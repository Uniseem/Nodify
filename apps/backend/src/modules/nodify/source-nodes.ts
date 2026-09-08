import { createHash } from "node:crypto";

export function sourceIdentity(sourceId: string, raw: Record<string, unknown>) {
  let budget = 10000;
  const active = new Set<object>();
  const canonical = (value: any, depth = 0): any => {
    if (--budget < 0 || depth > 16)
      throw new Error("Source node structure is too complex");
    if (!value || typeof value !== "object") return value;
    if (active.has(value)) throw new Error("Cyclic source node");
    active.add(value);
    const result = Array.isArray(value)
      ? value.map((item) => canonical(item, depth + 1))
      : Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key], depth + 1)]),
        );
    active.delete(value);
    return result;
  };
  const encoded = JSON.stringify(canonical({ ...raw, name: undefined }));
  if (Buffer.byteLength(encoded) > 65536)
    throw new Error("Source node exceeds 64 KiB");
  const identity = createHash("sha256")
    .update(sourceId + encoded)
    .digest("hex");
  return `${identity.slice(0, 8)}-${identity.slice(8, 12)}-4${identity.slice(13, 16)}-a${identity.slice(17, 20)}-${identity.slice(20, 32)}`;
}
export function sourceNodes(source: {
  nodes: unknown;
  nodeOverrides?: unknown;
  tags?: unknown;
}) {
  const overrides = (source.nodeOverrides || {}) as Record<string, any>;
  const tags = (source.tags || []) as string[];
  return (source.nodes as any[]).map((node) => {
    const override = overrides[node.id] || {};
    return {
      ...node,
      upstreamName: node.name,
      name: override.name || node.name,
      enabled: override.enabled !== false,
      tags: [...new Set([...tags, ...(override.tags || [])])],
      ownTags: override.tags || [],
      customName: override.name || null,
    };
  });
}
