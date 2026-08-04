import assert from "node:assert/strict";
import test from "node:test";
import { sameEnvironment } from "../lib/environment.mjs";

const environment = {
  lockfileSha256: "lock",
  node: "v22.23.2",
  pnpm: "9.0.0",
  platform: "darwin",
  arch: "arm64",
  next: "16.3.1-canary.0",
  nextCommit: "5005bd0",
};

test("cached evidence is reused only for the exact measurement environment", () => {
  assert.equal(sameEnvironment(environment, { ...environment }), true);

  for (const [field, value] of [
    ["lockfileSha256", "other-lock"],
    ["node", "v22.24.0"],
    ["platform", "linux"],
    ["arch", "x64"],
    ["nextCommit", "other-commit"],
  ]) {
    assert.equal(
      sameEnvironment(environment, { ...environment, [field]: value }),
      false,
      `${field} must invalidate cached evidence`,
    );
  }
});
