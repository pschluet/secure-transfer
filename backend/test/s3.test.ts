import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { presignDownload, presignUpload, shareKey, uploadKey } from "../src/s3";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://signed.example/fake-url"),
}));

const mockGetSignedUrl = vi.mocked(getSignedUrl);

beforeEach(() => {
  mockGetSignedUrl.mockClear();
});

describe("key builders", () => {
  it("shareKey uses the shares/<recipient>/<group>/<filename> layout", () => {
    expect(shareKey("recip-1", "grp-1", "file.txt")).toBe("shares/recip-1/grp-1/file.txt");
  });

  it("uploadKey uses the uploads/<sender>/<group>/<filename> layout", () => {
    expect(uploadKey("send-1", "grp-1", "file.txt")).toBe("uploads/send-1/grp-1/file.txt");
  });
});

describe("presignUpload", () => {
  it("signs a PutObjectCommand with a 15-minute TTL", async () => {
    const url = await presignUpload("shares/a/b/c.txt");
    expect(url).toBe("https://signed.example/fake-url");

    const [, command, opts] = mockGetSignedUrl.mock.calls[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: "test-files-bucket",
      Key: "shares/a/b/c.txt",
    });
    expect(opts).toEqual({ expiresIn: 900 });
  });

  it("omits ContentType when none is given", async () => {
    await presignUpload("k");
    const command = mockGetSignedUrl.mock.calls[0][1] as PutObjectCommand;
    expect(command.input.ContentType).toBeUndefined();
  });
});

describe("presignDownload", () => {
  it("signs a GetObjectCommand with a 5-minute TTL and attachment disposition", async () => {
    const url = await presignDownload("uploads/a/b/c.txt", "report.pdf");
    expect(url).toBe("https://signed.example/fake-url");

    const [, command, opts] = mockGetSignedUrl.mock.calls[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect((command as GetObjectCommand).input).toMatchObject({
      Bucket: "test-files-bucket",
      Key: "uploads/a/b/c.txt",
      ResponseContentDisposition: 'attachment; filename="report.pdf"',
    });
    expect(opts).toEqual({ expiresIn: 300 });
  });

  it("strips double-quotes from the filename", async () => {
    await presignDownload("k", 'a"b".pdf');
    const command = mockGetSignedUrl.mock.calls[0][1] as GetObjectCommand;
    expect(command.input.ResponseContentDisposition).toBe('attachment; filename="ab.pdf"');
  });

  // Known gap: only `"` is stripped. CR/LF pass through unescaped. Asserting
  // the current behavior so a future header-injection fix is a deliberate change.
  it("does NOT strip CR/LF from the filename (documented gap)", async () => {
    await presignDownload("k", "a\r\nb.pdf");
    const command = mockGetSignedUrl.mock.calls[0][1] as GetObjectCommand;
    expect(command.input.ResponseContentDisposition).toBe('attachment; filename="a\r\nb.pdf"');
  });
});
