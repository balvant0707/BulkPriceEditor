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
        publicDisplayName
      }
      shopAddress {
        country
        city
        phone
      }
    }
  }
`;

export async function syncShopDetails({ admin, session }) {
  if (!admin || !session?.shop) {
    return;
  }

  const response = await admin.graphql(SHOP_DETAILS_QUERY);
  const responseJson = await response.json();
  const shopDetails = responseJson.data?.shop;

  if (!shopDetails) {
    throw new Error(`Unable to load Shopify shop details for ${session.shop}`);
  }

  const data = {
    accessToken: session.accessToken,
    installed: true,
    status: "installed",
    ownerName: shopDetails.shopOwnerName,
    email: shopDetails.email,
    contactEmail: shopDetails.contactEmail,
    name: shopDetails.name,
    country: shopDetails.shopAddress?.country,
    city: shopDetails.shopAddress?.city,
    currency: shopDetails.currencyCode,
    phone: shopDetails.shopAddress?.phone,
    primaryDomain: shopDetails.primaryDomain?.url ?? shopDetails.myshopifyDomain,
    plan: shopDetails.plan?.publicDisplayName,
    uninstalledAt: null,
  };

  await db.shop.upsert({
    where: { shop: session.shop },
    create: {
      shop: session.shop,
      ...data,
      onboardedAt: new Date(),
    },
    update: data,
  });
}

export async function markShopUninstalled(shop) {
  if (!shop) {
    return;
  }

  await db.shop.upsert({
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
}
