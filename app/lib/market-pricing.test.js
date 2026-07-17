import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateMarketPrice } from "../services/market-pricing.server.js";

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
});
