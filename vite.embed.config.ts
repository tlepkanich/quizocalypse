import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Second build: the DOM-embed bundle. Separate from the Remix build because
// this produces a self-contained IIFE for a merchant's storefront, not a
// route graph.
//
// Runs AFTER `remix vite:build` (see package.json "build") and writes into
// build/embed/ — deliberately OUTSIDE build/client/.
//
// It lived in build/client/embed/ first, which remix-serve serves statically.
// That looked right and was wrong: remix-serve stamps EVERYTHING under
// build/client with `cache-control: public, max-age=31536000, immutable`.
// Correct for /assets/*, whose filenames are content-hashed, and actively
// harmful for a STABLE path like /embed/wiskr-embed.js — a browser that
// loaded the bundle once would keep it for a year and never revalidate, so a
// runtime fix would never reach that shopper. That silently destroys the one
// property this hosting choice exists for.
//
// So the bundle is served by a resource route instead
// (app/routes/embed.wiskr-embed[.]js.tsx), which sets a short revalidating
// cache. Static files win over routes in remix-serve, hence "outside".
//
// IIFE (not ES module) so the theme can load it with a plain
// <script defer src="..."> and `document.currentScript` resolves at module
// scope — that is how entry.tsx discovers our origin without configuration.
export default defineConfig({
  plugins: [tsconfigPaths()],
  // Vite's built-in esbuild handles the JSX, so this needs no
  // @vitejs/plugin-react dependency — that plugin exists for Fast Refresh,
  // which a production library build has no use for. "automatic" matches
  // tsconfig's "jsx": "react-jsx", so the runtime tree compiles identically
  // here and under the Remix build.
  esbuild: { jsx: "automatic" },
  // The Remix build already copies public/ into build/client. Without this,
  // Vite copies it AGAIN into build/client/embed/ — duplicate fonts, favicons
  // and art-directions shipped on every deploy.
  publicDir: false,
  define: {
    // React reads this; without it the bundle ships the dev build, which is
    // both larger and far slower.
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "build/embed",
    // `remix vite:build` runs first and clears build/client; this directory
    // is written afterwards and must not be wiped by its own re-runs either.
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: "app/embed/entry.tsx",
      name: "WiskrEmbed",
      formats: ["iife"],
      fileName: () => "wiskr-embed.js",
    },
    rollupOptions: {
      // Nothing external: the merchant's page has no React, so it all ships.
      output: { inlineDynamicImports: true },
    },
  },
});
