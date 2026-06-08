import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    // Vitest 4 removed `poolOptions`; the old `forks.singleFork` was silently
    // ignored, so the suite ran files in PARALLEL forks. That parallelism made
    // the deploy gate nondeterministic — identical code passed one CI run and
    // failed the next (the browse-api delete flake). Force sequential file
    // execution so the gate is reproducible. `isolate` (default true) still
    // gives each file a fresh module/state context.
    fileParallelism: false,
    testTimeout: 10_000,
  },
});
