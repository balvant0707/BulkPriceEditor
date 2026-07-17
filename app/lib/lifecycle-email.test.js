import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import nodemailer from "nodemailer";
import { sendAppInstalledEmails, sendAppUninstalledEmails } from "../emails/mail.server.js";

const originalFetch = globalThis.fetch;
const originalEnv = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  MAIL_FROM: process.env.MAIL_FROM,
  APP_OWNER_EMAIL: process.env.APP_OWNER_EMAIL,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_SECURE: process.env.SMTP_SECURE,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
};

afterEach(() => {
  mock.restoreAll();
  globalThis.fetch = originalFetch;
  restoreEnv("RESEND_API_KEY", originalEnv.RESEND_API_KEY);
  restoreEnv("MAIL_FROM", originalEnv.MAIL_FROM);
  restoreEnv("APP_OWNER_EMAIL", originalEnv.APP_OWNER_EMAIL);
  restoreEnv("SMTP_HOST", originalEnv.SMTP_HOST);
  restoreEnv("SMTP_PORT", originalEnv.SMTP_PORT);
  restoreEnv("SMTP_SECURE", originalEnv.SMTP_SECURE);
  restoreEnv("SMTP_USER", originalEnv.SMTP_USER);
  restoreEnv("SMTP_PASS", originalEnv.SMTP_PASS);
  restoreEnv("SMTP_FROM", originalEnv.SMTP_FROM);
});

describe("lifecycle emails", () => {
  it("sends install emails to the customer and app owner", async () => {
    const sentEmails = mockEmailDelivery();

    await sendAppInstalledEmails({
      shop: "demo-shop.myshopify.com",
      name: "Demo Shop",
      email: "merchant@example.com",
    });

    assert.deepEqual(
      sentEmails.map((email) => email.to).sort(),
      ["owner@example.com", "merchant@example.com"].sort(),
    );
    assert.equal(
      sentEmails.find((email) => email.to === "merchant@example.com").subject,
      "Bulk Price Editor installed for Demo Shop",
    );
    assert.equal(
      sentEmails.find((email) => email.to === "owner@example.com").subject,
      "App installed: Demo Shop",
    );
  });

  it("sends uninstall emails to the customer and app owner", async () => {
    const sentEmails = mockEmailDelivery();

    await sendAppUninstalledEmails({
      shop: "demo-shop.myshopify.com",
      name: "Demo Shop",
      contactEmail: "merchant@example.com",
    });

    assert.deepEqual(
      sentEmails.map((email) => email.to).sort(),
      ["owner@example.com", "merchant@example.com"].sort(),
    );
    assert.equal(
      sentEmails.find((email) => email.to === "merchant@example.com").subject,
      "Bulk Price Editor uninstalled for Demo Shop",
    );
    assert.equal(
      sentEmails.find((email) => email.to === "owner@example.com").subject,
      "App uninstalled: Demo Shop",
    );
  });

  it("sends lifecycle emails through SMTP when RESEND_API_KEY is missing", async () => {
    const sentEmails = mockSmtpDelivery();

    await sendAppInstalledEmails({
      shop: "demo-shop.myshopify.com",
      name: "Demo Shop",
      email: "merchant@example.com",
    });

    assert.deepEqual(
      sentEmails.map((email) => email.to).sort(),
      ["owner@example.com", "merchant@example.com"].sort(),
    );
    assert.equal(sentEmails[0].from, "Bulk Price Editor <smtp@example.com>");
  });
});

function mockEmailDelivery() {
  process.env.RESEND_API_KEY = "test-api-key";
  process.env.MAIL_FROM = "Bulk Price Editor <app@example.com>";
  process.env.APP_OWNER_EMAIL = "owner@example.com";

  const sentEmails = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer test-api-key");
    sentEmails.push(JSON.parse(options.body));

    return {
      ok: true,
      json: async () => ({ id: `email-${sentEmails.length}` }),
    };
  };

  return sentEmails;
}

function mockSmtpDelivery() {
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_SECURE = "true";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass";
  process.env.SMTP_FROM = "Bulk Price Editor <smtp@example.com>";
  process.env.APP_OWNER_EMAIL = "owner@example.com";

  const sentEmails = [];
  mock.method(nodemailer, "createTransport", (options) => {
    assert.deepEqual(options, {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "smtp-user", pass: "smtp-pass" },
    });

    return {
      sendMail: async (email) => {
        sentEmails.push(email);
        return { messageId: `smtp-${sentEmails.length}` };
      },
    };
  });

  return sentEmails;
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
