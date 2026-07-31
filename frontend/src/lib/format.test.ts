import { afterEach, describe, expect, it, vi } from "vitest";
import { formatBytes, formatDate, formatTimeLeft, zipFilename } from "./format";

describe("formatBytes", () => {
  it('returns "0 B" for zero', () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats whole bytes without decimals", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("scales through KB/MB/GB/TB with one decimal", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 ** 2)).toBe("1.0 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
    expect(formatBytes(1024 ** 4)).toBe("1.0 TB");
  });

  it("caps the unit at TB for very large values", () => {
    expect(formatBytes(1024 ** 5)).toBe("1024.0 TB");
  });
});

describe("formatTimeLeft", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function pin(nowIso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowIso));
  }

  it('returns "Expired" once past the expiry', () => {
    pin("2024-01-01T00:00:00Z");
    expect(formatTimeLeft("2023-12-31T23:59:59Z")).toBe("Expired");
    expect(formatTimeLeft("2024-01-01T00:00:00Z")).toBe("Expired");
  });

  it("reports minutes when under an hour", () => {
    pin("2024-01-01T00:00:00Z");
    expect(formatTimeLeft("2024-01-01T00:30:00Z")).toBe("30m left");
  });

  it("reports hours when under a day", () => {
    pin("2024-01-01T00:00:00Z");
    expect(formatTimeLeft("2024-01-01T05:00:00Z")).toBe("5h left");
  });

  it("reports days otherwise", () => {
    pin("2024-01-01T00:00:00Z");
    expect(formatTimeLeft("2024-01-04T00:00:00Z")).toBe("3d left");
  });
});

describe("formatDate", () => {
  it("renders a human-readable string including the year", () => {
    const out = formatDate("2024-06-15T12:00:00Z");
    expect(typeof out).toBe("string");
    expect(out).toContain("2024");
  });
});

describe("zipFilename", () => {
  it("joins the prefix with the date portion of the iso and a .zip extension", () => {
    expect(zipFilename("secure-transfer", "2024-06-15T12:00:00Z")).toBe(
      "secure-transfer-2024-06-15.zip"
    );
  });
});
