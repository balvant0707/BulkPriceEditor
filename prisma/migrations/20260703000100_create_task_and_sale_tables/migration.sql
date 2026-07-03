-- CreateTable
CREATE TABLE `task` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(255) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
    `applyChangesTo` VARCHAR(32) NOT NULL DEFAULT 'products',
    `applyToFixedPrices` BOOLEAN NOT NULL DEFAULT false,
    `selectedMarkets` JSON NULL,
    `priceChange` JSON NULL,
    `compareAtPriceChange` JSON NULL,
    `costPerItemChange` JSON NULL,
    `applyScope` VARCHAR(64) NOT NULL DEFAULT 'whole_store',
    `excludeScope` VARCHAR(64) NOT NULL DEFAULT 'nothing',
    `discountedScope` VARCHAR(64) NOT NULL DEFAULT 'nothing',
    `applyResources` JSON NULL,
    `excludeResources` JSON NULL,
    `autoReapplyChanges` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `task_shop_idx`(`shop`),
    INDEX `task_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(255) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
    `changeType` VARCHAR(32) NOT NULL DEFAULT 'products',
    `applyToFixedPrices` BOOLEAN NOT NULL DEFAULT false,
    `markets` JSON NULL,
    `priceChange` JSON NULL,
    `compareAtPriceChange` JSON NULL,
    `applyScope` VARCHAR(64) NOT NULL DEFAULT 'whole_store',
    `excludeScope` VARCHAR(64) NOT NULL DEFAULT 'nothing',
    `discountedScope` VARCHAR(64) NOT NULL DEFAULT 'nothing',
    `applyResources` JSON NULL,
    `excludeResources` JSON NULL,
    `tagRules` JSON NULL,
    `schedule` JSON NULL,
    `startAt` DATETIME(3) NULL,
    `endAt` DATETIME(3) NULL,
    `addTagsEnabled` BOOLEAN NOT NULL DEFAULT false,
    `removeTagsEnabled` BOOLEAN NOT NULL DEFAULT false,
    `trackConditionChanges` BOOLEAN NOT NULL DEFAULT false,
    `autoReapplyChanges` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sale_shop_idx`(`shop`),
    INDEX `sale_status_idx`(`status`),
    INDEX `sale_startAt_idx`(`startAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
