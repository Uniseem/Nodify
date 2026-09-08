// Keep the retained advanced subscription API separate from Nodify's entitlement tokens.
export const SUBSCRIPTION_CONTROLLER = 'legacy-sub' as const;

export const SUBSCRIPTION_ROUTES = {
    GET: '',
    GET_INFO: (shortUuid: string) => `${shortUuid}/info`,
} as const;
