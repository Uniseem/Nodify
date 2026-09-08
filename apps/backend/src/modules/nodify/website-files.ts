import { BadRequestException, ConflictException } from "@nestjs/common";
import { WebsiteFileRequest, WebsiteInput } from "@nodify/contract";
import { randomUUID } from "node:crypto";
import { NodifyService } from "./nodify.service";

export class WebsiteFiles {
  constructor(private readonly service: NodifyService) {}
  async queue(serverId: string, websiteId: string, body: unknown) {
    const input = WebsiteFileRequest.parse(body);
    return this.service.db.$transaction(async (tx) => {
      const site = await tx.nodifyWebsite.findFirstOrThrow({
        where: { id: websiteId, serverId },
      });
      if (!site.appliedConfig || site.appliedDeployment !== input.deployment)
        throw new ConflictException("网站生效版本已变化，请刷新网站后操作");
      if (WebsiteInput.parse(site.appliedConfig).type !== "static")
        throw new BadRequestException("文件管理仅适用于已发布的静态网站");
      const previous = site.operationId
        ? await tx.nodifyOperation.findUnique({
            where: { id: site.operationId },
          })
        : null;
      if (
        previous &&
        ["queued", "running"].includes(previous.state) &&
        previous.expiresAt > new Date()
      )
        throw new ConflictException("网站任务尚未完成，请等待后重试");
      const operation = await tx.nodifyOperation.create({
        data: {
          id: randomUUID(),
          serverId,
          kind: "website-files",
          payload: this.service.box.seal(
            JSON.stringify({
              websiteId,
              deployment: input.deployment,
              ...input.request,
            }),
          ),
          expiresAt: new Date(Date.now() + 120000),
        },
      });
      await tx.nodifyWebsite.update({
        where: { id: websiteId },
        data: { operationId: operation.id },
      });
      return { id: operation.id, state: operation.state };
    });
  }
}
