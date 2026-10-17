import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["m2m-source"] },
  ssr: { resolve: { conditions: ["m2m-source"] } },
  test: {
    include: ["apps/*/src/**/*.prod-smoke.test.ts"],
    testTimeout: 60_000,
  },
});
