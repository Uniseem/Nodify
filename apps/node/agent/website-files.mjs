import { constants } from "node:fs";
import {
  open,
  lstat,
  stat as fileStat,
  realpath,
  readdir,
  mkdir,
  rename,
  unlink,
  rmdir,
  link,
  chmod,
} from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

const LIMIT = 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const directoryTag = (stat) =>
  digest(`${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}`);
function parts(value, root = false) {
  if (typeof value !== "string" || value.length > 1024 || (!root && !value))
    throw new Error("Invalid website path");
  const result = value ? value.split("/") : [];
  if (
    result.some(
      (name) =>
        !name ||
        name === "." ||
        name === ".." ||
        /[\\:\x00-\x1f\x7f]/.test(name) ||
        name.startsWith(".nodify-"),
    )
  )
    throw new Error("路径必须位于网站目录内");
  return result;
}
const within = (base, target) => {
  const path = relative(base, target);
  return (
    !isAbsolute(path) &&
    path !== ".." &&
    !path.startsWith("../") &&
    !path.startsWith("..\\")
  );
};

// Linux directory descriptors anchor each path component. Symlinks and special
// files are never followed, including when an intermediate name is exchanged.
class Directory {
  handles = [];
  async init(root) {
    if (!(await lstat(root)).isDirectory())
      throw new Error("网站根目录必须是实际目录，不能是符号链接");
    this.base = await realpath(root);
    this.root = await this.directory(root);
    return this;
  }
  async directory(path) {
    if (!(await lstat(path)).isDirectory())
      throw new Error("不能访问目录符号链接");
    if (process.platform !== "linux") {
      if (!within(this.base, await realpath(path)))
        throw new Error("网站目录已变化，请刷新");
      return path;
    }
    const handle = await open(
      path,
      constants.O_RDONLY |
        (constants.O_DIRECTORY || 0) |
        (constants.O_NOFOLLOW || 0),
    );
    this.handles.push(handle);
    const anchor = `/proc/${process.pid}/fd/${handle.fd}`;
    if (!within(this.base, await realpath(anchor)))
      throw new Error("网站目录已变化，请刷新");
    return anchor;
  }
  async parent(segments) {
    let anchor = this.root;
    for (const name of segments)
      anchor = await this.directory(join(anchor, name));
    if (!within(this.base, await realpath(anchor)))
      throw new Error("网站目录已移动，请刷新");
    return anchor;
  }
  async close() {
    await Promise.all(this.handles.map((handle) => handle.close()));
  }
}
async function regular(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1)
    throw new Error("只能打开普通文件，不允许访问符号链接或硬链接");
  const handle = await open(
    path,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW || 0) |
      (constants.O_NONBLOCK || 0),
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.ino !== before.ino ||
      stat.dev !== before.dev
    )
      throw new Error("文件已被修改，请重新打开后再保存");
    if (stat.size > LIMIT) throw new Error("文件超过 1 MiB 传输上限");
    const data = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < data.length) {
      const read = await handle.read(
        data,
        length,
        data.length - length,
        length,
      );
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    if (
      length !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    )
      throw new Error("读取期间文件发生变化，请刷新后重试");
    return {
      bytes: data.subarray(0, length),
      etag: digest(data.subarray(0, length)),
      stat,
    };
  } finally {
    await handle.close();
  }
}
async function exists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function expected(path, tag) {
  const stat = await lstat(path);
  const etag = stat.isDirectory()
    ? directoryTag(stat)
    : (await regular(path)).etag;
  if (typeof tag !== "string" || etag !== tag)
    throw new Error("文件已被修改，请重新打开后再保存");
  return stat;
}
async function syncDirectory(path) {
  if (process.platform !== "linux") return;
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function websiteFiles(websites, payload) {
  const site = websites[payload.websiteId];
  if (
    !site ||
    site.remove ||
    site.type !== "static" ||
    site.deployment !== payload.deployment
  )
    throw new Error("网站生效版本已改变，请刷新后操作文件");
  if (
    !["list", "read", "write", "mkdir", "remove", "rename"].includes(
      payload.action,
    )
  )
    throw new Error("Unknown file action");
  const segments = parts(payload.path, payload.action === "list");
  const scope = new Directory();
  try {
    await scope.init(site.target);
    if (payload.action === "list") {
      const directory = await scope.parent(segments);
      const names = (await readdir(directory))
        .filter((name) => !name.startsWith(".nodify-"))
        .sort();
      if (names.length > 10000) throw new Error("目录超过 10000 项浏览上限");
      if (typeof (payload.after ?? "") !== "string")
        throw new Error("Invalid directory cursor");
      const page = names
        .filter((name) => name > (payload.after || ""))
        .slice(0, 201);
      const entries = [];
      for (const name of page.slice(0, 200)) {
        const path = join(directory, name),
          stat = await lstat(path);
        const kind = stat.isDirectory()
          ? "directory"
          : stat.isFile() && stat.nlink === 1
            ? "file"
            : "link";
        entries.push({
          name,
          kind,
          size: String(stat.size),
          modifiedAt: stat.mtime.toISOString(),
          etag:
            kind === "directory"
              ? directoryTag(stat)
              : kind === "file" && stat.size <= LIMIT
                ? (await regular(path)).etag
                : null,
        });
      }
      return {
        path: payload.path,
        entries,
        next: page.length > 200 ? page[199] : null,
        limit: LIMIT,
      };
    }
    const parent = await scope.parent(segments.slice(0, -1)),
      path = join(parent, segments.at(-1));
    if (payload.action === "read") {
      const file = await regular(path);
      return {
        path: payload.path,
        size: String(file.bytes.length),
        etag: file.etag,
        data: file.bytes.toString("base64"),
      };
    }
    if (payload.action === "mkdir") {
      await mkdir(path, { mode: 0o755 });
      await chmod(await scope.directory(path), 0o755);
    } else if (payload.action === "write") {
      if (
        typeof payload.data !== "string" ||
        payload.data.length > Math.ceil(LIMIT / 3) * 4
      )
        throw new Error("文件超过 1 MiB 传输上限");
      const bytes = Buffer.from(payload.data, "base64");
      if (bytes.length > LIMIT || bytes.toString("base64") !== payload.data)
        throw new Error("文件内容编码无效");
      let previous;
      if (payload.expected === null) {
        if (await exists(path))
          throw new Error("同名文件已存在，请先打开文件再编辑");
      } else {
        previous = await expected(path, payload.expected);
        if (!previous.isFile()) throw new Error("只能覆盖普通文件");
      }
      const temporary = join(parent, `.nodify-${randomUUID()}.tmp`);
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(bytes);
          if (previous && process.platform === "linux")
            await handle.chown(previous.uid, previous.gid);
          await handle.chmod(previous ? previous.mode & 0o777 : 0o644);
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (payload.expected === null) {
          await link(temporary, path); // no replacement if another file appeared
          await unlink(temporary);
        } else {
          await expected(path, payload.expected);
          await rename(temporary, path);
        }
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    } else if (payload.action === "remove") {
      const stat = await expected(path, payload.expected);
      if (stat.isDirectory())
        await rmdir(path); // never recursively delete site contents
      else await unlink(path);
    } else {
      const destination = parts(payload.destination);
      const targetParent = await scope.parent(destination.slice(0, -1)),
        target = join(targetParent, destination.at(-1));
      const stat = await expected(path, payload.expected);
      if (!stat.isFile()) throw new Error("暂不支持重命名目录");
      if (await exists(target)) throw new Error("目标名称已存在");
      if ((await fileStat(targetParent)).dev !== stat.dev)
        throw new Error("不能跨文件系统移动文件");
      if (process.platform === "linux") {
        await exec(
          "mv",
          ["--no-clobber", "--no-target-directory", "--", path, target],
          { timeout: 10000 },
        );
        if (await exists(path)) throw new Error("目标名称已存在");
      } else await rename(path, target);
      await syncDirectory(targetParent);
    }
    await syncDirectory(parent);
    return { path: payload.path, action: payload.action, completed: true };
  } catch (error) {
    const errors = {
      ENOENT: "文件或目录已不存在，请刷新",
      EEXIST: "目标名称已存在",
      ENOTEMPTY: "目录非空，不能删除",
      EACCES: "Agent 没有目录访问权限",
      ELOOP: "不允许访问符号链接",
      ENOTDIR: "路径中包含非目录项",
    };
    if (errors[error.code]) throw new Error(errors[error.code]);
    throw error;
  } finally {
    await scope.close();
  }
}
