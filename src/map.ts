import { nextIds, type Story, type StoryNode } from "./story";

const SVG_NS = "http://www.w3.org/2000/svg";

interface Placed {
  node: StoryNode;
  depth: number;
  x: number;
  y: number;
}

/**
 * Longest-path depth so a merge sits below both of the branches feeding it.
 */
function computeDepths(story: Story): Map<string, number> {
  const depth = new Map<string, number>();
  const byId = new Map(story.nodes.map((n) => [n.id, n]));
  const visit = (id: string, d: number) => {
    const known = depth.get(id) ?? -1;
    if (d <= known) return;
    depth.set(id, d);
    const node = byId.get(id);
    if (!node) return;
    for (const next of nextIds(node)) visit(next, d + 1);
  };
  visit(story.start, 0);
  return depth;
}

function layout(story: Story): { placed: Placed[]; rows: number } {
  const depths = computeDepths(story);
  const rows = Math.max(...depths.values()) + 1;
  const byDepth = new Map<number, StoryNode[]>();
  for (const node of story.nodes) {
    const d = depths.get(node.id);
    if (d === undefined) continue;
    const list = byDepth.get(d) ?? [];
    list.push(node);
    byDepth.set(d, list);
  }

  const placed: Placed[] = [];
  for (const [d, list] of byDepth) {
    list.forEach((node, i) => {
      placed.push({
        node,
        depth: d,
        x: (i + 1) / (list.length + 1),
        y: rows === 1 ? 0.5 : d / (rows - 1),
      });
    });
  }
  return { placed, rows };
}

export interface MapState {
  /** Nodes ever reached. */
  seen: Set<string>;
  /** Where the current run stands, if a run exists. */
  current: string | null;
}

/**
 * Draws the story as a vertical graph with fog of war:
 * reached nodes are lit and named, their unexplored neighbours are outlined,
 * everything further is a faint mark with no name.
 */
export function renderMap(story: Story, state: MapState): SVGSVGElement {
  const { placed, rows } = layout(story);
  const W = 300;
  const ROW = 72;
  const PAD_X = 44;
  const PAD_Y = 40;
  const H = PAD_Y * 2 + ROW * (rows - 1);

  const frontier = new Set<string>();
  for (const p of placed) {
    if (!state.seen.has(p.node.id)) continue;
    for (const next of nextIds(p.node)) {
      if (!state.seen.has(next)) frontier.add(next);
    }
  }

  const pos = new Map<string, { x: number; y: number }>();
  for (const p of placed) {
    pos.set(p.node.id, { x: PAD_X + p.x * (W - PAD_X * 2), y: PAD_Y + p.y * (H - PAD_Y * 2) });
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "map");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Story map, ${state.seen.size} of ${story.nodes.length} scenes reached`);

  const edges = document.createElementNS(SVG_NS, "g");
  edges.setAttribute("class", "map-edges");
  const nodes = document.createElementNS(SVG_NS, "g");
  nodes.setAttribute("class", "map-nodes");

  for (const p of placed) {
    const from = pos.get(p.node.id)!;
    for (const next of nextIds(p.node)) {
      const to = pos.get(next);
      if (!to) continue;
      const path = document.createElementNS(SVG_NS, "path");
      const midY = (from.y + to.y) / 2;
      path.setAttribute(
        "d",
        `M${from.x} ${from.y} C${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`,
      );
      const lit = state.seen.has(p.node.id) && state.seen.has(next);
      const half = state.seen.has(p.node.id) && frontier.has(next);
      path.setAttribute("class", lit ? "is-seen" : half ? "is-frontier" : "is-fog");
      edges.append(path);
    }
  }

  for (const p of placed) {
    const at = pos.get(p.node.id)!;
    const seen = state.seen.has(p.node.id);
    const near = frontier.has(p.node.id);
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", `translate(${at.x} ${at.y})`);
    g.setAttribute(
      "class",
      [
        "map-node",
        `kind-${p.node.kind}`,
        seen ? "is-seen" : near ? "is-frontier" : "is-fog",
        p.node.id === state.current ? "is-current" : "",
      ]
        .filter(Boolean)
        .join(" "),
    );

    if (p.node.id === state.current) {
      const halo = document.createElementNS(SVG_NS, "circle");
      halo.setAttribute("r", "13");
      halo.setAttribute("class", "map-halo");
      g.append(halo);
    }

    let shape: SVGElement;
    if (p.node.kind === "choice") {
      shape = document.createElementNS(SVG_NS, "rect");
      shape.setAttribute("x", "-6");
      shape.setAttribute("y", "-6");
      shape.setAttribute("width", "12");
      shape.setAttribute("height", "12");
      shape.setAttribute("transform", "rotate(45)");
    } else if (p.node.kind === "qte") {
      shape = document.createElementNS(SVG_NS, "path");
      shape.setAttribute("d", "M0 -7.5 L7 5 L-7 5 Z");
    } else if (p.node.kind === "defeat") {
      shape = document.createElementNS(SVG_NS, "circle");
      shape.setAttribute("r", "6");
      const cross = document.createElementNS(SVG_NS, "path");
      cross.setAttribute("d", "M-2.6 -2.6 L2.6 2.6 M2.6 -2.6 L-2.6 2.6");
      cross.setAttribute("class", "map-cross");
      g.append(cross);
    } else if (p.node.kind === "ending") {
      shape = document.createElementNS(SVG_NS, "circle");
      shape.setAttribute("r", "7");
      const inner = document.createElementNS(SVG_NS, "circle");
      inner.setAttribute("r", "3");
      inner.setAttribute("class", "map-core");
      g.append(inner);
    } else {
      shape = document.createElementNS(SVG_NS, "circle");
      shape.setAttribute("r", "5.5");
    }
    shape.setAttribute("class", "map-shape");
    g.prepend(shape);

    if (seen || near) {
      const label = document.createElementNS(SVG_NS, "text");
      // Labels point outward, so two branches in one row never meet in the middle.
      const left = at.x < W / 2;
      label.setAttribute("x", left ? "-14" : "14");
      label.setAttribute("y", "0");
      label.setAttribute("dominant-baseline", "middle");
      label.setAttribute("text-anchor", left ? "end" : "start");
      label.setAttribute("class", "map-label");
      label.textContent = seen ? p.node.title : "Unknown";
      g.append(label);
    }

    nodes.append(g);
  }

  svg.append(edges, nodes);
  return svg;
}
