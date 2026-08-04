export const ENVIRONMENT_IDENTITY_FIELDS = [
  "lockfileSha256",
  "node",
  "pnpm",
  "platform",
  "arch",
  "next",
  "nextCommit",
];

export function sameEnvironment(left, right) {
  if (!left || !right) return false;
  return ENVIRONMENT_IDENTITY_FIELDS.every((field) => left[field] === right[field]);
}
