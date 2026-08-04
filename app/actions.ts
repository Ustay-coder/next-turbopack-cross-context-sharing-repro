"use server";

import { redirect } from "next/navigation";
import { computeLightPayload } from "../lib/light";
import { computeSyntheticPayload } from "../lib/pure-heavy";

export async function runSyntheticAction() {
  const light = computeLightPayload("server-action");
  const heavy = computeSyntheticPayload("server-action");
  redirect(
    `/?action=verified&light=${light.length}&records=${heavy.recordCount}&checksum=${heavy.checksum}` ,
  );
}
