-- CreateTable
CREATE TABLE "ReelSettings" (
    "shop" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'auto',
    "count" INTEGER NOT NULL DEFAULT 10,
    "pins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSync" TIMESTAMP(3),

    CONSTRAINT "ReelSettings_pkey" PRIMARY KEY ("shop")
);

-- AlterTable
ALTER TABLE "SelectedReel" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
