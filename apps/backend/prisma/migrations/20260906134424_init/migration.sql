-- SQLite/Prisma: nullable JSON columns use TEXT to preserve SQL NULL on reads.
-- CreateTable
CREATE TABLE "remnawave_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "passkey_settings" TEXT,
    "oauth2_settings" TEXT,
    "password_settings" TEXT,
    "branding_settings" JSON
);

-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "short_uuid" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "traffic_limit_bytes" BIGINT NOT NULL DEFAULT 0,
    "traffic_limit_strategy" TEXT NOT NULL DEFAULT 'NO_RESET',
    "expire_at" DATETIME NOT NULL,
    "last_traffic_reset_at" DATETIME,
    "sub_revoked_at" DATETIME,
    "trojan_password" TEXT NOT NULL,
    "vless_uuid" TEXT NOT NULL,
    "ss_password" TEXT NOT NULL,
    "description" TEXT,
    "tag" TEXT,
    "telegram_id" BIGINT,
    "email" TEXT,
    "hwid_device_limit" INTEGER,
    "external_squad_uuid" TEXT,
    "last_triggered_threshold" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_external_squad_uuid_fkey" FOREIGN KEY ("external_squad_uuid") REFERENCES "external_squads" ("uuid") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_traffic" (
    "id" BIGINT NOT NULL PRIMARY KEY,
    "used_traffic_bytes" BIGINT NOT NULL DEFAULT 0,
    "lifetime_used_traffic_bytes" BIGINT NOT NULL DEFAULT 0,
    "online_at" DATETIME,
    "last_connected_node_uuid" TEXT,
    "first_connected_at" DATETIME,
    CONSTRAINT "user_traffic_id_fkey" FOREIGN KEY ("id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_traffic_last_connected_node_uuid_fkey" FOREIGN KEY ("last_connected_node_uuid") REFERENCES "nodes" ("uuid") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "expire_at" DATETIME NOT NULL,
    "scopes" JSON NOT NULL DEFAULT '["*"]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "admin" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "passkeys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "admin_uuid" TEXT NOT NULL,
    "public_key" BLOB NOT NULL,
    "counter" BIGINT NOT NULL,
    "device_type" TEXT NOT NULL,
    "backed_up" BOOLEAN NOT NULL,
    "transports" TEXT,
    "passkey_provider" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "passkeys_admin_uuid_fkey" FOREIGN KEY ("admin_uuid") REFERENCES "admin" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "keygen" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "priv_key" TEXT NOT NULL,
    "pub_key" TEXT NOT NULL,
    "ca_cert" TEXT,
    "ca_key" TEXT,
    "client_cert" TEXT,
    "client_key" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "nodes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "port" INTEGER,
    "proxy_url" TEXT,
    "active_config_profile_uuid" TEXT,
    "active_plugin_uuid" TEXT,
    "is_connected" BOOLEAN NOT NULL DEFAULT false,
    "is_connecting" BOOLEAN NOT NULL DEFAULT false,
    "is_disabled" BOOLEAN NOT NULL DEFAULT false,
    "last_status_change" DATETIME,
    "last_status_message" TEXT,
    "note" TEXT,
    "consumption_multiplier" BIGINT NOT NULL DEFAULT 1000000000,
    "node_consumption_multiplier" BIGINT NOT NULL DEFAULT 1000000000,
    "is_traffic_tracking_active" BOOLEAN NOT NULL DEFAULT false,
    "traffic_reset_day" INTEGER DEFAULT 1,
    "traffic_limit_bytes" BIGINT DEFAULT 0,
    "traffic_used_bytes" BIGINT DEFAULT 0,
    "notify_percent" INTEGER DEFAULT 0,
    "ips" JSON NOT NULL DEFAULT '[]',
    "provider_uuid" TEXT,
    "view_position" INTEGER NOT NULL DEFAULT 0,
    "country_code" TEXT NOT NULL DEFAULT 'XX',
    "tags" JSON NOT NULL DEFAULT '[]',
    "integration_uuids" JSON NOT NULL DEFAULT '[]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nodes_active_config_profile_uuid_fkey" FOREIGN KEY ("active_config_profile_uuid") REFERENCES "config_profiles" ("uuid") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "nodes_provider_uuid_fkey" FOREIGN KEY ("provider_uuid") REFERENCES "infra_providers" ("uuid") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "nodes_active_plugin_uuid_fkey" FOREIGN KEY ("active_plugin_uuid") REFERENCES "node_plugin" ("uuid") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "integrations" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" JSON NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "nodes_user_usage_history" (
    "node_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "total_bytes" BIGINT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("node_id", "created_at", "user_id"),
    CONSTRAINT "nodes_user_usage_history_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "nodes_user_usage_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "nodes_usage_history" (
    "node_uuid" TEXT NOT NULL,
    "download_bytes" BIGINT NOT NULL,
    "upload_bytes" BIGINT NOT NULL,
    "total_bytes" BIGINT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("node_uuid", "created_at"),
    CONSTRAINT "nodes_usage_history_node_uuid_fkey" FOREIGN KEY ("node_uuid") REFERENCES "nodes" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "hosts" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "view_position" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "path" TEXT,
    "sni" TEXT,
    "host" TEXT,
    "alpn" TEXT,
    "fingerprint" TEXT,
    "security_layer" TEXT NOT NULL DEFAULT 'DEFAULT',
    "xhttp_extra_params" TEXT,
    "mux_params" TEXT,
    "sockopt_params" TEXT,
    "final_mask" TEXT,
    "is_disabled" BOOLEAN NOT NULL DEFAULT false,
    "server_description" TEXT,
    "vless_route_id" INTEGER,
    "pinned_peer_cert_sha256" TEXT,
    "verify_peer_cert_by_name" TEXT,
    "shuffle_host" BOOLEAN NOT NULL DEFAULT false,
    "mihomo_x25519" BOOLEAN NOT NULL DEFAULT false,
    "mihomo_ip_version" TEXT,
    "xray_json_template_uuid" TEXT,
    "keep_sni_blank" BOOLEAN NOT NULL DEFAULT false,
    "exclude_from_subscription_types" JSON NOT NULL DEFAULT '[]',
    "mapper" JSON NOT NULL DEFAULT '{}',
    "internal_squads_mode" TEXT NOT NULL DEFAULT 'EXCLUDE',
    "tags" JSON NOT NULL DEFAULT '[]',
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "override_sni_from_address" BOOLEAN NOT NULL DEFAULT false,
    "config_profile_uuid" TEXT,
    "config_profile_inbound_uuid" TEXT,
    CONSTRAINT "hosts_config_profile_inbound_uuid_fkey" FOREIGN KEY ("config_profile_inbound_uuid") REFERENCES "config_profile_inbounds" ("uuid") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "hosts_config_profile_uuid_fkey" FOREIGN KEY ("config_profile_uuid") REFERENCES "config_profiles" ("uuid") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "hosts_xray_json_template_uuid_fkey" FOREIGN KEY ("xray_json_template_uuid") REFERENCES "subscription_templates" ("uuid") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "internal_squad_host_links" (
    "host_uuid" TEXT NOT NULL,
    "squad_uuid" TEXT NOT NULL,

    PRIMARY KEY ("host_uuid", "squad_uuid"),
    CONSTRAINT "internal_squad_host_links_host_uuid_fkey" FOREIGN KEY ("host_uuid") REFERENCES "hosts" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "internal_squad_host_links_squad_uuid_fkey" FOREIGN KEY ("squad_uuid") REFERENCES "internal_squads" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subscription_templates" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "view_position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "tags" JSON NOT NULL DEFAULT '[]',
    "template_type" TEXT NOT NULL,
    "template_yaml" TEXT,
    "template_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "subscription_settings" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "serve_json_at_base_subscription" BOOLEAN NOT NULL DEFAULT false,
    "is_show_custom_remarks" BOOLEAN NOT NULL DEFAULT true,
    "custom_remarks" JSON NOT NULL,
    "custom_response_headers" TEXT,
    "randomize_hosts" BOOLEAN NOT NULL DEFAULT false,
    "response_rules" TEXT,
    "hwid_settings" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "hwid_user_devices" (
    "hwid" TEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "platform" TEXT,
    "os_version" TEXT,
    "device_model" TEXT,
    "user_agent" TEXT,
    "request_ip" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("hwid", "user_id"),
    CONSTRAINT "hwid_user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "internal_squads" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "view_position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "tags" JSON NOT NULL DEFAULT '[]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "internal_squad_members" (
    "internal_squad_uuid" TEXT NOT NULL,
    "user_id" BIGINT NOT NULL,

    PRIMARY KEY ("internal_squad_uuid", "user_id"),
    CONSTRAINT "internal_squad_members_internal_squad_uuid_fkey" FOREIGN KEY ("internal_squad_uuid") REFERENCES "internal_squads" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "internal_squad_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "internal_squad_inbounds" (
    "internal_squad_uuid" TEXT NOT NULL,
    "inbound_uuid" TEXT NOT NULL,

    PRIMARY KEY ("internal_squad_uuid", "inbound_uuid"),
    CONSTRAINT "internal_squad_inbounds_internal_squad_uuid_fkey" FOREIGN KEY ("internal_squad_uuid") REFERENCES "internal_squads" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "internal_squad_inbounds_inbound_uuid_fkey" FOREIGN KEY ("inbound_uuid") REFERENCES "config_profile_inbounds" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "config_profiles" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "view_position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "tags" JSON NOT NULL DEFAULT '[]',
    "config" JSON NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "config_profile_inbounds" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "profile_uuid" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "network" TEXT,
    "security" TEXT,
    "port" INTEGER,
    "raw_inbound" TEXT,
    CONSTRAINT "config_profile_inbounds_profile_uuid_fkey" FOREIGN KEY ("profile_uuid") REFERENCES "config_profiles" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "config_profile_inbounds_to_nodes" (
    "config_profile_inbound_uuid" TEXT NOT NULL,
    "node_uuid" TEXT NOT NULL,

    PRIMARY KEY ("config_profile_inbound_uuid", "node_uuid"),
    CONSTRAINT "config_profile_inbounds_to_nodes_config_profile_inbound_uuid_fkey" FOREIGN KEY ("config_profile_inbound_uuid") REFERENCES "config_profile_inbounds" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "config_profile_inbounds_to_nodes_node_uuid_fkey" FOREIGN KEY ("node_uuid") REFERENCES "nodes" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "infra_providers" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "favicon_link" TEXT,
    "login_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "infra_billing_nodes" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "node_uuid" TEXT,
    "name" TEXT,
    "provider_uuid" TEXT NOT NULL,
    "next_billing_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "infra_billing_nodes_provider_uuid_fkey" FOREIGN KEY ("provider_uuid") REFERENCES "infra_providers" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "infra_billing_nodes_node_uuid_fkey" FOREIGN KEY ("node_uuid") REFERENCES "nodes" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "infra_billing_history" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "provider_uuid" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "billed_at" DATETIME NOT NULL,
    CONSTRAINT "infra_billing_history_provider_uuid_fkey" FOREIGN KEY ("provider_uuid") REFERENCES "infra_providers" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_subscription_request_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" BIGINT NOT NULL,
    "request_ip" TEXT,
    "user_agent" TEXT,
    "srr_rule_name" TEXT,
    "srr_response_type" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "request_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_subscription_request_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "hosts_to_nodes" (
    "host_uuid" TEXT NOT NULL,
    "node_uuid" TEXT NOT NULL,

    PRIMARY KEY ("host_uuid", "node_uuid"),
    CONSTRAINT "hosts_to_nodes_host_uuid_fkey" FOREIGN KEY ("host_uuid") REFERENCES "hosts" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "hosts_to_nodes_node_uuid_fkey" FOREIGN KEY ("node_uuid") REFERENCES "nodes" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "config_profile_snippets" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "snippet" JSON NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "external_squads" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "view_position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "tags" JSON NOT NULL DEFAULT '[]',
    "subscription_settings" TEXT,
    "host_overrides" TEXT,
    "response_headers_add" JSON NOT NULL DEFAULT '{}',
    "response_headers_remove" JSON NOT NULL DEFAULT '[]',
    "hwid_settings" TEXT,
    "custom_remarks" TEXT,
    "subpage_config_uuid" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "external_squads_subpage_config_uuid_fkey" FOREIGN KEY ("subpage_config_uuid") REFERENCES "subscription_page_config" ("uuid") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "external_squads_templates" (
    "external_squad_uuid" TEXT NOT NULL,
    "template_uuid" TEXT NOT NULL,
    "template_type" TEXT NOT NULL,

    PRIMARY KEY ("external_squad_uuid", "template_type"),
    CONSTRAINT "external_squads_templates_external_squad_uuid_fkey" FOREIGN KEY ("external_squad_uuid") REFERENCES "external_squads" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "external_squads_templates_template_uuid_fkey" FOREIGN KEY ("template_uuid") REFERENCES "subscription_templates" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subscription_page_config" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "view_position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "tags" JSON NOT NULL DEFAULT '[]',
    "config" JSON NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "shared_lists" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "config" JSON NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "node_plugin" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "view_position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "tags" JSON NOT NULL DEFAULT '[]',
    "plugin_config" JSON NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "user_meta" (
    "user_id" BIGINT NOT NULL PRIMARY KEY,
    "metadata" JSON NOT NULL,
    CONSTRAINT "user_meta_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "node_meta" (
    "node_id" BIGINT NOT NULL PRIMARY KEY,
    "metadata" JSON NOT NULL,
    CONSTRAINT "node_meta_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "torrent_blocker_reports" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" BIGINT NOT NULL,
    "node_id" BIGINT NOT NULL,
    "report" JSON NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "torrent_blocker_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "torrent_blocker_reports_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_short_uuid_key" ON "users"("short_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_expire_at_idx" ON "users"("expire_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_username_key" ON "admin"("username");

-- CreateIndex
CREATE INDEX "passkeys_id_idx" ON "passkeys"("id");

-- CreateIndex
CREATE INDEX "passkeys_admin_uuid_idx" ON "passkeys"("admin_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "nodes_uuid_key" ON "nodes"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "nodes_name_key" ON "nodes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "nodes_address_key" ON "nodes"("address");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_name_key" ON "integrations"("name");

-- CreateIndex
CREATE INDEX "nodes_user_usage_history_user_id_created_at_idx" ON "nodes_user_usage_history"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "nodes_usage_history_node_uuid_created_at_idx" ON "nodes_usage_history"("node_uuid", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_templates_template_type_name_key" ON "subscription_templates"("template_type", "name");

-- CreateIndex
CREATE INDEX "hwid_user_devices_user_id_idx" ON "hwid_user_devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "internal_squads_name_key" ON "internal_squads"("name");

-- CreateIndex
CREATE INDEX "internal_squad_members_internal_squad_uuid_idx" ON "internal_squad_members"("internal_squad_uuid");

-- CreateIndex
CREATE INDEX "internal_squad_members_user_id_idx" ON "internal_squad_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "config_profiles_name_key" ON "config_profiles"("name");

-- CreateIndex
CREATE INDEX "config_profile_inbounds_profile_uuid_uuid_idx" ON "config_profile_inbounds"("profile_uuid", "uuid");

-- CreateIndex
CREATE UNIQUE INDEX "config_profile_inbounds_tag_key" ON "config_profile_inbounds"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "infra_providers_name_key" ON "infra_providers"("name");

-- CreateIndex
CREATE INDEX "infra_billing_nodes_next_billing_at_idx" ON "infra_billing_nodes"("next_billing_at");

-- CreateIndex
CREATE UNIQUE INDEX "infra_billing_nodes_node_uuid_provider_uuid_key" ON "infra_billing_nodes"("node_uuid", "provider_uuid");

-- CreateIndex
CREATE INDEX "user_subscription_request_history_user_id_idx" ON "user_subscription_request_history"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_squads_name_key" ON "external_squads"("name");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_page_config_name_key" ON "subscription_page_config"("name");
