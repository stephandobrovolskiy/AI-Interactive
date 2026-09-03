import { defineConfig } from "vite";

// Three outputs from one source:
//  - `vite`                    -> the demo page (index.html) on a dev server
//  - `vite build`              -> dist/player.js, a single self-contained script for embedding
//  - `SITE=1 vite build`       -> site/, the demo page built for GitHub Pages
//    (`SITE=1 vite preview` serves that build under the same base path)
//
// Asset URLs in index.html and the story are relative, so the page works from
// any base path: the dev server root, a repository sub-path on GitHub Pages,
// or wherever a host page puts the media next to the player.
export default defineConfig(({ command }) => {
  if (process.env.SITE) {
    return {
      base: process.env.SITE_BASE ?? "/AI-Interactive/",
      build: {
        outDir: "site",
        emptyOutDir: true,
        sourcemap: false,
        assetsInlineLimit: 1024 * 1024,
      },
    };
  }
  if (command === "build") {
    return {
      build: {
        lib: {
          entry: "src/main.ts",
          name: "InteractiveFilm",
          formats: ["iife"],
          fileName: () => "player.js",
        },
        outDir: "dist",
        emptyOutDir: true,
        cssCodeSplit: false,
        sourcemap: true,
        assetsInlineLimit: 1024 * 1024,
      },
    };
  }
  // The preview tool hands out a port through PORT when 5173 is taken.
  return {
    server: {
      port: Number(process.env.PORT) || 5173,
      strictPort: true,
    },
  };
});
