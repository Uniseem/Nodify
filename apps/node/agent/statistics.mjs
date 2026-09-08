import http2 from 'node:http2';

function varint(value) {
    const bytes = [];
    let v = BigInt(value);
    do {
        let b = Number(v & 127n);
        v >>= 7n;
        if (v) b |= 128;
        bytes.push(b);
    } while (v);
    return Buffer.from(bytes);
}
function readVarint(buffer, offset) {
    let value = 0n,
        shift = 0n,
        i = offset;
    while (i < buffer.length && shift < 70n) {
        const b = buffer[i++];
        value |= BigInt(b & 127) << shift;
        if (!(b & 128)) return [value, i];
        shift += 7n;
    }
    throw new Error('Invalid protobuf varint');
}
function fields(buffer) {
    const result = [];
    let i = 0;
    while (i < buffer.length) {
        let tag;
        [tag, i] = readVarint(buffer, i);
        const wire = Number(tag & 7n);
        let value;
        if (wire === 0) [value, i] = readVarint(buffer, i);
        else if (wire === 2) {
            let length;
            [length, i] = readVarint(buffer, i);
            const end = i + Number(length);
            if (end > buffer.length) throw new Error('Truncated protobuf');
            value = buffer.subarray(i, end);
            i = end;
        } else throw new Error('Unsupported protobuf field');
        result.push([Number(tag >> 3n), value]);
    }
    return result;
}
export function decodeStats(buffer) {
    const stats = {};
    for (const [field, value] of fields(buffer))
        if (field === 1 && Buffer.isBuffer(value)) {
            const entry = fields(value);
            const name = entry.find(([k]) => k === 1)?.[1];
            const count = entry.find(([k]) => k === 2)?.[1] ?? 0n;
            if (Buffer.isBuffer(name)) stats[name.toString()] = count.toString();
        }
    return stats;
}
async function query(address, service) {
    const session = http2.connect(address);
    return new Promise((resolve, reject) => {
        const finish = (error, value) => {
            session.close();
            if (error) reject(error);
            else resolve(value);
        };
        session.on('error', reject);
        const call = session.request({
            ':method': 'POST',
            ':path': `/${service}/QueryStats`,
            'content-type': 'application/grpc',
            te: 'trailers',
        });
        const chunks = [];
        let size = 0;
        let status = '0';
        call.setTimeout(4000, () => call.destroy(new Error('Stats query timed out')));
        call.on('trailers', (headers) => {
            status = String(headers['grpc-status'] ?? '0');
        });
        call.on('data', (chunk) => {
            size += chunk.length;
            if (size > 8 * 1024 * 1024) call.destroy(new Error('Stats response too large'));
            else chunks.push(chunk);
        });
        call.on('error', (error) => finish(error));
        call.on('end', () => {
            try {
                const data = Buffer.concat(chunks);
                if (status !== '0' || data.length < 5 || data[0] !== 0)
                    throw new Error('Stats service unavailable');
                const length = data.readUInt32BE(1);
                if (length !== data.length - 5) throw new Error('Invalid gRPC frame');
                finish(null, decodeStats(data.subarray(5)));
            } catch (error) {
                finish(error);
            }
        });
        const pattern = Buffer.from('user>>>');
        const payload = Buffer.concat([Buffer.from([10]), varint(pattern.length), pattern]);
        const header = Buffer.alloc(5);
        header.writeUInt32BE(payload.length, 1);
        call.end(Buffer.concat([header, payload]));
    });
}
export async function queryStats(port) {
    try {
        return await query(`http://127.0.0.1:${port}`, 'xray.app.stats.command.StatsService');
    } catch {
        return query(`http://127.0.0.1:${port}`, 'v2ray.core.app.stats.command.StatsService');
    }
}
export function statsDelta(current, baseline) {
    const users = {};
    for (const [name, value] of Object.entries(current)) {
        const match = /^user>>>(\d+)>>>traffic>>>(uplink|downlink)$/.exec(name);
        if (!match) continue;
        const count = BigInt(value),
            before = BigInt(baseline[name] ?? '0');
        const delta = count >= before ? count - before : count;
        const u = (users[match[1]] ??= { userId: match[1], upload: '0', download: '0' });
        const direction = match[2] === 'uplink' ? 'upload' : 'download';
        u[direction] = (BigInt(u[direction]) + delta).toString();
    }
    return Object.values(users).filter((u) => BigInt(u.upload) + BigInt(u.download) > 0n);
}
