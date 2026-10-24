import { TriangleAlert } from "lucide-react";
import type { Messages } from "@/i18n/en";
import { fmt, type makeFormat } from "@/i18n/format";
import type { SalesDrop } from "@/lib/alerts";

/** The machines selling far less than usual: shown at the top of the overview and the sales page. */
export function SalesDrops({ drops, names, m, f }: { drops: SalesDrop[]; names: Map<string, string>; m: Messages; f: ReturnType<typeof makeFormat> }) {
  if (!drops.length) return null;
  return (
    <section className="card flex gap-3 border-warn px-5 py-4 sm:px-6" role="alert">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-warn">{m.alerts.title}</p>
        <ul className="mt-1 flex flex-col gap-0.5 text-[14px]">
          {drops.map((d) => (
            <li key={d.serial}>
              {fmt(m.alerts.line, { name: names.get(d.serial) ?? d.serial, recent: f.number(d.recent), expected: f.number(Math.round(d.expected)) })}
              {d.lastSale && <span className="text-muted"> · {fmt(m.alerts.lastSale, { time: f.dateTime(d.lastSale) })}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{m.alerts.hint}</p>
      </div>
    </section>
  );
}
