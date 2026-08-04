import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { generateCell } from "../generate-cell.mjs";

async function generate(context) {
  const root = await mkdtemp(resolve(tmpdir(), "next-context-cell-"));
  const result = await generateCell(root, context);
  return {
    result,
    action: await readFile(resolve(root, "app/actions.ts"), "utf8"),
    route: await readFile(resolve(root, "app/api/heavy/route.ts"), "utf8"),
  };
}

test("the four cells change only the selected heavy static import", async () => {
  const neither = await generate("neither");
  assert.doesNotMatch(neither.action, /pure-heavy/);
  assert.doesNotMatch(neither.route, /pure-heavy/);
  assert.match(neither.action, /computeLightPayload/);
  assert.match(neither.route, /computeLightPayload/);

  const routeOnly = await generate("route-only");
  assert.doesNotMatch(routeOnly.action, /pure-heavy/);
  assert.match(routeOnly.route, /pure-heavy/);

  const actionOnly = await generate("action-only");
  assert.match(actionOnly.action, /pure-heavy/);
  assert.doesNotMatch(actionOnly.route, /pure-heavy/);

  const both = await generate("both");
  assert.match(both.action, /computeSyntheticPayload/);
  assert.match(both.route, /computeSyntheticPayload/);
  assert.equal(both.result.actionUsesHeavy, true);
  assert.equal(both.result.routeUsesHeavy, true);
});

test("unknown contexts fail closed", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "next-context-cell-invalid-"));
  await assert.rejects(() => generateCell(root, "invalid"), /--context must be one of/);
});
