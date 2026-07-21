import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateMarketPrice,
  updateMarketPrices,
} from "../services/market-pricing.server.js";

describe("market pricing calculations", () => {
  it("uses cost per item as a relative base for market prices", () => {
    const price = calculateMarketPrice(
      "100.00",
      {
        price: "100.00",
        compareAtPrice: "150.00",
        inventoryItem: {
          unitCost: { amount: "40.00" },
        },
      },
      {
        action: "increase",
        type: "by_percent",
        percent: "25",
        relativeTo: "cost_per_item",
      },
    );

    assert.equal(price, "50.00");
  });

  it("can calculate compare-at price from a blank market value using product price fallback", () => {
    const compareAtPrice = calculateMarketPrice(
      null,
      {
        price: "80.00",
        compareAtPrice: null,
      },
      {
        action: "increase",
        type: "by_amount",
        amount: "20",
      },
      { fallbackBase: "80.00" },
    );

    assert.equal(compareAtPrice, "100.00");
  });

  it("updates product variant prices when a selected market has no price list", async () => {
    const graphqlCalls = [];
    const admin = {
      graphql: async (query, { variables } = {}) => {
        graphqlCalls.push({ query, variables });

        return {
          json: async () => ({
            data: {
              productVariantsBulkUpdate: {
                productVariants: [{ id: "gid://shopify/ProductVariant/1" }],
                userErrors: [],
              },
            },
          }),
        };
      },
    };

    const result = await updateMarketPrices({
      admin,
      ownerType: "task",
      ownerId: 1,
      shop: "demo.myshopify.com",
      markets: [{ id: "gid://shopify/Market/1", name: "Primary", currencyCode: "USD" }],
      variants: [
        {
          id: "gid://shopify/ProductVariant/1",
          title: "Default Title",
          price: "10.00",
          compareAtPrice: null,
          product: {
            id: "gid://shopify/Product/1",
            title: "Demo product",
          },
        },
      ],
      priceChange: {
        action: "increase",
        type: "by_amount",
        amount: "5",
      },
      compareAtPriceChange: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.updatedCount, 1);
    assert.equal(result.originalVariants.length, 1);
    assert.equal(result.originalVariants[0].price, "10.00");
    assert.equal(result.originalVariants[0].nextPrice, "15.00");
    assert.equal(graphqlCalls.length, 1);
    assert.match(graphqlCalls[0].query, /productVariantsBulkUpdate/);
    assert.deepEqual(graphqlCalls[0].variables, {
      productId: "gid://shopify/Product/1",
      variants: [{ id: "gid://shopify/ProductVariant/1", price: "15.00" }],
    });
  });

  it("updates fixed market prices through the price list update mutation", async () => {
    const graphqlCalls = [];
    const admin = {
      graphql: async (query, { variables } = {}) => {
        graphqlCalls.push({ query, variables });

        if (query.includes("priceListFixedPricesUpdate")) {
          return {
            json: async () => ({
              data: {
                priceListFixedPricesUpdate: {
                  pricesAdded: [
                    {
                      price: { amount: "15.00", currencyCode: "USD" },
                      compareAtPrice: null,
                    },
                  ],
                  userErrors: [],
                },
              },
            }),
          };
        }

        return {
          json: async () => ({
            data: {
              priceList: {
                prices: {
                  nodes: [
                    {
                      originType: "FIXED",
                      price: { amount: "10.00", currencyCode: "USD" },
                      compareAtPrice: null,
                      variant: { id: "gid://shopify/ProductVariant/1" },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          }),
        };
      },
    };

    const result = await updateMarketPrices({
      admin,
      ownerType: "task",
      ownerId: 1,
      shop: "demo.myshopify.com",
      markets: [
        {
          id: "gid://shopify/Market/1",
          name: "United States",
          currencyCode: "USD",
          priceListIds: ["gid://shopify/PriceList/1"],
        },
      ],
      variants: [
        {
          id: "gid://shopify/ProductVariant/1",
          title: "Default Title",
          price: "10.00",
          compareAtPrice: null,
          product: {
            id: "gid://shopify/Product/1",
            title: "Demo product",
          },
        },
      ],
      priceChange: {
        action: "increase",
        type: "by_amount",
        amount: "5",
      },
      compareAtPriceChange: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.updatedCount, 1);
    assert.equal(result.originalMarketPrices.length, 1);
    assert.equal(result.originalMarketPrices[0].price, "10.00");
    assert.equal(result.originalMarketPrices[0].nextPrice, "15.00");
    assert.equal(graphqlCalls.length, 2);
    assert.match(graphqlCalls[1].query, /priceListFixedPricesUpdate/);
    assert.deepEqual(graphqlCalls[1].variables, {
      priceListId: "gid://shopify/PriceList/1",
      pricesToAdd: [
        {
          variantId: "gid://shopify/ProductVariant/1",
          price: { amount: "15.00", currencyCode: "USD" },
        },
      ],
      variantIdsToDelete: [],
    });
  });

  it("sets fixed market compare-at price to the old market price for discounts", async () => {
    const graphqlCalls = [];
    const admin = {
      graphql: async (query, { variables } = {}) => {
        graphqlCalls.push({ query, variables });

        if (query.includes("priceListFixedPricesUpdate")) {
          return {
            json: async () => ({
              data: {
                priceListFixedPricesUpdate: {
                  pricesAdded: [
                    {
                      price: { amount: "200.00", currencyCode: "USD" },
                      compareAtPrice: { amount: "316.35", currencyCode: "USD" },
                    },
                  ],
                  userErrors: [],
                },
              },
            }),
          };
        }

        return {
          json: async () => ({
            data: {
              priceList: {
                prices: {
                  nodes: [
                    {
                      originType: "FIXED",
                      price: { amount: "316.35", currencyCode: "USD" },
                      compareAtPrice: { amount: "427.50", currencyCode: "USD" },
                      variant: { id: "gid://shopify/ProductVariant/1" },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          }),
        };
      },
    };

    const result = await updateMarketPrices({
      admin,
      ownerType: "sale",
      ownerId: 1,
      shop: "demo.myshopify.com",
      markets: [
        {
          id: "gid://shopify/Market/1",
          name: "Canada",
          currencyCode: "USD",
          priceListIds: ["gid://shopify/PriceList/1"],
        },
      ],
      variants: [
        {
          id: "gid://shopify/ProductVariant/1",
          title: "Default Title",
          price: "316.35",
          compareAtPrice: "427.50",
          product: {
            id: "gid://shopify/Product/1",
            title: "Demo product",
          },
        },
      ],
      priceChange: {
        action: "set_new_value",
        amount: "200",
      },
      compareAtPriceChange: {
        action: "set_to_price",
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(graphqlCalls[1].variables.pricesToAdd[0], {
      variantId: "gid://shopify/ProductVariant/1",
      price: { amount: "200.00", currencyCode: "USD" },
      compareAtPrice: { amount: "316.35", currencyCode: "USD" },
    });
    assert.deepEqual(result.logs[0].changes, [
      "Market price: 316.35 -> 200.00",
      "Market compare at price: 427.50 -> 316.35",
    ]);
  });
});
