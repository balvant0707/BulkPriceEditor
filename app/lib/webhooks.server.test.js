import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeScopePayload } from "./webhook-utils.js";

describe("webhook scope payload normalization", () => {
  it("normalizes comma-separated scope strings", () => {
    assert.equal(
      normalizeScopePayload("read_products, write_products,read_markets"),
      "read_products,write_products,read_markets",
    );
  });

  it("normalizes scope objects from app scopes update webhooks", () => {
    assert.equal(
      normalizeScopePayload([
        { handle: "read_products" },
        { handle: "write_markets" },
        { name: "read_markets" },
      ]),
      "read_products,write_markets,read_markets",
    );
  });
});
