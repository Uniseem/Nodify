export const AGENT_ENROLLMENTS_CONTROLLER = 'agent-enrollments' as const;
export const PUBLIC_AGENT_ENROLLMENTS_CONTROLLER = 'public/agent-enrollments' as const;

export const AGENT_ENROLLMENTS_ROUTES = {
    CREATE: '',
    GET: '',
    GET_BY_UUID: (uuid: string) => `${uuid}`,
    REVOKE: (uuid: string) => `${uuid}`,
} as const;

export const PUBLIC_AGENT_ENROLLMENTS_ROUTES = {
    GET: (token: string) => `${token}`,
    INSTALL: (token: string) => `${token}/install`,
    COMPLETE: (token: string) => `${token}/complete`,
} as const;
