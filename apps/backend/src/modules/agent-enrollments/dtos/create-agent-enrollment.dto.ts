import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class CreateAgentEnrollmentBodyDto extends createZodDto(
    z.object({
        name: z.string().trim().min(1).max(100),
        countryCode: z.string().trim().min(2).max(2).optional(),
        nodePort: z.number().int().min(1).max(65535).optional(),
    }),
) {}

export class CompleteAgentEnrollmentBodyDto extends createZodDto(
    z.object({
        address: z.string().trim().min(1).max(255),
    }),
) {}
