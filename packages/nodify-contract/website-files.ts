import { z } from "zod";

export const WEBSITE_FILE_LIMIT = 1024 * 1024;
const Path = z
  .string()
  .max(1024)
  .refine(
    (value) =>
      value === "" ||
      value
        .split("/")
        .every(
          (part) =>
            part.length > 0 &&
            part !== "." &&
            part !== ".." &&
            !/[\\:\x00-\x1f\x7f]/.test(part) &&
            !part.startsWith(".nodify-"),
        ),
    "请使用网站内的相对路径，不能包含路径跳转或内部临时文件",
  );
const FilePath = Path.refine((value) => value !== "", "不能修改网站根目录");
const Etag = z.string().regex(/^[a-f0-9]{64}$/);
export const WebsiteFileAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    path: Path,
    after: z.string().max(255).default(""),
  }),
  z.object({ action: z.literal("read"), path: FilePath }),
  z.object({ action: z.literal("mkdir"), path: FilePath }),
  z.object({
    action: z.literal("write"),
    path: FilePath,
    expected: Etag.nullable(),
    data: z
      .string()
      .max(Math.ceil(WEBSITE_FILE_LIMIT / 3) * 4)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
  }),
  z.object({ action: z.literal("remove"), path: FilePath, expected: Etag }),
  z.object({
    action: z.literal("rename"),
    path: FilePath,
    destination: FilePath,
    expected: Etag,
  }),
]);
export const WebsiteFileRequest = z.object({
  deployment: z.number().int().positive(),
  request: WebsiteFileAction,
});
