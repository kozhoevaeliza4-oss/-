import type { VersionDiff } from "@/lib/import/estimate";
import { Badge } from "@/components/ui";
import { fmtMoney, fmtNum } from "@/lib/format";

const KIND = {
  added: { label: "Добавлена", tone: "blue" as const },
  removed: { label: "Исключена", tone: "red" as const },
  changed: { label: "Изменена", tone: "yellow" as const },
  unchanged: { label: "Без изменений", tone: "grey" as const },
};

export function DiffSummary({ diff, currency }: { diff: VersionDiff; currency: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge tone="blue">Добавлено: {diff.added}</Badge>
      <Badge tone="red">Исключено: {diff.removed}</Badge>
      <Badge tone="yellow">Изменено: {diff.changed}</Badge>
      <Badge tone="grey">Без изменений: {diff.unchanged}</Badge>
      <span className="ml-2">
        Итог: {fmtMoney(diff.totalBefore, currency)} → <b>{fmtMoney(diff.totalAfter, currency)}</b> (
        <span className={Number(diff.totalDelta) > 0 ? "text-red-700" : Number(diff.totalDelta) < 0 ? "text-emerald-700" : ""}>
          {Number(diff.totalDelta) > 0 ? "+" : ""}{fmtMoney(diff.totalDelta, currency)}
        </span>)
      </span>
    </div>
  );
}

export function DiffTable({ diff, currency, showUnchanged = false }: { diff: VersionDiff; currency: string; showUnchanged?: boolean }) {
  const rows = diff.rows.filter((r) => showUnchanged || r.kind !== "unchanged");
  if (rows.length === 0) return <p className="text-sm text-slate-500">Различий нет.</p>;
  return (
    <div className="max-h-[600px] overflow-auto">
      <table className="table-base text-xs">
        <thead className="sticky top-0">
          <tr>
            <th>Изменение</th><th>Код</th><th>Наименование</th><th>Ед.</th>
            <th className="text-right">Объём было</th><th className="text-right">Объём стало</th>
            <th className="text-right">Цена было</th><th className="text-right">Цена стало</th>
            <th className="text-right">Стоимость было</th><th className="text-right">Стоимость стало</th><th className="text-right">Δ стоимости</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ch = (f: string) => (r.changes.includes(f as never) ? "bg-amber-100 font-semibold" : "");
            return (
              <tr key={r.kind + r.itemKey}>
                <td><Badge tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Badge></td>
                <td className="whitespace-nowrap">{r.code ?? "—"}</td>
                <td className={`min-w-[220px] ${ch("name")}`}>
                  {r.name}
                  {r.changes.includes("name") && r.before && <div className="font-normal text-slate-500">было: {r.before.name}</div>}
                </td>
                <td className={ch("unit")}>{r.unit ?? "—"}</td>
                <td className="num">{fmtNum(r.before?.quantity, 4)}</td>
                <td className={`num ${ch("quantity")}`}>{fmtNum(r.after?.quantity, 4)}</td>
                <td className="num">{fmtNum(r.before?.unitPrice)}</td>
                <td className={`num ${ch("unitPrice")}`}>{fmtNum(r.after?.unitPrice)}</td>
                <td className="num">{fmtMoney(r.before?.plannedCost, currency)}</td>
                <td className={`num ${ch("plannedCost")}`}>{fmtMoney(r.after?.plannedCost, currency)}</td>
                <td className="num">{fmtMoney(r.costDelta, currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
