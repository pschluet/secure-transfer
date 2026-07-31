// Global backend test setup. Env vars needed at module-load time are
// injected via `test.env` in vitest.config.ts (they must be set before any
// module that reads `process.env.X!` is first imported). This file is the
// place for any additional process-wide test wiring.

// Adds `toHaveReceivedCommandWith` and friends to vitest's `expect`.
import "aws-sdk-client-mock-jest";
