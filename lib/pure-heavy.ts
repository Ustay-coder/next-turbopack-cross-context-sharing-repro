import dataset from "../data/payload.generated.json";

export const PUBLIC_CANARY_CONTEXT_SHARING_SENTINEL =
  "PUBLIC_CANARY_CONTEXT_SHARING_SENTINEL_v1";

type SyntheticRecord = {
  id: number;
  label: string;
  payload: string;
  weight: number;
};

const records = (dataset as { records: SyntheticRecord[] }).records;

export function computeSyntheticPayload(routeId: string) {
  let checksum = 2166136261;
  let weightedTotal = 0;

  for (const record of records) {
    const value = `${routeId}:${record.id}:${record.label}:${record.payload}`;
    for (let index = 0; index < value.length; index += 1) {
      checksum ^= value.charCodeAt(index);
      checksum = Math.imul(checksum, 16777619) >>> 0;
    }
    weightedTotal = (weightedTotal + record.weight * (record.id + 1)) >>> 0;
  }

  const sample = records.length === 0 ? null : records[checksum % records.length];
  return {
    routeId,
    sentinel: PUBLIC_CANARY_CONTEXT_SHARING_SENTINEL,
    checksum: checksum.toString(16).padStart(8, "0"),
    weightedTotal,
    recordCount: records.length,
    sample: sample ? `${sample.label}:${sample.payload.slice(0, 32)}` : null,
  };
}
