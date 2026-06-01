import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";


export default defineConfig({

    plugins: [react()],
    base: "/",
    build: {
        outDir: "../dist/ui",
        emptyOutDir: true,
        rollupOptions: {
            input: {
                "sign-in": "sign-in.html", consent:
                    "consent.html"
            },
        },
    },
    server: {
        proxy: {
            "/api/auth": "http://127.0.0.1:3000",
            "/mcp": "http://127.0.0.1:3000",
        },
    },
});