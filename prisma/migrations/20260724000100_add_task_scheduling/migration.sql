ALTER TABLE `task`
  ADD COLUMN `isScheduled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `scheduleEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `startDate` DATE NULL,
  ADD COLUMN `startTime` TIME(0) NULL,
  ADD COLUMN `startAt` DATETIME(3) NULL,
  ADD COLUMN `endScheduleEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `endDate` DATE NULL,
  ADD COLUMN `endTime` TIME(0) NULL,
  ADD COLUMN `endAt` DATETIME(3) NULL,
  ADD COLUMN `scheduleStatus` VARCHAR(32) NULL,
  ADD COLUMN `executedAt` DATETIME(3) NULL,
  ADD COLUMN `lastCronRun` DATETIME(3) NULL,
  ADD COLUMN `cronError` TEXT NULL;

CREATE INDEX `task_scheduleStatus_idx` ON `task`(`scheduleStatus`);
CREATE INDEX `task_startAt_idx` ON `task`(`startAt`);
CREATE INDEX `task_endAt_idx` ON `task`(`endAt`);
