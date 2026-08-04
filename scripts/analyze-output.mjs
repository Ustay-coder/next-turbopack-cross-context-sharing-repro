import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const SENTINEL = "PUBLIC_CANARY_CONTEXT_SHARING_SENTINEL_v1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function walkFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files;
}

function outputCategory(path) {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.includes("/chunks/ssr/")) return "ssrChunks";
  if (normalized.includes("/chunks/")) return "serverChunks";
  if (normalized.includes("/app/api/heavy/route")) return "routeEntries";
  if (normalized.includes("/app/")) return "pageEntries";
  return "serverRuntime";
}

function emptySize() {
  return { fileCount: 0, rawBytes: 0, gzipBytes: 0, sentinelFileCount: 0 };
}

function sourceMapEntries(map) {
  if (Array.isArray(map.sections)) {
    return map.sections.flatMap((section) => sourceMapEntries(section.map ?? {}));
  }
  return (map.sources ?? []).map((source, index) => ({
    source,
    content: map.sourcesContent?.[index] ?? null,
  }));
}

export function normalizeSourcePath(input) {
  let value = String(input ?? "").replaceAll("\\", "/");
  try {
    value = decodeURIComponent(value);
  } catch {
    // Preserve malformed but usable source paths.
  }
  value = value.replace(/[?#].*$/, "").replace(/^webpack:\/\/(?:\/)?/, "");
  const pnpmMatch = value.match(/(?:^|\/)node_modules\/\.pnpm\/[^/]+\/node_modules\/(.+)$/);
  if (pnpmMatch) return `node_modules/${pnpmMatch[1]}`;
  for (const marker of ["node_modules/", "lib/", "data/", "app/"]) {
    const index = value.lastIndexOf(marker);
    if (index >= 0) return value.slice(index);
  }
  return value.replace(/^(?:\.\.\/)+/, "").replace(/^\/+/, "");
}

function summarizeSources(entries) {
  const byPath = new Map();
  for (const entry of entries) {
    const path = normalizeSourcePath(entry.source);
    const content = typeof entry.content === "string" ? entry.content : null;
    const existing = byPath.get(path);
    if (!existing || (existing.content === null && content !== null)) {
      byPath.set(path, {
        content,
        bytes: content === null ? 0 : Buffer.byteLength(content),
        hash: content === null ? null : sha256(content),
      });
    }
  }
  return byPath;
}

function compareSources(left, right, predicate = () => true) {
  const leftPaths = [...left.keys()].filter(predicate);
  const rightPaths = [...right.keys()].filter(predicate);
  const sharedPaths = leftPaths.filter((path) => right.has(path));
  const identicalPaths = sharedPaths.filter((path) => {
    const leftHash = left.get(path).hash;
    const rightHash = right.get(path).hash;
    return leftHash !== null && leftHash === rightHash;
  });
  const denominator = Math.min(leftPaths.length, rightPaths.length);
  const leftContentBytes = leftPaths.reduce((sum, path) => sum + left.get(path).bytes, 0);
  const rightContentBytes = rightPaths.reduce((sum, path) => sum + right.get(path).bytes, 0);
  const identicalContentBytes = identicalPaths.reduce(
    (sum, path) => sum + Math.min(left.get(path).bytes, right.get(path).bytes),
    0,
  );
  const contentByteDenominator = Math.min(leftContentBytes, rightContentBytes);
  return {
    serverSourceCount: leftPaths.length,
    ssrSourceCount: rightPaths.length,
    sharedPathCount: sharedPaths.length,
    identicalContentCount: identicalPaths.length,
    sourceOverlapRatio: denominator === 0 ? null : sharedPaths.length / denominator,
    contentIdentityRatio: sharedPaths.length === 0 ? null : identicalPaths.length / sharedPaths.length,
    identicalContentBytes,
    contentByteOverlapRatio:
      contentByteDenominator === 0 ? null : identicalContentBytes / contentByteDenominator,
    sharedPaths,
  };
}

function publicSourceSummary(sourceMap) {
  return {
    sourceCount: sourceMap.size,
    contentBytes: [...sourceMap.values()].reduce((sum, entry) => sum + entry.bytes, 0),
    treatmentSources: [...sourceMap.keys()].filter(
      (path) => path === "lib/pure-heavy.ts" || path === "data/payload.generated.json",
    ),
  };
}

async function analyzeSourceMaps(mapFiles, serverRoot) {
  const entries = { server: [], ssr: [] };
  let parseFailureCount = 0;
  for (const path of mapFiles) {
    const pathFromServer = relative(serverRoot, path).replaceAll("\\", "/");
    if (!pathFromServer.startsWith("chunks/")) continue;
    const context = pathFromServer.startsWith("chunks/ssr/") ? "ssr" : "server";
    try {
      const map = JSON.parse(await readFile(path, "utf8"));
      entries[context].push(...sourceMapEntries(map));
    } catch {
      parseFailureCount += 1;
    }
  }

  const server = summarizeSources(entries.server);
  const ssr = summarizeSources(entries.ssr);
  const treatment = (path) =>
    path === "lib/pure-heavy.ts" || path === "data/payload.generated.json";
  return {
    parseFailureCount,
    server: publicSourceSummary(server),
    ssr: publicSourceSummary(ssr),
    overallOverlap: compareSources(server, ssr),
    treatmentOverlap: compareSources(server, ssr, treatment),
  };
}

export async function analyzeOutput(root) {
  const serverRoot = resolve(root, ".next/server");
  const files = await walkFiles(serverRoot);
  const jsFiles = files.filter((path) => path.endsWith(".js"));
  const mapFiles = files.filter((path) => path.endsWith(".js.map"));
  const categories = {
    serverChunks: emptySize(),
    ssrChunks: emptySize(),
    routeEntries: emptySize(),
    pageEntries: emptySize(),
    serverRuntime: emptySize(),
  };
  const total = emptySize();

  for (const path of jsFiles) {
    const data = await readFile(path);
    const gzipBytes = gzipSync(data, { level: 9 }).byteLength;
    const hasSentinel = data.includes(SENTINEL);
    const category = categories[outputCategory(path)];
    for (const summary of [category, total]) {
      summary.fileCount += 1;
      summary.rawBytes += data.byteLength;
      summary.gzipBytes += gzipBytes;
      if (hasSentinel) summary.sentinelFileCount += 1;
    }
  }

  return {
    metric: "sum of level-9 gzip bytes for each .next/server JavaScript file",
    total,
    categories,
    sourceMapFileCount: mapFiles.length,
    sourceEvidence: await analyzeSourceMaps(mapFiles, serverRoot),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  console.log(JSON.stringify(await analyzeOutput(root), null, 2));
}
