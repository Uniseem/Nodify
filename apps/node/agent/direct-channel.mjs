import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

// The panel initiates every exchange. RPCs retain their IDs until the panel replies.
// Business tasks and traffic retain their existing durable journals and acknowledgements.
export class DirectChannel {
  constructor({
    token,
    credential,
    host = "127.0.0.1",
    port = 23889,
    cert,
    key,
  }) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token || ""))
      throw Error("Invalid NODIFY_DIRECT_TOKEN");
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw Error("Invalid NODIFY_DIRECT_PORT");
    if ((!cert || !key) && !["127.0.0.1", "::1"].includes(host))
      throw Error(
        "Non-loopback direct listener requires TLS certificate and key",
      );
    if (!!cert !== !!key)
      throw Error("Both direct TLS certificate and key are required");
    Object.assign(this, { token, credential, host, port, cert, key });
    this.pending = null;
    this.poll = null;
    this.closed = false;
  }
  async listen() {
    const handler = (req, res) => {
      void this.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(400);
        res.end();
      });
    };
    this.server = this.cert
      ? httpsServer(
          {
            cert: await readFile(this.cert),
            key: await readFile(this.key),
            minVersion: "TLSv1.2",
          },
          handler,
        )
      : httpServer(handler);
    this.server.requestTimeout = 25000;
    this.server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, resolve);
    });
    return this.server.address();
  }
  authorized(value) {
    const digest = (s) => createHash("sha256").update(s).digest();
    return timingSafeEqual(digest(value || ""), digest(`Bearer ${this.token}`));
  }
  async handle(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (!this.authorized(req.headers.authorization)) {
      res.writeHead(401);
      res.end();
      return;
    }
    if (req.method !== "POST" || req.url !== "/api/nodify/exchange") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (this.poll || this.receiving) {
      res.writeHead(409);
      res.end();
      return;
    }
    this.receiving = true;
    let body;
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } finally {
      this.receiving = false;
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw Error("Invalid exchange");
    if (body.reply) {
      if (typeof body.reply.id !== "string") throw Error("Invalid reply");
      if (this.pending?.frame.id === body.reply.id) {
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        if (body.reply.error)
          pending.reject(Error("Direct panel rejected request"));
        else pending.resolve(body.reply.result);
      }
    }
    const timer = setTimeout(() => finish(null), 18000);
    const finish = (frame) => {
      clearTimeout(timer);
      if (this.poll?.res === res) this.poll = null;
      if (!res.destroyed) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ frame }));
      }
    };
    this.poll = { res, finish };
    res.once("close", () => {
      clearTimeout(timer);
      if (this.poll?.res === res) this.poll = null;
    });
    if (this.pending) finish(this.pending.frame);
  }
  request(type, data, { timeoutMs = 30000 } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000)
      return Promise.reject(Error('Invalid direct request timeout'));
    if (this.closed) return Promise.reject(Error("Direct channel stopped"));
    if (this.pending)
      return Promise.reject(Error("Direct request already pending"));
    return new Promise((resolve, reject) => {
      const frame = {
        id: randomUUID(),
        credential: this.credential(),
        type,
        data,
      };
      if (Buffer.byteLength(JSON.stringify({ frame })) > 2 * 1024 * 1024) {
        reject(Error("Direct request exceeds 2 MiB"));
        return;
      }
      const timer = setTimeout(() => {
        if (this.pending?.frame.id === frame.id) this.pending = null;
        reject(Error("Direct panel request timed out"));
      }, timeoutMs);
      this.pending = { frame, resolve, reject, timer };
      this.poll?.finish(frame);
    });
  }
  async close() {
    this.closed = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(Error("Direct channel stopped"));
      this.pending = null;
    }
    this.poll?.finish(null);
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise((r) => this.server.close(r));
    }
  }
}
