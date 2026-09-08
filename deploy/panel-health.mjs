import { existsSync, readFileSync } from "node:fs";
const expected = process.argv[2];
const envFile = "/etc/nodify/panel.env";
const configuredPort = existsSync(envFile)
  ? readFileSync(envFile, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^APP_PORT=\d+$/.test(line))
      .at(-1)
      ?.split("=")[1]
  : undefined;
const port = Number(process.env.APP_PORT || configuredPort || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid panel port");
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agent/version`, {
      signal: AbortSignal.timeout(1000),
      headers: { "X-Forwarded-For": "127.0.0.1", "X-Forwarded-Proto": "https" },
    });
    const body = await response.json();
    if (
      response.ok &&
      body.application === "Nodify" &&
      (!expected || body.version === expected)
    )
      process.exit(0);
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.error("Nodify did not pass the startup health check");
process.exit(1);
