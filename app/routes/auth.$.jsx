import { authenticate } from "../shopify.server";
import { syncShopDetails } from "../models/shop.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  await syncShopDetails({ admin, session });

  return null;
};
