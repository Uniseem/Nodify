import { validateWebsite, websiteNames, websiteSites, websitePorts, websiteCertificatePath, renderWebsites } from './website-config.mjs';
import { X509Certificate } from 'node:crypto';
import { websiteFiles } from './website-files.mjs';
import { spawn, execFile } from 'node:child_process';
import dgram from 'node:dgram';
import { mkdir, readFile, writeFile, rename, statfs, open, stat, access, chmod, chown } from 'node:fs/promises';
import net from 'node:net';
import { cpus, totalmem, freemem, loadavg, hostname } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function atomicJson(filename, value) {
    const temp = `${filename}.tmp`;
    const file = await open(temp, 'w', 0o600);
    try {
        await file.writeFile(JSON.stringify(value));
        await file.sync();
    } finally {
        await file.close();
    }
    await rename(temp, filename);
}
export class Runtime {
    constructor(directory) {
        this.directory = directory;
        this.children = new Map();
        this.logs = new Map();
        this.websites = {};
    }
    async init() {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        try {
            this.websites = JSON.parse(
                await readFile(join(this.directory, 'websites.json'), 'utf8'),
            );
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        // Only the durable website snapshot is committed. A crash between
        // activating Nginx and saving that snapshot must restore the old config.
        const prefix = join(this.directory, 'nginx');
        await mkdir(join(prefix, 'logs'), { recursive: true });
        await mkdir(join(prefix, 'temp'), { recursive: true });
        await writeFile(join(prefix, 'recovered.conf'), renderWebsites(prefix, this.websites), { mode: 0o600 });
        await rename(join(prefix, 'recovered.conf'), join(prefix, 'nginx.conf'));
    }
    binary(service) {
        return process.env[`NODIFY_${service.replace('-', '_').toUpperCase()}_BINARY`] || service;
    }
    file(service, stage = false) {
        return join(this.directory, `${stage ? 'candidate' : 'active'}-${service}.json`);
    }
    async start(service) {
        const args =
            service === 'xray'
                ? ['run', '-config', this.file(service)]
                : service === 'sing-box'
                  ? ['run', '-c', this.file(service)]
                  : ['-p', `${this.directory}/nginx/`, '-c', 'nginx.conf', '-g', 'daemon off;'];
        const child = spawn(this.binary(service), args, { stdio: ['ignore', 'pipe', 'pipe'] });
        this.children.set(service, child);
        const log = (chunk) => {
            const current = (this.logs.get(service) || '') + chunk.toString();
            this.logs.set(service, current.slice(-16000));
        };
        child.stdout.on('data', log);
        child.stderr.on('data', log);
        child.on('error', (error) => log(error.message));
        await pause(800);
        if (child.exitCode !== null || !child.pid)
            throw new Error(`${service} failed to start; inspect local service logs`);
    }
    async stop(service) {
        const child = this.children.get(service);
        if (!child) return;
        if (child.exitCode === null) {
            child.kill('SIGTERM');
            for (let i = 0; i < 30 && child.exitCode === null; i++) await pause(100);
            if (child.exitCode === null) {
                child.kill('SIGKILL');
                await pause(100);
            }
        }
        this.children.delete(service);
    }
    async certificates(list = []) {
        for (const cert of list) {
            if (!/^[a-f0-9-]{36}$/.test(cert.id)) throw new Error('Invalid certificate id');
            const directory = join(this.directory, 'certificates', cert.id);
            await mkdir(directory, { recursive: true, mode: 0o700 });
            await writeFile(join(directory, 'fullchain.pem'), cert.certPem, { mode: 0o600 });
            await writeFile(join(directory, 'privkey.pem'), cert.keyPem, { mode: 0o600 });
        }
    }
    async apply(payload) {
        const previousCertificates = this.lastCertificates || [];
        try {
            const result = await this.applyCandidate(payload);
            this.lastCertificates = payload.certificates || [];
            return result;
        } catch (error) {
            await this.certificates(previousCertificates);
            throw error;
        }
    }
    async applyCandidate(payload) {
        await this.certificates(payload.certificates);
        const services = ['xray', 'sing-box'];
        const previous = {};
        for (const service of services) {
            try {
                previous[service] = await readFile(this.file(service), 'utf8');
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
            const config = service === 'xray' ? payload.xray : payload.singbox;
            const encoded = JSON.stringify(config).replaceAll(
                '/var/lib/nodify-agent/',
                `${this.directory}/`,
            );
            await writeFile(this.file(service, true), encoded, { mode: 0o600 });
            const args =
                service === 'xray'
                    ? ['run', '-test', '-config', this.file(service, true)]
                    : ['check', '-c', this.file(service, true)];
            try {
                await exec(this.binary(service), args, { timeout: 15000, maxBuffer: 1024 * 1024 });
            } catch {
                throw new Error(
                    `${service} configuration validation failed; active configuration retained`,
                );
            }
        }
        const owned = new Set();
        for (const [service, value] of Object.entries(previous))
            if (this.children.get(service)?.exitCode === null)
                for (const port of this.configPorts(JSON.parse(value)))
                    owned.add(`${port.transport}:${port.port}`);
        await this.checkPorts(
            [...this.configPorts(payload.xray), ...this.configPorts(payload.singbox)],
            owned,
        );
        await this.beforeProtocolRestart?.();
        try {
            for (const service of services) await this.stop(service);
            for (const service of services) {
                await rename(this.file(service, true), this.file(service));
                await this.start(service);
            }
        } catch (error) {
            await this.certificates(this.lastCertificates || []);
            for (const service of services) {
                await this.stop(service);
                if (previous[service]) {
                    await writeFile(this.file(service), previous[service], { mode: 0o600 });
                    await this.start(service);
                }
            }
            throw error;
        }
        return { version: payload.version };
    }
    configPorts(config) {
        const ports = (config.inbounds || []).flatMap((inbound) => {
            const port = inbound.port || inbound.listen_port;
            if (!port) return [];
            if (inbound.protocol === 'hysteria' || inbound.type === 'hysteria2')
                return [{ port, transport: 'udp' }];
            const transports =
                inbound.protocol === 'dokodemo-door' && inbound.settings?.network?.includes('udp')
                    ? ['tcp', 'udp']
                    : ['tcp'];
            return transports.map((transport) => ({ port, transport }));
        });
        if (config.experimental?.v2ray_api?.listen)
            ports.push({
                port: Number(config.experimental.v2ray_api.listen.split(':').at(-1)),
                transport: 'tcp',
            });
        return ports;
    }
    async checkPorts(ports, owned = new Set()) {
        for (const { port, transport } of ports) {
            if (owned.has(`${transport}:${port}`)) continue;
            await new Promise((resolve, reject) => {
                const socket =
                    transport === 'udp' ? dgram.createSocket('udp4') : net.createServer();
                socket.once('error', () => {
                    try {
                        socket.close();
                    } catch {}
                    reject(new Error(`Port ${port}/${transport} is already in use`));
                });
                const ready = () => socket.close(resolve);
                if (transport === 'udp') socket.bind(port, '0.0.0.0', ready);
                else socket.listen(port, '0.0.0.0', ready);
            });
        }
    }
    async recoverCrashedServices() {
        const recovered = [];
        for (const [name, child] of this.children)
            if (child.exitCode !== null) {
                await this.start(name);
                recovered.push(name);
            }
        return recovered;
    }
    async website(payload) {
        validateWebsite(payload);
        if ((this.websites[payload.id]?.deployment ?? 0) > (payload.deployment ?? 0)) throw new Error('Stale website deployment');
        const next = { ...this.websites, [payload.id]: payload };
        const prefix = join(this.directory, 'nginx');
        await mkdir(join(prefix, 'logs'), { recursive: true });
        await mkdir(join(prefix, 'temp'), { recursive: true });
        if (process.platform === 'linux' && process.getuid?.() === 0) {
            // Dedicated unprivileged Nginx workers need traversal, not directory
            // listing or access to the Agent's mode-0600 credentials.
            await chmod(this.directory, 0o711);
            await chmod(prefix, 0o711);
            await chown(join(prefix, 'temp'), 65534, 65534);
            await chmod(join(prefix, 'temp'), 0o700);
        }
        for (const site of websiteSites(next)) {
            validateWebsite(site);
            if (site.type === 'static') {
                if (!(await stat(site.target)).isDirectory()) throw new Error('Static website target is not a directory');
                await access(site.target);
            }
            if (site.certificateId) {
                const directory = websiteCertificatePath(prefix, site);
                await mkdir(directory, { recursive: true, mode: 0o700 });
                if (site.certificate) {
                    const certificate = new X509Certificate(site.certificate.certPem);
                    if (Date.parse(certificate.validTo) <= Date.now() || websiteNames(site).some(name => !certificate.checkHost(name)))
                        throw new Error('Certificate does not cover all website domains or has expired');
                    await writeFile(join(directory, 'fullchain.pem'), site.certificate.certPem, { mode: 0o600 });
                    await writeFile(join(directory, 'privkey.pem'), site.certificate.keyPem, { mode: 0o600 });
                }
            }
        }
        const config = renderWebsites(prefix, next);
        await writeFile(join(prefix, 'candidate.conf'), config, { mode: 0o600 });
        try { await exec(this.binary('nginx'), ['-t', '-p', `${prefix}/`, '-c', 'candidate.conf'], { timeout: 10000 }); }
        catch { throw new Error('Nginx configuration validation failed; active website configuration retained'); }
        const active = join(prefix, 'nginx.conf');
        let old;
        try { old = await readFile(active); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const owned = new Set(this.children.get('nginx')?.exitCode === null ? websitePorts(this.websites).map(p => `tcp:${p.port}`) : []);
        await this.checkPorts(websitePorts(next), owned);
        await rename(join(prefix, 'candidate.conf'), active);
        try {
            await this.stop('nginx');
            if (websiteSites(next).length) await this.start('nginx');
            await atomicJson(join(this.directory, 'websites.json'), next);
            this.websites = next;
        } catch (error) {
            await this.stop('nginx');
            if (old) {
                await writeFile(active, old, { mode: 0o600 });
                if (websiteSites(this.websites).length) await this.start('nginx');
            }
            throw error;
        }
        return { domain: payload.domain, deployment: payload.deployment, version: payload.version, removed: Boolean(payload.remove) };
    }
    async websiteLog(id, type = 'access') {
        if (!/^[a-f0-9-]{36}$/.test(id) || !['access', 'error'].includes(type) || !this.websites[id] || this.websites[id].remove) throw new Error('Unknown managed website log');
        let file;
        try {
            file = await open(join(this.directory, 'nginx', 'logs', `${id}.${type}.log`), 'r');
            const { size } = await file.stat(), length = Math.min(size, 16000), buffer = Buffer.alloc(length);
            await file.read(buffer, 0, length, Math.max(0, size - length));
            return { log: buffer.toString('utf8'), truncated: size > length };
        } catch (error) { if (error.code === 'ENOENT') return { log: '', truncated: false }; throw error; }
        finally { await file?.close(); }
    }
    async metrics() {
        const cpu = cpus().reduce(
            (sum, c) => ({
                idle: sum.idle + c.times.idle,
                total: sum.total + Object.values(c.times).reduce((a, b) => a + b, 0),
            }),
            { idle: 0, total: 0 },
        );
        const before = this.lastCpu;
        this.lastCpu = cpu;
        const cpuPercent =
            before && cpu.total > before.total
                ? 100 * (1 - (cpu.idle - before.idle) / (cpu.total - before.total))
                : 0;
        const disk = await statfs(this.directory).catch(() => null);
        return {
            hostname: hostname(),
            cpuCount: cpus().length,
            cpuPercent,
            load: loadavg(),
            memoryTotal: totalmem(),
            memoryUsed: totalmem() - freemem(),
            diskTotal: disk ? String(BigInt(disk.blocks) * BigInt(disk.bsize)) : '0',
            diskFree: disk ? String(BigInt(disk.bavail) * BigInt(disk.bsize)) : '0',
            websiteDeployments: Object.fromEntries(Object.entries(this.websites).map(([id, site]) => [id, site.deployment ?? 0])),
            services: Object.fromEntries(
                [...this.children].map(([name, child]) => [
                    name,
                    child.exitCode === null && !!child.pid,
                ]),
            ),
        };
    }
    async action(kind, payload) {
        if (kind === 'terminal') {
            try {
                const result = await exec('/bin/bash', ['-lc', payload.command], {
                    timeout: payload.timeoutSeconds * 1000,
                    maxBuffer: 32768,
                    cwd: this.directory,
                });
                return { output: result.stdout, stderr: result.stderr, exitCode: 0 };
            } catch (error) {
                return {
                    output: (error.stdout || '').slice(-16000),
                    stderr: (error.stderr || error.message).slice(-16000),
                    exitCode: error.code || 1,
                };
            }
        }
        if (kind === 'website') return this.website(payload);
        if (kind === 'website-files') return websiteFiles(this.websites, payload);
        if (kind === 'restart') {
            if (!['xray', 'sing-box', 'nginx'].includes(payload.service))
                throw new Error('Invalid service');
            await this.stop(payload.service);
            await this.start(payload.service);
            return { restarted: payload.service };
        }
        if (kind === 'logs' && payload.service === 'nginx' && payload.websiteId) return this.websiteLog(payload.websiteId, payload.logType);
        if (kind === 'logs')
            return {
                log: (this.logs.get(payload.service) || 'No output')
                    .replace(/(password|privateKey|token)["'=:\s]+[^\s,}]+/gi, '$1=[redacted]')
                    .slice(-8000),
            };
        if (kind === 'latency')
            return new Promise((resolve, reject) => {
                const started = Date.now();
                const socket = net.connect({ host: payload.host, port: payload.port || 443 });
                socket.setTimeout(5000);
                socket.on('connect', () => {
                    socket.destroy();
                    resolve({ milliseconds: Date.now() - started });
                });
                socket.on('timeout', () => {
                    socket.destroy();
                    reject(new Error('TCP probe timed out'));
                });
                socket.on('error', reject);
            });
        throw new Error(`Unsupported operation: ${kind}`);
    }
    async stopAll() {
        for (const service of [...this.children.keys()]) await this.stop(service);
    }
}
