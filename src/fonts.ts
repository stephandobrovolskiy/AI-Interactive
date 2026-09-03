import bricolage from "./fonts/bricolage-grotesque-latin.woff2?inline";

const STYLE_ID = "interactive-film-fonts";

/**
 * @font-face must live in the document, not in a shadow root, or Chrome will
 * not load it. The face is embedded in the bundle so the host page needs no
 * extra files. Calling this more than once is harmless.
 */
export function ensureFonts(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `@font-face {
  font-family: "Bricolage Grotesque";
  font-style: normal;
  font-weight: 400 800;
  font-display: swap;
  src: url(${bricolage}) format("woff2");
}`;
  document.head.append(style);
}
