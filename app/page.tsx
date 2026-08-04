import { runSyntheticAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <main>
      <h1>Turbopack cross-context server sharing reproduction</h1>
      <p
        data-action-status={params.action ?? "not-run"}
        data-action-records={params.records ?? "not-run"}
        data-action-checksum={params.checksum ?? "not-run"}
      >
        Action: {params.action ?? "not-run"}; records: {params.records ?? "not-run"}; checksum:{" "}
        {params.checksum ?? "not-run"}
      </p>
      <form action={runSyntheticAction}>
        <button type="submit">Run Server Action</button>
      </form>
    </main>
  );
}
