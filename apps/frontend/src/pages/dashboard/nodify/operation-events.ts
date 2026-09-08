import { useEffect } from "react";

import { getAuthorizationToken, getBackendDomain } from "@shared/api/axios";

export function useOperationEvents(ids: string, refresh: () => Promise<void>) {
  useEffect(() => {
    if (!ids) return;
    const abort = new AbortController();
    for (const id of ids.split(",")) {
      void (async () => {
        const response = await fetch(
          `${getBackendDomain()}/api/operations/${id}/events`,
          {
            headers: {
              Authorization: `Bearer ${getAuthorizationToken()}`,
              "X-Remnawave-Client-Type": "browser",
              Accept: "text/event-stream",
            },
            signal: abort.signal,
          },
        );
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        while (!abort.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder
            .decode(chunk.value, { stream: true })
            .replaceAll("\r\n", "\n");
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = event
              .split("\n")
              .find((line) => line.startsWith("data:"));
            if (!data) continue;
            const operation = JSON.parse(data.slice(5));
            if (["failed", "succeeded"].includes(operation.state))
              await refresh();
          }
        }
      })().catch(() => {
        /* Periodic authenticated queries remain the fallback. */
      });
    }
    return () => abort.abort();
  }, [ids, refresh]);
}
