import { z } from "zod";
import { TRAFFIC_POLICY_RECEIPT_LIMIT } from "@nodify/contract";
import { BadRequestException } from "@nestjs/common";
import { SecretBox } from "./crypto";
import type { RuntimeUser } from "./configuration";

// Billing-only receipt. It carries no protocol password or subscription token.
const Receipt = z.object({
  format: z.literal("nodify-traffic-policy-v1"),
  serverId: z.uuid(),
  policyId: z.uuid(),
  issuedAt: z.iso.datetime(),
  tariffs: z
    .array(
      z.tuple([
        z.string().regex(/^\d+$/).max(20),
        z.number().int().nonnegative(),
        z.enum(["both", "upload", "download"]),
        z.number().finite().positive(),
      ]),
    )
    .max(10000),
});

export function issueTrafficPolicy(
  box: SecretBox,
  serverId: string,
  policyId: string,
  issuedAt: Date,
  users: RuntimeUser[],
) {
  const value = Receipt.parse({
    format: "nodify-traffic-policy-v1",
    serverId,
    policyId,
    issuedAt: issuedAt.toISOString(),
    tariffs: users.map((user) => [
      user.id,
      user.generation || 0,
      user.direction || "both",
      user.multiplier || 1,
    ]),
  });
  const receipt = box.seal(JSON.stringify(value));
  if (receipt.length > TRAFFIC_POLICY_RECEIPT_LIMIT)
    throw new BadRequestException("Traffic policy is too large");
  return receipt;
}

export function readTrafficPolicy(
  box: SecretBox,
  receipt: string,
  serverId: string,
  policyId: string,
) {
  try {
    const value = Receipt.parse(JSON.parse(box.open(receipt)));
    if (value.serverId !== serverId || value.policyId !== policyId)
      throw new Error();
    return {
      issuedAt: new Date(value.issuedAt),
      users: value.tariffs.map(([id, generation, direction, multiplier]) => ({
        id,
        generation,
        direction,
        multiplier,
      })),
    };
  } catch {
    throw new BadRequestException("Invalid traffic policy receipt");
  }
}
