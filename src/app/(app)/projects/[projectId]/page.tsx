import Link from "next/link";
import { requireProjectAccess } from "@/lib/server/auth";
import { loadDashboard } from "@/lib/server/dashboard";
import { syncIssuesIfStale } from "@/lib/server/services/issues";
import { Badge, Card, EmptyState, Stat } from "@/components/ui";
import { BarList, CoverageBar, MonthColumns, PairBars } from "@/components/charts";
import { fmtDate, fmtDateTime, fmtMoney, fmtPct } from "@/lib/format";
import { ACTION_LABELS } from "@/lib/auditLabels";
import type { RegistryRowDTO } from "@/lib/server/registry";

export default async function DashboardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);
  if (access.can("issue.view")) await syncIssuesIfStale(projectId);
  const d = await loadDashboard(projectId);
  const c = d.cards;
  const cur = d.data.project.currency;
  const p = `/projects/${projectId}`;
  const reg = (q: string) => `${p}/registry${q ? "?" + q : ""}`;
  const ex = (m: string) => `${p}/explain?metric=${m}`;
  const missing = (n: number) => (n > 0 ? `без данных: ${n} ст.` : undefined);
  const canAcc = access.can("accounting.view");
  const canContracts = access.can("contract.view");
  const canActs = access.can("act.view");
  const NA = "Нет доступа";

  if (!d.data.currentVersion && d.data.rows.length === 0) {
    return (
      <EmptyState>
        В проекте ещё нет утверждённой сметы. <Link className="link" href={`${p}/estimate`}>Загрузите смету</Link>, проверьте её и утвердите — после этого появятся реестр работ и показатели.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="sr-only">Панель проекта</h1>
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 text-xs text-slate-600">
        <span>Данные актуальны на <b>{fmtDateTime(d.data.computedAt)}</b></span>
        <span>Смета: {d.data.currentVersion ? `v${d.data.currentVersion.versionNumber} «${d.data.currentVersion.name}»` : "не утверждена"}</span>
        <span>Последний импорт 1С: <b>{d.lastImport1C ? fmtDateTime(d.lastImport1C) : "не выполнялся"}</b></span>
        <span>Проверка данных: {d.openIssues === 0 ? <Badge tone="green">проблем нет</Badge> : <Link href={`${p}/issues`}><Badge tone={d.criticalIssues ? "red" : "yellow"}>открытых проблем: {d.openIssues}{d.criticalIssues ? `, важных: ${d.criticalIssues}` : ""}</Badge></Link>}</span>
      </div>
      {d.warnings.length > 0 && (
        <details className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" open={d.warnings.length <= 3}>
          <summary className="cursor-pointer font-medium">Неполнота данных ({d.warnings.length})</summary>
          <ul className="mt-1 list-disc pl-5">{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Смета и договоры</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Первоначальная утверждённая смета" value={fmtMoney(c.baselineTotal, cur, "Нет данных")} hint={d.data.baselineVersion ? `v${d.data.baselineVersion.versionNumber} · расшифровка` : undefined} href={ex("baselineCost")} />
          <Stat label="Текущая утверждённая смета" value={fmtMoney(c.currentTotal, cur, "Нет данных")} hint="расшифровка" href={ex("plannedCost")} />
          {canContracts ? <Stat label="Сумма действующих договоров" value={fmtMoney(c.contractsTotal, cur, "Нет данных")} hint={`${c.contractsCount} договоров${c.contractsIncomplete ? `, без суммы: ${c.contractsIncomplete}` : ""}`} href={ex("contractsTotal")} /> : <Stat label="Сумма действующих договоров" value={NA} />}
          <Stat label="Договорное покрытие" value={canContracts ? fmtPct(c.coveragePercent, "Нет данных") : NA} hint={canContracts ? "по плановой стоимости статей" : undefined} href={canContracts ? reg("contract=covered") : undefined} />
          {canContracts ? <Stat label="Работы без договора" value={fmtMoney(c.uncoveredValue, cur, "Нет данных")} hint={`${c.uncoveredCount} статей`} href={ex("uncovered")} tone={c.uncoveredCount ? "red" : undefined} /> : <Stat label="Работы без договора" value={NA} />}
          <Stat
            label="Требуют проверки"
            value={c.reviewCount}
            hint={[c.reviewBreakdown.draftVersions && `сметы ${c.reviewBreakdown.draftVersions}`, c.reviewBreakdown.reviewContracts && `договоры ${c.reviewBreakdown.reviewContracts}`, c.reviewBreakdown.recognitions && `АВР по фото ${c.reviewBreakdown.recognitions}`, c.reviewBreakdown.pendingJobs && `импорты ${c.reviewBreakdown.pendingJobs}`, c.reviewBreakdown.proposedTx && `операции 1С ${c.reviewBreakdown.proposedTx}`].filter(Boolean).join(", ") || undefined}
            href={`${p}/issues`}
            tone={c.reviewCount ? "yellow" : undefined}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Выполнение и АВР</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Средневзвешенная физическая готовность" value={fmtPct(c.weightedReadiness, "Нет данных")} hint={c.readinessDataCoverage ? `по статьям с данными (${fmtPct(c.readinessDataCoverage)} плановой стоимости)` : undefined} href={reg("progress=partial")} />
          <Stat label="Стоимость физически выполненного" value={fmtMoney(c.earned.sum, cur, "Нет данных")} hint={missing(c.earned.missing) ?? "расчётно, по расценкам сметы"} href={ex("earned")} />
          {canActs ? <Stat label="Подписанные АВР" value={fmtMoney(c.actsSigned, cur, "Нет данных")} hint="расшифровка" href={ex("actsSigned")} /> : <Stat label="Подписанные АВР" value={NA} />}
          <Stat label="Остаток работ (плановая стоимость)" value={fmtMoney(c.remainingCost.sum, cur, "Нет данных")} hint={missing(c.remainingCost.missing)} href={reg("progress=notdone")} />
          <Stat label="Просроченные статьи" value={c.overdueCount} href={reg("overdue=1")} tone={c.overdueCount ? "red" : undefined} />
          <Stat label="Статьи, требующие внимания" value={d.data.rows.filter((r) => r.level === "red" || r.level === "yellow").length} hint="красные и жёлтые" href={reg("level=attention")} />
        </div>
      </section>

      {canAcc && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Затраты, оплаты, прогноз</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            <Stat label={d.data.project.costMethodologyConfirmed ? "Фактические затраты (1С)" : "Импортированные затраты по 1С"} value={fmtMoney(c.accountingCost.sum, cur, "Нет данных")} hint={d.data.project.costMethodologyConfirmed ? "расшифровка" : "методика не согласована"} href={ex("accountingCost")} />
            <Stat label="Оплачено" value={fmtMoney(c.paid, cur, "Нет данных")} hint="по платежам 1С" href={ex("paid")} />
            <Stat label="Статьи с превышением затрат" value={c.overrunCount} hint={c.overrunPreliminary ? "предварительно" : undefined} href={reg("deviation=overrun")} tone={c.overrunCount ? "red" : undefined} />
            <Stat label="Нераспределённые операции 1С" value={c.unallocatedTx} hint={`без классификации ${c.unclassifiedTx}, затраты без статьи ${c.unallocatedCost}`} href={`${p}/accounting/transactions?status=UNCLASSIFIED`} tone={c.unallocatedTx ? "yellow" : undefined} />
            <Stat label="Прогноз итоговой стоимости" value={c.forecast ? fmtMoney(c.forecast, cur) : "Недостаточно данных"} hint={c.forecast ? "прогноз, не утверждённый бюджет" : c.forecastPartial ? `прогноз есть по ${c.forecastPartial} статьям` : d.data.project.forecastModelConfirmed ? "нет прогноза остатка по статьям" : "модель не подтверждена"} href={`${p}/reports/forecast`} />
            <Stat label="Открытые проблемы" value={d.openIssues} hint={d.criticalIssues ? `важных: ${d.criticalIssues}` : undefined} href={`${p}/issues`} tone={d.criticalIssues ? "red" : d.openIssues ? "yellow" : undefined} />
          </div>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Физическая готовность по корпусам">
          <BarList max={100} format={(v) => fmtPct(v)} items={d.objects.map((o) => ({ key: o.id ?? "none", label: o.name, value: o.weightedPercent === null ? null : Number(o.weightedPercent), href: reg(o.id ? `object=${o.id}` : "object=none"), hint: `${o.items} статей${o.itemsWithoutProgress ? ` · без данных: ${o.itemsWithoutProgress}` : ""}` }))} />
        </Card>
        <Card title="Физическая готовность по этапам">
          <BarList max={100} format={(v) => fmtPct(v)} items={d.stages.map((o) => ({ key: o.id ?? "none", label: o.name, value: o.weightedPercent === null ? null : Number(o.weightedPercent), href: reg(o.id ? `stage=${o.id}` : "stage=none"), hint: `${o.items} статей${o.itemsWithoutProgress ? ` · без данных: ${o.itemsWithoutProgress}` : ""}` }))} />
          <p className="mt-3 text-xs text-slate-500">Готовность = расчётная стоимость выполненного / плановая стоимость статей, по которым внесено выполнение. Статьи без данных не считаются нулевыми.</p>
        </Card>
        <Card title="Плановая и расчётная стоимость выполненного по этапам">
          <PairBars currency={cur} labels={["Плановая стоимость", "Выполнено (расчётно)"]} items={d.stages.map((s) => ({ key: s.id ?? "none", label: s.name, a: s.plannedCost === null ? null : Number(s.plannedCost), b: s.earned === null ? null : Number(s.earned), href: reg(s.id ? `stage=${s.id}` : "stage=none") }))} />
        </Card>
        {canContracts && <Card title="Договорное покрытие">
          <CoverageBar covered={c.coveredValue === null ? null : Number(c.coveredValue)} uncovered={c.uncoveredValue === null ? null : Number(c.uncoveredValue)} percent={c.coveragePercent} currency={cur} href={reg("contract=uncovered")} />
          <div className="mt-4">
            <RowList title="Крупнейшие работы без договора" rows={d.uncoveredTop} projectId={projectId} empty="Все действующие статьи покрыты договорами." value={(r) => fmtMoney(r.plannedCost, cur, "нет стоимости")} more={reg("contract=uncovered")} />
          </div>
        </Card>}
        {canActs && <Card title="Подписанные АВР по месяцам">
          <MonthColumns points={d.actsByMonth} currency={cur} emptyText="Подписанных АВР нет" />
        </Card>}
        {canAcc && (
          <Card title="Динамика затрат по данным 1С (по месяцам)">
            <MonthColumns points={d.costByMonth} currency={cur} emptyText="Подтверждённых затрат нет" />
          </Card>
        )}
        {canAcc && (
          <Card title="Распределение затрат 1С по разделам сметы">
            <BarList format={(v) => fmtMoney(v, cur)} items={d.sections.filter((s) => s.cost !== null).map((s) => ({ key: s.id ?? "none", label: s.name, value: Number(s.cost), href: reg(s.id ? `section=${s.id}` : "section=none"), hint: `план ${fmtMoney(s.plannedCost, cur)}` }))} emptyText="Затраты ещё не распределены по статьям" />
          </Card>
        )}
        {canAcc && <Card title="Наиболее значительные отклонения затрат">
          <RowList title="" rows={d.topDeviations} projectId={projectId} empty="Превышений нет или нет данных о затратах." value={(r) => <span className="text-red-700">+{fmtMoney(r.variance, cur)}</span>} more={reg("deviation=overrun")} />
        </Card>}
        <Card title="Незавершённые работы с просроченным сроком">
          <RowList title="" rows={d.overdue} projectId={projectId} empty="Просроченных работ нет (или не заданы плановые сроки)." value={(r) => <>{fmtDate(r.plannedEndDate)} · {fmtPct(r.percentDisplay, "нет данных")}</>} more={reg("overdue=1")} />
        </Card>
        <Card title="Последние изменения">
          {d.audit.length === 0 ? <EmptyState>Изменений нет.</EmptyState> : (
            <ul className="space-y-1 text-xs">
              {d.audit.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="whitespace-nowrap text-slate-500">{fmtDateTime(a.createdAt)}</span>
                  <span>{a.user?.name ?? "система"}</span>
                  <span className="text-slate-700">{ACTION_LABELS[a.action] ?? a.action}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function RowList({ title, rows, projectId, empty, value, more }: { title: string; rows: RegistryRowDTO[]; projectId: string; empty: string; value: (r: RegistryRowDTO) => React.ReactNode; more: string }) {
  return (
    <div>
      {title && <div className="mb-1 flex justify-between text-xs font-semibold text-slate-600"><span>{title}</span><Link href={more} className="link font-normal">Все в реестре</Link></div>}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-3 py-1.5">
              <Link href={`/projects/${projectId}/items/${r.id}`} className="link truncate">
                {r.code && <span className="mr-1 font-mono text-xs text-slate-500">{r.code}</span>}
                {r.name}
              </Link>
              <span className="whitespace-nowrap text-xs tabular-nums">{value(r)}</span>
            </li>
          ))}
        </ul>
      )}
      {!title && rows.length > 0 && <Link href={more} className="link mt-2 inline-block text-xs">Все в реестре</Link>}
    </div>
  );
}
