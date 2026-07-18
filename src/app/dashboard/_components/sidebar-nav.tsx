"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Zap, ListChecks, AlertTriangle } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Meetings", icon: Home, exact: true },
  { href: "/dashboard/agent", label: "Agent", icon: Zap, exact: false },
  { href: "/dashboard/decisions", label: "Decisions", icon: ListChecks, exact: false },
  { href: "/dashboard/conflicts", label: "Conflicts", icon: AlertTriangle, exact: false },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {navItems.map(({ href, label, icon: Icon, exact }) => {
        const isActive = exact
          ? pathname === href
          : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={[
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              isActive
                ? "bg-zinc-100 dark:bg-zinc-800 text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800",
            ].join(" ")}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
