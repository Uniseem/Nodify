import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Req,
    Res,
    UseFilters,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';

import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { errorHandler } from '@common/helpers/error-handler.helper';
import { PUBLIC_AGENT_ENROLLMENTS_CONTROLLER } from '@libs/contracts/api';

import { AgentEnrollmentsService } from './agent-enrollments.service';
import { CompleteAgentEnrollmentBodyDto } from './dtos/create-agent-enrollment.dto';

@ApiTags('Public Agent Enrollments')
@UseFilters(HttpExceptionFilter)
@Controller(PUBLIC_AGENT_ENROLLMENTS_CONTROLLER)
export class AgentEnrollmentsPublicController {
    constructor(private readonly agentEnrollmentsService: AgentEnrollmentsService) {}

    @Get(':token/install')
    async install(
        @Param('token') token: string,
        @Req() req: Request,
        @Res() res: Response,
    ): Promise<void> {
        const result = await this.agentEnrollmentsService.getInstallScript(token, req);
        const script = errorHandler(result);

        res
            .status(HttpStatus.OK)
            .setHeader('Content-Type', 'text/x-shellscript; charset=utf-8')
            .setHeader('Cache-Control', 'no-store')
            .send(script);
    }

    @Get(':token')
    async payload(@Param('token') token: string) {
        const result = await this.agentEnrollmentsService.getPublicPayload(token);

        return {
            response: errorHandler(result),
        };
    }

    @Post(':token/complete')
    @HttpCode(HttpStatus.OK)
    async complete(
        @Param('token') token: string,
        @Body() body: CompleteAgentEnrollmentBodyDto,
    ) {
        const result = await this.agentEnrollmentsService.completeEnrollment(
            token,
            body.address ?? '',
        );

        return {
            response: errorHandler(result),
        };
    }
}
