import "dotenv/config";
import { hash } from "bcryptjs";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Role } from "../src/generated/prisma/client";

const schema = z.object({
  APP_ENV: z.enum(["staging", "production"]),
  DATABASE_URL: z.string().min(1),
  BOOTSTRAP_OWNER_EMAIL: z.string().email(),
  BOOTSTRAP_OWNER_PASSWORD: z.string().min(14).max(256),
  BOOTSTRAP_OWNER_NAME: z.string().trim().min(2).max(100),
});

const env = schema.parse(process.env);
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

try {
  const activeOwnerCount = await prisma.user.count({
    where: { role: Role.OWNER_ADMIN, active: true },
  });

  if (activeOwnerCount > 0) {
    throw new Error(
      "Bootstrap refused: an active Owner/Admin already exists. Use Users / Audit.",
    );
  }

  const email = env.BOOTSTRAP_OWNER_EMAIL.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    throw new Error(
      "Bootstrap refused: that email already exists. Resolve it explicitly.",
    );
  }

  const passwordHash = await hash(env.BOOTSTRAP_OWNER_PASSWORD, 12);
  const user = await prisma.user.create({
    data: {
      name: env.BOOTSTRAP_OWNER_NAME,
      email,
      passwordHash,
      role: Role.OWNER_ADMIN,
      active: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: null,
      action: "OWNER_ADMIN_BOOTSTRAPPED",
      entityType: "User",
      entityId: user.id,
      afterData: {
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active,
        environment: env.APP_ENV,
      },
    },
  });

  console.log("Initial Owner/Admin account bootstrapped.");
} finally {
  await prisma.$disconnect();
}
