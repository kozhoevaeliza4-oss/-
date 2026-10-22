import type { Tone } from "@/components/ui";

export const VERSION_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Черновик — ожидает утверждения", tone: "yellow" },
  ACTIVE: { label: "Действующая", tone: "green" },
  SUPERSEDED: { label: "Заменена (история)", tone: "grey" },
  REJECTED: { label: "Отклонена", tone: "red" },
};

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  PARSED: { label: "Ожидает проверки", tone: "yellow" },
  CONFIRMED: { label: "Подтверждён", tone: "green" },
  CANCELLED: { label: "Отменён", tone: "grey" },
  FAILED: { label: "Ошибка", tone: "red" },
};
