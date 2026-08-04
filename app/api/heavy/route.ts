import { computeLightPayload } from "../../../lib/light";
import { computeSyntheticPayload } from "../../../lib/pure-heavy";

export const dynamic = "force-dynamic";

export async function GET() {
  const light = computeLightPayload("route-handler");
  const heavy = computeSyntheticPayload("route-handler");
  return Response.json({ light, heavy });
}
