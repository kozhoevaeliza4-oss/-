import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { loadContracts, CONTRACT_FLAG_LABELS, ContractFlag } from "@/lib/server/contracts";
import { maxUploadBytes } from "@/lib/server/storage";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDate, fmtMoney } from "@/lib/format";
import { CONTRACT_STATUS, SIGNING_STATUS } from "@/lib/labels";
import { UploadContractForm } from "./ContractForms";
import { uploadContractAction } from "./actions";

export default async function ContractsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ flag?: string; status?: string; contractor?: string; q?: string }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const access = await requireProjectAccess(projectId, "contract.view");
  const [rows, contractors] = await Promise.all([
    loadContracts(projectId),
    prisma.contractor.findMany({ where: { contracts: { some: { projectId } } }, orderBy: { name: "asc" } }),
  ]);
  const q = sp.q?.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!sp.flag || r.flags.includes(sp.flag as ContractFlag)) &&
      (!sp.status || r.status === sp.status) &&
      (!sp.contractor || r.contractorId === sp.contractor) &&
      (!q || `${r.number ?? ""} ${r.contractor ?? ""} ${r.subject ?? ""}`.toLowerCase().includes(q)),
  );
  const counts = Object.fromEntries((Object.keys(CONTRACT_FLAG_LABELS) as ContractFlag[]).map((f) => [f, rows.filter((r) => r.flags.includes(f)).length]));
  const base = `/projects/${projectId}/contracts`;
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `${base}${p.toString() ? "?" + p : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Договоры"
        subtitle="Реестр договоров, проверка извлечённых данных, распределение по статьям сметы"
        actions={
          <>
            <Link href={`/projects/${projectId}/reports/coverage`} className="btn-secondary">Отчёт о договорном покрытии</Link>
            {access.can("contract.edit") && <Link href={`${base}/new`} className="btn-secondary">Ввести вручную</Link>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(CONTRACT_FLAG_LABELS) as ContractFlag[]).map((f) => (
          <Link key={f} href={link({ flag: sp.flag === f ? undefined : f })} className={`rounded border px-2 py-1 text-xs ${sp.flag === f ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-400"}`}>
            {CONTRACT_FLAG_LABELS[f]}: <b>{counts[f]}</b>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-4">
        <div className="space-y-3 xl:col-span-3">
          <form className="card flex flex-wrap items-end gap-2 p-3" action={base}>
            {sp.flag && <input type="hidden" name="flag" value={sp.flag} />}
            <label className="min-w-[200px] flex-1"><span className="label">Поиск</span><input name="q" defaultValue={sp.q} className="input" placeholder="Номер, подрядчик, предмет" /></label>
            <label>
              <span className="label">Статус</span>
              <select name="status" defaultValue={sp.status ?? ""} className="input">
                <option value="">Все</option>
                {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Подрядчик</span>
              <select name="contractor" defaultValue={sp.contractor ?? ""} className="input">
                <option value="">Все</option>
                {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button className="btn-secondary">Применить</button>
            {(sp.q || sp.status || sp.contractor || sp.flag) && <Link href={base} className="btn-secondary">Сбросить</Link>}
          </form>
          <div className="card overflow-x-auto">
            {filtered.length === 0 ? (
              <div className="p-4"><EmptyState>{rows.length ? "Нет договоров по фильтру." : "Договоры ещё не загружены."}</EmptyState></div>
            ) : (
              <table className="table-base text-xs">
                <thead>
                  <tr>
                    <th>Договор</th><th>Подрядчик</th><th>Статус</th><th className="text-right">Сумма (текущая)</th><th className="text-right">Распределено (подтв.)</th>
                    <th className="text-right">Не распределено</th><th className="text-right">План статей</th><th className="text-right">Подписанные АВР</th><th>Окончание</th><th>Контроль</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="min-w-[160px]">
                        <Link className="link font-medium" href={`${base}/${r.id}`}>№ {r.number ?? "без номера"}</Link>
                        <div className="text-slate-500">{fmtDate(r.date)} · {r.itemsCount} ст.</div>
                        {r.subject && <div className="max-w-[260px] truncate text-slate-500" title={r.subject}>{r.subject}</div>}
                      </td>
                      <td>{r.contractor ?? <span className="text-amber-700">не указан</span>}</td>
                      <td className="space-y-1">
                        <Badge tone={CONTRACT_STATUS[r.status].tone}>{CONTRACT_STATUS[r.status].label}</Badge>
                        <div><Badge tone={SIGNING_STATUS[r.signingStatus].tone}>{SIGNING_STATUS[r.signingStatus].label}</Badge></div>
                      </td>
                      <td className="num">{fmtMoney(r.currentAmount, r.currency)}{r.amendmentsDelta && Number(r.amendmentsDelta) !== 0 && <div className="text-slate-500">ДС: {fmtMoney(r.amendmentsDelta, r.currency)}</div>}</td>
                      <td className="num">{fmtMoney(r.allocatedConfirmed, r.currency)}{r.allocatedProposed && <div className="text-amber-700">предл.: {fmtMoney(r.allocatedProposed, r.currency)}</div>}</td>
                      <td className={`num ${r.unallocated && Number(r.unallocated) < 0 ? "text-red-700" : ""}`}>{fmtMoney(r.unallocated, r.currency)}</td>
                      <td className="num">{fmtMoney(r.plannedCostOfItems, r.currency)}</td>
                      <td className="num">{fmtMoney(r.actsAccepted, r.currency)}</td>
                      <td className={r.flags.includes("EXPIRED") ? "font-semibold text-red-700" : ""}>{fmtDate(r.endDate)}</td>
                      <td className="min-w-[180px] space-y-0.5">
                        {r.flags.length === 0 ? <Badge tone="green">Замечаний нет</Badge> : r.flags.map((f) => (
                          <div key={f}><Badge tone={["OVER_ALLOCATED", "EXPIRED", "ACTS_OVER_CONTRACT", "NO_ITEMS"].includes(f) ? "red" : "yellow"}>{CONTRACT_FLAG_LABELS[f]}</Badge></div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="space-y-4">
          {access.can("contract.edit") && (
            <Card title="Загрузить договор">
              <UploadContractForm action={uploadContractAction.bind(null, projectId)} maxMb={Math.round(maxUploadBytes() / 1048576)} />
            </Card>
          )}
          <Card title="Правила учёта">
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
              <li>Покрытие статьи даёт только подтверждённое распределение на договор «действует» или «завершён».</li>
              <li>Текущая сумма = исходная + подписанные доп. соглашения.</li>
              <li>Сумма распределений не превышает текущую сумму без исключения с обоснованием.</li>
              <li>Статус подписания и статус действительности ведутся отдельно.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
