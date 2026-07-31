import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresignedFileUpload } from "../types";
import { triggerBrowserDownload, uploadFiles } from "./upload";

interface ProgressEventLike {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

class FakeXHR {
  static instances: FakeXHR[] = [];
  upload: { onprogress: ((e: ProgressEventLike) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  method = "";
  url = "";
  body: unknown = null;

  constructor() {
    FakeXHR.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: unknown) {
    this.body = body;
  }
}

function makeFile(name: string): File {
  return new File(["hello"], name, { type: "text/plain" });
}

function makePresigned(fileId: string, name: string): PresignedFileUpload {
  return { fileId, name, uploadUrl: `https://example.com/${fileId}` };
}

describe("uploadFiles", () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports per-file progress fractions and resolves on 2xx", async () => {
    const files = [makeFile("a.txt")];
    const presigned = [makePresigned("f1", "a.txt")];
    const onProgress = vi.fn();

    const promise = uploadFiles(files, presigned, onProgress);
    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe("https://example.com/f1");

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    expect(onProgress).toHaveBeenLastCalledWith({ f1: 0.5 });

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
    expect(onProgress).toHaveBeenLastCalledWith({ f1: 1 });

    xhr.status = 204;
    xhr.onload?.();
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects with a message containing the status code on non-2xx", async () => {
    const promise = uploadFiles([makeFile("a.txt")], [makePresigned("f1", "a.txt")]);
    const xhr = FakeXHR.instances[0];
    xhr.status = 500;
    xhr.onload?.();
    await expect(promise).rejects.toThrow(/500/);
  });

  it("rejects with a connection-error message on XHR onerror", async () => {
    const promise = uploadFiles([makeFile("a.txt")], [makePresigned("f1", "a.txt")]);
    const xhr = FakeXHR.instances[0];
    xhr.onerror?.();
    await expect(promise).rejects.toThrow(/connection/);
  });
});

describe("triggerBrowserDownload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates and clicks an anchor pointing at the url", () => {
    const anchor = document.createElement("a");
    const clickSpy = vi.spyOn(anchor, "click").mockImplementation(() => {});
    vi.spyOn(document, "createElement").mockReturnValue(anchor);

    triggerBrowserDownload("https://example.com/download");

    expect(anchor.href).toBe("https://example.com/download");
    expect(anchor.rel).toBe("noopener");
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
