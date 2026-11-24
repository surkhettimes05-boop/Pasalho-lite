import { createHash } from "node:crypto";

// Modern Trade hashes the verified ten-digit Nepal mobile number, without +977.
// A cashier-entered phone alone is not identity evidence for creator credit.
export function verifiedCreatorPhoneHash(customer: {
  phoneNormalized: string;
  membershipIdentityId: string | null;
} | null): string | null {
  if (!customer?.membershipIdentityId || !/^\+9779[6-9]\d{8}$/.test(customer.phoneNormalized)) return null;
  return createHash("sha256").update(customer.phoneNormalized.slice(4)).digest("hex");
}
