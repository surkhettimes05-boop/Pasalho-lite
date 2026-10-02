import { Prisma, Role } from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import { hashPassword } from "@/lib/auth/password";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import {
  createUserInputSchema,
  updateUserAccessInputSchema,
  type CreateUserInput,
  type UpdateUserAccessInput,
} from "@/modules/users/user.schemas";

export async function createStaffUser(
  actor: SessionUser,
  input: CreateUserInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const parsed = createUserInputSchema.parse(input);
  const passwordHash = await hashPassword(parsed.password);

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: parsed.name,
          email: parsed.email,
          passwordHash,
          role: parsed.role,
          active: true,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          createdAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "USER_CREATED",
          entityType: "User",
          entityId: user.id,
          afterData: {
            name: user.name,
            email: user.email,
            role: user.role,
            active: user.active,
          },
        },
      });

      return user;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new BusinessError("USER_EMAIL_EXISTS", "That staff email already exists.");
    }

    throw error;
  }
}

export async function updateStaffUserAccess(
  actor: SessionUser,
  input: UpdateUserAccessInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const parsed = updateUserAccessInputSchema.parse(input);

  if (parsed.userId === actor.id && (!parsed.active || parsed.role !== Role.OWNER_ADMIN)) {
    throw new BusinessError(
      "SELF_LOCKOUT_BLOCKED",
      "You cannot deactivate your own account or remove your own Owner/Admin role.",
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id: parsed.userId },
      });

      if (!existing) {
        throw new BusinessError("USER_NOT_FOUND", "Staff user not found.");
      }

      if (
        existing.role === Role.OWNER_ADMIN &&
        existing.active &&
        (!parsed.active || parsed.role !== Role.OWNER_ADMIN)
      ) {
        const activeOwnerCount = await tx.user.count({
          where: { role: Role.OWNER_ADMIN, active: true },
        });

        if (activeOwnerCount <= 1) {
          throw new BusinessError(
            "LAST_OWNER_REQUIRED",
            "At least one active Owner/Admin account must remain.",
          );
        }
      }

      if (existing.role === parsed.role && existing.active === parsed.active) {
        return {
          id: existing.id,
          name: existing.name,
          email: existing.email,
          role: existing.role,
          active: existing.active,
          createdAt: existing.createdAt,
        };
      }

      const updated = await tx.user.update({
        where: { id: existing.id },
        data: {
          role: parsed.role,
          active: parsed.active,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          createdAt: true,
        },
      });

      if (!parsed.active) {
        await tx.session.deleteMany({
          where: { userId: existing.id },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "USER_ACCESS_UPDATED",
          entityType: "User",
          entityId: existing.id,
          beforeData: {
            role: existing.role,
            active: existing.active,
          },
          afterData: {
            role: updated.role,
            active: updated.active,
          },
        },
      });

      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function getUsersAndAudit(page = 1, pageSize = 100) {
  const normalizedPage = Math.max(1, page);
  const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);

  const [users, audits, auditTotal] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (normalizedPage - 1) * normalizedPageSize,
      take: normalizedPageSize,
      include: {
        actor: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    }),
    prisma.auditLog.count(),
  ]);

  return {
    users,
    audits,
    auditTotal,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(auditTotal / normalizedPageSize)),
  };
}
