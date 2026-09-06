import { CamelCasePlugin, CamelCasePluginOptions, UnknownRow } from 'kysely';

export const JSON_COLUMNS = [
    'branding_settings',
    'config',
    'custom_remarks',
    'custom_response_headers',
    'exclude_from_subscription_types',
    'final_mask',
    'host_overrides',
    'hwid_settings',
    'integration_uuids',
    'ips',
    'mapper',
    'metadata',
    'mux_params',
    'oauth2_settings',
    'passkey_settings',
    'password_settings',
    'plugin_config',
    'raw_inbound',
    'report',
    'response_headers_add',
    'response_headers_remove',
    'response_rules',
    'scopes',
    'snippet',
    'sockopt_params',
    'subscription_settings',
    'tags',
    'template_json',
    'xhttp_extra_params',
];

export interface CustomCamelCasePluginOptions extends CamelCasePluginOptions {
    excludeColumns?: string[];
}

export class CustomCamelCasePlugin extends CamelCasePlugin {
    private readonly excludedColumns: ReadonlySet<string>;

    constructor({ excludeColumns = [], ...opt }: CustomCamelCasePluginOptions = {}) {
        super(opt);
        this.excludedColumns = new Set(excludeColumns);
    }

    protected override mapRow(row: UnknownRow): UnknownRow {
        return Object.keys(row).reduce<UnknownRow>((obj, key) => {
            const value = parseJsonContainer(row[key]);
            obj[this.camelCase(key)] = this.excludedColumns.has(key)
                ? value
                : this.mapValue(value);

            return obj;
        }, {});
    }

    private mapValue(value: unknown): unknown {
        if (Array.isArray(value)) {
            return value.map((item) => this.mapValue(item));
        }

        return this.canMap(value) ? this.mapRow(value as UnknownRow) : value;
    }

    private canMap(value: unknown): boolean {
        if (this.opt.maintainNestedObjectKeys) {
            return false;
        }

        if (typeof value !== 'object' || value === null) {
            return false;
        }

        const proto = Object.getPrototypeOf(value);

        return proto === null || proto === Object.prototype;
    }
}

function parseJsonContainer(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }

    const trimmed = value.trimStart();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}
