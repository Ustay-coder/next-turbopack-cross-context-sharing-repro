import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SENTINEL = "PUBLIC_CANARY_CONTEXT_SHARING_SENTINEL_v1";

async function availablePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function waitForServer(url, child, logs) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited early with ${child.exitCode}: ${logs.join("").slice(-2000)}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server has not started yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`next start did not become ready: ${logs.join("").slice(-2000)}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

export async function verifyRuntime(root) {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const logs = [];
  const child = spawn(command, ["exec", "next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString("utf8")));

  try {
    await waitForServer(origin, child, logs);

    const routeResponse = await fetch(`${origin}/api/heavy`);
    const routeBody = await routeResponse.json();
    if (
      !routeResponse.ok ||
      routeBody?.heavy?.sentinel !== SENTINEL ||
      routeBody?.heavy?.recordCount !== 1536
    ) {
      throw new Error(`Route Handler verification failed: ${JSON.stringify(routeBody).slice(0, 500)}`);
    }

    const pageResponse = await fetch(origin);
    const pageHtml = await pageResponse.text();
    const actionField = pageHtml.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
    if (!pageResponse.ok || !actionField) {
      throw new Error("Could not find the Server Action form field in the rendered page");
    }

    const form = new FormData();
    form.set(actionField, "");
    const actionResponse = await fetch(origin, {
      method: "POST",
      body: form,
      redirect: "manual",
    });
    const location = actionResponse.headers.get("location");
    const actionBody = await actionResponse.text();
    const redirectPassed =
      [302, 303, 307, 308].includes(actionResponse.status) &&
      location !== null &&
      location.includes("action=verified") &&
      location.includes("records=1536") &&
      location.includes("checksum=");
    const renderedRedirectPassed =
      actionResponse.status === 200 &&
      actionBody.includes('data-action-status="verified"') &&
      actionBody.includes('data-action-records="1536"') &&
      /data-action-checksum="[0-9a-f]{8}"/.test(actionBody);
    if (!redirectPassed && !renderedRedirectPassed) {
      throw new Error(
        `Server Action verification failed: status=${actionResponse.status} location=${location} body=${actionBody.slice(0, 1000)}`,
      );
    }

    return {
      passed: true,
      route: {
        status: routeResponse.status,
        recordCount: routeBody.heavy.recordCount,
        sentinel: routeBody.heavy.sentinel,
      },
      action: {
        status: actionResponse.status,
        responseMode: redirectPassed ? "http-redirect" : "rendered-redirect",
        redirectContainsRecordCount: true,
        redirectContainsChecksum: true,
      },
    };
  } finally {
    await stopServer(child);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  console.log(JSON.stringify(await verifyRuntime(root), null, 2));
}
