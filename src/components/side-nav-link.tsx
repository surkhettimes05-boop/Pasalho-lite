"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function SideNavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return <Link className={`nav-item${active ? " nav-item-active" : ""}`} aria-current={active ? "page" : undefined} href={href}>{children}</Link>;
}
