import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAutoReapplyInterval,
  getAutoReapplyNextRunAt,
  getConfiguredReapplyMinute,
} from "./task-auto-reapply.js";

describe("task auto reapply timing", () => {
  it("uses the selected interval for the next default hourly run", () => {
    const nextRunAt = getAutoReapplyNextRunAt({
      completedAt: "2026-07-14T10:45:00.000Z",
      configuration: { reapply_minute: "20" },
    });

    assert.equal(nextRunAt, "2026-07-14T11:45:00.000Z");
  });

  it("does not snap interval runs to the configured reapply minute", () => {
    const nextRunAt = getAutoReapplyNextRunAt({
      completedAt: "2026-07-14T10:25:00.000Z",
      configuration: { reapplyMinute: "20" },
    });

    assert.equal(nextRunAt, "2026-07-14T11:25:00.000Z");
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

    assert.equal(nextRunAt, "2026-07-14T16:45:00.000Z");
  });

  it("uses configured minute intervals", () => {
    const task = {
      completedAt: "2026-07-14T10:45:00.000Z",
      configuration: {
        reapply_minute: "20",
        auto_reapply_interval_unit: "minutes",
        auto_reapply_interval_value: "30",
      },
    };

    assert.equal(getAutoReapplyNextRunAt(task), "2026-07-14T11:15:00.000Z");
    assert.equal(formatAutoReapplyInterval(task), "Every 30 minutes");
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

    assert.equal(getAutoReapplyNextRunAt(task), "2026-07-16T10:45:00.000Z");
    assert.equal(formatAutoReapplyInterval(task), "Every 2 days");
  });
});
