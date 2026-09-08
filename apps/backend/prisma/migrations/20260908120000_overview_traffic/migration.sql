CREATE TABLE "NodifyOverviewSettings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "version" INTEGER NOT NULL DEFAULT 0,
  "includeExternal" BOOLEAN NOT NULL DEFAULT false
);
