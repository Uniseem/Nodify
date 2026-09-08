import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tunnelArtifacts, PublicationConfig } from "@nodify/contract";

// Offline bootstrap: no database, panel, Cloudflare account key or network access required.
const [inputFile, outputDirectory] = process.argv.slice(2);
if (!inputFile || !outputDirectory)
  throw new Error(
    "Usage: node dist/tunnel-config.js publication.json NEW_OUTPUT_DIRECTORY",
  );
const config = PublicationConfig.parse(
  JSON.parse(readFileSync(inputFile, "utf8")),
);
const files = tunnelArtifacts(config);
const output = resolve(outputDirectory);
mkdirSync(output, { mode: 0o700 }); // refuse existing directories; never overwrite deployment files
mkdirSync(join(output, "tunnel"), { mode: 0o700 });
for (const [name, content] of Object.entries({
  "tunnel/config.yml": files.config,
  ...(config.mode === "docker"
    ? { "compose.tunnel.yml": files.compose }
    : { "nodify-tunnel.service": files.service }),
  "install-nodify-tunnel.sh": files.commands,
  "verify-nodify-tunnel.sh": files.verifyCommands,
}))
  writeFileSync(join(output, name), content, { mode: 0o600, flag: "wx" });
console.log(
  "Nodify Tunnel configuration generated. Add your Tunnel JSON credentials separately, then review and run the deployment commands.",
);
