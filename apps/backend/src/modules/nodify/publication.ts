import { ConflictException } from "@nestjs/common";
import {
  PublicationInput,
  tunnelArtifacts,
  subscriptionRequestAllowed,
} from "@nodify/contract";
import type { NodifyService } from "./nodify.service";
import type { Request, Response, NextFunction } from "express";
const key = "publication-domains";
export class PublicationSettings {
  constructor(private readonly service: NodifyService) {}
  async read() {
    const row = await this.service.db.nodifySetting.findUnique({
      where: { key },
    });
    return row
      ? PublicationInput.parse(JSON.parse(row.value))
      : { version: 0, config: null };
  }
  async save(body: unknown) {
    const input = PublicationInput.parse(body);
    await this.service.db.$transaction(async (tx) => {
      const row = await tx.nodifySetting.findUnique({ where: { key } });
      const previous = row
        ? PublicationInput.parse(JSON.parse(row.value)).version
        : 0;
      if (previous !== input.version)
        throw new ConflictException(
          "发布设置已变化，请重新载入；本地修改已保留",
        );
      const value = JSON.stringify({ ...input, version: previous + 1 });
      await tx.nodifySetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    });
    return this.read();
  }
  async view() {
    const saved = await this.read();
    return {
      ...saved,
      environmentUrl: process.env.NODIFY_PUBLIC_URL || "",
      artifacts: saved.config ? tunnelArtifacts(saved.config) : null,
    };
  }
  async allows(host: string | undefined, method: string, url: string) {
    const { config } = await this.read();
    const hostname = (host || "")
      .split(":")[0]
      .toLowerCase()
      .replace(/\.$/, "");
    if (!config || hostname !== new URL(config.subscriptionUrl).hostname)
      return true;
    return subscriptionRequestAllowed(method, url);
  }
}
export function publicationGuard(service: NodifyService) {
  const settings = new PublicationSettings(service);
  return (req: Request, res: Response, next: NextFunction) => {
    void settings
      .allows(req.headers.host, req.method, req.originalUrl)
      .then((allowed) => {
        if (allowed) next();
        else res.status(404).end();
      })
      .catch(() => res.status(503).end());
  };
}
