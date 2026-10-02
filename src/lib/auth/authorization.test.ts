import { describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/client";
import {
  assertRole,
  AuthorizationError,
} from "@/lib/auth/authorization";

describe("assertRole", () => {
  it("allows an authorized role", () => {
    expect(() =>
      assertRole(Role.OWNER_ADMIN, [Role.OWNER_ADMIN]),
    ).not.toThrow();
  });

  it("rejects an unauthorized role", () => {
    expect(() =>
      assertRole(Role.CASHIER_STORE, [Role.OWNER_ADMIN]),
    ).toThrow(AuthorizationError);
  });
});
