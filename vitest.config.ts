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
        branches: 80,
        functions: 95,
        lines: 85,
        statements: 85,
      },
    },
    environment: "node",
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
  },
});

export default config;
