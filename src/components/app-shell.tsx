import Link from "next/link";
import type { ReactNode } from "react";
import { Role } from "@/generated/prisma/client";
import { logoutAction } from "@/app/(app)/actions";
import type { SessionUser } from "@/lib/auth/session";

const plannedModules = [
  "Transfers",
  "POS",
  "Customers",
  "Orders",
  "Returns",
  "Expenses",
  "Daily Close",
  "Reports",
  "Users / Audit",
];

export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Pasalho</p>
          <h1>Lite</h1>
          <p className="muted">One warehouse. One store. One source of truth.</p>
        </div>

        <nav aria-label="Primary navigation">
          <Link className="nav-item" href="/">
            Dashboard
          </Link>
          {user.role === Role.OWNER_ADMIN ? (
            <Link className="nav-item" href="/products">
              Products
            </Link>
          ) : null}
          <Link className="nav-item" href="/inventory">
            Inventory
          </Link>
          {user.role !== Role.CASHIER_STORE ? (
            <Link className="nav-item" href="/receiving">
              Receive Stock
            </Link>
          ) : null}
          {plannedModules.map((module) => (
            <span className="nav-item nav-item-disabled" key={module}>
              {module}
              <small>Planned</small>
            </span>
          ))}
        </nav>

        <div className="sidebar-user">
          <strong>{user.name}</strong>
          <span>{user.role.replaceAll("_", " ")}</span>
          <form action={logoutAction}>
            <button className="secondary-button" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
