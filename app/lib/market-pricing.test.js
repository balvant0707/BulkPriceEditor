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

        if (query.includes("priceListFixedPricesAdd")) {
          return {
            json: async () => ({
              data: {
                priceListFixedPricesAdd: {
                  prices: [
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
    assert.match(graphqlCalls[1].query, /priceListFixedPricesAdd/);
    assert.deepEqual(graphqlCalls[1].variables, {
      priceListId: "gid://shopify/PriceList/1",
      prices: [
        {
          variantId: "gid://shopify/ProductVariant/1",
          price: { amount: "15.00", currencyCode: "USD" },
        },
      ],
    });
  });

  it("sets fixed market compare-at price to the old market price for discounts", async () => {
    const graphqlCalls = [];
    const admin = {
      graphql: async (query, { variables } = {}) => {
        graphqlCalls.push({ query, variables });

        if (query.includes("priceListFixedPricesAdd")) {
          return {
            json: async () => ({
              data: {
                priceListFixedPricesAdd: {
                  prices: [
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
    assert.deepEqual(graphqlCalls[1].variables.prices[0], {
      variantId: "gid://shopify/ProductVariant/1",
      price: { amount: "200.00", currencyCode: "USD" },
      compareAtPrice: { amount: "316.35", currencyCode: "USD" },
    });
    assert.deepEqual(result.logs[0].changes, [
      "Market price: 316.35 -> 200.00",
      "Market compare at price: 427.50 -> 316.35",
    ]);
  });

  it("clears invalid fixed market compare-at prices instead of skipping price updates", async () => {
    const graphqlCalls = [];
    const admin = {
      graphql: async (query, { variables } = {}) => {
        graphqlCalls.push({ query, variables });

        if (query.includes("priceListFixedPricesAdd")) {
          return {
            json: async () => ({
              data: {
                priceListFixedPricesAdd: {
                  prices: [
                    {
                      price: { amount: "300.00", currencyCode: "USD" },
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
                      price: { amount: "285.00", currencyCode: "USD" },
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
          price: "285.00",
          compareAtPrice: "427.50",
          product: {
            id: "gid://shopify/Product/1",
            title: "Demo product",
          },
        },
      ],
      priceChange: {
        action: "set_new_value",
        amount: "300",
      },
      compareAtPriceChange: {
        action: "set_to_price",
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.updatedCount, 1);
    assert.equal(result.skippedCount, 0);
    assert.equal(result.logs[0].status, "Applied");
    assert.deepEqual(result.logs[0].errors, [
      "Compare at price was cleared because it must be greater than the sale price.",
    ]);
    assert.deepEqual(graphqlCalls[1].variables.prices[0], {
      variantId: "gid://shopify/ProductVariant/1",
      price: { amount: "300.00", currencyCode: "USD" },
      compareAtPrice: null,
    });
  });

  it("creates fixed market prices from generated price list rows", async () => {
    const graphqlCalls = [];
    const admin = {
      graphql: async (query, { variables } = {}) => {
        graphqlCalls.push({ query, variables });

        if (query.includes("priceListFixedPricesAdd")) {
          return {
            json: async () => ({
              data: {
                priceListFixedPricesAdd: {
                  prices: [
                    {
                      price: { amount: "90.00", currencyCode: "USD" },
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
                      originType: "GENERATED",
                      price: { amount: "100.00", currencyCode: "USD" },
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
          name: "Canada",
          currencyCode: "USD",
          priceListIds: ["gid://shopify/PriceList/1"],
        },
      ],
      variants: [
        {
          id: "gid://shopify/ProductVariant/1",
          title: "Default Title",
          price: "100.00",
          compareAtPrice: null,
          product: {
            id: "gid://shopify/Product/1",
            title: "Demo product",
          },
        },
      ],
      priceChange: {
        action: "decrease",
        type: "by_percent",
        percent: "10",
      },
      compareAtPriceChange: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.updatedCount, 1);
    assert.equal(result.originalMarketPrices[0].hadFixedPrice, false);
    assert.deepEqual(graphqlCalls[1].variables.prices[0], {
      variantId: "gid://shopify/ProductVariant/1",
      price: { amount: "90.00", currencyCode: "USD" },
    });
  });

  it("skips generated price list rows when fixed-only market updates are enabled", async () => {
    const graphqlCalls = [];
    const admin = {
      graphql: async (query, { variables } = {}) => {
        graphqlCalls.push({ query, variables });

        return {
          json: async () => ({
            data: {
              priceList: {
                prices: {
                  nodes: [
                    {
                      originType: "GENERATED",
                      price: { amount: "100.00", currencyCode: "USD" },
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
          name: "Canada",
          currencyCode: "USD",
          priceListIds: ["gid://shopify/PriceList/1"],
        },
      ],
      variants: [
        {
          id: "gid://shopify/ProductVariant/1",
          title: "Default Title",
          price: "100.00",
          compareAtPrice: null,
          product: {
            id: "gid://shopify/Product/1",
            title: "Demo product",
          },
        },
      ],
      priceChange: {
        action: "decrease",
        type: "by_percent",
        percent: "10",
      },
      compareAtPriceChange: {},
      applyToFixedPrices: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.updatedCount, 0);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.logs[0].status, "Skipped");
    assert.equal(graphqlCalls.length, 1);
  });

  it("marks market logs failed when Shopify rejects fixed price writes", async () => {
    const graphqlCalls = [];
    const admin = {
      graphql: async (query, { variables } = {}) => {
        graphqlCalls.push({ query, variables });

        if (query.includes("priceListFixedPricesAdd")) {
          return {
            json: async () => ({
              data: {
                priceListFixedPricesAdd: {
                  prices: [],
                  userErrors: [
                    {
                      field: ["prices", "0", "price"],
                      code: "INVALID",
                      message: "Price list price is invalid.",
                    },
                  ],
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
                      price: { amount: "285.00", currencyCode: "USD" },
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
          price: "285.00",
          compareAtPrice: null,
          product: {
            id: "gid://shopify/Product/1",
            title: "Demo product",
          },
        },
      ],
      priceChange: {
        action: "set_new_value",
        amount: "333",
      },
      compareAtPriceChange: {},
    });

    assert.equal(result.ok, false);
    assert.equal(result.updatedCount, 0);
    assert.equal(result.logs[0].status, "Failed");
    assert.match(result.logs[0].errors[0], /Price list price is invalid/);
  });

  it("verifies selected market storefront pricing with product contextual pricing", async () => {
    const graphqlCalls = [];
    const admin = {
      graphql: async (query, { variables } = {}) => {
        graphqlCalls.push({ query, variables });

        if (query.includes("contextualPricing")) {
          return {
            json: async () => ({
              data: {
                productVariant: {
                  id: variables.id,
                  contextualPricing: {
                    price: { amount: "333.00", currencyCode: "USD" },
                    compareAtPrice: null,
                  },
                },
              },
            }),
          };
        }

        if (query.includes("priceListFixedPricesAdd")) {
          return {
            json: async () => ({
              data: {
                priceListFixedPricesAdd: {
                  prices: [
                    {
                      price: { amount: "333.00", currencyCode: "USD" },
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
                      price: { amount: "285.00", currencyCode: "USD" },
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
      ownerType: "sale",
      ownerId: 1,
      shop: "demo.myshopify.com",
      markets: [
        {
          id: "gid://shopify/Market/1",
          name: "Canada",
          currencyCode: "USD",
          regions: [{ name: "Canada", code: "CA" }],
          priceListIds: ["gid://shopify/PriceList/1"],
        },
      ],
      variants: [
        {
          id: "gid://shopify/ProductVariant/1",
          title: "Default Title",
          price: "285.00",
          compareAtPrice: null,
          product: {
            id: "gid://shopify/Product/1",
            title: "Demo product",
          },
        },
      ],
      priceChange: {
        action: "set_new_value",
        amount: "333",
      },
      compareAtPriceChange: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.logs[0].status, "Applied");
    assert.match(graphqlCalls[2].query, /contextualPricing/);
    assert.deepEqual(graphqlCalls[2].variables, {
      id: "gid://shopify/ProductVariant/1",
      country: "CA",
    });
  });
});
