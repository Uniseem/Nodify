import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';

import { NodifyAgentGateway } from './agent.gateway';
import { NodifyDirectGateway } from './agent-connection';
import { NodifyController, NodifyAgentController } from './nodify.controller';
import { NodifyService } from './nodify.service';
import { NodifyResourcesService } from './resources.service';
import { NodifySubscriptionController } from './subscription.controller';
import { NodifyValidationFilter } from './validation.filter';

@Module({
    imports: [CqrsModule],
    controllers: [NodifyController, NodifyAgentController, NodifySubscriptionController],
    providers: [
        NodifyService,
        NodifyResourcesService,
        NodifyAgentGateway,
        NodifyDirectGateway,
        { provide: APP_FILTER, useClass: NodifyValidationFilter },
    ],
    exports: [NodifyService],
})
export class NodifyModule {}
