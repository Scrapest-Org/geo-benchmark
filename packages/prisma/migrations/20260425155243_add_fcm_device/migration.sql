-- CreateTable
CREATE TABLE "FcmDevice" (
    "id" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "androidId" TEXT NOT NULL,
    "securityToken" TEXT NOT NULL,
    "buildFingerprint" TEXT NOT NULL,
    "fcmToken" TEXT NOT NULL,
    "fcmKeyPrivate" BYTEA,
    "fcmAuthSecret" BYTEA,
    "oauthToken" TEXT NOT NULL,
    "oauthTokenSecret" TEXT NOT NULL,
    "twitterDeviceId" TEXT,
    "registeredAt" TIMESTAMP(3),
    "lastCheckinAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FcmDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FcmDevice_accountLogin_key" ON "FcmDevice"("accountLogin");

-- CreateIndex
CREATE INDEX "FcmDevice_accountLogin_idx" ON "FcmDevice"("accountLogin");
