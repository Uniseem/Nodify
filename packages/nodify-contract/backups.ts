import { z } from "zod";

const StorageUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !!url.hostname &&
        !url.username &&
        !url.password &&
        !/[?#\s\u0000-\u001f\u007f\\]/.test(value)
      );
    } catch {
      return false;
    }
  }, "请填写 HTTPS 目录地址，不含账号、查询参数、片段或空白字符");
const Credential = z
  .string()
  .min(1, "请填写存储密码或密钥")
  .max(4096, "存储密码或密钥过长");
export const BackupDestination = z.discriminatedUnion("type", [
  z.object({ type: z.literal("local") }),
  z.object({
    type: z.literal("webdav"),
    url: StorageUrl,
    username: z
      .string()
      .min(1, "请填写 WebDAV 用户名")
      .max(256, "WebDAV 用户名最多 256 字符")
      .refine(
        (v) => !/[:\u0000-\u001f\u007f]/.test(v),
        "用户名不能包含冒号或控制字符",
      ),
    password: Credential,
  }),
  z.object({
    type: z.literal("s3"),
    endpoint: StorageUrl,
    region: z
      .string()
      .min(1, "请填写区域")
      .max(128, "区域名称最多 128 字符")
      .regex(/^[a-z0-9-]+$/, "区域只能包含小写字母、数字和连字符"),
    bucket: z
      .string()
      .min(3, "存储桶名称至少 3 字符")
      .max(63, "存储桶名称最多 63 字符")
      .regex(
        /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/,
        "存储桶名称只能包含小写字母、数字、句点和连字符，首尾必须为字母或数字",
      )
      .refine(
        (v) => !v.includes("..") && !/^\d+\.\d+\.\d+\.\d+$/.test(v),
        "存储桶名称不能含连续句点或使用 IP 地址",
      ),
    accessKeyId: z
      .string()
      .min(1, "请填写 Access Key ID")
      .max(256, "Access Key ID 最多 256 字符")
      .regex(
        /^[A-Za-z0-9_-]+$/,
        "Access Key ID 只能包含字母、数字、下划线和连字符",
      ),
    secretAccessKey: Credential,
  }),
]);
export const BackupSchedule = z.object({
  enabled: z.boolean(),
  intervalHours: z
    .number()
    .int("间隔必须是整数小时")
    .min(1, "间隔至少 1 小时")
    .max(720, "间隔最多 720 小时")
    .default(24),
  retain: z
    .number()
    .int("保留份数必须是整数")
    .min(1, "至少保留 1 份备份")
    .max(100, "最多保留 100 份备份")
    .default(7),
  password: z
    .string()
    .min(12, "加密密码至少 12 字符")
    .max(256, "加密密码最多 256 字符"),
  destination: BackupDestination,
});
export type TBackupDestination = z.infer<typeof BackupDestination>;
