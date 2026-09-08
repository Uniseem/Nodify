import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

export class TerminalRuntime {
    constructor(directory, binary = process.env.NODIFY_PTY_BINARY || 'nodify-pty') {
        this.directory = directory;
        this.binary = binary;
        this.sessions = new Map();
        this.available = false;
    }
    async init() {
        if (process.platform !== 'linux') return;
        this.available = await promisify(execFile)(this.binary, ['--version'], { timeout: 3000 })
            .then(({ stdout }) => stdout.trim() === 'nodify-pty/1').catch(() => false);
    }
    async open(payload) {
        if (!this.available) throw new Error('Interactive terminal requires the Nodify PTY helper on Linux');
        if (this.sessions.has(payload.id)) return { sessionId: payload.id };
        if (this.sessions.size >= 2) throw new Error('Terminal session limit reached');
        const expiresAt = Date.parse(payload.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 1801000)
            throw new Error('Invalid terminal expiry');
        const child = spawn(this.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
        const session = { id: payload.id, child, state: 'running', reason: '', output: [], sequence: 0,
            inputAck: 0, bytes: 0, pendingBytes: 0, expiresAt, leaseUntil: Date.now() + 30000 };
        this.sessions.set(payload.id, session);
        const send = (value) => {
            if (child.stdin.destroyed || child.stdin.writableLength > 65536) throw new Error('Terminal input unavailable');
            child.stdin.write(JSON.stringify(value) + '\n');
        };
        session.send = send;
        let ready;
        const opened = new Promise((resolve, reject) => { ready = { resolve, reject }; });
        const timer = setTimeout(() => { ready.reject(new Error('PTY helper startup timed out')); this.close(session.id, 'helper-failed'); }, 5000);
        const lines = createInterface({ input: child.stdout });
        lines.on('line', (line) => {
            try {
                if (line.length > 25000) throw new Error('PTY frame too large');
                const value = JSON.parse(line);
                if (value.type === 'ready') { clearTimeout(timer); ready.resolve(); }
                else if (value.type === 'data') {
                    const size = Buffer.byteLength(value.data, 'base64');
                    if (size > 16384 || session.bytes + size > 1048576 || session.pendingBytes + size > 262144) {
                        this.close(session.id, 'output-limit'); return;
                    }
                    session.bytes += size; session.pendingBytes += size;
                    session.output.push({ sequence: ++session.sequence, data: value.data });
                } else if (value.type === 'exit') session.exitCode = value.code;
            } catch { this.close(session.id, 'helper-failed'); }
        });
        child.stderr.resume(); // Helper diagnostics must not become a second unbounded log stream.
        child.stdin.on('error', () => this.close(session.id, 'helper-failed'));
        child.on('error', () => { ready.reject(new Error('PTY helper could not start')); session.state = 'failed'; session.reason = 'helper-failed'; });
        child.on('close', () => {
            session.endedAt = Date.now();
            clearTimeout(timer); clearInterval(session.watchdog);
            if (['running', 'closing'].includes(session.state)) session.state = session.reason === 'helper-failed' ? 'failed' : 'closed';
            session.reason ||= 'closed';
            ready.reject(new Error('PTY helper exited before starting'));
        });
        session.watchdog = setInterval(() => {
            if (Date.now() >= session.expiresAt) this.close(session.id, 'expired');
            else if (Date.now() >= session.leaseUntil) this.close(session.id, 'idle');
        }, 500);
        session.watchdog.unref();
        send({ type: 'open', directory: this.directory, cols: payload.cols, rows: payload.rows,
            seconds: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)) });
        try { await opened; return { sessionId: payload.id }; }
        catch (error) { this.close(payload.id, 'helper-failed'); throw error; }
    }
    close(id, reason = 'closed') {
        const session = this.sessions.get(id);
        if (!session || session.state !== 'running') return;
        session.state = 'closing'; session.reason = reason;
        session.child.stdin.end(JSON.stringify({ type: 'close' }) + '\n');
        const timer = setTimeout(() => session.child.kill('SIGTERM'), 2000); timer.unref();
        session.child.once('close', () => clearTimeout(timer));
    }
    snapshot() {
        // Terminal output is ephemeral. An unreachable/restored panel cannot hold dead PTYs forever.
        for (const [id, session] of this.sessions) if (session.endedAt && Date.now() - session.endedAt > 30000) this.sessions.delete(id);
        return { sessions: [...this.sessions.values()].map((s) => ({ id: s.id, state: s.state === 'closing' ? 'running' : s.state, reason: s.state === 'closing' ? '' : s.reason,
            inputAck: s.inputAck, output: s.output.slice(0, 16), ...(s.exitCode === undefined ? {} : { exitCode: s.exitCode }) })) };
    }
    accept(reply) {
        for (const value of reply.sessions || []) {
            const s = this.sessions.get(value.id); if (!s) continue;
            if (!Number.isSafeInteger(value.outputAck) || value.outputAck < 0 || value.outputAck > s.sequence)
                throw new Error('Invalid terminal acknowledgement');
            s.output = s.output.filter((frame) => frame.sequence > value.outputAck);
            s.pendingBytes = s.output.reduce((n, f) => n + Buffer.byteLength(f.data, 'base64'), 0);
            s.leaseUntil = Math.min(s.expiresAt, Date.parse(value.leaseUntil) || 0);
            if (value.close) this.close(s.id);
            if (value.close && value.discardOutput) { s.output = []; s.pendingBytes = 0; }
            for (const frame of value.inputs || []) {
                if (frame.sequence <= s.inputAck) continue;
                if (frame.sequence !== s.inputAck + 1) throw new Error('Terminal input sequence gap');
                if (s.state !== 'running') break;
                if (frame.type === 'input') s.send({ type: 'input', data: Buffer.from(frame.data, 'utf8').toString('base64') });
                else if (frame.type === 'resize') s.send({ type: 'resize', cols: frame.cols, rows: frame.rows });
                else throw new Error('Unknown terminal input');
                s.inputAck = frame.sequence;
            }
            if (s.state !== 'running' && s.output.length === 0 && (s.child.exitCode !== null || s.child.signalCode !== null)) {
                clearInterval(s.watchdog); this.sessions.delete(s.id);
            }
        }
    }
    async stopAll() {
        await Promise.all([...this.sessions.values()].map(async (s) => {
            const exited = s.child.exitCode === null && s.child.signalCode === null ? new Promise((r) => s.child.once('close', r)) : Promise.resolve();
            this.close(s.id); await exited; clearInterval(s.watchdog);
        }));
        this.sessions.clear();
    }
}
