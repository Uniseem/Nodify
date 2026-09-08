import type { TConfig, TInbound, TPackage } from '@nodify/contract';

export type RuntimeUser = {
    id: string;
    uuid: string;
    password: string;
    ssPassword: string;
    anytlsPassword: string;
    expiresAt: string;
    remainingBytes: string;
    nodeIds: string[];
    tags: string[];
    generation?: number;
    direction?: TPackage['direction'];
    multiplier?: number;
};
export function allowed(inbound: TInbound, rights: Pick<TPackage, 'nodeIds' | 'tags'>): boolean {
    return (
        rights.nodeIds.includes(inbound.id) || inbound.tags.some((tag) => rights.tags.includes(tag))
    );
}
export function compileConfiguration(config: TConfig, users: RuntimeUser[]) {
    const xrayInbounds: Record<string, unknown>[] = [];
    const singInbounds: Record<string, unknown>[] = [];
    for (const inbound of config.inbounds.filter((i) => i.enabled)) {
        const clients = users.filter((u) => allowed(inbound, u));
        const cert = `/var/lib/nodify-agent/certificates/${inbound.certificateId}`;
        if (inbound.protocol === 'anytls') {
            singInbounds.push({
                ...inbound.extra,
                type: 'anytls',
                tag: inbound.id,
                listen: '::',
                listen_port: inbound.port,
                users: clients.map((u) => ({ name: u.id, password: u.anytlsPassword })),
                tls: {
                    ...(inbound.extra.tls as object),
                    enabled: true,
                    server_name: inbound.serverName,
                    certificate_path: `${cert}/fullchain.pem`,
                    key_path: `${cert}/privkey.pem`,
                },
            });
            continue;
        }
        const stream: Record<string, unknown> = {
            ...(inbound.extra.streamSettings as object),
            network: inbound.network === 'udp' ? 'hysteria' : inbound.network,
            security: inbound.security,
        };
        // Xray's newer method alias takes precedence over network.
        if ('method' in stream) stream.method = stream.network;
        if (inbound.security === 'tls')
            stream.tlsSettings = {
                ...(stream.tlsSettings as object),
                certificates: [
                    { certificateFile: `${cert}/fullchain.pem`, keyFile: `${cert}/privkey.pem` },
                ],
            };
        if (inbound.security === 'reality')
            stream.realitySettings = {
                ...(stream.realitySettings as object),
                target: inbound.realityTarget,
                serverNames: [inbound.serverName],
                privateKey: inbound.realityPrivateKey,
                shortIds: [inbound.shortId],
            };
        if (inbound.network === 'ws')
            stream.wsSettings = { ...(stream.wsSettings as object), path: inbound.path };
        if (inbound.network === 'grpc')
            stream.grpcSettings = {
                ...(stream.grpcSettings as object),
                serviceName: inbound.path.replace(/^\//, ''),
            };
        if (inbound.network === 'xhttp')
            stream.xhttpSettings = {
                mode: 'auto',
                ...(stream.xhttpSettings as object),
                path: inbound.path,
            };
        if (inbound.protocol === 'hysteria2') stream.hysteriaSettings = { version: 2 };
        const entries = clients.map((u) => {
            const common = { email: u.id, level: 0 };
            if (inbound.protocol === 'vless') return { ...common, id: u.uuid, flow: inbound.flow };
            if (inbound.protocol === 'vmess') return { ...common, id: u.uuid };
            if (inbound.protocol === 'shadowsocks')
                return { ...common, password: u.ssPassword, method: inbound.method };
            if (inbound.protocol === 'hysteria2') return { ...common, auth: u.uuid };
            return { ...common, password: u.password };
        });
        const settings =
            inbound.protocol === 'tunnel'
                ? {
                      address: inbound.target,
                      port: inbound.targetPort,
                      network: inbound.udp ? 'tcp,udp' : 'tcp',
                  }
                : {
                      clients: entries,
                      ...(inbound.protocol === 'vless' ? { decryption: 'none' } : {}),
                      ...(inbound.protocol === 'hysteria2' ? { version: 2 } : {}),
                  };
        xrayInbounds.push({
            ...inbound.extra,
            tag: inbound.id,
            listen: '0.0.0.0',
            port: inbound.port,
            protocol:
                inbound.protocol === 'tunnel'
                    ? 'dokodemo-door'
                    : inbound.protocol === 'hysteria2'
                      ? 'hysteria'
                      : inbound.protocol,
            settings: { ...(inbound.extra.settings as object), ...settings },
            streamSettings: stream,
        });
    }
    const existingRouting = config.xray.routing as { rules?: unknown[] } | undefined;
    const policy = (config.xray.policy || {}) as Record<string, any>;
    const experimental = (config.singbox.experimental || {}) as Record<string, any>;
    const tunnels = config.inbounds.filter((i) => i.enabled && i.protocol === 'tunnel');
    return {
        xray: {
            log: { loglevel: 'warning' },
            ...config.xray,
            api: { tag: 'nodify-api', services: ['StatsService'] },
            stats: {},
            policy: {
                ...policy,
                levels: {
                    ...policy.levels,
                    '0': {
                        ...policy.levels?.['0'],
                        statsUserUplink: true,
                        statsUserDownlink: true,
                    },
                },
                system: { ...policy.system, statsInboundUplink: true, statsInboundDownlink: true },
            },
            inbounds: [
                ...xrayInbounds,
                {
                    tag: 'nodify-api-in',
                    listen: '127.0.0.1',
                    port: 61001,
                    protocol: 'dokodemo-door',
                    settings: { address: '127.0.0.1' },
                },
            ],
            outbounds: [
                ...((config.xray.outbounds as unknown[] | undefined) ?? [
                    { tag: 'direct', protocol: 'freedom' },
                    { tag: 'block', protocol: 'blackhole' },
                ]),
                ...tunnels.map((i) => ({
                    tag: `nodify-forward-${i.id}`,
                    protocol: 'freedom',
                    settings: { finalRules: [{ action: 'allow', ip: ['0.0.0.0/0', '::/0'] }] },
                })),
            ],
            routing: {
                ...existingRouting,
                rules: [
                    { type: 'field', inboundTag: ['nodify-api-in'], outboundTag: 'nodify-api' },
                    ...tunnels.map((i) => ({
                        type: 'field',
                        inboundTag: [i.id],
                        outboundTag: `nodify-forward-${i.id}`,
                    })),
                    ...(existingRouting?.rules ?? []),
                ],
            },
        },
        singbox: {
            log: { level: 'warn' },
            ...config.singbox,
            inbounds: singInbounds,
            outbounds: config.singbox.outbounds ?? [{ type: 'direct', tag: 'direct' }],
            experimental: {
                ...experimental,
                v2ray_api: {
                    ...experimental.v2ray_api,
                    listen: '127.0.0.1:61002',
                    stats: {
                        enabled: true,
                        users: users.map((u) => u.id),
                        inbounds: singInbounds.map((i) => i.tag),
                    },
                },
            },
        },
        users,
        config,
    };
}

export function measuredBytes(upload: bigint, download: bigint, snapshot: Pick<TPackage,'direction'|'multiplier'>): bigint {
    const total =
        snapshot.direction === 'upload'
            ? upload
            : snapshot.direction === 'download'
              ? download
              : upload + download;
    return (total * BigInt(Math.round(snapshot.multiplier * 1_000_000))) / 1_000_000n;
}
