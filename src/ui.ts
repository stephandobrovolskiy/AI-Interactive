/**
 * Small builders shared by every screen: the big-word list, the pressable
 * behavior, and the panel shell with its back control.
 */

const BACK_MARK = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const PAUSE_MARK = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M8.5 5.5v13M15.5 5.5v13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
</svg>`;

export interface WordItem {
  label: string;
  /** Secondary line under the word, optional. */
  detail?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * Pointer-down feedback, pointer-up commit, cancel on leave. Keyboard commits
 * after a short pressed frame so the eye sees the same thing as a tap.
 */
export function pressable(el: HTMLElement, onCommit: () => void): void {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    el.setAttribute("data-pressed", "");
  });
  const release = () => el.removeAttribute("data-pressed");
  el.addEventListener("pointerup", () => {
    if (!el.hasAttribute("data-pressed")) return;
    release();
    onCommit();
  });
  el.addEventListener("pointercancel", release);
  el.addEventListener("pointerleave", release);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      el.setAttribute("data-pressed", "");
      setTimeout(() => {
        release();
        onCommit();
      }, 120);
    }
  });
}

/** A vertical list of large words. Arrow keys move, Enter commits. */
export function wordList(items: WordItem[], label: string): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "words";
  nav.setAttribute("aria-label", label);

  const buttons: HTMLButtonElement[] = [];
  const setActive = (active: HTMLButtonElement) => {
    for (const b of buttons) {
      if (b === active) b.setAttribute("data-active", "");
      else b.removeAttribute("data-active");
    }
  };

  items.forEach((item, i) => {
    const button = document.createElement("button");
    button.className = "word";
    button.type = "button";
    button.style.setProperty("--i", String(i));
    if (item.disabled) button.setAttribute("aria-disabled", "true");

    const text = document.createElement("span");
    text.className = "word-label";
    text.textContent = item.label;
    button.append(text);

    if (item.detail) {
      const detail = document.createElement("span");
      detail.className = "word-detail";
      detail.textContent = item.detail;
      button.append(detail);
    }

    button.addEventListener("pointerenter", () => setActive(button));
    button.addEventListener("focus", () => setActive(button));
    button.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      const index = buttons.indexOf(button);
      buttons[(index + step + buttons.length) % buttons.length].focus({ preventScroll: true });
    });
    pressable(button, () => {
      if (item.disabled) return;
      item.onSelect();
    });

    buttons.push(button);
    nav.append(button);
  });

  return nav;
}

export interface PanelParts {
  root: HTMLDivElement;
  body: HTMLDivElement;
}

/** Full-stage screen with a scrim, a back control, and a title. */
export function panel(title: string, onBack: () => void, className = ""): PanelParts {
  const root = document.createElement("div");
  root.className = `panel ${className}`.trim();
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", title);

  const scrim = document.createElement("div");
  scrim.className = "panel-scrim";

  const head = document.createElement("div");
  head.className = "panel-head";

  const back = document.createElement("button");
  back.className = "back";
  back.type = "button";
  back.setAttribute("aria-label", "Back");
  back.innerHTML = BACK_MARK;
  pressable(back, onBack);

  const heading = document.createElement("h2");
  heading.className = "panel-title";
  heading.textContent = title;

  head.append(back, heading);

  const body = document.createElement("div");
  body.className = "panel-body";

  root.append(scrim, head, body);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onBack();
    }
  });

  return { root, body };
}
