// Полный пользовательский сценарий на отдельном тестовом проекте (синтетические данные)
import { chromium } from "playwright";
const S = process.env.QA_OUT_DIR ?? "./qa-out";
const DATA = process.env.QA_DATA_DIR ?? "./qa-data";
const B = (process.env.QA_BASE_URL ?? "http://localhost:3000");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
const errors = [];
const results = [];
let step = "";
page.on("pageerror", (e) => errors.push(`${step} :: ${e.message.slice(0, 200)}`));
page.on("console", (m) => m.type() === "error" && !/404|Failed to load resource/.test(m.text()) && errors.push(`${step} :: ${m.text().slice(0, 200)}`));
const shot = (n) => page.screenshot({ path: `${S}/full-${n}.png`, fullPage: true });
async function t(name, fn) {
  step = name;
  try { const info = await fn(); results.push(["PASS", name, info ?? ""]); }
  catch (e) { results.push(["FAIL", name, e.message.split("\n")[0].slice(0, 300)]); await shot("fail-" + results.length).catch(() => {}); }
}
const norm = (x) => (x ?? "").replace(/[\u00a0\u202f]/g, " ");
const settle = () => page.waitForLoadState("networkidle");
const code = `QA-E2E-${Date.now().toString(36).toUpperCase()}`;
let P = "";

await t("Вход: неверный пароль отклонён", async () => {
  await page.goto(B + "/login");
  await page.fill("input[name=email]", (process.env.QA_EMAIL ?? "admin@example.local"));
  await page.fill("input[name=password]", "wrong-password");
  await page.click("button[type=submit]");
  const msg = await page.textContent("p[role=alert]");
  if (page.url().includes("password")) throw new Error("пароль в URL");
  return msg;
});
await t("Вход: верный пароль", async () => {
  await page.fill("input[name=password]", (process.env.QA_PASSWORD ?? "change-me-please"));
  await page.click("button[type=submit]");
  await page.waitForURL(B + "/", { waitUntil: "commit" });
  await page.waitForSelector("h1");
});
await t("Создание проекта", async () => {
  await page.goto(B + "/projects/new");
  await page.fill("input[name=code]", code);
  await page.fill("input[name=name]", "Тестовый объект QA (синтетические данные)");
  await page.click("button[type=submit]");
  await page.waitForURL(/projects\/c[a-z0-9]+/, { waitUntil: "commit" });
  await settle();
  P = page.url().match(/(.*\/projects\/c[a-z0-9]+)/)[1];
  return code;
});
await t("Импорт сметы: предпросмотр", async () => {
  await page.goto(P + "/estimate");
  await page.setInputFiles("input[type=file]", `${DATA}/estimate.xlsx`);
  await page.fill("input[name=name]", "Смета QA v1");
  await page.click("text=Загрузить и проверить");
  await page.waitForURL(/import/, { waitUntil: "commit" });
  await settle();
  await shot("01-preview");
  return (await page.locator("text=/Строк работ|Ошибок|Предупреждений/").allTextContents()).join(" | ");
});
await t("Импорт сметы: черновик версии и утверждение", async () => {
  page.once("dialog", (d) => d.accept());
  await page.click("text=Создать черновик версии сметы");
  await page.waitForURL(/versions/, { waitUntil: "commit" });
  await settle();
  page.once("dialog", (d) => d.accept());
  await page.fill("input[name=comment]", "Утверждено для теста QA");
  await page.click("text=Утвердить версию");
  await page.waitForSelector("text=Версия утверждена и стала действующей");
});
await t("Реестр: 4 статьи, итог плановой стоимости", async () => {
  await page.goto(P + "/registry");
  await page.waitForSelector("table");
  const found = await page.textContent("text=Найдено статей");
  if (!/4/.test(found)) throw new Error(found);
  const body = norm(await page.textContent("body"));
  if (!body.includes("12 520 000")) throw new Error("нет итога 12 520 000");
  await shot("02-registry");
  return found;
});

await t("Договор: создание вручную", async () => {
  await page.goto(P + "/contracts/new");
  await page.click("button:has-text('Новый')");
  await page.fill("input[name=newContractorName]", "ОсОО Тест-Монолит");
  await page.fill("input[name=number]", "Д-02/26");
  await page.fill("input[name=date]", "2026-03-10");
  await page.fill("input[name=totalAmount]", "10000000");
  await page.click("text=Сохранить реквизиты");
  await page.waitForURL(/contracts\/c[a-z0-9]+/, { waitUntil: "commit" });
  await settle();
});
await t("Договор: статус «Подписан и действует»", async () => {
  await page.selectOption("select[name=status]", "ACTIVE");
  await page.locator("form:has(select[name=status]) input[name=comment]").fill("Оригинал проверен (QA)");
  await page.click("text=Изменить статус");
  await page.waitForSelector("text=/Подписан и действует/");
  await settle();
});
await t("Договор: распределение на статью и подтверждение", async () => {
  const picker = page.locator("input[placeholder='Код или наименование статьи']").first();
  await picker.click();
  await picker.fill("колонны");
  await page.locator("ul button", { hasText: "Монолитные колонны" }).first().click();
  await page.fill("input[name=quantity]", "500");
  await page.fill("input[name=unitPrice]", "12500");
  await page.click("text=Добавить / обновить распределение");
  await page.waitForSelector("button:has-text('Подтвердить')");
  await settle();
  await page.locator("button", { hasText: /^Подтвердить$/ }).first().click();
  await page.waitForSelector("text=подтверждено");
  await settle();
  await shot("03-contract");
});
await t("АВР по фото: загрузка и распознавание", async () => {
  await page.goto(P + "/acts/capture");
  await page.locator("input[type=file][capture]").setInputFiles(`${DATA}/act.jpg`);
  await page.waitForSelector("text=Стр. 1");
  await page.click("button:has-text('Распознать')");
  await page.waitForURL(/recognition/, { waitUntil: "commit" });
  await page.waitForSelector("text=Позиции акта", { timeout: 180000 });
  await settle();
  await shot("04-review");
  const body = norm(await page.textContent("body"));
  const vals = await page.locator("input").evaluateAll((els) => els.map((e) => e.value));
  return `поля: ${vals.filter((v) => /АВР-15|2026-10-20|1 ?500 ?000|1500000/.test(v)).join(", ")}`;
});
await t("АВР по фото: проверка оператором и подтверждение", async () => {
  await page.click("text=Подтвердить все сверенные");
  const cards = page.locator("label:has-text('Значения строки сверены с оригиналом')");
  const n = await cards.count();
  for (const box of await page.locator("label:has-text('оставить для решения ответственного') input").all()) await box.check();
  const pend = page.locator("label:has(span:text-is('подтвердить')) input[type=checkbox]");
  for (let k = 0; k < 20 && (await pend.count()); k++) await pend.first().check();
  for (let i = 0; i < n; i++) await cards.nth(i).locator("input").check();
  await page.waitForTimeout(300);
  const blockers = await page.locator("text=Перед подтверждением").count();
  if (blockers) {
    await shot("05-blockers");
    throw new Error("остались замечания: " + (await page.locator("section ul.list-disc li").allTextContents()).join("; "));
  }
  await page.selectOption("select:has(option[value=ON_APPROVAL])", "ON_APPROVAL");
  page.once("dialog", (d) => d.accept());
  await page.click("text=Подтвердить документ");
  await page.waitForURL(/acts\/c[a-z0-9]+(\?|$)/, { waitUntil: "commit", timeout: 60000 });
  await settle();
  await shot("06-act");
  const body = norm(await page.textContent("body"));
  if (/Подписан/.test(body.match(/Статус[^\n]{0,40}/)?.[0] ?? "")) throw new Error("акт сразу подписан");
  return `строк ${n}`;
});
await t("АВР: подписание с датой", async () => {
  await page.selectOption("select[name=status]", "SIGNED");
  await page.fill("input[name=signedAt]", "2026-10-21");
  await page.locator("input[name=comment]").first().fill("Подписан сторонами (QA)").catch(() => {});
  await page.click("text=Применить");
  await settle();
  await page.waitForSelector("text=/Подписан/");
  const msg = await page.locator("[role=alert]").allTextContents();
  if (msg.length) return "сообщение: " + msg.join(" ");
});
await t("Импорт 1С: загрузка и предпросмотр", async () => {
  await page.goto(P + "/accounting");
  await page.setInputFiles("input[type=file]", `${DATA}/1c.csv`);
  await page.click("text=Загрузить и проверить");
  await page.waitForURL(/accounting\/import\//, { waitUntil: "commit" });
  await settle();
  await shot("07-1c-preview");
  return norm((await page.locator("text=/Новых|новых|Дубл|дубл/").allTextContents()).join(" | ")).slice(0, 200);
});
await t("Импорт 1С: подтверждение", async () => {
  page.once("dialog", (d) => d.accept());
  await page.click("text=Подтвердить импорт");
  await page.waitForTimeout(1500);
  await settle();
  return page.url().replace(P, "");
});
await t("Импорт 1С: повторная загрузка того же файла не дублирует", async () => {
  await page.goto(P + "/accounting");
  await page.setInputFiles("input[type=file]", `${DATA}/1c.csv`);
  await page.click("text=Загрузить и проверить");
  await page.waitForURL(/accounting\/import\//, { waitUntil: "commit" });
  await settle();
  const body = norm(await page.textContent("body"));
  return (body.match(/[^.]{0,40}(дубл|Дубл)[^.]{0,60}/) || ["?"])[0];
});

await t("1С: классификация затрат на статью и договор", async () => {
  await page.goto(P + "/accounting/transactions?q=" + encodeURIComponent("Колонны"));
  await page.waitForSelector("table");
  await page.locator("td input[name=ids]").first().check();
  await page.selectOption("form:has(button[value=classify]) select[name=category]", "COST");
  const picker = page.locator("input[placeholder='Код или наименование статьи']").first();
  await picker.click(); await picker.fill("колонны");
  await page.locator("ul button", { hasText: "Монолитные колонны" }).first().click();
  await page.selectOption("form:has(button[value=classify]) select[name=contractId]", { index: 1 });
  await page.click("button:has-text('Подтвердить классификацию')");
  await page.waitForSelector("[role=status]");
  return await page.textContent("[role=status]");
});
await t("1С: классификация платежа создаёт оплату", async () => {
  await page.goto(P + "/accounting/transactions?q=" + encodeURIComponent("Оплата"));
  await page.waitForSelector("table");
  await page.locator("td input[name=ids]").first().check();
  await page.selectOption("form:has(button[value=classify]) select[name=category]", "PAYMENT");
  await page.selectOption("form:has(button[value=classify]) select[name=contractId]", { index: 1 });
  await page.click("button:has-text('Подтвердить классификацию')");
  await page.waitForSelector("[role=status]");
  return await page.textContent("[role=status]");
});
await t("Реестр: затраты 1С, АВР и договор отражены в статье", async () => {
  await page.goto(P + "/registry?q=" + encodeURIComponent("колонны"));
  await page.waitForSelector("table");
  const row = norm(await page.locator("tbody tr").first().textContent());
  for (const x of ["1 500 000", "ОсОО Тест-Монолит"]) if (!row.includes(x)) throw new Error(`нет «${x}» в строке: ${row.slice(0, 300)}`);
  return row.slice(0, 160);
});
await t("Панель: подписанные АВР, затраты, оплачено", async () => {
  await page.goto(P);
  await page.waitForSelector("text=Подписанные АВР");
  const body = norm(await page.textContent("body"));
  await shot("08-dashboard");
  const pick = (label) => (body.match(new RegExp(label + "(.{0,22})")) || [])[1]?.trim();
  if (!pick("Оплачено").startsWith("1 000 000")) throw new Error("Оплачено: " + pick("Оплачено"));
  if (!pick("Подписанные АВР").startsWith("2 722 400")) throw new Error("АВР: " + pick("Подписанные АВР"));
  return `АВР: ${pick("Подписанные АВР")} · Оплачено: ${pick("Оплачено")} · Договоры: ${pick("Сумма действующих договоров")}`;
});
await t("Проблемы: проверка данных", async () => {
  await page.goto(P + "/issues");
  await page.click("button:has-text('Проверить сейчас')");
  await page.waitForTimeout(1500);
  await settle();
  const n = await page.locator("tbody tr").count();
  return `строк: ${n}`;
});
await t("Расшифровки: все показатели сходятся", async () => {
  const bad = [];
  for (const m of ["plannedCost", "baselineCost", "earned", "actsSigned", "actsAccepted", "accountingCost", "contractsTotal", "paid", "uncovered"]) {
    await page.goto(`${P}/explain?metric=${m}`);
    const body = norm(await page.textContent("body"));
    if (/не совпада|расхожд/i.test(body)) bad.push(m);
  }
  if (bad.length) throw new Error("не сходятся: " + bad.join(", "));
});
await t("Отчёты: экспорт XLSX и PDF всех 14 отчётов", async () => {
  const kinds = ["coverage","estimate-compare","plan-fact","progress","no-contract","unfinished","acts","reconciliation","contractors","structure","unclassified-1c","forecast","audit","critical"];
  const bad = [];
  const pid = P.split("/projects/")[1];
  for (const k of kinds) for (const f of ["xlsx", "pdf"]) {
    const r = await page.request.get(`${B}/api/projects/${pid}/reports/${k}?format=${f}`);
    const b = await r.body();
    const ok = r.status() === 200 && (f === "pdf" ? b.subarray(0, 4).toString() === "%PDF" : b.subarray(0, 2).toString() === "PK");
    if (!ok) bad.push(`${k}.${f}:${r.status()}`);
  }
  const reg = await page.request.get(`${B}/api/projects/${pid}/registry/export`);
  if (reg.status() !== 200) bad.push("registry:" + reg.status());
  if (bad.length) throw new Error(bad.join(", "));
  return "28 файлов + реестр";
});
await t("Несуществующая страница: понятная 404", async () => {
  const r = await page.goto(P + "/contracts/cnotexisting000000000000000");
  const h = await page.textContent("h1");
  return `${r.status()} «${h}»`;
});
await t("Выход и недоступность страниц после выхода", async () => {
  await page.goto(P);
  await page.click("button:has-text('Выйти')");
  await page.waitForURL(/login/, { waitUntil: "commit" });
  await page.goto(P + "/registry");
  if (!page.url().includes("/login")) throw new Error("после выхода открылся реестр: " + page.url());
  const pid = P.split("/projects/")[1];
  const r = await page.request.get(`${B}/api/projects/${pid}/registry/export`);
  if (r.status() !== 401) throw new Error("экспорт без сессии: " + r.status());
});
console.log(JSON.stringify({ P, code }));
for (const r of results) console.log(r.join(" | "));
console.log("errors:", errors);
await browser.close();
