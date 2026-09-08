function shellSingleQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildAgentInstallCommand(installUrl: string): string {
    return `curl -fsSL ${shellSingleQuote(installUrl)} | bash`;
}

function renderComposeYaml(nodePort: number, secretKey: string): string {
    const image = process.env.NODIFY_LEGACY_AGENT_IMAGE;
    if (!image || !/^[a-zA-Z0-9./:_@-]+$/.test(image)) {
        throw new Error('Use the Nodify servers page for new Agent installations. Legacy direct-mode installation requires an explicitly built NODIFY_LEGACY_AGENT_IMAGE.');
    }
    return `services:
  nodify-agent:
    container_name: nodify-agent
    hostname: nodify-agent
    image: ${image}
    network_mode: host
    restart: always
    cap_add:
      - NET_ADMIN
    ulimits:
      nofile:
        soft: 1048576
        hard: 1048576
    environment:
      - NODE_PORT=${nodePort}
      - SECRET_KEY=${JSON.stringify(secretKey)}
`;
}

export function renderAgentInstallScript(params: {
    completeUrl: string;
    nodePort: number;
    secretKey: string;
}): string {
    const compose = renderComposeYaml(params.nodePort, params.secretKey);
    const completeUrl = shellSingleQuote(params.completeUrl);

    return `#!/bin/sh
set -eu

echo "Installing Nodify agent..."

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this install link as root: curl -fsSL <url> | sudo bash"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required on this server."
  exit 1
fi

INSTALL_DIR=/opt/nodify-agent
mkdir -p "$INSTALL_DIR"

cat > "$INSTALL_DIR/docker-compose.yml" <<'NODIFY_COMPOSE'
${compose}NODIFY_COMPOSE

cd "$INSTALL_DIR"

if docker compose version >/dev/null 2>&1; then
  docker compose up -d
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose up -d
else
  echo "docker compose is required."
  exit 1
fi

ADDRESS="\${NODIFY_AGENT_ADDRESS:-}"
if [ -z "$ADDRESS" ]; then
  ADDRESS="$(curl -fsSL --max-time 8 https://api.ipify.org || true)"
fi
if [ -z "$ADDRESS" ]; then
  ADDRESS="$(curl -fsSL --max-time 8 https://ifconfig.me/ip || true)"
fi
if [ -z "$ADDRESS" ]; then
  ADDRESS="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
fi

if [ -z "$ADDRESS" ]; then
  echo "Agent is running, but this host could not detect a public address."
  echo "Report it from the panel, or rerun with NODIFY_AGENT_ADDRESS=<ip>."
  exit 0
fi

curl -fsSL -X POST \\
  -H "Content-Type: application/json" \\
  -d "$(printf '{"address":"%s"}' "$ADDRESS")" \\
  ${completeUrl}

echo "Agent is up. Reported address: $ADDRESS"
`;
}
