-- AlterTable
ALTER TABLE `sale`
  ADD COLUMN `executionSummary` JSON NULL,
  ADD COLUMN `startedAt` DATETIME(3) NULL,
  ADD COLUMN `completedAt` DATETIME(3) NULL;
