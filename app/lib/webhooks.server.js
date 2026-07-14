import db from "../db.server";
import { sendAppUninstalledEmails } from "../emails/mail.server";
import { markShopUninstalled } from "../models/shop.server";

export async function handleWebhook({ payload, session, shop, topic }) {
  const normalizedTopic = normalizeWebhookTopic(topic);
  const shopDomain = shop || payload?.shop_domain;

  console.log(`Received ${topic} webhook for ${shopDomain}`);

  if (normalizedTopic === "app/scopes_update") {
    if (session && payload?.current) {
      await db.session.update({
        where: { id: session.id },
        data: { scope: payload.current.toString() },
      });
    }

    return new Response(null, { status: 200 });
  }

  if (normalizedTopic === "app/uninstalled") {
    const uninstallResult = await markShopUninstalled(shopDomain);

    if (uninstallResult?.wasUninstalled) {
      await sendAppUninstalledEmails(uninstallResult.previousShop || uninstallResult.shop);
    }

    if (session) {
      await db.session.deleteMany({ where: { shop: shopDomain } });
    }

    return new Response(null, { status: 200 });
  }

  if (normalizedTopic === "orders/create") {
    console.log("Order create webhook received.", {
      shop: shopDomain,
      orderId: payload?.id,
      adminGraphqlApiId: payload?.admin_graphql_api_id,
    });

    return new Response(null, { status: 200 });
  }

  if (normalizedTopic === "customers/data_request") {
    console.log("Customer data request received. No customer records are stored by this app.", {
      shop: shopDomain,
      customerId: payload?.customer?.id,
      dataRequestId: payload?.data_request?.id,
    });

    return new Response(null, { status: 200 });
  }

  if (normalizedTopic === "customers/redact") {
    console.log("Customer redact request received. No customer records are stored by this app.", {
      shop: shopDomain,
      customerId: payload?.customer?.id,
    });

    return new Response(null, { status: 200 });
  }

  if (normalizedTopic === "shop/redact") {
    await redactShopData(shopDomain);
    return new Response(null, { status: 200 });
  }

  console.log(`Unhandled webhook topic ${topic} for ${shopDomain}`);
  return new Response(null, { status: 200 });
}

export function normalizeWebhookTopic(topic) {
  const value = String(topic || "").toLowerCase();

  if (value.includes("app") && value.includes("scopes")) {
    return "app/scopes_update";
  }

  if (value.includes("app") && value.includes("uninstalled")) {
    return "app/uninstalled";
  }

  if (value.includes("orders") && value.includes("create")) {
    return "orders/create";
  }

  if (value.includes("customers") && value.includes("data")) {
    return "customers/data_request";
  }

  if (value.includes("customers") && value.includes("redact")) {
    return "customers/redact";
  }

  if (value.includes("shop") && value.includes("redact")) {
    return "shop/redact";
  }

  return value.replace(/_/g, "/");
}

async function redactShopData(shop) {
  if (!shop) {
    console.error("Unable to redact shop data because shop domain is missing.");
    return;
  }

  await db.$transaction([
    db.productReportRow.deleteMany({ where: { shop } }),
    db.productReport.deleteMany({ where: { shop } }),
    db.taskAuditLog.deleteMany({ where: { shop } }),
    db.task.deleteMany({ where: { shop } }),
    db.sale.deleteMany({ where: { shop } }),
    db.priceEditorSetting.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
    db.shop.deleteMany({ where: { shop } }),
  ]);

  console.log(`Redacted all shop-scoped app data for ${shop}.`);
}
