import { renderMap } from "./map";
import { preloadClips } from "./preload";
import {
  SLOT_COUNT,
  formatSavedAt,
  readSlots,
  writeSlot,
  type SaveSlot,
} from "./saves";
import { nodeById, storyClips, storyTracks, type Story } from "./story";
import { panel, wordList } from "./ui";

/* ---------------------------------------------------------------------------
 * Loading
 * ------------------------------------------------------------------------- */

export interface LoadingParts {
  root: HTMLDivElement;
  /** Resolves when every clip is cached and the minimum display time has passed. */
  done: Promise<void>;
  abort: () => void;
}

const LOADING_MIN_MS = 1400;

export function loadingScreen(story: Story, caption: string): LoadingParts {
  const root = document.createElement("div");
  root.className = "panel loading";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  const scrim = document.createElement("div");
  scrim.className = "panel-scrim";

  const copy = document.createElement("div");
  copy.className = "loading-copy";

  const title = document.createElement("p");
  title.className = "loading-title";
  title.textContent = caption;

  const meter = document.createElement("div");
  meter.className = "meter";
  const fill = document.createElement("div");
  fill.className = "meter-fill";
  meter.append(fill);

  const status = document.createElement("p");
  status.className = "loading-status";
  status.textContent = "Preparing scenes";

  copy.append(title, meter, status);
  root.append(scrim, copy);

  const controller = new AbortController();
  const started = performance.now();

  const setRatio = (r: number) => {
    fill.style.transform = `scaleX(${Math.max(0.02, r)})`;
  };
  setRatio(0);

  const work = preloadClips(
    [...storyClips(story), ...storyTracks(story)],
    (p) => {
      setRatio(p.ratio);
      if (p.totalBytes > 0) {
        const mb = (n: number) => (n / 1048576).toFixed(1);
        status.textContent = `${mb(p.loadedBytes)} of ${mb(p.totalBytes)} MB`;
      }
    },
    controller.signal,
  );

  const done = work
    .then(async () => {
      setRatio(1);
      status.textContent = "Ready";
      const elapsed = performance.now() - started;
      if (elapsed < LOADING_MIN_MS) {
        await new Promise((r) => setTimeout(r, LOADING_MIN_MS - elapsed));
      }
    })
    .catch((err: unknown) => {
      if (controller.signal.aborted) return;
      status.textContent = "Could not load the scenes";
      throw err;
    });

  return { root, done, abort: () => controller.abort() };
}

/* ---------------------------------------------------------------------------
 * Save slots (load or save)
 * ------------------------------------------------------------------------- */

export interface SlotsOptions {
  mode: "load" | "save";
  story: Story;
  poster: string;
  onBack: () => void;
  /** Load mode: a slot was chosen. */
  onLoad?: (slot: SaveSlot) => void;
  /** Save mode: what to write. */
  current?: { nodeId: string; path: string[] };
  /** Save mode: written. */
  onSaved?: (slot: SaveSlot) => void;
}

export function slotsScreen(opts: SlotsOptions): HTMLDivElement {
  const { root, body } = panel(opts.mode === "load" ? "Load" : "Save", opts.onBack, "slots");
  const list = document.createElement("div");
  list.className = "slot-list";

  const slots = readSlots();
  for (let i = 0; i < SLOT_COUNT; i++) {
    list.append(slotRow(i, slots[i], opts, (updated) => {
      slots[i] = updated;
    }));
  }

  body.append(list);
  return root;
}

function slotRow(
  index: number,
  slot: SaveSlot | null,
  opts: SlotsOptions,
  onWrite: (slot: SaveSlot) => void,
): HTMLButtonElement {
  const row = document.createElement("button");
  row.className = "slot";
  row.type = "button";
  row.style.setProperty("--i", String(index));

  const thumb = document.createElement("div");
  thumb.className = "slot-thumb";
  if (slot) {
    const img = document.createElement("img");
    img.src = opts.poster;
    img.alt = "";
    img.draggable = false;
    thumb.append(img);
  }

  const text = document.createElement("div");
  text.className = "slot-text";
  const name = document.createElement("span");
  name.className = "slot-name";
  const meta = document.createElement("span");
  meta.className = "slot-meta";

  const paint = (s: SaveSlot | null) => {
    if (s) {
      name.textContent = s.nodeTitle;
      meta.textContent = `Slot ${index + 1}, ${formatSavedAt(s.savedAt)}`;
      row.removeAttribute("data-empty");
    } else {
      name.textContent = "Empty";
      meta.textContent = `Slot ${index + 1}`;
      row.setAttribute("data-empty", "");
    }
  };
  paint(slot);

  text.append(name, meta);
  row.append(thumb, text);

  const disabled = opts.mode === "load" && !slot;
  if (disabled) row.setAttribute("aria-disabled", "true");

  row.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || disabled) return;
    row.setAttribute("data-pressed", "");
  });
  const release = () => row.removeAttribute("data-pressed");
  const commit = () => {
    if (disabled) return;
    if (opts.mode === "load" && slot) {
      opts.onLoad?.(slot);
      return;
    }
    if (opts.mode === "save" && opts.current) {
      const node = nodeById(opts.story, opts.current.nodeId);
      const written = writeSlot(index, {
        nodeId: node.id,
        nodeTitle: node.title,
        path: opts.current.path,
      });
      slot = written;
      onWrite(written);
      if (!thumb.firstChild) {
        const img = document.createElement("img");
        img.src = opts.poster;
        img.alt = "";
        img.draggable = false;
        thumb.append(img);
      }
      paint(written);
      row.setAttribute("data-saved", "");
      setTimeout(() => row.removeAttribute("data-saved"), 900);
      opts.onSaved?.(written);
    }
  };
  row.addEventListener("pointerup", () => {
    if (!row.hasAttribute("data-pressed")) return;
    release();
    commit();
  });
  row.addEventListener("pointercancel", release);
  row.addEventListener("pointerleave", release);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      row.setAttribute("data-pressed", "");
      setTimeout(() => {
        release();
        commit();
      }, 120);
    }
  });

  return row;
}

/* ---------------------------------------------------------------------------
 * Progress map
 * ------------------------------------------------------------------------- */

export function progressScreen(
  story: Story,
  seen: Set<string>,
  current: string | null,
  onBack: () => void,
): HTMLDivElement {
  const { root, body } = panel("Progress", onBack, "progress");

  const summary = document.createElement("p");
  summary.className = "progress-summary";
  const reached = [...seen].filter((id) => story.nodes.some((n) => n.id === id)).length;
  const endings = story.nodes.filter((n) => n.kind === "ending");
  const endingsFound = endings.filter((n) => seen.has(n.id)).length;
  summary.textContent = `${reached} of ${story.nodes.length} scenes reached. ${endingsFound} of ${endings.length} endings found.`;

  const scroller = document.createElement("div");
  scroller.className = "map-scroll";
  scroller.append(renderMap(story, { seen, current }));

  body.append(summary, scroller);
  return root;
}

/* ---------------------------------------------------------------------------
 * Pause
 * ------------------------------------------------------------------------- */

export interface PauseHandlers {
  onResume: () => void;
  onProgress: () => void;
  onSave: () => void;
  onQuit: () => void;
  /**
   * The sequence has run out. Nothing to resume, nothing to save past this
   * point: the only way on is back to the menu.
   */
  final?: boolean;
}

export function pauseScreen(handlers: PauseHandlers): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "panel pause";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Paused");

  const scrim = document.createElement("div");
  scrim.className = "panel-scrim";

  const head = document.createElement("p");
  head.className = "pause-head";
  head.textContent = "Paused";

  const list = wordList(
    handlers.final
      ? [{ label: "Quit to menu", onSelect: handlers.onQuit }]
      : [
          { label: "Resume", onSelect: handlers.onResume },
          { label: "Progress", onSelect: handlers.onProgress },
          { label: "Save", onSelect: handlers.onSave },
          { label: "Quit to menu", onSelect: handlers.onQuit },
        ],
    "Pause menu",
  );

  root.append(scrim, head, list);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !handlers.final) {
      e.preventDefault();
      handlers.onResume();
    }
  });
  return root;
}

/* ---------------------------------------------------------------------------
 * Defeat
 * The pause menu's shape, after a lost fight: nothing to resume.
 * ------------------------------------------------------------------------- */

export interface DefeatHandlers {
  onRetry: () => void;
  onLoad: () => void;
  onQuit: () => void;
}

export function defeatScreen(handlers: DefeatHandlers): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "panel pause defeat";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "You lost");

  const scrim = document.createElement("div");
  scrim.className = "panel-scrim";

  const head = document.createElement("p");
  head.className = "pause-head";
  head.textContent = "You lost";

  const list = wordList(
    [
      { label: "Try again", onSelect: handlers.onRetry },
      { label: "Load", onSelect: handlers.onLoad },
      { label: "Quit to menu", onSelect: handlers.onQuit },
    ],
    "Defeat menu",
  );

  root.append(scrim, head, list);
  return root;
}
