import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seed = JSON.parse(await readFile(resolve(root, "data/seed.json"), "utf8"));
const outputPath = resolve(root, "data/payload.generated.json");

function makePayload(index) {
  let value = "";
  let counter = 0;
  while (value.length < seed.payloadWidth) {
    value += createHash("sha256")
      .update(`${seed.seed}:${index}:${counter}`)
      .digest("hex");
    counter += 1;
  }
  return value.slice(0, seed.payloadWidth);
}

const payload = {
  records: Array.from({ length: seed.recordCount }, (_, index) => ({
    id: index,
    label: `synthetic-record-${String(index).padStart(4, "0")}`,
    payload: makePayload(index),
    weight: (index * 37 + 11) % 997,
  })),
};

await mkdir(dirname(outputPath), { recursive: true });
const serialized = `${JSON.stringify(payload)}\n`;
await writeFile(outputPath, serialized);

console.log(
  JSON.stringify(
    {
      output: "data/payload.generated.json",
      recordCount: payload.records.length,
      bytes: Buffer.byteLength(serialized),
      sha256: createHash("sha256").update(serialized).digest("hex"),
    },
    null,
    2,
  ),
);
