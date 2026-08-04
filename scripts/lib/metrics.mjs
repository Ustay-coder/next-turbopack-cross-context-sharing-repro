export const CONTEXTS = ["neither", "route-only", "action-only", "both"];

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rounded(value) {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 1e6) / 1e6;
}

export function maxRelativeDeviation(values) {
  const average = mean(values);
  if (average === 0) return 0;
  return Math.max(...values.map((value) => Math.abs(value - average) / average));
}

export function deriveFactorialMetrics(values) {
  for (const context of CONTEXTS) {
    if (!Number.isFinite(values[context])) {
      throw new Error(`Missing metric for context: ${context}`);
    }
  }
  const baseline = values.neither;
  const routeIncrement = values["route-only"] - baseline;
  const actionIncrement = values["action-only"] - baseline;
  const bothIncrement = values.both - baseline;
  const secondContextCost = values.both - Math.max(values["route-only"], values["action-only"]);
  const interaction = values.both - values["route-only"] - values["action-only"] + baseline;
  const denominator = Math.min(routeIncrement, actionIncrement);
  const duplicationRatio = denominator >= 32 * 1024 ? secondContextCost / denominator : null;
  return Object.fromEntries(
    Object.entries({
      baseline,
      routeIncrement,
      actionIncrement,
      bothIncrement,
      secondContextCost,
      interaction,
      duplicationRatio,
    }).map(([key, value]) => [key, rounded(value)]),
  );
}

export function summarizeMatrix(cells, sourceEvidenceOverride = null) {
  const grouped = new Map();
  for (const cell of cells) {
    const key = `${cell.bundler}:${cell.context}`;
    const rows = grouped.get(key) ?? [];
    rows.push(cell);
    grouped.set(key, rows);
  }

  const results = {};
  for (const bundler of ["webpack", "turbopack"]) {
    const byContext = {};
    for (const context of CONTEXTS) {
      const rows = grouped.get(`${bundler}:${context}`) ?? [];
      if (rows.length === 0) throw new Error(`Missing cell: ${bundler}:${context}`);
      byContext[context] = rows;
    }
    const values = Object.fromEntries(
      CONTEXTS.map((context) => [
        context,
        Math.round(mean(byContext[context].map((row) => row.output.total.gzipBytes))),
      ]),
    );
    const runtimeChecks = byContext.both
      .map((row) => row.runtimeVerification)
      .filter(Boolean);
    results[bundler] = {
      runCount: Math.min(...CONTEXTS.map((context) => byContext[context].length)),
      values,
      factorial: deriveFactorialMetrics(values),
      stability: {
        evaluated: CONTEXTS.every((context) => byContext[context].length >= 3),
        maxRelativeDeviation: rounded(
          Math.max(
            ...CONTEXTS.map((context) =>
              maxRelativeDeviation(byContext[context].map((row) => row.output.total.gzipBytes)),
            ),
          ),
        ),
      },
      runtimeVerified: runtimeChecks.some((entry) => entry.passed === true),
    };
  }

  const bothTurbo = grouped.get("turbopack:both")?.at(-1);
  const sourceEvidence = sourceEvidenceOverride ?? bothTurbo?.output.sourceEvidence ?? null;
  const treatmentOverlap = sourceEvidence?.treatmentOverlap ?? null;
  const overallOverlap = sourceEvidence?.overallOverlap ?? null;
  const overallContentByteOverlapRatio = overallOverlap === null
    ? null
    : (overallOverlap.contentByteOverlapRatio ??
      (overallOverlap.identicalContentBytes /
        Math.min(sourceEvidence.server.contentBytes, sourceEvidence.ssr.contentBytes)));
  const turboRatio = results.turbopack.factorial.duplicationRatio;
  const webpackRatio = results.webpack.factorial.duplicationRatio;
  const gates = {
    turbopackSecondCopy:
      turboRatio !== null &&
      turboRatio >= 0.75 &&
      results.turbopack.factorial.secondContextCost >= 128 * 1024,
    webpackShares:
      webpackRatio !== null &&
      (webpackRatio <= 0.25 || turboRatio - webpackRatio >= 0.5),
    treatmentSourceOverlap:
      treatmentOverlap !== null &&
      (treatmentOverlap.sourceOverlapRatio ?? 0) >= 0.9 &&
      (treatmentOverlap.contentIdentityRatio ?? 0) >= 0.99,
    overallContentByteOverlap:
      overallOverlap !== null &&
      (overallContentByteOverlapRatio ?? 0) >= 0.9 &&
      (overallOverlap.contentIdentityRatio ?? 0) >= 0.99,
    stable:
      results.webpack.stability.evaluated &&
      results.turbopack.stability.evaluated &&
      results.webpack.stability.maxRelativeDeviation <= 0.01 &&
      results.turbopack.stability.maxRelativeDeviation <= 0.01,
    runtimeVerified: results.webpack.runtimeVerified && results.turbopack.runtimeVerified,
  };

  return {
    results,
    gates,
    decision: Object.values(gates).every(Boolean)
      ? "PROCEED_TO_PHASE_3"
      : "DO_NOT_PROCEED_TO_PHASE_3",
  };
}
