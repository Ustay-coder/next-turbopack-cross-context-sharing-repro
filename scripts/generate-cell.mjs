import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CONTEXTS = ["neither", "route-only", "action-only", "both"];

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

export function actionSource(context) {
  const usesHeavy = context === "action-only" || context === "both";
  return [
    `"use server";`,
    ``,
    `import { redirect } from "next/navigation";`,
    `import { computeLightPayload } from "../lib/light";`,
    ...(usesHeavy
      ? [`import { computeSyntheticPayload } from "../lib/pure-heavy";`]
      : []),
    ``,
    `export async function runSyntheticAction() {`,
    `  const light = computeLightPayload("server-action");`,
    ...(usesHeavy
      ? [
          `  const heavy = computeSyntheticPayload("server-action");`,
          "  redirect(",
          "    `/?action=verified&light=${light.length}&records=${heavy.recordCount}&checksum=${heavy.checksum}` ,",
          "  );",
        ]
      : [`  redirect(` + "`/?action=verified&light=${light.length}`" + `);`]),
    `}`,
    ``,
  ].join("\n");
}

export function routeSource(context) {
  const usesHeavy = context === "route-only" || context === "both";
  return [
    `import { computeLightPayload } from "../../../lib/light";`,
    ...(usesHeavy
      ? [`import { computeSyntheticPayload } from "../../../lib/pure-heavy";`]
      : []),
    ``,
    `export const dynamic = "force-dynamic";`,
    ``,
    `export async function GET() {`,
    `  const light = computeLightPayload("route-handler");`,
    ...(usesHeavy
      ? [
          `  const heavy = computeSyntheticPayload("route-handler");`,
          `  return Response.json({ light, heavy });`,
        ]
      : [`  return Response.json({ light });`]),
    `}`,
    ``,
  ].join("\n");
}

export async function generateCell(root, context) {
  if (!CONTEXTS.includes(context)) {
    throw new Error(`--context must be one of: ${CONTEXTS.join(", ")}`);
  }
  const actionPath = resolve(root, "app/actions.ts");
  const routePath = resolve(root, "app/api/heavy/route.ts");
  await mkdir(dirname(actionPath), { recursive: true });
  await mkdir(dirname(routePath), { recursive: true });
  await writeFile(actionPath, actionSource(context));
  await writeFile(routePath, routeSource(context));
  return {
    context,
    actionUsesHeavy: context === "action-only" || context === "both",
    routeUsesHeavy: context === "route-only" || context === "both",
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root ?? dirname(fileURLToPath(import.meta.url)), "..");
  console.log(JSON.stringify(await generateCell(root, args.context ?? "both"), null, 2));
}
