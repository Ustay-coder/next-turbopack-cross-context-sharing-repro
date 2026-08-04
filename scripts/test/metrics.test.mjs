import assert from "node:assert/strict";
import test from "node:test";
import { deriveFactorialMetrics, summarizeMatrix } from "../lib/metrics.mjs";

test("factorial metrics isolate the second-context cost", () => {
  const metrics = deriveFactorialMetrics({
    neither: 100_000,
    "route-only": 300_000,
    "action-only": 310_000,
    both: 500_000,
  });
  assert.equal(metrics.routeIncrement, 200_000);
  assert.equal(metrics.actionIncrement, 210_000);
  assert.equal(metrics.secondContextCost, 190_000);
  assert.equal(metrics.interaction, -10_000);
  assert.equal(metrics.duplicationRatio, 0.95);
});

test("small denominators are reported as not applicable", () => {
  const metrics = deriveFactorialMetrics({
    neither: 100_000,
    "route-only": 110_000,
    "action-only": 111_000,
    both: 120_000,
  });
  assert.equal(metrics.duplicationRatio, null);
});

function cellsFor(bundler, values) {
  return Object.entries(values).flatMap(([context, gzipBytes]) =>
    [1, 2, 3].map((run) => ({
      bundler,
      context,
      run,
      output: {
        total: { gzipBytes },
        sourceEvidence:
          bundler === "turbopack" && context === "both"
            ? {
                treatmentOverlap: {
                  sourceOverlapRatio: 1,
                  contentIdentityRatio: 1,
                },
                overallOverlap: {
                  contentByteOverlapRatio: 0.96,
                  contentIdentityRatio: 1,
                },
              }
            : null,
      },
      runtimeVerification:
        context === "both" && run === 1 ? { passed: true } : null,
    })),
  );
}

test("the canary gate proceeds for a stable Turbopack-only second copy", () => {
  const cells = [
    ...cellsFor("webpack", {
      neither: 1_000_000,
      "route-only": 1_200_000,
      "action-only": 1_210_000,
      both: 1_220_000,
    }),
    ...cellsFor("turbopack", {
      neither: 1_000_000,
      "route-only": 1_200_000,
      "action-only": 1_210_000,
      both: 1_410_000,
    }),
  ];
  const summary = summarizeMatrix(cells);
  assert.equal(summary.results.webpack.factorial.duplicationRatio, 0.05);
  assert.equal(summary.results.turbopack.factorial.duplicationRatio, 1);
  assert.equal(summary.decision, "PROCEED_TO_PHASE_3");
  assert.ok(Object.values(summary.gates).every(Boolean));
});
