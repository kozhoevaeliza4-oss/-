// Список компаний для первичного заведения учётных записей — используется
// и разовым скриптом (server/scripts/seedCompanies.js), и автозасевом при
// первом запуске сервера (см. ./ensureSeeded.js, нужен для деплоя на
// хостинги без доступа к консоли, например бесплатный тариф Render).

const DEFAULT_COMPANIES = [
  { login: 'nurzaman-yug', name: 'ОсОО СК «Нурзаман-Юг»' },
  { login: 'nurzaman-group', name: 'ОсОО СК «Нурзаман-групп»' },
  { login: 'nurzaman-trc', name: 'ОсОО ТРЦ «Нурзаман»' },
  { login: 'nurzaman-plaza', name: 'ОсОО «Нурзаман плаза»' },
];

module.exports = { DEFAULT_COMPANIES };
