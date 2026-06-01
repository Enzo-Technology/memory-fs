import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const dir = import.meta.dirname; // .../ui — config sits next to the html entries

export default defineConfig({
    plugins: [react()],
    base: "/",
    build: {
        outDir: "../dist/ui",
        emptyOutDir: true,
        rollupOptions: {
            input: {
                "sign-in": resolve(dir, "sign-in.html"),
                consent: resolve(dir, "consent.html"),
            },
        },
    },
    // No dev server here on purpose: `npm run dev:ui` is `vite build --watch`, so the
    // Node server (src/lib/auth-ui.ts) serves these pages same-origin with /api/auth in
    // both dev and prod. One origin = no cookie/redirect_uri drift between dev and prod.
});