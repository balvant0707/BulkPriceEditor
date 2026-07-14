import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SALE_STATUS,
  canRollbackSale,
  getSaleStatusDisplay,
  normalizeSaleStatus,
} from "./sale-status.js";

describe("sale status display", () => {
  it("normalizes legacy sale statuses", () => {
    assert.equal(normalizeSaleStatus("activating"), SALE_STATUS.APPLYING);
    assert.equal(normalizeSaleStatus("active"), SALE_STATUS.COMPLETED);
    assert.equal(normalizeSaleStatus("ended"), SALE_STATUS.CANCELED);
  });

  it("shows a spinner without progress for pending sales", () => {
    const display = getSaleStatusDisplay({
      status: SALE_STATUS.PENDING,
      executionSummary: { progress: 0 },
    });

    assert.equal(display.label, "Pending");
    assert.equal(display.showSpinner, true);
    assert.equal(display.showProgress, false);
    assert.equal(display.progress, 0);
  });

  it("shows progress for applying and canceling sales", () => {
    assert.deepEqual(
      {
        applying: getSaleStatusDisplay({
          status: SALE_STATUS.APPLYING,
          executionSummary: { progress: 42 },
        }).progress,
        canceling: getSaleStatusDisplay({
          status: SALE_STATUS.CANCELING,
          executionSummary: { progress: 73 },
        }).progress,
      },
      { applying: 42, canceling: 73 },
    );
  });

  it("allows rollback only when completed sale originals are available", () => {
    assert.equal(
      canRollbackSale({
        status: SALE_STATUS.COMPLETED,
        executionSummary: { originalVariants: [] },
      }),
      true,
    );
    assert.equal(canRollbackSale({ status: SALE_STATUS.COMPLETED }), false);
  });
});
