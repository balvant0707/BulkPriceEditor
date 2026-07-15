ALTER TABLE `task`
  ADD COLUMN `applyToActiveProducts` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `applyToDraftProducts` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `applyToSoldoutProducts` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `sale`
  ADD COLUMN `applyToActiveProducts` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `applyToDraftProducts` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `applyToSoldoutProducts` BOOLEAN NOT NULL DEFAULT true;
