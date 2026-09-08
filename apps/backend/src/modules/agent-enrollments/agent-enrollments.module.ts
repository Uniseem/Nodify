import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { KeygenModule } from "@modules/keygen/keygen.module";

import { AgentEnrollmentsController } from "./agent-enrollments.controller";
import { AgentEnrollmentsPublicController } from "./agent-enrollments.public.controller";
import { AgentEnrollmentsService } from "./agent-enrollments.service";

@Module({
  imports: [KeygenModule, CqrsModule],
  controllers: [AgentEnrollmentsController, AgentEnrollmentsPublicController],
  providers: [AgentEnrollmentsService],
})
export class AgentEnrollmentsModule {}
