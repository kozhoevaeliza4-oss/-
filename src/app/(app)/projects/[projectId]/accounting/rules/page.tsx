import { prisma } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/auth";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { TRANSACTION_CATEGORY } from "@/lib/labels";
import { RuleForm } from "./RuleForm";
import { applyRulesAction, createRuleAction, ruleToggleAction } from "../actions";

export default async function RulesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId, "accounting.view");
  const [rules, contracts] = await Promise.all([
    prisma.classificationRule.findMany({ where: { projectId }, orderBy: { priority: "asc" }, include: { workItem: true, contract: true, _count: { select: { transactions: true } } } }),
    prisma.contract.findMany({ where: { projectId }, include: { contractor: true } }),
  ]);
  const can = access.can("accounting.classify");
  return (
    <>
      <PageHeader title="Правила классификации 1С" subtitle="Правила предлагают категорию, статью и договор. Результат всегда подтверждает бухгалтерия." actions={can && <ActionButton action={applyRulesAction.bind(null, projectId)} label="Применить к неклассифицированным" className="btn-secondary" />} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Правила" className="xl:col-span-2">
          {rules.length === 0 ? <EmptyState>Правил нет. Создайте правила по реальным выгрузкам после согласования с бухгалтерией.</EmptyState> : (
            <table className="table-base text-xs">
              <thead><tr><th>Приоритет</th><th>Название</th><th>Условия (И)</th><th>Результат</th><th className="text-right">Операций</th><th /></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className={r.isActive ? "" : "text-slate-400"}>
                    <td>{r.priority}</td>
                    <td>{r.name} {!r.isActive && <Badge tone="grey">выключено</Badge>}</td>
                    <td>{[r.account && `Дт ${r.account}*`, r.corrAccount && `Кт ${r.corrAccount}*`, r.textContains && `текст содержит «${r.textContains}»`, r.counterpartyContains && `контрагент содержит «${r.counterpartyContains}»`].filter(Boolean).join("; ")}</td>
                    <td>{TRANSACTION_CATEGORY[r.category]}{r.workItem && ` → ${r.workItem.code ?? ""} ${r.workItem.name}`}{r.contract && ` → дог. № ${r.contract.number}`}</td>
                    <td className="num">{r._count.transactions}</td>
                    <td className="space-x-1 whitespace-nowrap">{can && <><ActionButton action={ruleToggleAction.bind(null, projectId, r.id, !r.isActive)} label={r.isActive ? "Выключить" : "Включить"} /><ActionButton action={ruleToggleAction.bind(null, projectId, r.id, "delete")} label="Удалить" confirm="Удалить правило? Уже классифицированные операции не изменятся." /></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {can && <Card title="Новое правило"><RuleForm action={createRuleAction.bind(null, projectId)} projectId={projectId} contracts={contracts.map((c) => ({ id: c.id, label: `№ ${c.number ?? "—"} · ${c.contractor?.name ?? ""}` }))} categories={Object.entries(TRANSACTION_CATEGORY).filter(([k]) => k !== "UNCLASSIFIED")} /></Card>}
      </div>
    </>
  );
}
