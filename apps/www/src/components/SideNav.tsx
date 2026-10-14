"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SideNavItem = {
  label: string;
  href: string;
  /** External/cross-origin link: plain <a>, never marked active. */
  external?: boolean;
  /** Path prefixes (besides href) that should mark this item active. */
  match?: string[];
};

export function isSideNavActive(pathname: string, item: SideNavItem): boolean {
  if (item.external) return false;
  const paths = [item.href.split("#")[0] || "/", ...(item.match ?? [])];
  return paths.some((path) =>
    path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`),
  );
}

/** One sidebar section: muted uppercase label + 36px rows with an active pill. */
export function SideNav({
  label,
  items,
  className = "",
}: {
  label: string;
  items: SideNavItem[];
  className?: string;
}) {
  const pathname = usePathname() ?? "/";
  return (
    <div className={`sj-side-group ${className}`.trim()}>
      <p className="sj-side-label">{label}</p>
      <nav className="sj-side-nav" aria-label={label}>
        {items.map((item) => {
          const active = isSideNavActive(pathname, item);
          return item.external ? (
            <a key={item.label} className="sj-side-item" href={item.href} rel="noopener noreferrer">
              {item.label}
            </a>
          ) : (
            <Link
              key={item.label}
              className="sj-side-item"
              href={item.href}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
