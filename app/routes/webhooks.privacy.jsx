import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  const normalizedTopic = normalizeTopic(topic);
  const shopDomain = shop || payload?.shop_domain;

  console.log(`Received privacy compliance webhook ${topic} for ${shopDomain}`);

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

  console.log(`Unknown privacy webhook topic ${topic} for ${shopDomain}`);
  return new Response(null, { status: 200 });
};

function normalizeTopic(topic) {
  const value = String(topic || "").toLowerCase();

  if (value.includes("customers") && value.includes("data")) {
    return "customers/data_request";
  }

  if (value.includes("customers") && value.includes("redact")) {
    return "customers/redact";
  }

  if (value.includes("shop") && value.includes("redact")) {
    return "shop/redact";
  }

  return value;
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
