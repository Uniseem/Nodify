import { join } from "node:path";

export const websiteNames = (site) => [site.domain, ...(site.aliases || [])];

export function websiteSites(websites) {
  return Object.values(websites).filter(
    (site) => !site.remove && site.enabled !== false,
  );
}
export function validateWebsite(site) {
  if (
    !Array.isArray(site.aliases ?? []) ||
    (site.aliases?.length ?? 0) > 19 ||
    websiteNames(site).some(
      (name) =>
        typeof name !== "string" ||
        name.length > 253 ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(name),
    ) ||
    new Set(websiteNames(site).map((name) => name.toLowerCase())).size !==
      websiteNames(site).length
  )
    throw new Error("Invalid or duplicate website domains");
  if (
    !/^[a-f0-9-]{36}$/.test(site.id) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(site.domain)
  )
    throw new Error("Invalid website identifier or domain");
  if (
    !["static", "proxy"].includes(site.type) ||
    typeof site.target !== "string" ||
    /[\x00-\x1f;{}"'$\\]/.test(site.target)
  )
    throw new Error("Invalid website target");
  if (site.type === "proxy") {
    const url = new URL(site.target);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      /\s/.test(site.target)
    )
      throw new Error("Invalid upstream URL");
  } else if (
    !site.target.startsWith("/") ||
    site.target.split("/").includes("..")
  )
    throw new Error("An absolute static directory is required");
  for (const port of [
    site.httpPort ?? 80,
    ...(site.certificateId ? [site.httpsPort ?? 443] : []),
  ])
    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      [61001, 61002].includes(port)
    )
      throw new Error("Invalid website port");
  if (site.certificateId && !/^[a-f0-9-]{36}$/.test(site.certificateId))
    throw new Error("Invalid certificate identifier");
  if (!Number.isSafeInteger(site.deployment ?? 0) || (site.deployment ?? 0) < 0)
    throw new Error("Invalid website deployment");
  if (site.redirectHttps && !site.certificateId)
    throw new Error("HTTPS redirect requires a certificate");
}
export function websitePorts(websites) {
  return [
    ...new Set(
      websiteSites(websites).flatMap((site) => [
        site.httpPort ?? 80,
        ...(site.certificateId ? [site.httpsPort ?? 443] : []),
      ]),
    ),
  ].map((port) => ({ port, transport: "tcp" }));
}
export function websiteCertificatePath(prefix, site) {
  return join(prefix, "certificates", `${site.id}-${site.deployment ?? 0}`);
}
export function renderWebsites(prefix, websites) {
  const sites = websiteSites(websites),
    domains = new Set(),
    http = new Set(),
    https = new Set();
  for (const site of sites) {
    validateWebsite(site);
    for (const name of websiteNames(site)) {
      if (domains.has(name.toLowerCase()))
        throw new Error("Duplicate website domain");
      domains.add(name.toLowerCase());
    }
    http.add(site.httpPort ?? 80);
    if (site.certificateId) https.add(site.httpsPort ?? 443);
  }
  if ([...https].some((port) => http.has(port)))
    throw new Error("HTTP and HTTPS listeners conflict");
  const blocks = sites.map((site) => {
    const names = websiteNames(site).join(" ");
    const certificate = websiteCertificatePath(prefix, site);
    const tls = site.certificateId
      ? `listen ${site.httpsPort ?? 443} ssl; ssl_certificate "${certificate}/fullchain.pem"; ssl_certificate_key "${certificate}/privkey.pem";`
      : "";
    const location =
      site.type === "static"
        ? `root "${site.target}"; try_files $uri $uri/ =404;`
        : `proxy_pass ${site.target}; proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; proxy_ssl_server_name on; ${site.websocket !== false ? "proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection $nodify_connection;" : ""}`;
    const logs = `access_log logs/${site.id}.access.log; error_log logs/${site.id}.error.log warn;`;
    const privateFiles = site.type === "static" ? "location ~ /\\.nodify- { deny all; }" : "";
    const plain = site.redirectHttps
      ? `server { listen ${site.httpPort ?? 80}; server_name ${names}; ${logs} return 308 https://${site.domain}${(site.httpsPort ?? 443) === 443 ? "" : `:${site.httpsPort}`}$request_uri; }`
      : "";
    return `${plain}\nserver { ${site.redirectHttps ? "" : `listen ${site.httpPort ?? 80};`} ${tls} server_name ${names}; ${logs} ${privateFiles} location / { ${location} } }`;
  });
  return `${process.platform === "linux" && process.getuid?.() === 0 ? "user nobody nogroup;" : ""} worker_processes 1; pid nginx.pid; error_log logs/error.log warn; events { worker_connections 1024; } http { default_type application/octet-stream; types { text/html html htm; text/css css; text/plain txt; application/javascript js mjs; application/json json; image/svg+xml svg; image/png png; image/jpeg jpg jpeg; image/gif gif; image/webp webp; image/x-icon ico; application/wasm wasm; font/woff woff; font/woff2 woff2; application/pdf pdf; } map $http_upgrade $nodify_connection { default upgrade; '' close; } access_log logs/access.log; client_body_temp_path temp; proxy_temp_path temp; ${blocks.join("\n")} }`;
}
