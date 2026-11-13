-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EtsyConnection" (
    "shop" TEXT NOT NULL,
    "installId" TEXT,
    "etsyUserId" TEXT NOT NULL,
    "etsyShopId" TEXT NOT NULL,
    "etsyShopName" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EtsyConnection_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "EtsyAuthState" (
    "state" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EtsyAuthState_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "ListingDefaults" (
    "shop" TEXT NOT NULL,
    "taxonomyId" INTEGER,
    "taxonomyPath" TEXT,
    "whoMade" TEXT NOT NULL DEFAULT 'someone_else',
    "whenMade" TEXT NOT NULL DEFAULT 'made_to_order',
    "shippingProfileId" TEXT,
    "readinessStateId" TEXT,
    "returnPolicyId" TEXT,
    "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "markupPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ListingDefaults_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "ListingLink" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "etsyListingId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListingLink_shop_shopifyProductId_key" ON "ListingLink"("shop", "shopifyProductId");

-- CreateIndex
CREATE INDEX "ListingLink_shop_status_idx" ON "ListingLink"("shop", "status");
