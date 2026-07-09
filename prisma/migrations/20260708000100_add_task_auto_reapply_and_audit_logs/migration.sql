ALTER TABLE `task`
  ADD COLUMN `autoReapply` BOOLEAN NOT NULL DEFAULT false;

UPDATE `task`
SET `autoReapply` = `autoReapplyChanges`
WHERE `autoReapplyChanges` = true;

CREATE TABLE `task_audit_log` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `taskId` INTEGER NOT NULL,
  `shop` VARCHAR(255) NOT NULL,
  `productId` VARCHAR(255) NULL,
  `variantId` VARCHAR(255) NULL,
  `previousPrice` VARCHAR(32) NULL,
  `newPrice` VARCHAR(32) NULL,
  `action` VARCHAR(32) NOT NULL,
  `skipReason` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `task_audit_log_taskId_idx`(`taskId`),
  INDEX `task_audit_log_shop_idx`(`shop`),
  INDEX `task_audit_log_action_idx`(`action`),
  PRIMARY KEY (`id`),
  CONSTRAINT `task_audit_log_taskId_fkey`
    FOREIGN KEY (`taskId`) REFERENCES `task`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
