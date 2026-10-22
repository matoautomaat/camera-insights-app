import Link from "next/link";
import { LogOut } from "lucide-react";
import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { getI18n } from "@/i18n/server";
import { requireLogin } from "@/lib/auth";
import { logOutAction } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireLogin();
  const { m } = await getI18n();
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:h-16 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 text-[16px] font-bold tracking-[-0.01em]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="size-8" />
            {m.brand}
          </Link>
          <div className="flex-1" />
          <NavLinks placement="top" />
          <ThemeToggle />
          <form action={logOutAction}>
            <button type="submit" className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface hover:text-ink" aria-label={m.nav.logout} title={m.nav.logout}>
              <LogOut className="size-[19px]" />
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pb-16 sm:pt-8">{children}</main>
      <NavLinks placement="bottom" />
    </>
  );
}
