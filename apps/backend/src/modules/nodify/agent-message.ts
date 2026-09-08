import { OperationResult, TrafficBatch } from "@nodify/contract";
import { NodifyService } from "./nodify.service";
import { TerminalSessions } from "./terminal-sessions";

export async function agentMessage(
  service: NodifyService,
  serverId: string,
  type: string,
  data: any,
) {
  if (type === "heartbeat") {
    if (
      !data ||
      Array.isArray(data) ||
      typeof data !== "object" ||
      JSON.stringify(data).length > 20000
    )
      throw Error("Invalid metrics");
    return { operations: await service.heartbeat(serverId, data) };
  }
  if (type === "traffic")
    return service.traffic(serverId, TrafficBatch.parse(data));
  if (type === "network") return service.network(serverId, data);
  if (type === "terminal-exchange")
    return new TerminalSessions(service).exchange(serverId, data);
  if (type === "result") {
    const result = OperationResult.parse(data);
    return service.complete(
      serverId,
      result.id,
      result.state,
      result.message,
      result.result,
    );
  }
  throw Error("Unknown Agent request");
}
