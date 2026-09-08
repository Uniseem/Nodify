import path from 'node:path';

import { isDevelopment } from './startup-app';

export function getAssetsPath(): string {
    if (process.env.NODIFY_FRONTEND_DIR) return path.resolve(process.env.NODIFY_FRONTEND_DIR);
    return isDevelopment() ? path.resolve(process.cwd(), 'frontend') : '/opt/app/frontend';
}
