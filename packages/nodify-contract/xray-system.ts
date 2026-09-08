import type { XrayRecord } from "./xray";

// Go duration syntax, converted only for validation; keep the original text in JSON.
export function xrayDurationSeconds(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/^(?:\d+(?:\.\d+)?(?:ns|us|µs|μs|ms|s|m|h))+$/.test(value)
  )
    return null;
  const units: Record<string, number> = {
    ns: 1e-9,
    us: 1e-6,
    µs: 1e-6,
    μs: 1e-6,
    ms: 1e-3,
    s: 1,
    m: 60,
    h: 3600,
  };
  const seconds = [
    ...value.matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|μs|ms|s|m|h)/g),
  ].reduce((n, m) => n + Number(m[1]) * units[m[2]], 0);
  return Number.isFinite(seconds) && seconds <= 9223372036 ? seconds : null;
}

export function updatePolicyLevel(
  x: XrayRecord,
  level: string,
  changes: XrayRecord,
): XrayRecord {
  const entry = { ...x.policy?.levels?.[level], ...changes };
  for (const key of Object.keys(entry))
    if (entry[key] === undefined) delete entry[key];
  return {
    ...x,
    policy: { ...x.policy, levels: { ...x.policy?.levels, [level]: entry } },
  };
}

export function xraySystemErrors(x: XrayRecord): string[] {
  const errors: string[] = [];
  const integer = (value: unknown, path: string, min: number, max: number) => {
    if (
      value !== undefined &&
      (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
    )
      errors.push(`${path} 必须是 ${min} 至 ${max} 的整数`);
  };
  const bool = (value: unknown, path: string) => {
    if (value !== undefined && typeof value !== "boolean")
      errors.push(`${path} 必须是布尔值`);
  };
  for (const [level, p] of Object.entries(x.policy?.levels || {}) as [
    string,
    XrayRecord,
  ][]) {
    if (!/^(0|[1-9]\d*)$/.test(level) || Number(level) > 4294967295)
      errors.push(`策略等级 ${level} 必须是 0 至 4294967295 的整数`);
    for (const field of ["handshake", "connIdle", "uplinkOnly", "downlinkOnly"])
      integer(p[field], `等级 ${level} 的 ${field}`, 0, 4294967295);
    // Xray multiplies a signed int32 KB value by 1024. Reject overflow and use -1 for unlimited.
    integer(p.bufferSize, `等级 ${level} 的 bufferSize（KiB）`, -1, 2097151);
    for (const field of [
      "statsUserUplink",
      "statsUserDownlink",
      "statsUserOnline",
    ])
      bool(p[field], `等级 ${level} 的 ${field}`);
  }
  for (const field of [
    "statsInboundUplink",
    "statsInboundDownlink",
    "statsOutboundUplink",
    "statsOutboundDownlink",
  ])
    bool(x.policy?.system?.[field], `policy.system.${field}`);
  if (x.observatory && x.burstObservatory)
    errors.push("请只启用一种连接观测器");
  const duration = (value: unknown, path: string) => {
    if (
      value !== undefined &&
      (xrayDurationSeconds(value) === null || xrayDurationSeconds(value)! <= 0)
    )
      errors.push(`${path} 需要正数时长，如 10s、1m 或 2h45m`);
  };
  const url = (value: unknown, path: string) => {
    if (value === undefined || value === "") return;
    try {
      const u = new URL(String(value));
      if (
        typeof value !== "string" ||
        !["http:", "https:"].includes(u.protocol) ||
        u.username ||
        u.password ||
        u.hash ||
        /\s/.test(value)
      )
        throw new Error();
    } catch {
      errors.push(`${path} 需要不含凭据或片段的 HTTP/HTTPS 地址`);
    }
  };
  for (const kind of ["observatory", "burstObservatory"]) {
    const observer = x[kind];
    if (!observer) continue;
    if (
      !observer.subjectSelector?.length ||
      observer.subjectSelector.some((s: string) => !s.trim())
    )
      errors.push(`${kind} 需要非空的出站前缀`);
  }
  if (x.observatory) {
    // Go's JSON decoder accepts either spelling. Ambiguous aliases are rejected.
    if (
      x.observatory.probeURL !== undefined &&
      x.observatory.probeUrl !== undefined
    )
      errors.push("probeURL 与 probeUrl 不能同时设置");
    url(x.observatory.probeURL ?? x.observatory.probeUrl, "观测探测地址");
    duration(x.observatory.probeInterval, "观测间隔");
    bool(x.observatory.enableConcurrency, "并发观测");
  }
  if (x.burstObservatory) {
    const ping = x.burstObservatory.pingConfig;
    if (!ping) errors.push("突发观测需要 pingConfig");
    else {
      url(ping.destination, "突发观测地址");
      url(ping.connectivity, "本地连通性地址");
      duration(ping.interval, "突发观测间隔");
      duration(ping.timeout, "突发观测超时");
      integer(ping.sampling, "突发观测采样数", 1, 10000);
      if (
        ping.httpMethod !== undefined &&
        (typeof ping.httpMethod !== "string" ||
          !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,32}$/.test(ping.httpMethod))
      )
        errors.push("突发观测 HTTP 方法必须是有效方法名称");
    }
  }
  return errors;
}
