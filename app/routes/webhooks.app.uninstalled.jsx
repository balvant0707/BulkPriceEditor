import { authenticate } from "../shopify.server";
import { handleWebhook } from "../lib/webhooks.server";

export const action = async ({ request }) => {
  const webhook = await authenticate.webhook(request);
  return handleWebhook(webhook);
};
