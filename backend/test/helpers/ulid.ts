// Deterministic, resettable stand-in for `ulid`. Used as the `vi.mock("ulid")`
// implementation so generated IDs are stable per test. Call `resetUlid()` in
// `beforeEach` to restart the counter.

let counter = 0;

export function ulid(): string {
  return `ulid-${++counter}`;
}

export function resetUlid(): void {
  counter = 0;
}
