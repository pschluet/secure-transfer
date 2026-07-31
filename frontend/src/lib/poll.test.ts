import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollAfterDelays } from "./poll";

describe("pollAfterDelays", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the callback once at each default delay and no more", () => {
    const fn = vi.fn();
    pollAfterDelays(fn);

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000); // 8000
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(7000); // 15000
    expect(fn).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(10000); // 25000
    expect(fn).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(20000); // 45000
    expect(fn).toHaveBeenCalledTimes(5);

    vi.advanceTimersByTime(60000);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("honors a custom delay array", () => {
    const fn = vi.fn();
    pollAfterDelays(fn, [100, 200]);
    vi.advanceTimersByTime(99);
    expect(fn).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
