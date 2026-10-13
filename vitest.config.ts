import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["m2m-source"] },
  ssr: { resolve: { conditions: ["m2m-source"] } },
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    exclude: ["**/*.devnet.test.ts", "**/*.smoke.test.ts", "**/node_modules/**", "**/dist/**"],
  },
});
