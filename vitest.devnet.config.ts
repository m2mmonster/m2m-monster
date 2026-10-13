import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["m2m-source"] },
  ssr: { resolve: { conditions: ["m2m-source"] } },
  test: {
    include: ["packages/*/src/**/*.devnet.test.ts", "apps/*/src/**/*.devnet.test.ts"],
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
