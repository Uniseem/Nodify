// File content is available only through the explicit, authenticated result endpoint.
export function operationView<T extends { kind: string; result: unknown }>(
  operation: T,
): T {
  if (operation.kind !== "website-files") return operation;
  const { data, encryptedData, ...result } = (operation.result || {}) as Record<
    string,
    unknown
  >;
  return {
    ...operation,
    result: {
      ...result,
      ...(data || encryptedData ? { contentAvailable: true } : {}),
    },
  };
}
