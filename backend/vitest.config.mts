import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    // Required env vars are injected here (rather than read from a real
    // .env) so every test file sees them before its top-level imports run —
    // `db.ts`/`s3.ts`/`email.ts`/`api.ts`/`s3-event.ts` all read
    // `process.env.X!` at module-load time.
    env: {
      TABLE_NAME: "test-table",
      FILES_BUCKET: "test-files-bucket",
      USER_POOL_ID: "test-user-pool-id",
      ALLOWED_ORIGIN: "https://transfer.test.example",
      FROM_EMAIL: "no-reply@test.example",
      SITE_URL: "https://transfer.test.example",
      ADMIN_EMAIL: "admin@test.example",
    },
  },
});
