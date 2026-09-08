import { z } from "zod";
export const CounterBytes = z.string().regex(/^(0|[1-9][0-9]{0,38})$/);
export const SourceTraffic = z.object({
  upload: CounterBytes,
  download: CounterBytes,
  total: CounterBytes.nullable(),
  expire: z
    .string()
    .regex(/^[0-9]{1,12}$/)
    .nullable(),
});
export const ServerTrafficSettings = z
  .object({
    source: z.enum(["protocol", "network"]).default("protocol"),
    includeInOverview: z.boolean().default(true),
    interfaces: z
      .array(
        z
          .string()
          .min(1)
          .max(15)
          .regex(/^[a-zA-Z0-9_.:-]+$/),
      )
      .max(128)
      .default([]),
    direction: z.enum(["both", "upload", "download", "max"]).default("both"),
    resetDay: z
      .number({ error: "重置日需为 1–31 的整数" })
      .int("重置日需为整数")
      .min(1, "重置日不能小于 1")
      .max(31, "重置日不能超过 31")
      .nullable()
      .default(null),
    limitBytes: CounterBytes.nullable().default(null),
  })
  .refine(
    (value) => value.source !== "network" || value.interfaces.length > 0,
    "系统网卡统计需要选择至少一张网卡",
  )
  .refine(
    (value) => new Set(value.interfaces).size === value.interfaces.length,
    "网卡不能重复",
  );
export function serverTrafficRaw(server: Record<string, any>) {
  const settings = ServerTrafficSettings.parse(server.trafficSettings || {});
  if (settings.source === "protocol")
    return { ...server.protocolTraffic, missingInterfaces: [] as string[] };
  const rows = server.networkTraffic?.interfaces || {};
  const selected = settings.interfaces
    .map((name) => rows[name])
    .filter(Boolean);
  return {
    upload: selected.length
      ? selected.reduce((sum, row) => sum + BigInt(row.upload), 0n).toString()
      : null,
    download: selected.length
      ? selected.reduce((sum, row) => sum + BigInt(row.download), 0n).toString()
      : null,
    startedAt: selected.map((row) => row.startedAt).sort()[0] || null,
    updatedAt:
      selected
        .map((row) => row.updatedAt)
        .sort()
        .at(-1) || null,
    missingInterfaces: settings.interfaces.filter((name) => !rows[name]),
    discontinuities: selected.reduce(
      (sum, row) => sum + (row.discontinuities || 0),
      0,
    ),
  };
}
export function directionBytes(
  upload: string,
  download: string,
  direction: string,
) {
  const u = BigInt(upload),
    d = BigInt(download);
  return (
    direction === "upload"
      ? u
      : direction === "download"
        ? d
        : direction === "max"
          ? u > d
            ? u
            : d
          : u + d
  ).toString();
}
export function parseTrafficHeader(header: string | undefined) {
  if (header == null) return null;
  if (header.length > 4096 || /[\r\n\0]/.test(header))
    throw new Error("Invalid subscription traffic header");
  const values: Record<string, string> = {};
  for (const entry of header.split(";")) {
    if (!entry.trim()) continue;
    const match = /^\s*([a-z]+)\s*=\s*([0-9]+)\s*$/i.exec(entry);
    if (!match) throw new Error("Invalid subscription traffic header");
    const key = match[1].toLowerCase();
    if (Object.hasOwn(values, key))
      throw new Error("Duplicate subscription traffic field");
    values[key] = match[2].replace(/^0+(?=\d)/, "");
  }
  return SourceTraffic.parse({
    upload: values.upload,
    download: values.download,
    total: values.total ?? null,
    expire: values.expire ?? null,
  });
}
