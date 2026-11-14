import type { NextConfig } from "next";
import path from "node:path";

// A stray parent-directory package.json + package-lock.json (e.g. in a home folder)
// makes Turbopack infer the workspace root one level above this project (it
// detects roots via lockfiles — see Next 16 docs:
// node_modules/.../docs/01-app/03-api-reference/05-config/01-next-config-js/turbopack.md
// "Root directory"). The parent has no node_modules/tailwindcss, so `next dev`
// crashes resolving `@import "tailwindcss"` from globals.css with
// `Can't resolve 'tailwindcss' in '<parent directory>'`.
//
// Fixes applied below (all rooting resolution at THIS project, per the docs):
//   - turbopack.root: pins the module-resolution root to this dir.
//   - turbopack.resolveAlias: explicitly maps the bare `tailwindcss` specifier
//     to this project's own copy, so CSS resolution cannot walk up to the
//     parent even if root inference misfires (turbopack.md "Resolving aliases").
//   - outputFileTracingRoot: keeps build/trace rooted here, not the parent
//     lockfile (output.md "outputFileTracingRoot").
const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
    resolveAlias: {
      tailwindcss: path.join(__dirname, "node_modules/tailwindcss"),
    },
  },
};

export default nextConfig;
