CREATE TABLE `price_editor_setting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(255) NOT NULL,
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `price_editor_setting_shop_key_key`(`shop`, `key`),
    INDEX `price_editor_setting_shop_idx`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `product_report` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(255) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'Completed',
    `totalRows` INTEGER NOT NULL DEFAULT 0,
    `generatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `product_report_shop_type_idx`(`shop`, `type`),
    INDEX `product_report_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `product_report_row` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reportId` INTEGER NOT NULL,
    `shop` VARCHAR(255) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `productId` VARCHAR(255) NOT NULL,
    `productTitle` VARCHAR(500) NOT NULL,
    `productHandle` VARCHAR(255) NULL,
    `variantId` VARCHAR(255) NOT NULL,
    `variantTitle` VARCHAR(500) NULL,
    `sku` VARCHAR(255) NULL,
    `price` DECIMAL(12, 2) NULL,
    `cost` DECIMAL(12, 2) NULL,
    `compareAtPrice` DECIMAL(12, 2) NULL,
    `marginPercent` DECIMAL(8, 2) NULL,
    `discountPercent` DECIMAL(8, 2) NULL,
    `currencyCode` VARCHAR(10) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `product_report_row_reportId_idx`(`reportId`),
    INDEX `product_report_row_shop_type_idx`(`shop`, `type`),
    INDEX `product_report_row_productTitle_idx`(`productTitle`),
    INDEX `product_report_row_sku_idx`(`sku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `product_report_row`
ADD CONSTRAINT `product_report_row_reportId_fkey`
FOREIGN KEY (`reportId`) REFERENCES `product_report`(`id`)
ON DELETE CASCADE ON UPDATE CASCADE;
