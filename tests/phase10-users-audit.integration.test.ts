import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/authorization";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import {
  createStaffUser,
  updateStaffUserAccess,
} from "@/modules/users/user.service";

const suffix = randomUUID().slice(0, 8);
let owner: SessionUser;
let cashierActor: SessionUser;
let createdUserId: string;

beforeAll(async () => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.SEED_OWNER_EMAIL!.toLowerCase() },
  });
  owner = { id: user.id, name: user.name, email: user.email, role: user.role };
  cashierActor = { ...owner, role: Role.CASHIER_STORE };
});

describe("Phase 10 staff access and audit", () => {
  it("denies non-owner staff management", async () => {
    await expect(
      createStaffUser(cashierActor, {
        name: "Denied User",
        email: `denied-${suffix}@example.com`,
        password: "strong-password-123",
        role: Role.CASHIER_STORE,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("creates staff with hashed password and audit evidence", async () => {
    const password = "strong-password-123";
    const user = await createStaffUser(owner, {
      name: "Phase 10 Cashier",
      email: `cashier-${suffix}@example.com`,
      password,
      role: Role.CASHIER_STORE,
    });
    createdUserId = user.id;

    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(persisted.passwordHash).not.toBe(password);
    expect(await verifyPassword(password, persisted.passwordHash)).toBe(true);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "USER_CREATED",
        entityType: "User",
        entityId: user.id,
      },
    });
    expect(audit.actorUserId).toBe(owner.id);
  });

  it("rejects duplicate staff email", async () => {
    await expect(
      createStaffUser(owner, {
        name: "Duplicate",
        email: `cashier-${suffix}@example.com`,
        password: "another-password-123",
        role: Role.WAREHOUSE_STAFF,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "USER_EMAIL_EXISTS",
    });
  });

  it("changes role, deactivates user, deletes sessions, and audits the change", async () => {
    const { token } = await createSession(createdUserId);
    expect(token.length).toBeGreaterThan(20);
    expect(await prisma.session.count({ where: { userId: createdUserId } })).toBe(1);

    const updated = await updateStaffUserAccess(owner, {
      userId: createdUserId,
      role: Role.WAREHOUSE_STAFF,
      active: false,
    });

    expect(updated.role).toBe(Role.WAREHOUSE_STAFF);
    expect(updated.active).toBe(false);
    expect(await prisma.session.count({ where: { userId: createdUserId } })).toBe(0);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "USER_ACCESS_UPDATED",
        entityType: "User",
        entityId: createdUserId,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.actorUserId).toBe(owner.id);
  });

  it("blocks Owner/Admin self-lockout", async () => {
    await expect(
      updateStaffUserAccess(owner, {
        userId: owner.id,
        role: Role.CASHIER_STORE,
        active: true,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "SELF_LOCKOUT_BLOCKED",
    });
  });

  it("keeps AuditLog append-only in PostgreSQL", async () => {
    const audit = await prisma.auditLog.findFirstOrThrow({
      orderBy: { createdAt: "desc" },
    });

    await expect(
      prisma.auditLog.update({
        where: { id: audit.id },
        data: { action: "REWRITTEN" },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.auditLog.delete({ where: { id: audit.id } }),
    ).rejects.toThrow();
  });
});
