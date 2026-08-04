import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeOutput } from "./analyze-output.mjs";
import { generateCell } from "./generate-cell.mjs";
import { sameEnvironment } from "./lib/environment.mjs";
import { CONTEXTS, summarizeMatrix } from "./lib/metrics.mjs";
import { verifyRuntime } from "./verify-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workRoot = resolve(root, ".repro-work");
const runResultRoot = resolve(root, "results/runs");
const logRoot = resolve(root, "results/logs");

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    result[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

async function runCommand(label, command, args, { captureOnly = false, env = {} } = {}) {
  await mkdir(logRoot, { recursive: true });
  return await new Promise((resolveRun, reject) => {
    const output = [];
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        output.push(text);
        if (!captureOnly) process.stdout.write(text);
      });
    }
    child.once("error", reject);
    child.once("exit", async (code, signal) => {
      const text = output.join("");
      await writeFile(resolve(logRoot, `${label}.log`), text);
      if (code === 0) resolveRun(text);
      else reject(new Error(`${label} failed with code=${code} signal=${signal}\n${text.slice(-3000)}`));
    });
  });
}

function buildOrder(run, bundlers) {
  const contextOrder = run % 2 === 1
    ? ["neither", "both", "route-only", "action-only"]
    : ["action-only", "route-only", "both", "neither"];
  const rows = [];
  for (const context of contextOrder) {
    const orderedBundlers = (rows.length + run) % 2 === 0 ? bundlers : [...bundlers].reverse();
    for (const bundler of orderedBundlers) rows.push({ run, context, bundler });
  }
  return rows;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function environmentInfo() {
  const [packageJson, reproMetadata, nextPackage, reactPackage, reactDomPackage, lockfile, nextInfo] =
    await Promise.all([
      readFile(resolve(root, "package.json"), "utf8").then(JSON.parse),
      readFile(resolve(root, "repro-metadata.json"), "utf8").then(JSON.parse),
      readFile(resolve(root, "node_modules/next/package.json"), "utf8").then(JSON.parse),
      readFile(resolve(root, "node_modules/react/package.json"), "utf8").then(JSON.parse),
      readFile(resolve(root, "node_modules/react-dom/package.json"), "utf8").then(JSON.parse),
      readFile(resolve(root, "pnpm-lock.yaml")),
      runCommand("next-info", "pnpm", ["exec", "next", "info"], { captureOnly: true }),
    ]);
  const pnpmVersion = (await runCommand("pnpm-version", "pnpm", ["--version"], { captureOnly: true })).trim();
  return {
    packageManager: packageJson.packageManager,
    node: process.version,
    pnpm: pnpmVersion,
    platform: process.platform,
    arch: process.arch,
    next: nextPackage.version,
    nextTag: reproMetadata.nextTag,
    nextCommit: reproMetadata.nextCommit,
    react: reactPackage.version,
    reactDom: reactDomPackage.version,
    lockfileSha256: sha256(lockfile),
    nextInfo: nextInfo.trim(),
  };
}

function formatBytes(value) {
  const sign = value < 0 ? "-" : "";
  return `${sign}${(Math.abs(value) / 1024).toFixed(2)} KiB`;
}

function resultMarkdown(result) {
  const lines = [
    "# Next.js canary cross-context sharing result",
    "",
    `Decision: **${result.decision}**`,
    "",
    `Next.js: \`${result.environment.next}\``,
    `Next.js tag commit: \`${result.environment.nextCommit}\``,
    `React: \`${result.environment.react}\``,
    `Node: \`${result.environment.node}\``,
    `pnpm: \`${result.environment.pnpm}\``,
    `Platform: \`${result.environment.platform} ${result.environment.arch}\``,
    "",
    "Primary metric: sum of level-9 gzip bytes for each JavaScript file under `.next/server`.",
    "The 24 primary builds use the default Next.js configuration without enabling `experimental.serverSourceMaps`.",
    "Source identity is measured in one separate Turbopack `both` diagnostic build with that option enabled.",
    "",
    "| Bundler | Baseline | Route increment | Action increment | Both increment | Second-context cost | Duplication ratio | Max deviation | Runtime |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const bundler of ["turbopack", "webpack"]) {
    const row = result.results[bundler];
    const metric = row.factorial;
    lines.push(
      `| ${bundler} | ${formatBytes(metric.baseline)} | ${formatBytes(metric.routeIncrement)} | ${formatBytes(metric.actionIncrement)} | ${formatBytes(metric.bothIncrement)} | **${formatBytes(metric.secondContextCost)}** | **${metric.duplicationRatio?.toFixed(3) ?? "n/a"}** | ${(row.stability.maxRelativeDeviation * 100).toFixed(4)}% | ${row.runtimeVerified ? "pass" : "fail"} |`,
    );
  }
  lines.push("", "## Gates", "");
  for (const [gate, passed] of Object.entries(result.gates)) {
    lines.push(`- ${passed ? "PASS" : "FAIL"}: ${gate}`);
  }
  const overlap = result.sourceEvidence?.treatmentOverlap;
  const overall = result.sourceEvidence?.overallOverlap;
  lines.push(
    "",
    "## Treatment source identity",
    "",
    `- Shared treatment paths: ${overlap?.sharedPathCount ?? 0}`,
    `- Source overlap: ${overlap?.sourceOverlapRatio == null ? "n/a" : `${(overlap.sourceOverlapRatio * 100).toFixed(2)}%`}`,
    `- Content identity: ${overlap?.contentIdentityRatio == null ? "n/a" : `${(overlap.contentIdentityRatio * 100).toFixed(2)}%`}`,
    `- Identical source-content bytes: ${overlap?.identicalContentBytes ?? 0}`,
    `- Overall identical source-content byte overlap: ${overall?.contentByteOverlapRatio == null ? "n/a" : `${(overall.contentByteOverlapRatio * 100).toFixed(2)}%`}`,
    `- Source-map parse failures: ${result.sourceEvidence?.parseFailureCount ?? 0}`,
    "",
  );
  return lines.join("\n");
}

async function diagnosticSourceEvidence(environment) {
  const path = resolve(root, "results/source-evidence.json");
  try {
    const existing = JSON.parse(await readFile(path, "utf8"));
    if (sameEnvironment(existing.environment, environment)) return existing.output;
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }

  console.log("\nSOURCE_EVIDENCE_BUILD turbopack-both-server-source-maps");
  await generateCell(root, "both");
  await rm(resolve(root, ".next"), { recursive: true, force: true });
  await runCommand(
    "source-evidence-turbopack-both",
    "pnpm",
    ["exec", "next", "build", "--turbopack"],
    { env: { REPRO_SERVER_SOURCE_MAPS: "1" } },
  );
  const output = await analyzeOutput(root);
  await writeFile(
    path,
    `${JSON.stringify({ schemaVersion: 1, environment, output }, null, 2)}\n`,
  );
  return output;
}

const args = parseArgs(process.argv.slice(2));
const runs = Number(args.runs ?? 3);
const bundlers = String(args.bundlers ?? "webpack,turbopack").split(",").filter(Boolean);
const resume = args.resume !== "false";
if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error("--runs must be 1-5");
for (const bundler of bundlers) {
  if (!["webpack", "turbopack"].includes(bundler)) throw new Error(`Unknown bundler: ${bundler}`);
}
if (bundlers.length !== 2) throw new Error("The Phase 1 gate requires both webpack and turbopack");

await mkdir(workRoot, { recursive: true });
await mkdir(runResultRoot, { recursive: true });
await runCommand("generate-payload", "node", ["scripts/generate-payload.mjs"]);
const environment = await environmentInfo();
const cells = [];

for (let run = 1; run <= runs; run += 1) {
  for (const cell of buildOrder(run, bundlers)) {
    const id = `${environment.next}-default-sourcemaps-off-${cell.bundler}-${cell.context}-run-${run}`;
    const resultPath = resolve(runResultRoot, `${id}.json`);
    if (resume) {
      try {
        const existing = JSON.parse(await readFile(resultPath, "utf8"));
        if (sameEnvironment(existing.environment, environment)) {
          console.log(`CELL_RESUME ${id}`);
          cells.push(existing);
          continue;
        }
      } catch (error) {
        if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
    }

    console.log(`\nCELL_START ${id}`);
    await generateCell(root, cell.context);
    await rm(resolve(root, ".next"), { recursive: true, force: true });
    const startedAt = Date.now();
    await runCommand(
      id,
      "pnpm",
      ["exec", "next", "build", cell.bundler === "turbopack" ? "--turbopack" : "--webpack"],
    );
    const output = await analyzeOutput(root);
    const runtimeVerification =
      run === 1 && cell.context === "both" ? await verifyRuntime(root) : null;
    const result = {
      schemaVersion: 1,
      run,
      context: cell.context,
      bundler: cell.bundler,
      environment,
      buildDurationMs: Date.now() - startedAt,
      output,
      runtimeVerification,
    };
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    cells.push(result);
    console.log(
      `CELL_COMPLETE ${id} gzip=${output.total.gzipBytes} sentinelFiles=${output.total.sentinelFileCount}`,
    );
  }
}

const diagnosticOutput = await diagnosticSourceEvidence(environment);
const sourceEvidence = structuredClone(diagnosticOutput.sourceEvidence);
sourceEvidence.overallOverlap.contentByteOverlapRatio ??=
  sourceEvidence.overallOverlap.identicalContentBytes /
  Math.min(sourceEvidence.server.contentBytes, sourceEvidence.ssr.contentBytes);
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  environment,
  experiment: {
    payload: "pure ESM plus deterministic generated JSON",
    contexts: CONTEXTS,
    bundlers,
    runs,
    routeHandlerCount: 1,
    serverActionCount: 1,
    primaryBuildServerSourceMaps: false,
    sourceEvidenceBuildServerSourceMaps: true,
  },
  ...summarizeMatrix(cells, sourceEvidence),
  sourceEvidence,
};
const platformResultName = `${environment.platform}-${environment.arch}`;
const resultJson = `${JSON.stringify(result, null, 2)}\n`;
const resultMd = resultMarkdown(result);
await Promise.all([
  writeFile(resolve(root, "results/canary.json"), resultJson),
  writeFile(resolve(root, "results/canary.md"), resultMd),
  writeFile(resolve(root, `results/${platformResultName}.json`), resultJson),
  writeFile(resolve(root, `results/${platformResultName}.md`), resultMd),
]);
await generateCell(root, "both");

console.log("\nMATRIX_COMPLETE");
console.log(JSON.stringify({ decision: result.decision, gates: result.gates, results: result.results }, null, 2));
