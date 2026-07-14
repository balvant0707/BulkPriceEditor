import { handleWebhook } from "../lib/webhooks.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const webhook = await authenticate.webhook(request);
  return handleWebhook(webhook);
};
