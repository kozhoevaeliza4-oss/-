/**
 * Права доступа. Роли — настраиваемые наборы этих прав (таблица Role).
 * Права проверяются на сервере в каждом действии и маршруте.
 */
export const PERMISSIONS = {
  "project.view": "Просмотр проекта и реестра",
  "project.manage": "Управление проектом, корпусами и этапами",
  "project.members": "Управление участниками проекта",
  "estimate.import": "Загрузка смет",
  "estimate.approve": "Утверждение версий смет",
  "workitem.edit": "Редактирование статей реестра",
  "progress.update": "Обновление физического выполнения",
  "progress.confirmOverrun": "Подтверждение превышения объёмов",
  "contract.view": "Просмотр договоров",
  "contract.edit": "Загрузка и редактирование договоров",
  "contract.verify": "Подтверждение договоров и распределений",
  "act.view": "Просмотр АВР",
  "act.edit": "Ввод и изменение АВР",
  "accounting.view": "Просмотр данных 1С",
  "accounting.import": "Импорт выгрузок 1С",
  "accounting.classify": "Классификация операций 1С",
  "finance.settings": "Подтверждение методики учёта и прогноза",
  "document.download": "Скачивание документов",
  "report.export": "Экспорт отчётов",
  "audit.view": "Просмотр журнала действий",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export interface RoleTemplate {
  code: string;
  name: string;
  description: string;
  permissions: Permission[];
}

/** Роли по умолчанию. Администратор может изменить их состав. */
export const DEFAULT_ROLES: RoleTemplate[] = [
  {
    code: "admin",
    name: "Администратор",
    description: "Полный доступ к проекту",
    permissions: ALL_PERMISSIONS,
  },
  {
    code: "project_manager",
    name: "Руководитель проекта",
    description: "Управление проектом, утверждение смет и договоров",
    permissions: [
      "project.view", "project.manage", "project.members", "estimate.import", "estimate.approve",
      "workitem.edit", "progress.update", "progress.confirmOverrun", "contract.view", "contract.edit",
      "contract.verify", "act.view", "act.edit", "accounting.view", "document.download", "report.export", "audit.view",
    ],
  },
  {
    code: "pto",
    name: "ПТО",
    description: "Сметы, объёмы, выполнение, АВР",
    permissions: [
      "project.view", "estimate.import", "workitem.edit", "progress.update", "contract.view", "contract.edit",
      "act.view", "act.edit", "document.download", "report.export",
    ],
  },
  {
    code: "finance",
    name: "Финансы/бухгалтерия",
    description: "Импорт 1С, классификация затрат, оплаты",
    permissions: [
      "project.view", "contract.view", "act.view", "accounting.view", "accounting.import", "accounting.classify",
      "finance.settings", "document.download", "report.export",
    ],
  },
  {
    code: "reviewer",
    name: "Проверяющий",
    description: "Просмотр всех данных и журнала, без изменений",
    permissions: ["project.view", "contract.view", "act.view", "accounting.view", "document.download", "report.export", "audit.view"],
  },
  {
    code: "viewer",
    name: "Наблюдатель",
    description: "Только просмотр реестра",
    permissions: ["project.view"],
  },
];
