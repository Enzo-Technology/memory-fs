import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Single-page app: Vite uses ui/index.html as the entry automatically, so no explicit
// rollup input is needed (and no relative-path resolution to trip rolldown's dev scan).
export default defineConfig({
    plugins: [react()],
    base: "/",
    build: {
        outDir: "../dist/ui",
        emptyOutDir: true,
    },
    // No dev server here on purpose: `npm run dev:ui` is `vite build --watch`, so the
    // Node server (src/lib/auth-ui.ts) serves the app same-origin with /api/auth in both
    // dev and prod. One origin = no cookie/redirect_uri drift between dev and prod.
});