/** Столбцы реестра работ: общий список для таблицы и экспорта в Excel. */
import type { RegistryRowDTO } from "@/lib/server/registry";

export type ColumnKind = "text" | "money" | "qty" | "pct" | "date";

export interface RegistryColumn {
  key: string;
  label: string;
  kind: ColumnKind;
  defaultVisible: boolean;
  value: (r: RegistryRowDTO) => string | null;
  /** Ширина в Excel */
  width?: number;
}

const join = (xs: (string | null)[]) => (xs.filter(Boolean).length ? xs.filter(Boolean).join("; ") : null);

export const REGISTRY_COLUMNS: RegistryColumn[] = [
  { key: "status", label: "Статус", kind: "text", defaultVisible: true, value: (r) => r.levelLabel, width: 18 },
  { key: "code", label: "Код статьи", kind: "text", defaultVisible: true, value: (r) => r.code, width: 16 },
  { key: "section", label: "Раздел сметы", kind: "text", defaultVisible: true, value: (r) => r.sectionName, width: 24 },
  { key: "name", label: "Наименование работы", kind: "text", defaultVisible: true, value: (r) => r.name, width: 50 },
  { key: "object", label: "Корпус", kind: "text", defaultVisible: true, value: (r) => r.objectName, width: 14 },
  { key: "stage", label: "Этап", kind: "text", defaultVisible: false, value: (r) => r.stageName, width: 14 },
  { key: "unit", label: "Ед. изм.", kind: "text", defaultVisible: true, value: (r) => r.unit, width: 8 },
  { key: "plannedQuantity", label: "Плановый объём", kind: "qty", defaultVisible: true, value: (r) => r.plannedQuantity, width: 14 },
  { key: "unitPrice", label: "Плановая цена за ед.", kind: "money", defaultVisible: false, value: (r) => r.unitPrice, width: 14 },
  { key: "plannedCost", label: "Плановая стоимость", kind: "money", defaultVisible: true, value: (r) => r.plannedCost, width: 16 },
  { key: "baselinePlannedCost", label: "Первоначальная плановая стоимость", kind: "money", defaultVisible: false, value: (r) => r.baselinePlannedCost, width: 16 },
  { key: "contractor", label: "Подрядчик", kind: "text", defaultVisible: true, value: (r) => join(r.contractors), width: 24 },
  { key: "contractNumber", label: "Номер договора", kind: "text", defaultVisible: false, value: (r) => join(r.contracts.map((c) => c.number)), width: 14 },
  { key: "contractDate", label: "Дата договора", kind: "text", defaultVisible: false, value: (r) => join(r.contracts.map((c) => c.date)), width: 12 },
  { key: "contractAmount", label: "Сумма договора (по статье)", kind: "money", defaultVisible: false, value: (r) => r.contractAmount, width: 16 },
  { key: "coverage", label: "Статус договорного покрытия", kind: "text", defaultVisible: true, value: (r) => r.coverageLabel, width: 22 },
  { key: "actualQuantity", label: "Фактический объём", kind: "qty", defaultVisible: true, value: (r) => r.actualQuantity, width: 14 },
  { key: "percent", label: "Физическая готовность, %", kind: "pct", defaultVisible: true, value: (r) => r.percentDisplay, width: 12 },
  { key: "overrunQuantity", label: "Превышение объёма", kind: "qty", defaultVisible: false, value: (r) => r.overrunQuantity, width: 12 },
  { key: "earnedValue", label: "Расчётная стоимость выполненного", kind: "money", defaultVisible: true, value: (r) => r.earnedValue, width: 16 },
  { key: "actsAccepted", label: "Стоимость по подписанным АВР", kind: "money", defaultVisible: true, value: (r) => r.actsAccepted, width: 16 },
  { key: "documentedPercent", label: "Документальное подтверждение, %", kind: "pct", defaultVisible: false, value: (r) => r.documentedPercent, width: 12 },
  { key: "accountingCost", label: "Затраты по данным 1С", kind: "money", defaultVisible: true, value: (r) => r.accountingCost, width: 16 },
  { key: "paid", label: "Оплачено", kind: "money", defaultVisible: false, value: (r) => r.paid, width: 14 },
  { key: "remainingQuantity", label: "Остаток работ (объём)", kind: "qty", defaultVisible: true, value: (r) => r.remainingQuantity, width: 14 },
  { key: "remainingCost", label: "Остаток плановой стоимости", kind: "money", defaultVisible: true, value: (r) => r.remainingCost, width: 16 },
  { key: "variance", label: "Отклонение от плана", kind: "money", defaultVisible: true, value: (r) => r.variance, width: 16 },
  { key: "forecast", label: "Прогноз итоговой стоимости", kind: "money", defaultVisible: false, value: (r) => r.forecast, width: 16 },
  { key: "plannedEndDate", label: "Плановая дата завершения", kind: "date", defaultVisible: true, value: (r) => r.plannedEndDate, width: 12 },
  { key: "actualEndDate", label: "Фактическая дата завершения", kind: "date", defaultVisible: false, value: (r) => r.actualEndDate, width: 12 },
  { key: "comment", label: "Комментарий", kind: "text", defaultVisible: false, value: (r) => r.comment, width: 30 },
  { key: "updatedAt", label: "Дата последнего обновления", kind: "date", defaultVisible: false, value: (r) => r.updatedAt.slice(0, 10), width: 12 },
  { key: "sources", label: "Источник и подтверждение данных", kind: "text", defaultVisible: false, value: (r) => join(r.sources), width: 40 },
  { key: "flags", label: "Замечания", kind: "text", defaultVisible: false, value: (r) => join(r.flags.map((f) => f.text)), width: 50 },
];
