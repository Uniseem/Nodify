import { Button, Card, TextArea } from "@heroui/react";
import { WEBSITE_FILE_LIMIT } from "@nodify/contract";
import { useEffect, useRef, useState } from "react";
import { instance } from "@shared/api/axios";
import { Field } from "./editor-fields";
import { websiteError } from "./website-error";

type Row = Record<string, any>;
const encode = (bytes: Uint8Array) => {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
};
const decode = (data: string) =>
  Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
export function WebsiteFileManager({
  site,
  serverId,
  close,
}: {
  site: Row;
  serverId: string;
  close: () => void;
}) {
  const [listing, setListing] = useState<Row>({
      path: "",
      entries: [],
      next: null,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [name, setName] = useState(""),
    [editor, setEditor] = useState<Row | null>(null),
    [content, setContent] = useState(""),
    [remove, setRemove] = useState<Row | null>(null),
    [rename, setRename] = useState<Row | null>(null),
    [closing, setClosing] = useState("");
  const active = useRef<AbortController | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const dirty = editor && content !== editor.original;
  const selecting = Boolean(remove || rename);
  const pathFor = (value: string) =>
    listing.path ? `${listing.path}/${value}` : value;
  const request = async (path: string, body?: unknown) =>
    (
      await instance.request({
        url: `/api/${path}`,
        method: body === undefined ? "GET" : "POST",
        data: body,
        signal: active.current?.signal,
      })
    ).data.response;
  const task = async (requestBody: Row) => {
    const created = await request(
      `servers/${serverId}/websites/${site.id}/files`,
      { deployment: site.appliedDeployment, request: requestBody },
    );
    setStatus(`任务 ${created.id}，等待 Agent 执行…`);
    const deadline = Date.now() + 125000;
    while (Date.now() < deadline) {
      if (active.current?.signal.aborted) throw new Error("已关闭文件管理");
      const op = await request(`operations/${created.id}`);
      if (op.state === "failed") throw new Error(op.message || "文件任务失败");
      if (op.state === "succeeded") {
        setStatus("Agent 已完成操作");
        return op.result.contentAvailable
          ? request(`operations/${op.id}/file-result`)
          : op.result;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("尚未收到最终结果，请在任务记录中检查，当前内容已保留");
  };
  const list = async (path = listing.path, after = "") => {
    const result = await task({ action: "list", path, after });
    if (!active.current?.signal.aborted)
      setListing((current) => ({
        ...result,
        entries: after
          ? [...current.entries, ...result.entries]
          : result.entries,
      }));
  };
  const run = (work: () => Promise<void>) => {
    if (active.current && !active.current.signal.aborted) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    void work()
      .catch((e) => {
        if (!controller.signal.aborted) {
          setStatus("");
          setError(websiteError(e));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
        controller.abort();
      });
  };
  useEffect(() => {
    const timer = setTimeout(() => run(() => list("")), 0);
    return () => {
      clearTimeout(timer);
      active.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const read = (entry: Row, download: boolean) =>
    run(async () => {
      const file = await task({ action: "read", path: pathFor(entry.name) });
      const bytes = decode(file.data);
      if (download) {
        const url = URL.createObjectURL(
          new Blob([bytes], { type: "application/octet-stream" }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = entry.name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (text.includes("\0"))
          throw new Error("该文件不是可编辑的 UTF-8 文本，请使用下载");
        setEditor({ path: file.path, expected: file.etag, original: text });
        setContent(text);
      }
    });
  return (
    <Card className="nd-stack">
      <Card.Header>
        <Card.Title>网站文件 · {site.config.name}</Card.Title>
      </Card.Header>
      <Card.Content className="nd-stack">
        <p className="nd-muted">
          已应用目录：{site.appliedConfig.target} · 单文件传输上限 1
          MiB。修改保存后立即影响站点内容。
        </p>
        {error && (
          <p role="alert" tabIndex={-1} ref={errorRef} className="nd-error">
            {error}
          </p>
        )}
        {status && <p role="status">{status}</p>}
        <div className="nd-row">
          <strong style={{ overflowWrap: "anywhere" }}>/{listing.path}</strong>
          <Button
            variant="tertiary"
            isDisabled={busy || !!editor || selecting || !listing.path}
            onPress={() =>
              run(() => list(listing.path.split("/").slice(0, -1).join("/")))
            }
          >
            上一级
          </Button>
          <Button
            variant="tertiary"
            isDisabled={busy || !!editor || selecting}
            onPress={() => run(() => list())}
          >
            刷新目录
          </Button>
          <Button
            variant="tertiary"
            isDisabled={busy}
            onPress={() => (dirty ? setClosing("manager") : close())}
          >
            关闭文件管理
          </Button>
        </div>
        {closing && (
          <div className="nd-notice">
            <p>文件内容尚未保存，离开编辑将丢弃本地修改。</p>
            <Button
              variant="danger"
              onPress={() => {
                if (closing === "manager") close();
                else {
                  setEditor(null);
                  setClosing("");
                }
              }}
            >
              丢弃未保存修改
            </Button>
            <Button onPress={() => setClosing("")}>继续编辑</Button>
          </div>
        )}
        {!editor && (
          <div className="nd-stack" inert={busy || selecting}>
            <Field label="新文件或目录名称" value={name} change={setName} />
            <div className="nd-row">
              <Button
                isDisabled={!name || name.includes("/")}
                onPress={() => {
                  setEditor({
                    path: pathFor(name),
                    expected: null,
                    original: "",
                  });
                  setContent("");
                }}
              >
                新建文本文件
              </Button>
              <Button
                isDisabled={!name || name.includes("/")}
                onPress={() =>
                  run(async () => {
                    await task({ action: "mkdir", path: pathFor(name) });
                    setName("");
                    await list();
                  })
                }
              >
                新建目录
              </Button>
              <label className="nd-field">
                上传文件（同名文件不会覆盖）
                <input
                  aria-label="上传网站文件"
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    if (file.size > WEBSITE_FILE_LIMIT) {
                      setError("文件超过 1 MiB 传输上限");
                      return;
                    }
                    run(async () => {
                      await task({
                        action: "write",
                        path: pathFor(file.name),
                        expected: null,
                        data: encode(new Uint8Array(await file.arrayBuffer())),
                      });
                      await list();
                    });
                  }}
                />
              </label>
            </div>
          </div>
        )}
        {editor && (
          <form
            className="nd-stack"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                const bytes = new TextEncoder().encode(content);
                if (bytes.length > WEBSITE_FILE_LIMIT)
                  throw new Error("文件超过 1 MiB 传输上限");
                await task({
                  action: "write",
                  path: editor.path,
                  expected: editor.expected,
                  data: encode(bytes),
                });
                setEditor(null);
                setName("");
                await list();
              });
            }}
          >
            <strong style={{ overflowWrap: "anywhere" }}>{editor.path}</strong>
            <TextArea
              aria-label="网站文件内容"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={14}
              disabled={busy}
            />
            <div className="nd-row">
              <Button type="submit" isDisabled={busy}>
                保存文件
              </Button>
              <Button
                isDisabled={busy}
                variant="tertiary"
                onPress={() => (dirty ? setClosing("editor") : setEditor(null))}
              >
                取消编辑
              </Button>
            </div>
          </form>
        )}
        {!listing.entries.length && !busy && <p>当前目录为空。</p>}
        {listing.entries.map((entry: Row) => (
          <div className="nd-engine-entry" key={entry.name}>
            <strong style={{ overflowWrap: "anywhere" }}>{entry.name}</strong>
            <span>
              {" "}
              ·{" "}
              {entry.kind === "directory"
                ? "目录"
                : entry.kind === "link"
                  ? "链接或特殊文件（不操作）"
                  : `${entry.size} 字节`}
            </span>
            <div className="nd-row">
              {entry.kind === "directory" ? (
                <Button
                  isDisabled={busy || !!editor || selecting}
                  onPress={() => run(() => list(pathFor(entry.name)))}
                >
                  打开目录
                </Button>
              ) : (
                entry.kind === "file" && (
                  <>
                    <Button
                      isDisabled={busy || !!editor || selecting || !entry.etag}
                      onPress={() => read(entry, false)}
                    >
                      编辑文本
                    </Button>
                    <Button
                      isDisabled={busy || !!editor || selecting || !entry.etag}
                      onPress={() => read(entry, true)}
                    >
                      下载
                    </Button>
                    <Button
                      isDisabled={busy || !!editor || selecting || !entry.etag}
                      onPress={() => {
                        setRename(entry);
                        setName(entry.name);
                      }}
                    >
                      重命名
                    </Button>
                  </>
                )
              )}
              <Button
                variant="danger-soft"
                isDisabled={busy || !!editor || selecting || !entry.etag}
                onPress={() => setRemove(entry)}
              >
                删除
              </Button>
            </div>
          </div>
        ))}
        {listing.next && (
          <Button
            isDisabled={busy || !!editor || selecting}
            onPress={() => run(() => list(listing.path, listing.next))}
          >
            加载更多文件
          </Button>
        )}
        {rename && (
          <div className="nd-notice">
            <Field label="重命名为" value={name} change={setName} />
            <Button
              isDisabled={busy || !name || name.includes("/")}
              onPress={() =>
                run(async () => {
                  await task({
                    action: "rename",
                    path: pathFor(rename.name),
                    destination: pathFor(name),
                    expected: rename.etag,
                  });
                  setRename(null);
                  setName("");
                  await list();
                })
              }
            >
              确认重命名
            </Button>
            <Button isDisabled={busy} onPress={() => setRename(null)}>
              取消
            </Button>
          </div>
        )}
        {remove && (
          <div className="nd-notice">
            <p>
              确认删除 {remove.name}？文件删除不可撤销，非空目录会拒绝删除。
            </p>
            <Button
              variant="danger"
              isDisabled={busy}
              onPress={() =>
                run(async () => {
                  await task({
                    action: "remove",
                    path: pathFor(remove.name),
                    expected: remove.etag,
                  });
                  setRemove(null);
                  await list();
                })
              }
            >
              确认删除文件或空目录
            </Button>
            <Button isDisabled={busy} onPress={() => setRemove(null)}>
              取消删除
            </Button>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
