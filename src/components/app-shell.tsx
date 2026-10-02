import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/(app)/actions";
import type { SessionUser } from "@/lib/auth/session";

const plannedModules = [
  "Products",
  "Inventory",
  "Receive Stock",
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
          <Link className="nav-item nav-item-active" href="/">
            Dashboard
          </Link>
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
