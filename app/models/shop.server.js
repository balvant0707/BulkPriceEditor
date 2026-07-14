import db from "../db.server";

const SHOP_DETAILS_QUERY = `#graphql
  query ShopDetails {
    shop {
      name
      email
      contactEmail
      currencyCode
      myshopifyDomain
      shopOwnerName
      primaryDomain {
        url
      }
      plan {
        displayName
      }
    }
  }
`;

export async function syncShopDetails({ admin, session }) {
  if (!admin || !session?.shop) {
    return null;
  }

  const existingShop = await db.shop.findUnique({
    where: { shop: session.shop },
  });

  await db.shop.upsert({
    where: { shop: session.shop },
    create: {
      shop: session.shop,
      accessToken: session.accessToken,
      installed: true,
      status: "installed",
      onboardedAt: new Date(),
      uninstalledAt: null,
    },
    update: {
      accessToken: session.accessToken,
      installed: true,
      status: "installed",
      uninstalledAt: null,
    },
  });

  let shopDetails;

  try {
    const response = await admin.graphql(SHOP_DETAILS_QUERY);
    const responseJson = await response.json();
    shopDetails = responseJson.data?.shop;
  } catch (error) {
    console.error(`Unable to load Shopify shop details for ${session.shop}`, error);
    return {
      shop: existingShop || { shop: session.shop, accessToken: session.accessToken },
      wasInstalled: !existingShop?.installed,
    };
  }

  if (!shopDetails) {
    console.error(`Shopify shop details response was empty for ${session.shop}`);
    return {
      shop: existingShop || { shop: session.shop, accessToken: session.accessToken },
      wasInstalled: !existingShop?.installed,
    };
  }

  const data = {
    accessToken: session.accessToken,
    installed: true,
    status: "installed",
    ownerName: shopDetails.shopOwnerName,
    email: shopDetails.email,
    contactEmail: shopDetails.contactEmail,
    name: shopDetails.name,
    currency: shopDetails.currencyCode,
    primaryDomain: shopDetails.primaryDomain?.url ?? shopDetails.myshopifyDomain,
    plan: shopDetails.plan?.displayName,
    uninstalledAt: null,
  };

  const shop = await db.shop.upsert({
    where: { shop: session.shop },
    create: {
      shop: session.shop,
      ...data,
      onboardedAt: new Date(),
    },
    update: data,
  });

  return {
    shop,
    wasInstalled: !existingShop?.installed,
  };
}

export async function markShopUninstalled(shop) {
  if (!shop) {
    return null;
  }

  const existingShop = await db.shop.findUnique({
    where: { shop },
  });

  const updatedShop = await db.shop.upsert({
    where: { shop },
    create: {
      shop,
      installed: false,
      status: "uninstalled",
      uninstalledAt: new Date(),
    },
    update: {
      accessToken: null,
      installed: false,
      status: "uninstalled",
      uninstalledAt: new Date(),
    },
  });

  return {
    shop: updatedShop,
    previousShop: existingShop,
    wasUninstalled: Boolean(existingShop?.installed),
  };
}
