/**
 * The quick-time event. While the clip plays, a tap mark sits on the scene
 * with a ring around it. Every tap on the stage adds to the ring; the ring
 * drains whenever the taps stop. The ring fights back: the fuller it is, the
 * less a tap adds and the faster it drains. Nothing is decided until the clip
 * ends; the ring has to be past the threshold at that moment.
 */

/** A pointing hand with two ripples at the fingertip. Drawn in one stroke weight. */
const TAP_MARK = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <path class="qte-ripple" d="M13.5 29.5 A14 14 0 1 1 34.5 29.5"/>
  <path class="qte-ripple qte-ripple-inner" d="M17.6 25.6 A8 8 0 1 1 28.4 25.6"/>
  <path class="qte-hand" d="M20.5 24.5 c-2.6-3.6 1.8-7.6 4.8-4.2 l11.6 16.2 c0.6-3 5.4-3.4 6.8-0.6 c1.6-2.8 6-2.4 7 0.6 c1.8-2.2 5.8-1.4 6.6 1.4 l5.6 10.6 c1.8 3.4 1.6 6.6 0.8 9.8 l-15.4 8.6 c-8-8-17.6-13.2-25.2-15.4 c-1-3 2.8-6 5.8-6 l4.4 1.2 z"/>
</svg>`;

export interface QteOptions {
  /** Ring added by a tap on an empty ring, 0..1. */
  gain: number;
  /** Ring drained per second from an empty ring, 0..1. */
  decay: number;
  /**
   * How hard the ring fights back, 0..1. At a full ring a tap adds
   * `gain * (1 - resistance)` and the drain is `decay * (1 + resistance)`.
   */
  resistance: number;
  /** The ring level that counts as a win when the clip ends, 0..1. */
  threshold: number;
}

export interface QteParts {
  root: HTMLDivElement;
  /** Whether the ring is past the threshold right now. Read when the clip ends. */
  readonly won: boolean;
  /** Freezes the ring and ignores taps. */
  pause: () => void;
  resume: () => void;
  /** Stops the loop. Does not remove the element. */
  dispose: () => void;
}

export function qteScreen(opts: QteOptions): QteParts {
  const root = document.createElement("div");
  root.className = "qte";
  root.setAttribute("role", "button");
  root.setAttribute("tabindex", "0");
  root.setAttribute("aria-label", "Tap, fast, until the end");

  const mark = document.createElement("div");
  mark.className = "qte-mark";

  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ring.setAttribute("class", "qte-ring");
  ring.setAttribute("viewBox", "0 0 100 100");
  ring.setAttribute("aria-hidden", "true");
  const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  track.setAttribute("class", "qte-track");
  track.setAttribute("cx", "50");
  track.setAttribute("cy", "50");
  track.setAttribute("r", "46");
  const fill = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  fill.setAttribute("class", "qte-fill");
  fill.setAttribute("cx", "50");
  fill.setAttribute("cy", "50");
  fill.setAttribute("r", "46");
  fill.setAttribute("pathLength", "1");
  ring.append(track, fill);

  const icon = document.createElement("div");
  icon.className = "qte-icon";
  icon.innerHTML = TAP_MARK;

  mark.append(ring, icon);
  root.append(mark);

  // ---------------------------------------------------------------------------
  // The ring
  // ---------------------------------------------------------------------------

  let progress = 0;
  let full = false;
  let held = false;
  let disposed = false;
  let last = 0;
  let raf = 0;

  const paint = () => {
    fill.style.strokeDashoffset = String(1 - progress);
    const nowFull = progress >= opts.threshold;
    if (nowFull !== full) {
      full = nowFull;
      if (full) root.setAttribute("data-full", "");
      else root.removeAttribute("data-full");
    }
  };
  paint();

  /** Drains the ring for the time since the last frame or tap. */
  const settle = (t: number) => {
    const dt = Math.min(0.5, Math.max(0, (t - last) / 1000));
    last = t;
    if (progress <= 0) return;
    const drain = opts.decay * (1 + opts.resistance * progress);
    progress = Math.max(0, progress - drain * dt);
  };

  const loop = (t: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    if (held) {
      last = t;
      return;
    }
    settle(t);
    paint();
  };

  const tap = () => {
    if (held || disposed) return;
    // Frames can be sparse (hidden tab, busy main thread): drain up to now first.
    settle(performance.now());
    const add = opts.gain * (1 - opts.resistance * progress);
    progress = Math.min(1, progress + add);
    paint();
    // Restart the pulse from the top even if the last one is still running.
    icon.removeAttribute("data-tap");
    void icon.offsetWidth;
    icon.setAttribute("data-tap", "");
  };

  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    tap();
  });
  for (const type of ["pointerup", "click"] as const) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }
  root.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) tap();
    }
  });

  requestAnimationFrame((t) => {
    last = t;
    root.setAttribute("data-in", "");
    raf = requestAnimationFrame(loop);
  });

  return {
    root,
    get won() {
      return progress >= opts.threshold;
    },
    pause: () => {
      held = true;
      root.setAttribute("data-held", "");
    },
    resume: () => {
      held = false;
      root.removeAttribute("data-held");
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
    },
  };
}
