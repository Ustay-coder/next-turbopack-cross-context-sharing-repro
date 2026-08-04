export function computeLightPayload(routeId: string) {
  return {
    routeId,
    kind: "light",
    length: routeId.length,
  };
}
