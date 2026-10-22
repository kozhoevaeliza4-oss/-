import Link from "next/link";
import { requireProjectAccess } from "@/lib/server/auth";
import { loadDashboard } from "@/lib/server/dashboard";
import { Card, EmptyState, Stat } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMoney, fmtPct } from "@/lib/format";
import { ACTION_LABELS } from "@/lib/auditLabels";
import type { RegistryRowDTO } from "@/lib/server/registry";

export default async function DashboardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireProjectAccess(projectId);
  const d = await loadDashboard(projectId);
  const c = d.cards;
  const cur = d.data.project.currency;
  const reg = (q: string) => `/projects/${projectId}/registry${q ? "?" + q : ""}`;
  const missing = (n: number) => (n > 0 ? `без данных: ${n} ст.` : undefined);

  if (!d.data.currentVersion && d.data.rows.length === 0) {
    return (
      <EmptyState>
        В проекте ещё нет утверждённой сметы. <Link className="link" href={`/projects/${projectId}/estimate`}>Загрузите смету</Link>, проверьте её и утвердите — после этого появится реестр работ и показатели.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">
        Показатели рассчитаны {fmtDateTime(d.data.computedAt)} по действующей смете
        {d.data.currentVersion ? ` v${d.data.currentVersion.versionNumber} «${d.data.currentVersion.name}»` : " (не утверждена)"}. Каждая карточка открывает соответствующие строки реестра.
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Первоначальная смета" value={fmtMoney(c.baselineTotal, cur, "Нет данных")} hint={d.data.baselineVersion ? `v${d.data.baselineVersion.versionNumber}` : undefined} href={`/projects/${projectId}/estimate`} />
        <Stat label="Текущая утверждённая смета" value={fmtMoney(c.currentTotal, cur, "Нет данных")} hint={c.itemsWithoutPlannedCost ? `статей без стоимости: ${c.itemsWithoutPlannedCost}` : undefined} href={reg("active=1")} />
        <Stat label="Сумма договоров" value={fmtMoney(c.contractsTotal, cur, "Нет данных")} hint={`${c.contractsCount} действующих/завершённых${c.contractsIncomplete ? `, без суммы: ${c.contractsIncomplete}` : ""}`} href={reg("contract=covered")} />
        <Stat label="Договорное покрытие" value={fmtPct(c.coveragePercent, "Нет данных")} hint="по плановой стоимости статей" href={reg("contract=covered")} />
        <Stat label="Работы без договора" value={fmtMoney(c.uncoveredValue, cur, "Нет данных")} hint={`${c.uncoveredCount} статей`} href={reg("contract=uncovered")} tone={c.uncoveredCount ? "red" : undefined} />
        <Stat label="Стоимость физически выполненного" value={fmtMoney(c.earned.sum, cur, "Нет данных")} hint={missing(c.earned.missing)} href={reg("progress=partial")} />
        <Stat label="Подписанные АВР" value={fmtMoney(c.actsSigned, cur, "Нет данных")} href={reg("acts=signed")} />
        <Stat
          label={d.data.project.costMethodologyConfirmed ? "Фактические затраты (1С)" : "Импортированные затраты по 1С"}
          value={fmtMoney(c.accountingCost.sum, cur, "Нет данных")}
          hint={d.data.project.costMethodologyConfirmed ? undefined : "методика не согласована"}
          href={reg("")}
        />
        <Stat label="Оплачено" value={fmtMoney(c.paid, cur, "Нет данных")} hint="по данным платежей" />
        <Stat label="Остаток работ (плановая стоимость)" value={fmtMoney(c.remainingCost.sum, cur, "Нет данных")} hint={missing(c.remainingCost.missing)} href={reg("progress=notdone")} />
        <Stat label="Статей с превышением бюджета" value={c.overrunCount} hint={c.overrunPreliminary ? "предварительно" : undefined} href={reg("deviation=overrun")} tone={c.overrunCount ? "red" : undefined} />
        <Stat label="Статей без договора" value={c.uncoveredCount} href={reg("contract=uncovered")} tone={c.uncoveredCount ? "yellow" : undefined} />
        <Stat
          label="Требуют проверки"
          value={c.reviewCount}
          hint={[
            c.reviewBreakdown.draftVersions && `черновики смет: ${c.reviewBreakdown.draftVersions}`,
            c.reviewBreakdown.pendingJobs && `импорты: ${c.reviewBreakdown.pendingJobs}`,
            c.reviewBreakdown.reviewContracts && `договоры: ${c.reviewBreakdown.reviewContracts}`,
            c.reviewBreakdown.unclassified && `операции 1С: ${c.reviewBreakdown.unclassified}`,
          ].filter(Boolean).join(", ") || undefined}
          href={`/projects/${projectId}/estimate`}
          tone={c.reviewCount ? "yellow" : undefined}
        />
        <Stat label="Статьи, требующие внимания" value={d.data.rows.filter((r) => r.level === "red" || r.level === "yellow").length} hint="красные и жёлтые" href={reg("level=attention")} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Физическая готовность по этапам">
          {d.stages.length === 0 ? (
            <EmptyState>Нет статей.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {d.stages.map((s) => {
                const pct = s.weightedPercent === null ? null : Math.max(0, Math.min(100, Number(s.weightedPercent)));
                return (
                  <li key={s.id ?? "none"}>
                    <Link href={reg(s.id ? `stage=${s.id}` : "stage=none")} className="group block">
                      <div className="flex justify-between text-sm">
                        <span className="group-hover:underline">{s.name}</span>
                        <span className="tabular-nums font-medium">{s.weightedPercent === null ? "Нет данных" : fmtPct(s.weightedPercent)}</span>
                      </div>
                      <div className="mt-1 h-2 rounded bg-slate-100" role="img" aria-label={`Готовность ${s.weightedPercent === null ? "нет данных" : fmtPct(s.weightedPercent)}`}>
                        {pct !== null && <div className="h-2 rounded bg-blue-600" style={{ width: `${pct}%` }} title={`${fmtMoney(s.earned, cur)} из ${fmtMoney(s.plannedCost, cur)}`} />}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {s.items} статей{s.itemsWithoutProgress ? ` · без данных о выполнении: ${s.itemsWithoutProgress}` : ""}{s.itemsWithoutPlan ? ` · без плана: ${s.itemsWithoutPlan}` : ""}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">Готовность этапа = расчётная стоимость выполненного / плановая стоимость (взвешено по стоимости статей).</p>
        </Card>

        <Card title="План и факт по этапам">
          {d.stages.length === 0 ? (
            <EmptyState>Нет статей.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base text-xs">
                <thead><tr><th>Этап</th><th className="text-right">Плановая стоимость</th><th className="text-right">Выполнено (расчётно)</th><th className="text-right">Подписанные АВР</th><th className="text-right">Затраты 1С</th></tr></thead>
                <tbody>
                  {d.stages.map((s) => (
                    <tr key={s.id ?? "none"}>
                      <td><Link className="link" href={reg(s.id ? `stage=${s.id}` : "stage=none")}>{s.name}</Link></td>
                      <td className="num">{fmtMoney(s.plannedCost, cur)}</td>
                      <td className="num">{fmtMoney(s.earned, cur)}</td>
                      <td className="num">{fmtMoney(s.acts, cur)}</td>
                      <td className="num">{fmtMoney(s.cost, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">«—» означает отсутствие данных, а не ноль.</p>
        </Card>

        <RowList title="Максимальное превышение затрат" rows={d.topOverruns} projectId={projectId} empty="Превышений нет или нет данных о затратах." value={(r) => <span className="text-red-700">+{fmtMoney(r.variance, cur)}</span>} more={reg("deviation=overrun")} />
        <RowList title="Работы без договора" rows={d.uncoveredTop} projectId={projectId} empty="Все действующие статьи покрыты договорами." value={(r) => fmtMoney(r.plannedCost, cur, "нет стоимости")} more={reg("contract=uncovered")} />
        <RowList title="Незавершённые работы с просроченным сроком" rows={d.overdue} projectId={projectId} empty="Просроченных работ нет (или не заданы плановые сроки)." value={(r) => <>{fmtDate(r.plannedEndDate)} · {fmtPct(r.percentDisplay, "нет данных")}</>} more={reg("overdue=1")} />

        <Card title="Последние изменения">
          {d.audit.length === 0 ? (
            <EmptyState>Изменений нет.</EmptyState>
          ) : (
            <ul className="space-y-1 text-xs">
              {d.audit.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="whitespace-nowrap text-slate-500">{fmtDateTime(a.createdAt)}</span>
                  <span>{a.user?.name ?? "система"}</span>
                  <span className="text-slate-700">{ACTION_LABELS[a.action] ?? a.action}</span>
                  {a.comment && <span className="truncate text-slate-500">— {a.comment}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}


function RowList({
  title,
  rows,
  projectId,
  empty,
  value,
  more,
}: {
  title: string;
  rows: RegistryRowDTO[];
  projectId: string;
  empty: string;
  value: (r: RegistryRowDTO) => React.ReactNode;
  more: string;
}) {
  return (
    <Card title={title} actions={<Link href={more} className="link text-xs">Все в реестре</Link>}>
      {rows.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-3 py-1.5">
              <Link href={`/projects/${projectId}/items/${r.id}`} className="link truncate">
                {r.code && <span className="mr-1 font-mono text-xs text-slate-500">{r.code}</span>}
                {r.name}
              </Link>
              <span className="whitespace-nowrap tabular-nums text-xs">{value(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
