import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const excluded = [
  ".git/",
  "node_modules/",
  ".next/",
  ".repro-work/",
  "results/runs/",
  "results/logs/",
  "data/payload.generated.json",
  "tsconfig.tsbuildinfo",
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const pathFromRoot = relative(root, path).replaceAll("\\", "/");
    if (excluded.some((prefix) => pathFromRoot === prefix.slice(0, -1) || pathFromRoot.startsWith(prefix))) {
      continue;
    }
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const result = JSON.parse(await readFile(resolve(root, "results/canary.json"), "utf8"));
const platformResultPath = resolve(
  root,
  `results/${result.environment.platform}-${result.environment.arch}.json`,
);
const platformResult = JSON.parse(await readFile(platformResultPath, "utf8"));
const lockfile = await readFile(resolve(root, "pnpm-lock.yaml"));
const directDependencies = Object.keys(packageJson.dependencies).sort();
if (JSON.stringify(directDependencies) !== JSON.stringify(["next", "react", "react-dom"])) {
  throw new Error(`Unexpected direct dependencies: ${directDependencies.join(", ")}`);
}
if (result.decision !== "PROCEED_TO_PHASE_3" || !Object.values(result.gates).every(Boolean)) {
  throw new Error("The committed canary result does not pass every Phase 1 gate");
}
if (result.environment.next !== packageJson.dependencies.next) {
  throw new Error("package.json and canary evidence disagree on the Next.js version");
}
if (result.environment.lockfileSha256 !== sha256(lockfile)) {
  throw new Error("The lockfile hash does not match the canary evidence");
}
if (JSON.stringify(platformResult) !== JSON.stringify(result)) {
  throw new Error("The platform-specific result does not match the current canary evidence");
}

const failures = [];
for (const path of await walk(root)) {
  const content = await readFile(path, "utf8").catch(() => null);
  if (content === null) continue;
  const pathFromRoot = relative(root, path).replaceAll("\\", "/");
  if (/\/Users\/|[A-Za-z]:\\Users\\/.test(content)) {
    failures.push(`${pathFromRoot}: absolute user path`);
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
    failures.push(`${pathFromRoot}: private key marker`);
  }
  if (/(?:api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*["'][^"']{8,}/i.test(content)) {
    failures.push(`${pathFromRoot}: credential-like assignment`);
  }
}
if (failures.length > 0) throw new Error(`Public safety check failed:\n${failures.join("\n")}`);

console.log(
  JSON.stringify(
    {
      passed: true,
      decision: result.decision,
      next: result.environment.next,
      nextCommit: result.environment.nextCommit,
      lockfileSha256: result.environment.lockfileSha256,
      checkedFiles: (await walk(root)).length,
    },
    null,
    2,
  ),
);
