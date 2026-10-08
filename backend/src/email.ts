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

/** "a message", "2 files", or "a message and 1 file" — whatever a share holds. */
function describeContents(hasMessage: boolean, fileCount: number): string {
  const files = fileCount > 0 ? `${fileCount} ${fileCount === 1 ? "file" : "files"}` : "";
  if (hasMessage && files) return `a message and ${files}`;
  return hasMessage ? "a message" : files;
}

/** The summary sentence's ending: what was shared, `suffix`, then a colon and
 * the file list, or a period when there are no files to list. */
function contentsWithList(hasMessage: boolean, fileNames: string[], suffix = ""): string {
  const contents = `${describeContents(hasMessage, fileNames.length)}${suffix}`;
  return fileNames.length > 0 ? `${contents}:\n\n${formatFileList(fileNames)}` : `${contents}.`;
}

export async function sendShareReadyEmail(
  to: string,
  firstName: string,
  fileNames: string[],
  expiresAt: string,
  hasMessage = false
): Promise<void> {
  await send(
    to,
    "Paul shared something with you on Secure Transfer",
    `Hi ${firstName},\n\nPaul shared ${contentsWithList(hasMessage, fileNames, " with you")}\n\nIt's available until ${formatCentral(expiresAt)}.\n\nLog in to view: ${SITE_URL}\n`
  );
}

export async function sendUserInvitedEmail(to: string, firstName: string): Promise<void> {
  await send(
    to,
    "You've been added to Secure Transfer",
    `Hi ${firstName},\n\nPaul added you to Secure Transfer, a site for exchanging files and messages securely.\n\nGo to ${SITE_URL} and enter this email address to sign in — you'll get a one-time code by email, no password needed.\n`
  );
}

export async function sendUploadReadyEmail(
  to: string,
  senderName: string,
  fileNames: string[],
  hasMessage = false
): Promise<void> {
  await send(
    to,
    `New share from ${senderName} on Secure Transfer`,
    `${senderName} sent you ${contentsWithList(hasMessage, fileNames)}\n\nLog in to view: ${SITE_URL}\n`
  );
}
