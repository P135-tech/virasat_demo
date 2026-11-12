-- Facebook Login for Business: remember who logged in and which Page the Instagram account is linked to.
ALTER TABLE "InstagramAccount" ADD COLUMN "fbUserId" TEXT;
ALTER TABLE "InstagramAccount" ADD COLUMN "pageId" TEXT;
