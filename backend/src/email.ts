import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const FROM_EMAIL = process.env.FROM_EMAIL!;
const SITE_URL = process.env.SITE_URL!;

const ses = new SESv2Client({});

const CENTRAL_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  dateStyle: "long",
  timeStyle: "short",
});
const CENTRAL_TZ_NAME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  timeZoneName: "short",
});

// dateStyle/timeStyle can't be combined with timeZoneName in one formatter
// (ECMA-402 rejects mixing style options with explicit component options),
// so the zone abbreviation (CDT/CST) is pulled from a second formatter.
function formatCentral(iso: string): string {
  const date = new Date(iso);
  const zone = CENTRAL_TZ_NAME.formatToParts(date).find((p) => p.type === "timeZoneName")?.value;
  return `${CENTRAL_DATE_TIME.format(date)} ${zone}`;
}

function formatFileList(fileNames: string[]): string {
  return fileNames.map((name) => `  - ${name}`).join("\n");
}

async function send(to: string, subject: string, bodyText: string): Promise<void> {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: { Text: { Data: bodyText } },
        },
      },
    })
  );
}

export async function sendShareReadyEmail(
  to: string,
  firstName: string,
  fileNames: string[],
  expiresAt: string
): Promise<void> {
  const fileWord = fileNames.length === 1 ? "file" : "files";
  await send(
    to,
    "Files shared with you on Secure Transfer",
    `Hi ${firstName},\n\nPaul shared ${fileNames.length} ${fileWord} with you:\n\n${formatFileList(fileNames)}\n\nThey're available until ${formatCentral(expiresAt)}.\n\nLog in to download: ${SITE_URL}\n`
  );
}

export async function sendUserInvitedEmail(to: string, firstName: string): Promise<void> {
  await send(
    to,
    "You've been added to Secure Transfer",
    `Hi ${firstName},\n\nPaul added you to Secure Transfer, a site for exchanging files securely.\n\nGo to ${SITE_URL} and enter this email address to sign in — you'll get a one-time code by email, no password needed.\n`
  );
}

export async function sendUploadReadyEmail(
  to: string,
  senderName: string,
  fileNames: string[]
): Promise<void> {
  const fileWord = fileNames.length === 1 ? "file" : "files";
  await send(
    to,
    "New files uploaded on Secure Transfer",
    `${senderName} uploaded ${fileNames.length} ${fileWord} for you:\n\n${formatFileList(fileNames)}\n\nLog in to download: ${SITE_URL}\n`
  );
}
