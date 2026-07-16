import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  BillingReplacementBehavior,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { syncShopDetails } from "./models/shop.server";
import { sendAppInstalledEmails } from "./emails/mail.server";
import { PRICING_PLANS } from "./lib/pricing-plans";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  hooks: {
    afterAuth: async ({ admin, session }) => {
      const syncResult = await syncShopDetails({ admin, session });

      if (syncResult?.wasInstalled) {
        await sendAppInstalledEmails(syncResult.shop);
      }
    },
  },
  billing: {
    [PRICING_PLANS.basicMonthly]: {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      lineItems: [
        {
          amount: 9.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [PRICING_PLANS.advancedMonthly]: {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      lineItems: [
        {
          amount: 14.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [PRICING_PLANS.premiumMonthly]: {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      lineItems: [
        {
          amount: 24.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [PRICING_PLANS.basicYearly]: {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      lineItems: [
        {
          amount: 89,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
    },
    [PRICING_PLANS.advancedYearly]: {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      lineItems: [
        {
          amount: 134,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
    },
    [PRICING_PLANS.premiumYearly]: {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      lineItems: [
        {
          amount: 224,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
    },
  },
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.April26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
