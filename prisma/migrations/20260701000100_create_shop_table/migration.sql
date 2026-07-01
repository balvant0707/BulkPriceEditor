-- CreateTable
CREATE TABLE `shop` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL,
    `accessToken` VARCHAR(191) NULL,
    `installed` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(32) NULL DEFAULT 'installed',
    `ownerName` VARCHAR(255) NULL,
    `email` VARCHAR(320) NULL,
    `contactEmail` VARCHAR(320) NULL,
    `name` VARCHAR(255) NULL,
    `country` VARCHAR(100) NULL,
    `city` VARCHAR(100) NULL,
    `currency` VARCHAR(10) NULL,
    `phone` VARCHAR(50) NULL,
    `primaryDomain` VARCHAR(255) NULL,
    `plan` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `onboardedAt` DATETIME(3) NULL,
    `uninstalledAt` DATETIME(3) NULL,
    `announcementEmailSentAt` DATETIME(3) NULL,

    UNIQUE INDEX `Shop_shop_key`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
