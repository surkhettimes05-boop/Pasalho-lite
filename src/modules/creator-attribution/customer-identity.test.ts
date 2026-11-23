import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifiedCreatorPhoneHash } from "./customer-identity";

describe("creator POS identity", () => {
  it("never credits a cashier-entered or invalid phone without a verified link", () => {
    expect(verifiedCreatorPhoneHash({ phoneNormalized: "+9779812345678", membershipIdentityId: null })).toBeNull();
    expect(verifiedCreatorPhoneHash({ phoneNormalized: "+9771234567", membershipIdentityId: "verified-id" })).toBeNull();
  });

  it("uses Modern Trade's canonical ten-digit phone hash for a verified link", () => {
    expect(verifiedCreatorPhoneHash({ phoneNormalized: "+9779812345678", membershipIdentityId: "verified-id" })).toBe(createHash("sha256").update("9812345678").digest("hex"));
  });
});
