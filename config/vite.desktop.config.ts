import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: path.join(repoRoot, "src", "desktop"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true
  },
  build: {
    outDir: path.join(repoRoot, "dist", "desktop"),
    emptyOutDir: true
  }
});
