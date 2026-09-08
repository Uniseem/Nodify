export const AGENT_ENROLLMENT_STATUS = {
    PENDING: 'pending',
    INSTALLED: 'installed',
    EXPIRED: 'expired',
    REVOKED: 'revoked',
} as const;

export type TAgentEnrollmentStatus =
    (typeof AGENT_ENROLLMENT_STATUS)[keyof typeof AGENT_ENROLLMENT_STATUS];

export const AGENT_ENROLLMENT_TTL_MS = 72 * 60 * 60 * 1000;
