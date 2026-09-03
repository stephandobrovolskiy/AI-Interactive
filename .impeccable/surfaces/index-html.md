---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: ["src/main.ts","src/player.ts"]
---

# Surface: player frame (index.html, src/)

Scope: the embeddable game frame only. Mode: Experience. Vertical 9:16 stage with a dark placeholder where video will play. No screens, controls, story logic.

Audience/job: mobile viewer of short vertical drama; on desktop the stage is centered on a dark page. Success: the frame reads as a game viewport, not a video player, and drops into any host page without style leakage.

Constraints: TypeScript + Vite, no framework, one JS bundle, Shadow DOM isolation, safe-area aware on mobile, aspect locked to 9:16. Palette pinned by brief: near-black blue ground, gold as hairline only. UI language English.

Deferred (user decision): full visual world for screens, direction roll (concept-seed) runs when screens are designed; page ground pure black vs deep blue (deep blue chosen provisionally).

## Direction contract

THESIS: The frame is a stage, not a player. No chrome, no controls, no progress; the viewport itself is the only object on the page.
OWN-WORLD: Deep blue-black ground (#070A10 family), stage a shade lighter, one 1px gold hairline at ~35% on desktop only, no radius on mobile, 8px on desktop. Face: system UI for nothing visible yet.
STORY: Viewer sees a dark portrait window and understands something is about to play.
FIRST VIEWPORT: Mobile: stage fills the screen edge to edge. Desktop: portrait stage centered, height-fit, faint gold edge, vignette fades page into stage.
SIGNATURE: The stage breathes once on mount: hairline fades in with 600ms exponential ease-out; nothing else moves.
RISK: Looks empty until video arrives; accepted by brief.

seed: deferred-to-screens
