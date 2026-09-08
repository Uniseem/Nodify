import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

import { restrictPolicy } from './policy.mjs';
import { Runtime, atomicJson, pause } from './runtime.mjs';
import { queryStats, statsDelta } from './statistics.mjs';
import { readNetwork, networkDelta } from './network.mjs';
import { NODIFY_VERSION } from './version.mjs';
import { TerminalRuntime } from './terminal.mjs';
import { DirectChannel } from './direct-channel.mjs';

const directory = process.env.NODIFY_AGENT_DATA || '/var/lib/nodify-agent';
const panel = (process.env.NODIFY_PANEL || '').replace(/\/$/, '');
if (!panel || (new URL(panel).protocol !== 'https:' && process.env.NODIFY_ALLOW_HTTP !== '1'))
    throw new Error('NODIFY_PANEL must be an HTTPS URL');
const runtime = new Runtime(directory);
await runtime.init();
const terminals = new TerminalRuntime(directory);
await terminals.init();
const shutdown = new AbortController();
const filename = join(directory, 'state.json');
let state;
try {
    state = JSON.parse(await readFile(filename, 'utf8'));
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = {
        journal: {},
        outbox: [],
        session: randomUUID(),
        sequence: 0,
        counters: {},
        usage: {},
    };
}
const persist = () => atomicJson(filename, state);
state.session = randomUUID();
state.sequence = 0;
state.networkOutbox ??= [];
state.networkSequence = 0;
await persist();
async function http(path, data, authenticated = true) {
    const response = await fetch(`${panel}/api/agent/${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(authenticated ? { Authorization: `Bearer ${state.credential}` } : {}),
        },
        body: JSON.stringify(data),
        signal: AbortSignal.any([AbortSignal.timeout(35000), shutdown.signal]),
    });
    if (!response.ok) throw new Error(`Agent API returned ${response.status}`);
    return response.json();
}
if (!state.credential) {
    const credentials = await http(
        'enroll',
        {
            token: process.env.NODIFY_ENROLLMENT,
            version: process.env.NODIFY_VERSION || NODIFY_VERSION,
            hostname: hostname(),
        },
        false,
    );
    Object.assign(state, credentials);
    await persist();
}
let socket;
const connectionMode = process.env.NODIFY_CONNECTION_MODE || 'auto';
if (!['auto', 'ws', 'pull', 'direct'].includes(connectionMode)) throw Error('Invalid NODIFY_CONNECTION_MODE');
const direct = (connectionMode === 'direct' || (connectionMode === 'auto' && process.env.NODIFY_DIRECT_TOKEN)) ? new DirectChannel({
    token: process.env.NODIFY_DIRECT_TOKEN,
    credential: () => state.credential,
    host: process.env.NODIFY_DIRECT_HOST || '127.0.0.1',
    port: Number(process.env.NODIFY_DIRECT_PORT || '23889'),
    cert: process.env.NODIFY_DIRECT_CERT,
    key: process.env.NODIFY_DIRECT_KEY,
}) : null;
if (direct) await direct.listen();
let waiting;
let nextDirectAttempt = 0;
let stopping = false;
function connect() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${panel.replace(/^http/, 'ws')}/api/agent/connect`, {
            headers: { Authorization: `Bearer ${state.credential}` },
            handshakeTimeout: 5000,
        });
        ws.once('open', () => {
            socket = ws;
            resolve();
        });
        ws.on('error', reject);
        ws.on('close', () => {
            if (socket === ws) { socket = null; nextConnect = Date.now() + 5000; }
            if (waiting?.socket === ws) {
                waiting.reject(new Error('Connection closed'));
                waiting = null;
            }
        });
        ws.on('message', (data) => {
            try {
                const reply = JSON.parse(data.toString());
                if (waiting?.id === reply.id) {
                    waiting.resolve(reply.result);
                    waiting = null;
                }
            } catch {
                ws.close();
            }
        });
    });
}
// Only one transport is awaited at a time. Stable task/batch IDs survive retries on another path.
async function request(type, data) {
    const payload = (transport) => type === 'heartbeat' ? { ...data, connectionMode, connectionTransport: transport, directAvailable: !!direct } : data;
    const pull = () => http(type === 'heartbeat' ? 'poll' : type === 'result' ? 'results' : type, payload('pull'));
    if (connectionMode === 'direct') return direct.request(type, payload('direct'));
    if (connectionMode === 'pull') return pull();
    if (connectionMode === 'ws') return websocketRequest(type, payload('ws'));
    if (socket?.readyState === WebSocket.OPEN) {
        try { return await websocketRequest(type, payload('ws')); }
        catch (error) { if (stopping) throw error; }
    }
    if (direct && Date.now() >= nextDirectAttempt) {
        try { return await direct.request(type, payload('direct'), { timeoutMs: 5000 }); }
        catch (error) {
            if (stopping) throw error;
            nextDirectAttempt = Date.now() + 15000;
        }
    }
    return pull();
}
function websocketRequest(type, data) {
    const ws = socket;
    if (ws?.readyState !== WebSocket.OPEN) return Promise.reject(Error('WebSocket connection unavailable'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
        const finish = (error, value) => {
            clearTimeout(timer);
            if (waiting?.id === id) waiting = null;
            if (error) reject(error); else resolve(value);
        };
        const timer = setTimeout(() => {
            finish(Error('Agent WebSocket request timed out'));
            ws.terminate();
        }, connectionMode === 'auto' ? 10000 : 30000);
        waiting = { id, socket: ws, resolve: value => finish(null, value), reject: error => finish(error) };
        try { ws.send(JSON.stringify({ id, type, data }), error => { if (error) finish(error); }); }
        catch (error) { finish(error); }
    });
}
async function collect() {
    const aggregated = {};
    for (const [service, port] of [
        ['xray', 61001],
        ['sing-box', 61002],
    ]) {
        if (!runtime.children.has(service)) continue;
        try {
            const current = await queryStats(port);
            const deltas = statsDelta(current, state.counters[service] || {});
            state.counters[service] = current;
            for (const u of deltas) {
                const value = (aggregated[u.userId] ??= {
                    userId: u.userId,
                    upload: '0',
                    download: '0',
                });
                value.upload = (BigInt(value.upload) + BigInt(u.upload)).toString();
                value.download = (BigInt(value.download) + BigInt(u.download)).toString();
                const policy = state.policy?.users.find((p) => p.id === u.userId);
                const raw =
                    policy?.direction === 'upload'
                        ? BigInt(u.upload)
                        : policy?.direction === 'download'
                          ? BigInt(u.download)
                          : BigInt(u.upload) + BigInt(u.download);
                const charged =
                    (raw * BigInt(Math.round((policy?.multiplier || 1) * 1e6))) / 1000000n;
                state.usage[u.userId] = (BigInt(state.usage[u.userId] || '0') + charged).toString();
            }
        } catch (error) {
            console.error(`${service}: ${error.message}`);
        }
    }
    if (Object.keys(aggregated).length && state.policy?.policyId)
        state.outbox.push({
            session: state.session,
            policyId: state.policy.policyId,
            ...(state.policy.policyReceipt ? { policyReceipt: state.policy.policyReceipt } : {}),
            sequence: state.sequence++,
            collectedAt: new Date().toISOString(),
            users: Object.values(aggregated),
        });
    await persist();
}
runtime.beforeProtocolRestart = collect;
async function collectNetwork() {
    const baseline = state.networkBaseline, length = state.networkOutbox.length, sequence = state.networkSequence;
    try {
        const sample = await readNetwork();
        if (!sample) return;
        const delta = networkDelta(sample, state.networkBaseline);
        if (delta.interfaces.length)
            state.networkOutbox.push({ ...delta, session: state.session, sequence: state.networkSequence++ });
        state.networkBaseline = sample;
        state.networkError = '';
        await persist();
    } catch (error) {
        state.networkBaseline = baseline;
        state.networkOutbox.length = length;
        state.networkSequence = sequence;
        state.networkError = `Network sampling failed: ${error.message}`;
    }
}
const restrict = (payload) => restrictPolicy(payload, state.usage);
async function enforce() {
    if (!state.policy) return;
    const filtered = restrict(state.policy);
    const fingerprint = filtered.users
        .map((u) => u.id)
        .sort()
        .join(',');
    if (fingerprint !== state.activeUsers) {
        await collect();
        await runtime.apply(filtered);
        state.counters = {};
        state.activeUsers = fingerprint;
        await persist();
    }
}
async function execute(op) {
    const report = async (record) => {
        await request('result', record);
        // The panel durably acknowledges content before the Agent drops its
        // retry copy; large file reads must not accumulate in the local journal.
        if (op.kind === 'website-files' && typeof record.result?.data === 'string') {
            delete record.result.data;
            record.result.contentAvailable = true;
            await persist();
        }
    };
    if (op.kind === 'upgrade') {
        let completion;
        try {
            completion = JSON.parse(await readFile(join(directory, 'upgrade-result.json'), 'utf8'));
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
        }
        if (completion?.id === op.id) {
            state.journal[op.id] = completion;
            await persist();
            return request('result', completion);
        }
        if (state.journal[op.id]) return;
        if (Date.parse(op.expiresAt) < Date.now()) return;
        state.journal[op.id] = {
            id: op.id,
            state: 'running',
            message: 'Independent supervisor is installing the pinned release',
            result: {},
        };
        await persist();
        await atomicJson(join(directory, 'upgrade-request.json'), { id: op.id, ...op.payload });
        return;
    }
    if (state.journal[op.id]) {
        const recorded = state.journal[op.id];
        if (recorded.state === 'running') {
            recorded.state = 'failed';
            recorded.message = 'Agent restarted during execution; inspect service before retrying';
            await persist();
        }
        return report(recorded);
    }
    state.journal[op.id] = { id: op.id, state: 'running', message: '', result: {} };
    await persist();
    let result;
    try {
        if (Date.parse(op.expiresAt) < Date.now()) throw new Error('Operation expired');
        if (op.kind === 'rotate-credential') {
            state.credential = op.payload.credential;
            await persist();
            socket?.close();
            socket = null;
            result = { rotated: true };
        } else if (op.kind === 'apply-config') {
            await collect();
            result = await runtime.apply(op.payload);
            state.policy = op.payload;
            state.counters = {};
            state.usage = {};
            state.activeUsers = op.payload.users
                .map((u) => u.id)
                .sort()
                .join(',');
        } else if (op.kind === 'terminal-session') {
            result = await terminals.open(op.payload);
        } else {
            if (op.kind === 'restart') await collect();
            result = await runtime.action(op.kind, op.payload);
            if (op.kind === 'restart') state.counters[op.payload.service] = {};
        }
        state.journal[op.id] = { id: op.id, state: 'succeeded', message: '', result };
    } catch (error) {
        state.journal[op.id] = {
            id: op.id,
            state: 'failed',
            message: error.message.slice(0, 2000),
            result: {},
        };
    }
    await persist();
    await report(state.journal[op.id]);
}
if (state.policy) {
    await runtime.apply(restrict(state.policy));
    state.counters = {};
    await persist();
}
if (Object.values(runtime.websites).some(site => !site.remove && site.enabled !== false)) await runtime.start('nginx');
let nextConnect = 0, reconnectDelay = 5000;
for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
        stopping = true;
        shutdown.abort();
        socket?.close();
        void direct?.close();
    });
while (!stopping) {
    try {
        for (const service of await runtime.recoverCrashedServices()) state.counters[service] = {};
        await collect();
        await enforce();
        await collectNetwork();
        if (!socket && ['auto', 'ws'].includes(connectionMode) && Date.now() > nextConnect) {
            try {
                await connect();
                reconnectDelay = 5000;
                nextConnect = Date.now() + 5000;
            } catch {
                nextConnect = Date.now() + reconnectDelay;
                reconnectDelay = Math.min(60000, reconnectDelay * 2);
            }
        }
        let trafficError = '';
        for (let sent = 0; sent < 100 && state.outbox.length; sent++) {
            try {
                const ack = await request('traffic', state.outbox[0]);
                if (ack?.acknowledged !== state.outbox[0].sequence) throw new Error('Traffic acknowledgement mismatch');
                state.outbox.shift();
                await persist();
            } catch {
                // Keep every unacknowledged batch, but allow control recovery and later batches.
                state.outbox.push(state.outbox.shift());
                await persist();
                trafficError = 'Unacknowledged traffic retained locally; retry pending';
                break;
            }
        }
        for (let sent = 0; sent < 100 && state.networkOutbox.length; sent++) {
            try {
                const ack = await request('network', state.networkOutbox[0]);
                if (ack?.acknowledged !== state.networkOutbox[0].sequence) throw new Error('Network acknowledgement mismatch');
                state.networkOutbox.shift();
                await persist();
            } catch {
                state.networkError = 'Unacknowledged network traffic retained locally; retry pending';
                break;
            }
        }
        const reply = await request('heartbeat', {
            ...(await runtime.metrics()),
            interfaces: state.networkBaseline?.interfaces || {},
            networkBootId: state.networkBaseline?.bootId || null,
            networkCollectedAt: state.networkBaseline?.collectedAt || null,
            pendingNetworkBatches: state.networkOutbox.length,
            networkError: state.networkError || '',
            version: process.env.NODIFY_VERSION || NODIFY_VERSION,
            session: state.session,
            appliedPolicyId: state.policy?.policyId || null,
            appliedConfigVersion: state.policy?.version || 0,
            pendingTrafficBatches: state.outbox.length,
            trafficError,
            terminalAvailable: terminals.available,
            terminalActive: terminals.sessions.size > 0,
        });
        await writeFile(join(directory, 'ready'), new Date().toISOString());
        for (const op of reply.operations || []) await execute(op);
    } catch (error) {
        console.error(`Nodify Agent: ${error.message}`);
    }
    for (let i = 0; i < 12 && !stopping; i++) {
        if (terminals.sessions.size) {
            try { terminals.accept(await request('terminal-exchange', terminals.snapshot())); }
            catch { console.error('Nodify Agent: terminal exchange unavailable'); break; }
        }
        await pause(250);
    }
}
await terminals.stopAll();
await collect();
await collectNetwork();
await runtime.stopAll();
await persist();
