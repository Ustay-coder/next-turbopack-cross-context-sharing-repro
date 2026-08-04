import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { analyzeOutput, normalizeSourcePath } from "../analyze-output.mjs";

test("source paths are normalized across pnpm and webpack forms", () => {
  assert.equal(
    normalizeSourcePath(
      "webpack:///node_modules/.pnpm/example@1.0.0/node_modules/example/index.js?abc",
    ),
    "node_modules/example/index.js",
  );
  assert.equal(
    normalizeSourcePath("file:///workspace/lib/pure-heavy.ts"),
    "lib/pure-heavy.ts",
  );
});

test("output analysis separates server and ssr chunks and proves treatment identity", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "next-output-analysis-"));
  const serverChunks = resolve(root, ".next/server/chunks");
  const ssrChunks = resolve(serverChunks, "ssr");
  await mkdir(ssrChunks, { recursive: true });
  const sourceMap = {
    version: 3,
    sources: ["file:///workspace/lib/pure-heavy.ts", "file:///workspace/data/payload.generated.json"],
    sourcesContent: ["export const value = 1;", "{\"records\":[]}"],
    names: [],
    mappings: "",
  };
  await writeFile(
    resolve(serverChunks, "server.js"),
    'const x="PUBLIC_CANARY_CONTEXT_SHARING_SENTINEL_v1";',
  );
  await writeFile(resolve(serverChunks, "server.js.map"), JSON.stringify(sourceMap));
  await writeFile(
    resolve(ssrChunks, "ssr.js"),
    'const x="PUBLIC_CANARY_CONTEXT_SHARING_SENTINEL_v1";',
  );
  await writeFile(resolve(ssrChunks, "ssr.js.map"), JSON.stringify(sourceMap));

  const result = await analyzeOutput(root);
  assert.equal(result.categories.serverChunks.fileCount, 1);
  assert.equal(result.categories.ssrChunks.fileCount, 1);
  assert.equal(result.total.sentinelFileCount, 2);
  assert.equal(result.sourceEvidence.treatmentOverlap.sharedPathCount, 2);
  assert.equal(result.sourceEvidence.treatmentOverlap.sourceOverlapRatio, 1);
  assert.equal(result.sourceEvidence.treatmentOverlap.contentIdentityRatio, 1);
  assert.equal(result.sourceEvidence.overallOverlap.contentByteOverlapRatio, 1);
});
