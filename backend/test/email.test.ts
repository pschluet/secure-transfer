import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { sendShareReadyEmail, sendUploadReadyEmail, sendUserInvitedEmail } from "../src/email";

const sesMock = mockClient(SESv2Client);

function lastEmail() {
  const calls = sesMock.commandCalls(SendEmailCommand);
  return calls[calls.length - 1].args[0].input;
}

beforeEach(() => {
  sesMock.reset();
  sesMock.on(SendEmailCommand).resolves({});
});

describe("sendShareReadyEmail", () => {
  it("sends from FROM_EMAIL to the recipient with the fixed subject", async () => {
    await sendShareReadyEmail("r@example.com", "Rae", ["a.txt"], "2026-07-15T18:00:00.000Z");
    const input = lastEmail();
    expect(input.FromEmailAddress).toBe("no-reply@test.example");
    expect(input.Destination?.ToAddresses).toEqual(["r@example.com"]);
    expect(input.Content?.Simple?.Subject?.Data).toBe("Files shared with you on Secure Transfer");
  });

  it("uses singular 'file' for one file", async () => {
    await sendShareReadyEmail("r@example.com", "Rae", ["a.txt"], "2026-07-15T18:00:00.000Z");
    const body = lastEmail().Content?.Simple?.Body?.Text?.Data ?? "";
    expect(body).toContain("Paul shared 1 file with you:");
    expect(body).toContain("  - a.txt");
    expect(body).toContain("Log in to download: https://transfer.test.example");
  });

  it("uses plural 'files' for multiple files", async () => {
    await sendShareReadyEmail(
      "r@example.com",
      "Rae",
      ["a.txt", "b.txt"],
      "2026-07-15T18:00:00.000Z"
    );
    const body = lastEmail().Content?.Simple?.Body?.Text?.Data ?? "";
    expect(body).toContain("Paul shared 2 files with you:");
    expect(body).toContain("  - a.txt\n  - b.txt");
  });

  it("formats a summer expiry in Central time as CDT", async () => {
    await sendShareReadyEmail("r@example.com", "Rae", ["a.txt"], "2026-07-15T18:00:00.000Z");
    const body = lastEmail().Content?.Simple?.Body?.Text?.Data ?? "";
    // 18:00 UTC in July == 1:00 PM CDT (UTC-5).
    expect(body).toContain("July 15, 2026");
    expect(body).toContain("1:00 PM");
    expect(body).toContain("CDT");
    expect(body).not.toContain("CST");
  });

  it("formats a winter expiry in Central time as CST", async () => {
    await sendShareReadyEmail("r@example.com", "Rae", ["a.txt"], "2026-01-15T18:00:00.000Z");
    const body = lastEmail().Content?.Simple?.Body?.Text?.Data ?? "";
    // 18:00 UTC in January == 12:00 PM CST (UTC-6).
    expect(body).toContain("January 15, 2026");
    expect(body).toContain("12:00 PM");
    expect(body).toContain("CST");
  });
});

describe("sendUserInvitedEmail", () => {
  it("sends the invite with the fixed subject and sign-in instructions", async () => {
    await sendUserInvitedEmail("new@example.com", "Nova");
    const input = lastEmail();
    expect(input.Destination?.ToAddresses).toEqual(["new@example.com"]);
    expect(input.Content?.Simple?.Subject?.Data).toBe("You've been added to Secure Transfer");
    const body = input.Content?.Simple?.Body?.Text?.Data ?? "";
    expect(body).toContain("Hi Nova,");
    expect(body).toContain("Paul added you to Secure Transfer");
    expect(body).toContain("Go to https://transfer.test.example and enter this email address");
  });
});

describe("sendUploadReadyEmail", () => {
  it("uses singular 'file' for one file", async () => {
    await sendUploadReadyEmail("admin@test.example", "Sam Sender", ["only.pdf"]);
    const input = lastEmail();
    expect(input.Content?.Simple?.Subject?.Data).toBe("New files uploaded on Secure Transfer");
    const body = input.Content?.Simple?.Body?.Text?.Data ?? "";
    expect(body).toContain("Sam Sender uploaded 1 file for you:");
    expect(body).toContain("  - only.pdf");
    expect(body).toContain("Log in to download: https://transfer.test.example");
  });

  it("uses plural 'files' for multiple files", async () => {
    await sendUploadReadyEmail("admin@test.example", "Sam Sender", ["a.pdf", "b.pdf"]);
    const body = lastEmail().Content?.Simple?.Body?.Text?.Data ?? "";
    expect(body).toContain("Sam Sender uploaded 2 files for you:");
  });
});
