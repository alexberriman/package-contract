import { defineConfig } from "vitest/config";

const config: ReturnType<typeof defineConfig> = defineConfig({
  test: {
    coverage: {
      exclude: [
        "dist/**",
        "research/**",
        "src/cli.ts",
        "src/probes/typescript-worker.ts",
        "test/**",
      ],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        branches: 90,
        functions: 100,
        lines: 95,
        statements: 95,
      },
    },
    environment: "node",
    hookTimeout: 30_000,
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
    testTimeout: 30_000,
  },
});

export default config;
