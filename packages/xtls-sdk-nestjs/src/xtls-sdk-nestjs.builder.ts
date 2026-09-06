import { ConfigurableModuleBuilder } from '@nestjs/common';
import { XtlsApiOptions } from '@remnawave/xtls-sdk';

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
    new ConfigurableModuleBuilder<XtlsApiOptions>()
        .setFactoryMethodName('forRootAsync')
        .setClassMethodName('forRoot')
        .build();
