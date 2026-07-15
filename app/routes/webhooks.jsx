import { handleWebhook } from "../lib/webhooks.server";
import { authenticate } from "../shopify.server";

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
