import { authenticate } from "../shopify.server";
import db from "../db.server";
import { markShopUninstalled } from "../models/shop.server";
import { sendAppUninstalledEmails } from "../emails/mail.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  const uninstallResult = await markShopUninstalled(shop);

  if (uninstallResult?.wasUninstalled) {
    await sendAppUninstalledEmails(uninstallResult.previousShop || uninstallResult.shop);
  }

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
