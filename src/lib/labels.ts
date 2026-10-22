/** Подписи статусов (единые для интерфейса, отчётов и экспорта). */
export type LabelTone = "green" | "yellow" | "red" | "grey" | "blue";

export const CONTRACT_STATUS: Record<string, { label: string; tone: LabelTone }> = {
  UPLOADED_NEEDS_REVIEW: { label: "Загружен, требуется проверка", tone: "yellow" },
  ACTIVE: { label: "Подписан и действует", tone: "green" },
  COMPLETED: { label: "Завершён", tone: "blue" },
  TERMINATED: { label: "Расторгнут", tone: "red" },
  NEEDS_CLARIFICATION: { label: "Требует уточнения", tone: "yellow" },
};

export const SIGNING_STATUS: Record<string, { label: string; tone: LabelTone }> = {
  UNKNOWN: { label: "Подписание не установлено", tone: "grey" },
  NOT_SIGNED: { label: "Не подписан", tone: "red" },
  PARTIALLY_SIGNED: { label: "Подписан одной стороной", tone: "yellow" },
  SIGNED: { label: "Подписан сторонами", tone: "green" },
};

export const ALLOCATION_STATUS: Record<string, { label: string; tone: LabelTone }> = {
  PROPOSED: { label: "Предложено", tone: "yellow" },
  CONFIRMED: { label: "Подтверждено", tone: "green" },
  REJECTED: { label: "Отклонено", tone: "grey" },
};

export const ACT_STATUS: Record<string, { label: string; tone: LabelTone }> = {
  DRAFT: { label: "Черновик", tone: "grey" },
  ON_APPROVAL: { label: "На согласовании", tone: "yellow" },
  SIGNED: { label: "Подписан", tone: "green" },
  REJECTED: { label: "Отклонён", tone: "red" },
  CORRECTED: { label: "Скорректирован (заменён)", tone: "grey" },
  ANNULLED: { label: "Аннулирован", tone: "grey" },
};

export const RECOGNITION_STATUS: Record<string, { label: string; tone: LabelTone }> = {
  UPLOADED: { label: "Загружен", tone: "grey" },
  QUEUED: { label: "Ожидает распознавания", tone: "grey" },
  RECOGNIZING: { label: "Распознаётся", tone: "blue" },
  NEEDS_REVIEW: { label: "Требует проверки", tone: "yellow" },
  REVIEWED: { label: "Проверен пользователем", tone: "blue" },
  CONFIRMED: { label: "Подтверждён и сохранён", tone: "green" },
  FAILED: { label: "Ошибка распознавания", tone: "red" },
  CANCELLED: { label: "Отменён", tone: "grey" },
};

export const TRANSACTION_CATEGORY: Record<string, string> = {
  UNCLASSIFIED: "Не классифицировано",
  COST: "Затраты",
  ADJUSTMENT: "Корректировка",
  REVERSAL: "Сторно",
  INTERNAL_TRANSFER: "Внутреннее перемещение",
  SETTLEMENT: "Расчёты с контрагентами",
  PAYMENT: "Платёж",
  OTHER: "Прочее",
};

export const CLASSIFICATION_STATUS: Record<string, { label: string; tone: LabelTone }> = {
  UNCLASSIFIED: { label: "Требует классификации", tone: "red" },
  PROPOSED: { label: "Предложено правилом", tone: "yellow" },
  CONFIRMED: { label: "Подтверждено", tone: "green" },
  EXCLUDED: { label: "Исключено", tone: "grey" },
};

export const ISSUE_STATUS: Record<string, { label: string; tone: LabelTone }> = {
  NEW: { label: "Новая", tone: "red" },
  ASSIGNED: { label: "Назначена", tone: "yellow" },
  IN_REVIEW: { label: "На проверке", tone: "yellow" },
  NEEDS_DECISION: { label: "Требует решения", tone: "red" },
  RESOLVED: { label: "Устранена", tone: "green" },
  CLOSED_EXCEPTION: { label: "Закрыта с исключением", tone: "grey" },
};

export const ISSUE_SEVERITY: Record<string, { label: string; tone: LabelTone }> = {
  LOW: { label: "Низкая", tone: "grey" },
  MEDIUM: { label: "Средняя", tone: "yellow" },
  HIGH: { label: "Высокая", tone: "red" },
  CRITICAL: { label: "Критическая", tone: "red" },
};
