import type { ReactNode } from "react";
import { Role } from "@/generated/prisma/client";
import { logoutAction } from "@/app/(app)/actions";
import type { SessionUser } from "@/lib/auth/session";
import { SideNavLink } from "@/components/side-nav-link";

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const store = user.role !== Role.WAREHOUSE_STAFF;
  const warehouse = user.role !== Role.CASHIER_STORE;
  const owner = user.role === Role.OWNER_ADMIN;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="brand-mark">P</span><div><strong>Pasalho</strong><small>Store operations</small></div></div>
      <nav aria-label="Primary navigation">
        <span className="nav-group-label">Operations</span>
        <SideNavLink href="/">Dashboard</SideNavLink>
        {store && <SideNavLink href="/pos">POS</SideNavLink>}
        {store && <SideNavLink href="/orders">Orders</SideNavLink>}
        <span className="nav-group-label">Inventory</span>
        {owner && <SideNavLink href="/products">Products</SideNavLink>}
        <SideNavLink href="/inventory">Inventory</SideNavLink>
        {warehouse && <SideNavLink href="/receiving">Receive Stock</SideNavLink>}
        <SideNavLink href="/transfers">Transfers</SideNavLink>
        {store && <span className="nav-group-label">Customers</span>}
        {store && <SideNavLink href="/customers">Customers</SideNavLink>}
        {store && <SideNavLink href="/returns">Returns</SideNavLink>}
        {store && <span className="nav-group-label">Finance</span>}
        {store && <SideNavLink href="/cash">Expenses / Cash</SideNavLink>}
        {store && <SideNavLink href="/daily-close">Daily Close</SideNavLink>}
        <span className="nav-group-label">Management</span>
        <SideNavLink href="/reports">Reports</SideNavLink>
        {owner && <SideNavLink href="/users-audit">Users / Audit</SideNavLink>}
      </nav>
      <div className="sidebar-user"><strong>{user.name}</strong><span>{user.role.replaceAll("_", " ")}</span><form action={logoutAction}><button className="secondary-button" type="submit">Sign out</button></form></div>
    </aside>
    <main className="main-content">{children}</main>
  </div>;
}
