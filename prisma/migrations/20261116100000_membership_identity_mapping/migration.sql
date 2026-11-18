ALTER TABLE "Customer"
ADD COLUMN "membershipIdentityId" TEXT;

CREATE UNIQUE INDEX "Customer_membershipIdentityId_key"
ON "Customer"("membershipIdentityId");
