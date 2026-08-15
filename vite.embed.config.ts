import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Second build: the DOM-embed bundle. Separate from the Remix build because
// this produces a self-contained IIFE for a merchant's storefront, not a
// route graph.
//
// Runs AFTER `remix vite:build` (see package.json "build") and writes into
// build/client/embed/, which Remix serves statically — so the bundle ships
// from OUR origin and a runtime fix reaches every storefront on the next
// deploy, with no theme edit and no Shopify extension release. That preserves
// the update loop the iframe gives us today.
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
    outDir: "build/client/embed",
    // Remix has already populated build/client by the time this runs.
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
