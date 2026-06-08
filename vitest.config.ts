import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/shared/**/*.test.ts", "src/webview/**/*.test.ts", "src/webview/**/*.test.tsx", "src/desktop/**/*.test.ts", "src/desktop/**/*.test.tsx"],
    setupFiles: ["src/webview/test/setup.ts"],
    globals: false
  }
});
