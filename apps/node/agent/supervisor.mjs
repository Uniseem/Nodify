// This process owns Agent lifecycle, so an exiting Agent never upgrades itself.
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, lstat, readdir } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { atomicJson, pause } from './runtime.mjs';
import { NODIFY_VERSION } from './version.mjs';

const exec = promisify(execFile);
const data = process.env.NODIFY_AGENT_DATA || '/var/lib/nodify-agent';
await mkdir(data, { recursive: true, mode: 0o700 });
let installedVersion = process.env.NODIFY_VERSION || NODIFY_VERSION;
for (const file of [
    resolve(dirname(fileURLToPath(import.meta.url)), '../manifest.json'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../manifest.json'),
]) {
    try {
        installedVersion = JSON.parse(await readFile(file, 'utf8')).version;
        break;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}
const initial = {
    entry: join(dirname(fileURLToPath(import.meta.url)), 'main.mjs'),
    bin: process.env.NODIFY_ENGINE_DIR || '',
    version: installedVersion,
};
const read = async (name) => {
    try {
        return JSON.parse(await readFile(join(data, name), 'utf8'));
    } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        return null;
    }
};
let active = (await read('active-release.json')) || initial;
let child,
    stopping = false;
async function start(release) {
    await writeFile(join(data, 'ready'), '');
    child = spawn(process.execPath, [release.entry], {
        stdio: 'inherit',
        env: {
            ...process.env,
            NODIFY_VERSION: release.version,
            ...(release.bin
                ? {
                      NODIFY_XRAY_BINARY: join(release.bin, 'xray'),
                      NODIFY_SING_BOX_BINARY: join(release.bin, 'sing-box'),
                  }
                : {}),
        },
    });
    child.on('error', (error) => console.error(error.message));
}
async function stop() {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    for (let i = 0; i < 300 && child.exitCode === null; i++) await pause(100);
    if (child.exitCode === null) {
        child.kill('SIGKILL');
        await pause(500);
    }
}
async function unpack(request) {
    if (
        !/^[a-f0-9-]{36}$/.test(request.id) ||
        !/^\d+\.\d+\.\d+$/.test(request.version) ||
        !/^[a-f0-9]{64}$/.test(request.sha256)
    )
        throw new Error('Invalid pinned release');
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('An HTTPS release URL is required');
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body)
        throw new Error(`Release download failed: ${response.status}`);
    let length = 0;
    const chunks = [];
    for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 512 * 1024 * 1024) throw new Error('Release exceeds 512 MiB');
        chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (createHash('sha256').update(bytes).digest('hex') !== request.sha256)
        throw new Error('Release checksum mismatch');
    const directory = join(data, 'releases', request.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const archive = join(directory, 'release.tar.gz');
    await writeFile(archive, bytes, { mode: 0o600 });
    const listing = (await exec('tar', ['-tzf', archive], { maxBuffer: 16 * 1024 * 1024 })).stdout;
    if (listing.split('\n').some((name) => name.startsWith('/') || name.split('/').includes('..')))
        throw new Error('Unsafe archive path');
    const verbose = (await exec('tar', ['-tvzf', archive], { maxBuffer: 32 * 1024 * 1024 })).stdout;
    if (
        verbose
            .trim()
            .split('\n')
            .some((line) => !['-', 'd'].includes(line[0]))
    )
        throw new Error('Release contains special files or links');
    await exec('tar', ['-xzf', archive, '-C', directory, '--no-same-owner'], { timeout: 120000 });
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
    if (
        manifest.role !== 'agent' ||
        manifest.version !== request.version ||
        manifest.platform !== `linux-${arch}`
    )
        throw new Error('Release role, version or architecture mismatch');
    for (const [name, hash] of Object.entries(manifest.files)) {
        const file = resolve(directory, name);
        if (relative(directory, file).startsWith('..')) throw new Error('Unsafe manifest path');
        if (
            !(await lstat(file)).isFile() ||
            createHash('sha256')
                .update(await readFile(file))
                .digest('hex') !== hash
        )
            throw new Error('Release file integrity failure');
    }
    return {
        entry: join(directory, 'app/agent/main.mjs'),
        bin: join(directory, 'bin'),
        version: manifest.version,
    };
}
async function upgrade(request) {
    const previous = active;
    let result;
    try {
        const candidate = await unpack(request);
        await atomicJson(join(data, 'upgrade-in-progress.json'), { id: request.id, previous });
        await stop();
        await start(candidate);
        let ready = false;
        for (let i = 0; i < 90 && !stopping; i++) {
            if (child.exitCode !== null) break;
            if ((await readFile(join(data, 'ready'), 'utf8')).trim()) {
                ready = true;
                break;
            }
            await pause(1000);
        }
        if (!ready) throw new Error('Upgraded Agent did not authenticate within 90 seconds');
        active = candidate;
        await atomicJson(join(data, 'active-release.json'), active);
        result = {
            id: request.id,
            state: 'succeeded',
            message: '',
            result: { version: active.version },
        };
    } catch (error) {
        await stop();
        active = previous;
        await atomicJson(join(data, 'active-release.json'), active);
        await start(active);
        result = {
            id: request.id,
            state: 'failed',
            message: `${error.message}; previous release retained`,
            result: {},
        };
    }
    await atomicJson(join(data, 'upgrade-result.json'), result);
    await atomicJson(join(data, 'upgrade-request.json'), null);
    await atomicJson(join(data, 'upgrade-in-progress.json'), null);
}
const interrupted = await read('upgrade-in-progress.json');
if (interrupted) {
    active = interrupted.previous;
    await atomicJson(join(data, 'active-release.json'), active);
    await atomicJson(join(data, 'upgrade-result.json'), {
        id: interrupted.id,
        state: 'failed',
        message: 'Supervisor interrupted; rolled back to previous release',
        result: {},
    });
    await atomicJson(join(data, 'upgrade-request.json'), null);
    await atomicJson(join(data, 'upgrade-in-progress.json'), null);
}
for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
        stopping = true;
    });
await start(active);
while (!stopping) {
    const request = await read('upgrade-request.json');
    if (request) await upgrade(request);
    else if (child.exitCode !== null) {
        await pause(2000);
        await start(active);
    }
    await pause(1000);
}
await stop();
