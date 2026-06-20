import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: repoRoot,
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/shared/**/*.test.ts", "src/webview/**/*.test.ts", "src/webview/**/*.test.tsx", "src/desktop/**/*.test.ts", "src/desktop/**/*.test.tsx"],
    setupFiles: ["src/webview/test/setup.ts"],
    globals: false
  }
});
