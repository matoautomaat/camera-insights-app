"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, LayoutGrid, Settings } from "lucide-react";
import { useI18n } from "@/i18n/client";

/** The three places of the app. On a phone a bar along the bottom, under the thumb; on a computer in the top bar. */
export function NavLinks({ placement }: { placement: "top" | "bottom" }) {
  const { m } = useI18n();
  const path = usePathname();
  const links = [
    { href: "/", label: m.nav.overview, icon: LayoutGrid, active: path === "/" || path.startsWith("/cameras") },
    { href: "/sales", label: m.nav.sales, icon: BarChart3, active: path.startsWith("/sales") },
    { href: "/settings", label: m.nav.settings, icon: Settings, active: path.startsWith("/settings") },
  ];
  if (placement === "top")
    return (
      <nav className="hidden items-center gap-1 sm:flex">
        {links.map(({ href, label, active }) => (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="rounded-full px-3.5 py-2 text-[14.5px] font-semibold text-muted hover:text-ink aria-[current=page]:bg-surface aria-[current=page]:text-ink"
          >
            {label}
          </Link>
        ))}
      </nav>
    );
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      <div className="mx-auto grid max-w-md grid-cols-3">
        {links.map(({ href, label, icon: Icon, active }) => (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="flex h-16 flex-col items-center justify-center gap-1 text-[12px] font-semibold text-muted aria-[current=page]:text-accent"
          >
            <Icon className="size-[22px]" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
