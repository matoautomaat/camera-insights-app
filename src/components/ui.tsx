import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import type { Messages } from "@/i18n/en";
import { fmt, type Format } from "@/i18n/format";
import type { Verdict } from "@/lib/stats";

// The building blocks every page uses. Server components: no script reaches the browser for these.

export function PageHeader({ title, subtitle, back, actions }: { title: string; subtitle?: ReactNode; back?: { href: string; label: string }; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 sm:mb-8">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-[14px] font-semibold text-muted hover:text-ink">
            <ChevronLeft className="size-4" aria-hidden="true" />
            {back.label}
          </Link>
        )}
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-[62ch] text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

export function Section({ title, hint, action, children }: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold tracking-[-0.01em]">{title}</h2>
          {hint && <p className="text-[13.5px] text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Panel({ title, hint, children, className = "" }: { title: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card px-5 py-5 sm:px-6 ${className}`}>
      <h3 className="text-[16px] font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-[13.5px] text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, detail }: { label: string; value: string; detail?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="mt-0.5 text-[22px] font-bold tracking-[-0.01em]">{value}</p>
      {detail && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{detail}</p>}
    </div>
  );
}

export function Empty({ title, hint, icon }: { title: string; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon && <div className="grid size-11 place-items-center rounded-full bg-surface text-muted">{icon}</div>}
      <p className="text-[16px] font-semibold">{title}</p>
      {hint && <p className="max-w-[48ch] text-[14px] text-muted">{hint}</p>}
    </div>
  );
}

/** Period choice as links, so it works without script and survives a reload. */
export function PeriodLinks<K extends string>({ hrefFor, current, labels }: { hrefFor: (key: K) => string; current: K; labels: Record<K, string> }) {
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="Period">
      {(Object.keys(labels) as K[]).map((key) => (
        <Link key={key} href={hrefFor(key)} className="pill" aria-current={key === current ? "page" : undefined} scroll={false}>
          {labels[key]}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The change against the period before, only as strong as the numbers allow: a percentage only for a real rise
 * or fall, grey "about the same" for normal swing, and no comparison at all for too few or a new start.
 */
export function Change({
  verdict,
  current,
  previous,
  first,
  label,
  m,
  f,
}: {
  verdict: Verdict;
  current: number;
  previous: number;
  first: string | null;
  label: string;
  m: Messages;
  f: Format;
}) {
  if (verdict === "tooFew") return <p className="text-[13.5px] text-muted">{m.common.tooFew}</p>;
  if (verdict === "new") return <p className="text-[13.5px] text-muted">{first ? fmt(m.common.newSince, { date: f.dayMonth(first) }) : m.common.tooFew}</p>;
  if (verdict === "noise")
    return (
      <p className="text-[13.5px] text-muted" title={m.common.noise}>
        {m.common.same} <span className="opacity-80">· {label}</span>
      </p>
    );
  const pct = previous > 0 ? f.percent(Math.abs(current - previous) / previous) : "";
  return (
    <p className={`text-[13.5px] font-semibold ${verdict === "up" ? "text-up" : "text-down"}`}>
      {fmt(verdict === "up" ? m.common.up : m.common.down, { pct })} <span className="font-normal text-muted">· {label}</span>
    </p>
  );
}

export type BarItem = { key: string; label: string; value: number; display: string; strong?: boolean };

/**
 * Columns, tallest = full height, with a few labels underneath. Each column can take focus, so a tap on a phone
 * shows its value, and carries it for a screen reader.
 */
export function Bars({ items, height = 170, labelEvery }: { items: BarItem[]; height?: number; labelEvery?: number }) {
  const max = Math.max(...items.map((item) => item.value), 0);
  const every = labelEvery ?? Math.max(1, Math.ceil(items.length / 5));
  return (
    <div>
      <div className="bars" style={{ height }} role="list">
        {items.map((item) => (
          <div
            key={item.key}
            className="col"
            role="listitem"
            tabIndex={0}
            aria-label={`${item.label}: ${item.display}`}
            data-strong={item.strong ? "true" : undefined}
            data-zero={item.value === 0 ? "true" : undefined}
          >
            <span className="bar" style={{ height: max > 0 ? `${Math.max(1.5, (item.value / max) * 100)}%` : "2px" }} />
            <span className="tip">
              {item.label}: {item.display}
            </span>
          </div>
        ))}
      </div>
      {/* Labels under their column but free of its width, so "25 sep" never shrinks to "2". */}
      <div className="relative mt-1.5 h-4" aria-hidden="true">
        {items.map((item, index) =>
          index % every === 0 ? (
            <span
              key={item.key}
              className="absolute top-0 whitespace-nowrap text-[11px] text-muted"
              style={
                index === 0
                  ? { left: 0 }
                  : index === items.length - 1
                    ? { right: 0 }
                    : { left: `${((index + 0.5) / items.length) * 100}%`, transform: "translateX(-50%)" }
              }
            >
              {item.label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

/** Horizontal bars with the value at the end: weekdays, best sellers, terminals. */
export function BarList({ items }: { items: BarItem[] }) {
  const max = Math.max(...items.map((item) => item.value), 0);
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item.key} className="grid grid-cols-[minmax(4.5rem,auto)_1fr_auto] items-center gap-3 text-[14px]">
          <span className={`truncate ${item.strong ? "font-semibold" : "text-muted"}`}>{item.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface">
            <span
              className={`block h-full rounded-full ${item.strong ? "bg-bar-strong" : "bg-bar"}`}
              style={{ width: max > 0 ? `${(item.value / max) * 100}%` : "0%" }}
            />
          </span>
          <span className="text-right font-semibold tabular-nums">{item.display}</span>
        </li>
      ))}
    </ul>
  );
}

export function Dot({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
      <span className={`size-2 rounded-full ${on ? "bg-up" : "bg-down"}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export function HowToRead({ title, lines }: { title: string; lines: string[] }) {
  return (
    <details className="group card px-5 py-4 sm:px-6">
      <summary className="cursor-pointer list-none text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
        <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">›</span>
        {title}
      </summary>
      <div className="mt-3 flex flex-col gap-2.5 text-[14px] leading-relaxed text-muted">
        {lines.map((line) => (
          <p key={line} className="max-w-[70ch]">
            {line}
          </p>
        ))}
      </div>
    </details>
  );
}
