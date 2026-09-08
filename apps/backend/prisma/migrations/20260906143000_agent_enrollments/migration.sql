-- CreateTable
CREATE TABLE "agent_enrollments" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" TEXT NOT NULL DEFAULT 'XX',
    "node_port" INTEGER NOT NULL DEFAULT 2222,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "secret_key" TEXT NOT NULL,
    "node_uuid" TEXT,
    "reported_address" TEXT,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "agent_enrollments_token_key" ON "agent_enrollments"("token");
