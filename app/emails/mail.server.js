import {
  appInstalledOwnerTemplate,
  appInstalledUserTemplate,
  appUninstalledOwnerTemplate,
  appUninstalledUserTemplate,
} from "./templates/lifecycle";

const RESEND_API_URL = "https://api.resend.com/emails";

function getSender() {
  return process.env.MAIL_FROM || process.env.RESEND_FROM_EMAIL || "";
}

function getOwnerEmail() {
  return process.env.APP_OWNER_EMAIL || process.env.OWNER_EMAIL || "";
}

function getShopRecipient(shop) {
  return shop?.contactEmail || shop?.email || "";
}

function uniqueEmails(emails) {
  return Array.from(
    new Set(
      emails
        .map((email) => String(email || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = getSender();

  if (!apiKey || !from || !to) {
    console.log("Email skipped because RESEND_API_KEY, MAIL_FROM, or recipient is missing.", {
      hasApiKey: Boolean(apiKey),
      hasFrom: Boolean(from),
      hasTo: Boolean(to),
      subject,
    });
    return { skipped: true };
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Unable to send email: ${response.status} ${body}`);
  }

  return response.json();
}

async function sendLifecycleEmails(shop, templates) {
  const shopRecipient = getShopRecipient(shop);
  const ownerRecipient = getOwnerEmail();
  const recipients = uniqueEmails([shopRecipient, ownerRecipient]);

  const results = [];
  for (const recipient of recipients) {
    const template =
      recipient === String(ownerRecipient || "").trim().toLowerCase()
        ? templates.owner(shop)
        : templates.user(shop);

    try {
      results.push(await sendEmail({ to: recipient, ...template }));
    } catch (error) {
      console.error(`Failed to send lifecycle email to ${recipient}`, error);
      results.push({ ok: false, recipient, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return results;
}

export async function sendAppInstalledEmails(shop) {
  return sendLifecycleEmails(shop, {
    user: appInstalledUserTemplate,
    owner: appInstalledOwnerTemplate,
  });
}

export async function sendAppUninstalledEmails(shop) {
  return sendLifecycleEmails(shop, {
    user: appUninstalledUserTemplate,
    owner: appUninstalledOwnerTemplate,
  });
}
