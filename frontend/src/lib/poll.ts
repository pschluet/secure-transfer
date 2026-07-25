/**
 * Fires `fn` again after each delay in `delaysMs`. Used right after an
 * upload finishes client-side to pick up the backend's async "ready" flip
 * (driven by an S3 event, usually within a few seconds but occasionally
 * slower under cold starts) without the user having to click refresh.
 * Backs off over 45s total: quick at first, then spaced further apart.
 */
export function pollAfterDelays(
  fn: () => void,
  delaysMs: number[] = [3000, 8000, 15000, 25000, 45000]
): void {
  for (const delay of delaysMs) {
    setTimeout(fn, delay);
  }
}
