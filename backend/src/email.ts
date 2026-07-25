import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const FROM_EMAIL = process.env.FROM_EMAIL!;
const SITE_URL = process.env.SITE_URL!;

const ses = new SESv2Client({});

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
  fileCount: number,
  expiresAt: string
): Promise<void> {
  const fileWord = fileCount === 1 ? "file" : "files";
  await send(
    to,
    "Files shared with you on Secure Transfer",
    `Hi ${firstName},\n\nPaul shared ${fileCount} ${fileWord} with you. They're available until ${expiresAt}.\n\nLog in to download: ${SITE_URL}\n`
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
  fileCount: number
): Promise<void> {
  const fileWord = fileCount === 1 ? "file" : "files";
  await send(
    to,
    "New files uploaded on Secure Transfer",
    `${senderName} uploaded ${fileCount} ${fileWord} for you.\n\nLog in to download: ${SITE_URL}\n`
  );
}
