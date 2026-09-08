import { readFile } from 'node:fs/promises';

// Keep every interface separate. Selecting bridges together with their members can double count.
export async function readNetwork() {
    if (process.platform !== 'linux') return null;
    const [boot, content, routes] = await Promise.all([
        readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
        readFile('/proc/net/dev', 'utf8'),
        readFile('/proc/net/route', 'utf8').catch(() => ''),
    ]);
    const defaults = new Set(routes.split('\n').slice(1).map(line => line.trim().split(/\s+/))
        .filter(row => row[1] === '00000000').map(row => row[0]));
    const interfaces = {};
    for (const line of content.trim().split('\n').slice(2)) {
        const colon = line.lastIndexOf(':');
        const name = line.slice(0, colon).trim();
        if (name === 'lo' || !/^[a-zA-Z0-9_.:-]{1,15}$/.test(name)) continue;
        if (Object.keys(interfaces).length >= 128) throw new Error('More than 128 network interfaces');
        const values = line.slice(colon + 1).trim().split(/\s+/);
        const index = Number(await readFile(`/sys/class/net/${name}/ifindex`, 'utf8').catch(() => '0'));
        if (!index || !/^\d+$/.test(values[0]) || !/^\d+$/.test(values[8])) continue;
        interfaces[name] = { rx: values[0], tx: values[8], index, preferred: defaults.has(name) };
    }
    return { bootId: boot.trim(), collectedAt: new Date().toISOString(), interfaces };
}

// A first sample, boot/interface replacement or counter regression establishes a new baseline.
// It never imports the machine's pre-enrollment cumulative counters into the durable ledger.
export function networkDelta(sample, previous) {
    const interfaces = Object.entries(sample.interfaces).map(([name, current]) => {
        const prior = previous?.interfaces[name];
        const valid = previous?.bootId === sample.bootId && prior?.index === current.index &&
            BigInt(current.rx) >= BigInt(prior.rx) && BigInt(current.tx) >= BigInt(prior.tx) &&
            Date.parse(sample.collectedAt) > Date.parse(previous.collectedAt);
        return {
            name, index: current.index,
            upload: valid ? (BigInt(current.tx) - BigInt(prior.tx)).toString() : '0',
            download: valid ? (BigInt(current.rx) - BigInt(prior.rx)).toString() : '0',
            discontinuity: !valid,
            intervalStart: valid ? previous.collectedAt : null,
        };
    });
    return { bootId: sample.bootId, collectedAt: sample.collectedAt, interfaces };
}
