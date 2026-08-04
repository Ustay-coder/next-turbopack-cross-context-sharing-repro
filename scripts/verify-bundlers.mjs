import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeOutput } from "./analyze-output.mjs";
import { generateCell } from "./generate-cell.mjs";
import { verifyRuntime } from "./verify-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function run(command, args) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with code=${code} signal=${signal}`));
    });
  });
}

await run("node", ["scripts/generate-payload.mjs"]);
await generateCell(root, "both");
const results = {};
for (const bundler of ["turbopack", "webpack"]) {
  await rm(resolve(root, ".next"), { recursive: true, force: true });
  await run("pnpm", [
    "exec",
    "next",
    "build",
    bundler === "turbopack" ? "--turbopack" : "--webpack",
  ]);
  results[bundler] = {
    runtime: await verifyRuntime(root),
    output: await analyzeOutput(root),
  };
}
await generateCell(root, "both");
await mkdir(resolve(root, "results"), { recursive: true });
await writeFile(
  resolve(root, "results/runtime-verification.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
);
console.log(JSON.stringify({ passed: true, bundlers: Object.keys(results) }, null, 2));
