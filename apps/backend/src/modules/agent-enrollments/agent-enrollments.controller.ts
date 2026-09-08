import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Req,
    UseFilters,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { Roles } from '@common/decorators/roles/roles';
import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { errorHandler } from '@common/helpers/error-handler.helper';
import { AGENT_ENROLLMENTS_CONTROLLER, CONTROLLERS_INFO } from '@libs/contracts/api';
import { ROLE } from '@libs/contracts/constants';

import { AgentEnrollmentsService } from './agent-enrollments.service';
import { CreateAgentEnrollmentBodyDto } from './dtos/create-agent-enrollment.dto';

@ApiBearerAuth('Authorization')
@ApiTags(CONTROLLERS_INFO.AGENT_ENROLLMENTS.tag)
@Roles(ROLE.ADMIN, ROLE.API)
@UseGuards(JwtDefaultGuard, RolesGuard)
@UseFilters(HttpExceptionFilter)
@Controller(AGENT_ENROLLMENTS_CONTROLLER)
export class AgentEnrollmentsController {
    constructor(private readonly agentEnrollmentsService: AgentEnrollmentsService) {}

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(
        @Body() body: CreateAgentEnrollmentBodyDto,
        @Req() req: Request,
    ) {
        const result = await this.agentEnrollmentsService.createEnrollment(
            {
                name: body.name ?? '',
                countryCode: body.countryCode,
                nodePort: body.nodePort,
            },
            req,
        );

        return {
            response: errorHandler(result),
        };
    }

    @Get()
    async list(@Req() req: Request) {
        const result = await this.agentEnrollmentsService.listEnrollments(req);

        return {
            response: {
                enrollments: errorHandler(result),
            },
        };
    }

    @Get(':uuid')
    async getOne(@Param('uuid') uuid: string, @Req() req: Request) {
        const result = await this.agentEnrollmentsService.getEnrollment(uuid, req);

        return {
            response: errorHandler(result),
        };
    }

    @Delete(':uuid')
    async revoke(@Param('uuid') uuid: string) {
        const result = await this.agentEnrollmentsService.revokeEnrollment(uuid);

        return {
            response: errorHandler(result),
        };
    }
}
