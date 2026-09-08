export function restrictPolicy(payload, usage, now = Date.now()) {
    const users = payload.users.filter(
        (user) =>
            Date.parse(user.expiresAt) > now &&
            (user.remainingBytes === '-1' ||
                BigInt(usage[user.id] || '0') < BigInt(user.remainingBytes)),
    );
    const ids = new Set(users.map((user) => user.id)),
        copy = structuredClone(payload);
    copy.users = users;
    for (const inbound of copy.xray.inbounds)
        if (inbound.settings?.clients)
            inbound.settings.clients = inbound.settings.clients.filter((user) =>
                ids.has(user.email),
            );
    for (const inbound of copy.singbox.inbounds)
        if (inbound.users) inbound.users = inbound.users.filter((user) => ids.has(user.name));
    return copy;
}
