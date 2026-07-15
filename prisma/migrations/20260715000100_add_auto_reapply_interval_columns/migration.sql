ALTER TABLE `task`
  ADD COLUMN `autoReapplyIntervalUnit` VARCHAR(16) NOT NULL DEFAULT 'hours',
  ADD COLUMN `autoReapplyIntervalValue` INTEGER NOT NULL DEFAULT 1;

ALTER TABLE `sale`
  ADD COLUMN `autoReapplyIntervalUnit` VARCHAR(16) NOT NULL DEFAULT 'hours',
  ADD COLUMN `autoReapplyIntervalValue` INTEGER NOT NULL DEFAULT 1;
