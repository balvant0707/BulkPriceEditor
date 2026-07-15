import { authenticate } from "../shopify.server";
import { handleWebhook } from "../lib/webhooks.server";

export const action = async ({ request }) => {
  try {
    const webhook = await authenticate.webhook(request);
    return handleWebhook(webhook);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    throw error;
  }
};
