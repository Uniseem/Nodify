import { createQueryKeys } from '@lukemorales/query-key-factory'
import { notifications } from '@shared/heroui-compat'
import { z } from 'zod'

import { sToMs } from '@shared/utils/time-utils'

import { createGetQueryHook, createMutationHook } from '../../tsq-helpers'

const agentEnrollmentSchema = z.object({
    uuid: z.string(),
    name: z.string(),
    countryCode: z.string(),
    nodePort: z.number(),
    status: z.enum(['pending', 'installed', 'expired', 'revoked']),
    nodeUuid: z.string().nullable(),
    reportedAddress: z.string().nullable(),
    installUrl: z.string(),
    installCommand: z.string(),
    expiresAt: z.string(),
    usedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string()
})

const createAgentEnrollmentBodySchema = z.object({
    name: z.string().trim().min(1),
    countryCode: z.string().trim().min(2).max(2).optional(),
    nodePort: z.number().int().min(1).max(65535).optional()
})

export const agentEnrollmentsQueryKeys = createQueryKeys('agentEnrollments', {
    getAll: {
        queryKey: null
    },
    getOne: (route: { uuid: string }) => ({
        queryKey: [route]
    })
})

export const useGetAgentEnrollment = createGetQueryHook({
    endpoint: '/api/agent-enrollments/:uuid',
    responseSchema: z.object({
        response: agentEnrollmentSchema
    }),
    routeParamsSchema: z.object({
        uuid: z.string()
    }),
    getQueryKey: ({ route }) => agentEnrollmentsQueryKeys.getOne(route!).queryKey,
    rQueryParams: {
        staleTime: sToMs(2)
    }
})

export const useCreateAgentEnrollment = createMutationHook({
    endpoint: '/api/agent-enrollments',
    requestMethod: 'post',
    bodySchema: createAgentEnrollmentBodySchema,
    responseSchema: z.object({
        response: agentEnrollmentSchema
    }),
    rMutationParams: {
        onError: (error) => {
            notifications.show({
                title: 'Install link',
                message: error instanceof Error ? error.message : 'Failed to create install link.',
                color: 'red'
            })
        }
    }
})
