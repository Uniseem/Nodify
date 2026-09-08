import { WebSocketServer } from 'ws';

import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { NodifyService } from './nodify.service';
import { agentMessage } from './agent-message';
import { PublicationSettings } from './publication';

@Injectable()
export class NodifyAgentGateway implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly server = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
    constructor(
        private readonly adapter: HttpAdapterHost,
        private readonly service: NodifyService,
    ) {}
    onApplicationBootstrap() {
        this.adapter.httpAdapter
            .getHttpServer()
            .on('upgrade', (req: any, socket: any, head: Buffer) => {
                if (req.url?.split('?')[0] !== '/api/agent/connect') return;
                new PublicationSettings(this.service).allows(req.headers.host, 'UPGRADE', req.url)
                    .then(allowed => {
                        if (!allowed) throw new Error('Subscription host does not accept management connections');
                        return this.service.authenticate((req.headers.authorization ?? '').replace(/^Bearer /, ''));
                    })
                    .then((server) => {
                        this.server.handleUpgrade(req, socket, head, (ws) => {
                            let busy = false;
                            ws.on('error', () => ws.close());
                            ws.on('message', async (data) => {
                                if (busy) return ws.close(1008, 'One request at a time');
                                busy = true;
                                try {
                                    const input = JSON.parse(data.toString());
                                    // Revalidate on every frame so revocation also closes existing sessions.
                                    await this.service.authenticate(
                                        (req.headers.authorization ?? '').replace(/^Bearer /, ''),
                                    );
                                    const result = await agentMessage(this.service, server.id, input.type, input.type === 'heartbeat' ? { ...input.data, connectionTransport: 'ws' } : input.data);
                                    ws.send(JSON.stringify({ id: input.id, result }));
                                } catch {
                                    ws.close(1008, 'Invalid or unauthorized request');
                                } finally {
                                    busy = false;
                                }
                            });
                        });
                    })
                    .catch(() => {
                        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
                        socket.destroy();
                    });
            });
    }
    onModuleDestroy() {
        for (const ws of this.server.clients) ws.terminate();
        this.server.close();
    }
}
