import type { Role } from "@/generated/prisma/client";

export class AuthorizationError extends Error {
  readonly code = "UNAUTHORIZED_ACTION";

  constructor() {
    super("You are not authorized to perform this action.");
    this.name = "AuthorizationError";
  }
}

export function assertRole(actualRole: Role, allowedRoles: readonly Role[]) {
  if (!allowedRoles.includes(actualRole)) {
    throw new AuthorizationError();
  }
}
