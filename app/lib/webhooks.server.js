import db from "../db.server";
import { sendAppUninstalledEmails } from "../emails/mail.server";
import { markShopUninstalled } from "../models/shop.server";

export async function handleWebhook(webhook) {
  try {
    await processWebhook(webhook);
  } catch (error) {
    console.error("Webhook processing failed.", {
      topic: webhook?.topic,
      shop: webhook?.shop || webhook?.payload?.shop_domain,
      webhookId: webhook?.webhookId,
      error,
    });
  }

  return new Response(null, { status: 200 });
}

async function processWebhook({ payload, session, shop, topic, webhookId }) {
  const normalizedTopic = normalizeWebhookTopic(topic);
  const shopDomain = shop || payload?.shop_domain;

  console.log(`Received ${topic} webhook for ${shopDomain}`, { webhookId });

  if (normalizedTopic === "app/scopes_update") {
    if (session && payload?.current) {
      await db.session.update({
        where: { id: session.id },
        data: { scope: payload.current.toString() },
      });
    }

    return;
  }

  if (normalizedTopic === "app/uninstalled") {
    const uninstallResult = await markShopUninstalled(shopDomain);

    if (uninstallResult?.wasUninstalled) {
      await sendAppUninstalledEmails(uninstallResult.previousShop || uninstallResult.shop);
    }

    if (session) {
      await db.session.deleteMany({ where: { shop: shopDomain } });
    }

    return;
  }

  if (normalizedTopic === "orders/create") {
    console.log("Order create webhook received.", {
      shop: shopDomain,
      orderId: payload?.id,
      adminGraphqlApiId: payload?.admin_graphql_api_id,
    });

    return;
  }

  if (normalizedTopic === "customers/data_request") {
    await handleCustomerDataRequest({ payload, shop: shopDomain, webhookId });
    return;
  }

  if (normalizedTopic === "customers/redact") {
    await handleCustomerRedact({ payload, shop: shopDomain, webhookId });
    return;
  }

  if (normalizedTopic === "shop/redact") {
    await handleShopRedact({ payload, shop: shopDomain, webhookId });
    return;
  }

  console.log(`Unhandled webhook topic ${topic} for ${shopDomain}`);
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

async function handleCustomerDataRequest({ payload, shop, webhookId }) {
  const customer = payload?.customer || {};
  const customerId = customer.id ? String(customer.id) : null;
  const customerEmail = customer.email ? String(customer.email) : null;
  const orderIds = Array.isArray(payload?.orders_requested)
    ? payload.orders_requested.map((orderId) => String(orderId))
    : [];

  console.log("Customer data request received.", {
    shop,
    webhookId,
    customerId,
    customerEmail,
    dataRequestId: payload?.data_request?.id,
    orderIds,
  });

  const exportData = await fetchCustomerRelatedDataForExport({
    shop,
    customerId,
    customerEmail,
    orderIds,
  });

  // TODO: Serialize exportData into the format required by your privacy
  // workflow and deliver it to the merchant/customer through your approved
  // business process. Shopify requires the request to be completed separately
  // from the webhook acknowledgement.
  console.log("Prepared customer data export.", {
    shop,
    webhookId,
    customerId,
    dataRequestId: payload?.data_request?.id,
    recordGroups: Object.keys(exportData),
  });
}

async function handleCustomerRedact({ payload, shop, webhookId }) {
  const customer = payload?.customer || {};
  const customerId = customer.id ? String(customer.id) : null;
  const customerEmail = customer.email ? String(customer.email) : null;
  const orderIds = Array.isArray(payload?.orders_to_redact)
    ? payload.orders_to_redact.map((orderId) => String(orderId))
    : [];

  console.log("Customer redact request received.", {
    shop,
    webhookId,
    customerId,
    customerEmail,
    orderIds,
  });

  await redactCustomerData({ shop, customerId, customerEmail, orderIds });

  console.log("Customer personal data redaction completed.", {
    shop,
    webhookId,
    customerId,
  });
}

async function handleShopRedact({ payload, shop, webhookId }) {
  const shopDomain = shop || payload?.shop_domain;
  await redactShopData(shopDomain);
  console.log("Shop redaction completed.", {
    shop: shopDomain,
    webhookId,
    shopId: payload?.shop_id,
  });
}

async function fetchCustomerRelatedDataForExport({
  shop,
  customerId,
  customerEmail,
  orderIds,
}) {
  // The current schema stores shop/product/task/sale data and does not define a
  // customer-owned table. Keep this shape explicit so future tables can be added
  // without changing the webhook contract.
  const data = {
    customer: {
      id: customerId,
      email: customerEmail,
      requestedOrderIds: orderIds,
    },
    records: {},
  };

  // TODO: Query custom customer tables by shop + customerId/customerEmail.
  // TODO: Query order-scoped tables by shop + orderIds when order data is stored.
  // TODO: Include customer metafields or customer-linked app records if this app
  // adds them later.

  return data;
}

async function redactCustomerData({ shop, customerId, customerEmail, orderIds }) {
  if (!shop) {
    console.error("Unable to redact customer data because shop domain is missing.");
    return;
  }

  // The current app schema does not persist customer PII. Keep aggregate
  // task/report analytics because they are product/shop-scoped, not customer
  // records. If future analytics can identify a customer, anonymize or delete
  // them here.
  console.log("No customer-owned records found in the current Prisma schema.", {
    shop,
    customerId,
    customerEmail,
    orderIds,
  });

  // TODO: Delete or anonymize custom customer profile tables.
  // TODO: Delete or anonymize order/customer lookup tables using orderIds.
  // TODO: Delete customer metafields or customer-linked app records.
  // TODO: Keep only non-personal aggregate analytics when legally allowed.
}

async function redactShopData(shop) {
  if (!shop) {
    console.error("Unable to redact shop data because shop domain is missing.");
    return;
  }

  // Delete all current shop-scoped data owned by this app: product report cache,
  // audit logs, tasks, sales, settings, sessions, and shop metadata.
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

  // TODO: Delete products cache tables if added outside ProductReport/ProductReportRow.
  // TODO: Delete application logs if persisted in custom tables.
  // TODO: Delete Shopify metafields/metaobjects created by the app if tracked locally
  // or enqueue Admin API cleanup where legally/technically required.
  // TODO: Delete any app-specific records added after this implementation.

  console.log(`Redacted all shop-scoped app data for ${shop}.`);
}
