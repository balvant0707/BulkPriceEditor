import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAutoReapplyInterval,
  getAutoReapplyNextRunAt,
  getConfiguredReapplyMinute,
} from "./task-auto-reapply.js";

describe("task auto reapply timing", () => {
  it("uses the configured reapply minute for the next hourly run", () => {
    const nextRunAt = getAutoReapplyNextRunAt({
      completedAt: "2026-07-14T10:45:00.000Z",
      configuration: { reapply_minute: "20" },
    });

    assert.equal(nextRunAt, "2026-07-14T11:20:00.000Z");
  });

  it("moves to the following hour when the configured minute already passed", () => {
    const nextRunAt = getAutoReapplyNextRunAt({
      completedAt: "2026-07-14T10:25:00.000Z",
      configuration: { reapplyMinute: "20" },
    });

    assert.equal(nextRunAt, "2026-07-14T11:20:00.000Z");
  });

  it("clamps invalid configured minutes", () => {
    assert.equal(
      getConfiguredReapplyMinute({ configuration: { reapply_minute: "90" } }),
      59,
    );
  });

  it("uses configured hourly intervals", () => {
    const nextRunAt = getAutoReapplyNextRunAt({
      completedAt: "2026-07-14T10:45:00.000Z",
      configuration: {
        reapply_minute: "20",
        auto_reapply_interval_unit: "hours",
        auto_reapply_interval_value: "6",
      },
    });

    assert.equal(nextRunAt, "2026-07-14T16:20:00.000Z");
  });

  it("uses configured daily intervals", () => {
    const task = {
      completedAt: "2026-07-14T10:45:00.000Z",
      configuration: {
        reapply_minute: "20",
        auto_reapply_interval_unit: "days",
        auto_reapply_interval_value: "2",
      },
    };

    assert.equal(getAutoReapplyNextRunAt(task), "2026-07-16T10:20:00.000Z");
    assert.equal(formatAutoReapplyInterval(task), "Every 2 days");
  });
});
