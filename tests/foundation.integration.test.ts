import { afterAll, describe, expect, it } from "vitest";
import { LocationType, Role } from "@/generated/prisma/client";
import { authenticateCredentials } from "@/lib/auth/service";
import {
  createSession,
  deleteSession,
  getSessionUser,
} from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const createdSessionTokens: string[] = [];

afterAll(async () => {
  await Promise.all(createdSessionTokens.map((token) => deleteSession(token)));
  await prisma.$disconnect();
});

describe("Phase 0 foundation", () => {
  it("seeds exactly the required V1 operating locations", async () => {
    const warehouse = await prisma.location.findUnique({
      where: { code: "WAREHOUSE_MAIN" },
    });
    const store = await prisma.location.findUnique({
      where: { code: "STORE_MAIN" },
    });

    expect(warehouse).toMatchObject({
      name: "Central Warehouse",
      type: LocationType.WAREHOUSE,
      active: true,
    });

    expect(store).toMatchObject({
      name: "Pasalho Store",
      type: LocationType.STORE,
      active: true,
    });

    const activeWarehouses = await prisma.location.count({
      where: { active: true, type: LocationType.WAREHOUSE },
    });
    const activeStores = await prisma.location.count({
      where: { active: true, type: LocationType.STORE },
    });

    expect(activeWarehouses).toBe(1);
    expect(activeStores).toBe(1);
  });

  it("allows the seeded owner to authenticate and use an expiring DB session", async () => {
    const email = process.env.SEED_OWNER_EMAIL;
    const password = process.env.SEED_OWNER_PASSWORD;

    expect(email).toBeTruthy();
    expect(password).toBeTruthy();

    const owner = await authenticateCredentials(email!, password!);

    expect(owner).toMatchObject({
      email: email!.toLowerCase(),
      role: Role.OWNER_ADMIN,
    });

    const session = await createSession(owner!.id);
    createdSessionTokens.push(session.token);

    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const sessionUser = await getSessionUser(session.token);

    expect(sessionUser).toMatchObject({
      id: owner!.id,
      email: email!.toLowerCase(),
      role: Role.OWNER_ADMIN,
    });
  });

  it("rejects an incorrect owner password", async () => {
    const email = process.env.SEED_OWNER_EMAIL;

    const owner = await authenticateCredentials(
      email!,
      "definitely-the-wrong-password",
    );

    expect(owner).toBeNull();
  });
});
