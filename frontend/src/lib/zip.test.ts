import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadAllAsZip } from "./zip";

const { zipInstances } = vi.hoisted(() => ({
  zipInstances: [] as Array<{
    file: ReturnType<typeof vi.fn>;
    generateAsync: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("jszip", () => ({
  default: class {
    file = vi.fn();
    generateAsync = vi.fn().mockResolvedValue(new Blob(["zip"]));
    constructor() {
      zipInstances.push(this);
    }
  },
}));

function okResponse(): Response {
  return { ok: true, blob: () => Promise.resolve(new Blob(["x"])) } as unknown as Response;
}

describe("downloadAllAsZip", () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    zipInstances.length = 0;
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('dedupes colliding filenames by appending " (2)", " (3)" before the extension', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(okResponse()))
    );

    await downloadAllAsZip(
      [
        { name: "report.pdf", url: "u1" },
        { name: "report.pdf", url: "u2" },
        { name: "report.pdf", url: "u3" },
      ],
      "bundle.zip"
    );

    const names = zipInstances[0].file.mock.calls.map((c) => c[0]);
    expect(names).toEqual(["report.pdf", "report (2).pdf", "report (3).pdf"]);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("rejects the whole operation and never downloads if any fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url === "bad" ? Promise.resolve({ ok: false } as Response) : Promise.resolve(okResponse())
      )
    );

    await expect(
      downloadAllAsZip(
        [
          { name: "a.txt", url: "good" },
          { name: "b.txt", url: "bad" },
        ],
        "bundle.zip"
      )
    ).rejects.toThrow(/Failed to download b\.txt/);

    expect(clickSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
