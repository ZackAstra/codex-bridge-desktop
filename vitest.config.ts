import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["electron/bridge/__tests__/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
  },
});
