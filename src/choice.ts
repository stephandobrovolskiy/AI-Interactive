/**
 * The choice screen. The last frame of the clip that just ended is split
 * corner to corner by a crack. Each half holds one option: it grows and takes
 * its colour (gold upper right, silver lower left) while hovered or pressed,
 * and commits on release. A bar across the top runs the clock down; when it
 * runs out, one option is taken at random.
 */

import type { StoryOption } from "./story";

/**
 * The crack, corner to corner, in percent of the stage. Kinks stay within a
 * few percent of the diagonal so the halves read as halves.
 */
const CRACK: Array<[number, number]> = [
  [0, 0],
  [9, 12],
  [7, 16],
  [21, 27],
  [26, 29],
  [38, 43],
  [35, 48],
  [51, 59],
  [56, 61],
  [69, 75],
  [66, 80],
  [83, 91],
  [88, 93],
  [100, 100],
];

const REVEAL_MS = 420;
const COMMIT_MS = 220;

const pct = (n: number) => `${n}%`;

function polygonUpperRight(): string {
  const pts = [...CRACK.map(([x, y]) => `${pct(x)} ${pct(y)}`), `${pct(100)} ${pct(0)}`];
  return `polygon(${pts.join(", ")})`;
}

function polygonLowerLeft(): string {
  const pts = [...CRACK.map(([x, y]) => `${pct(x)} ${pct(y)}`), `${pct(0)} ${pct(100)}`];
  return `polygon(${pts.join(", ")})`;
}

function crackPath(): string {
  return CRACK.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
}

export interface ChoiceHandlers {
  /** The viewer picked, or the clock picked for them. */
  onChoose: (index: 0 | 1, byTimeout: boolean) => void;
}

export interface ChoiceParts {
  root: HTMLDivElement;
  /** Holds the clock; the halves stay where they are. */
  pause: () => void;
  resume: () => void;
  /** Drops the clock and the listeners. Does not remove the element. */
  dispose: () => void;
}

/**
 * @param frame  A canvas holding the frame the choice opens on.
 * @param options  The two options: first upper right, second lower left.
 * @param seconds  Time on the clock.
 */
export function choiceScreen(
  frame: HTMLCanvasElement,
  options: [StoryOption, StoryOption],
  seconds: number,
  handlers: ChoiceHandlers,
): ChoiceParts {
  const root = document.createElement("div");
  root.className = "choice";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Your choice");

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Halves. Each carries its own copy of the frozen frame so it can grow on
  // its own, clipped to its side of the crack.
  const halves: HTMLButtonElement[] = [];
  const make = (index: 0 | 1) => {
    const half = document.createElement("button");
    half.className = "choice-half";
    half.type = "button";
    half.setAttribute("data-side", index === 0 ? "upper" : "lower");
    half.style.clipPath = index === 0 ? polygonUpperRight() : polygonLowerLeft();

    const copy = document.createElement("canvas");
    copy.className = "choice-frame";
    copy.width = frame.width;
    copy.height = frame.height;
    copy.getContext("2d")?.drawImage(frame, 0, 0);
    copy.setAttribute("aria-hidden", "true");

    const tint = document.createElement("div");
    tint.className = "choice-tint";

    const label = document.createElement("span");
    label.className = "choice-label";
    label.textContent = options[index].label;

    // Each half carries its own edge of the crack, so the edge moves with the
    // half when it grows. The clip cuts the stroke in half along the crack;
    // the ground shows through the gap between the two edges.
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "choice-crack");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const edge = document.createElementNS("http://www.w3.org/2000/svg", "path");
    edge.setAttribute("class", "choice-edge");
    edge.setAttribute("d", crackPath());
    // Normalised length so the edge can draw itself with a 1 → 0 dash offset.
    edge.setAttribute("pathLength", "1");
    svg.append(edge);

    half.append(copy, tint, svg, label);
    halves.push(half);
    return half;
  };
  const upper = make(0);
  const lower = make(1);

  // The clock.
  const clock = document.createElement("div");
  clock.className = "choice-clock";
  clock.setAttribute("role", "timer");
  clock.setAttribute("aria-label", `${seconds} seconds to choose`);
  const fill = document.createElement("div");
  fill.className = "choice-clock-fill";
  clock.append(fill);

  root.append(upper, lower, clock);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let settled = false;
  let active: 0 | 1 | null = null;
  let clockAnim: Animation | null = null;

  const setActive = (index: 0 | 1 | null) => {
    if (settled) return;
    active = index;
    halves.forEach((h, i) => {
      if (i === index) h.setAttribute("data-active", "");
      else h.removeAttribute("data-active");
    });
    if (index === null) root.removeAttribute("data-active");
    else root.setAttribute("data-active", index === 0 ? "upper" : "lower");
  };

  const commit = (index: 0 | 1, byTimeout: boolean) => {
    if (settled) return;
    settled = true;
    clockAnim?.pause();
    root.setAttribute("data-chosen", index === 0 ? "upper" : "lower");
    halves.forEach((h, i) => {
      h.removeAttribute("data-pressed");
      if (i === index) h.setAttribute("data-chosen", "");
      else h.setAttribute("data-lost", "");
      h.setAttribute("tabindex", "-1");
    });
    setTimeout(() => handlers.onChoose(index, byTimeout), reduced ? 0 : COMMIT_MS);
  };

  // ---------------------------------------------------------------------------
  // Input: feedback on the way down, commit on the way up, cancel on leave.
  // ---------------------------------------------------------------------------

  halves.forEach((half, i) => {
    const index = i as 0 | 1;
    half.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") setActive(index);
    });
    half.addEventListener("pointerleave", () => {
      half.removeAttribute("data-pressed");
      if (active === index) setActive(null);
    });
    half.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || settled) return;
      try {
        half.setPointerCapture(e.pointerId);
      } catch {
        // A synthetic event with no live pointer: nothing to capture.
      }
      half.setAttribute("data-pressed", "");
      setActive(index);
    });
    half.addEventListener("pointerup", (e) => {
      if (!half.hasAttribute("data-pressed")) return;
      half.removeAttribute("data-pressed");
      // A finger that slid off the half before lifting cancels.
      const under = root.getRootNode() instanceof ShadowRoot
        ? (root.getRootNode() as ShadowRoot).elementFromPoint(e.clientX, e.clientY)
        : document.elementFromPoint(e.clientX, e.clientY);
      if (under && !half.contains(under)) {
        setActive(null);
        return;
      }
      commit(index, false);
    });
    half.addEventListener("pointercancel", () => {
      half.removeAttribute("data-pressed");
      setActive(null);
    });
    half.addEventListener("focus", () => setActive(index));
    half.addEventListener("blur", () => {
      if (active === index && !half.matches(":hover")) setActive(null);
    });
    half.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        // Space would otherwise reach the scene and pause it.
        e.preventDefault();
        e.stopPropagation();
        half.setAttribute("data-pressed", "");
        setTimeout(() => commit(index, false), 120);
      } else if (
        e.key === "ArrowUp" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft"
      ) {
        e.preventDefault();
        e.stopPropagation();
        const other = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0 : 1;
        halves[other].focus({ preventScroll: true });
      }
    });
  });

  // Taps land on the halves; nothing underneath should see them.
  for (const type of ["pointerdown", "pointerup", "click"] as const) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }

  // ---------------------------------------------------------------------------
  // Reveal, then the clock
  // ---------------------------------------------------------------------------

  const startClock = () => {
    if (settled || held || clockAnim) return;
    clockAnim = fill.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
      duration: seconds * 1000,
      easing: "linear",
      fill: "forwards",
    });
    clockAnim.onfinish = () => commit(Math.random() < 0.5 ? 0 : 1, true);
  };

  let held = false;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.setAttribute("data-in", "");
      // The crack has to finish opening before the clock starts running.
      setTimeout(startClock, reduced ? 0 : REVEAL_MS);
    });
  });
  const pause = () => {
    if (held || settled) return;
    held = true;
    clockAnim?.pause();
    root.setAttribute("data-held", "");
  };
  const resume = () => {
    if (!held) return;
    held = false;
    root.removeAttribute("data-held");
    if (clockAnim) clockAnim.play();
    else if (root.hasAttribute("data-in")) startClock();
  };
  const dispose = () => {
    settled = true;
    clockAnim?.cancel();
    clockAnim = null;
  };

  return { root, pause, resume, dispose };
}
