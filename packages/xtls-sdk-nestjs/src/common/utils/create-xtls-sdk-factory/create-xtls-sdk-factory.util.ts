import { XtlsApi, XtlsApiOptions } from '@remnawave/xtls-sdk';
import { Logger } from '@nestjs/common';
const logger = new Logger('xtls-sdk-nestjs');

export function createXtlsSdkFactory(moduleOptions: XtlsApiOptions): XtlsApi {
    const xtlsApi = new XtlsApi({
        connectionUrl: moduleOptions.connectionUrl,
        options: moduleOptions.options,
        credentials: moduleOptions.credentials,
    });
    logger.log(`[OK] XtlsApi initialized`);
    return xtlsApi;
}
