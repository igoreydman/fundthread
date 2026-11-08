import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const browserPolicy =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'";
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === "browser"
      ? [
          {
            name: "browser-security-policy",
            apply: "build" as const,
            generateBundle() {
              this.emitFile({
                type: "asset",
                fileName: "_headers",
                source: `/*
  Content-Security-Policy: ${browserPolicy}
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
`,
              });
            },
            transformIndexHtml() {
              return [
                {
                  tag: "meta",
                  attrs: {
                    "http-equiv": "Content-Security-Policy",
                    content: browserPolicy,
                  },
                  injectTo: "head-prepend" as const,
                },
                {
                  tag: "meta",
                  attrs: { name: "referrer", content: "no-referrer" },
                  injectTo: "head-prepend" as const,
                },
              ];
            },
          },
        ]
      : []),
  ],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  preview: {
    headers:
      mode === "browser"
        ? {
            "Content-Security-Policy": browserPolicy,
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
          }
        : {},
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
}));
