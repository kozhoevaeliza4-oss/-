import { chromium } from "playwright";
const S = process.env.QA_OUT_DIR ?? "./qa-out";
const DATA = process.env.QA_DATA_DIR ?? "./qa-data";
const B = (process.env.QA_BASE_URL ?? "http://localhost:3000");
const P = B + "/projects/" + process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
const errors = [], results = [];
let step = "";
page.on("pageerror", (e) => errors.push(`${step} :: ${e.message.slice(0, 200)}`));
page.on("console", (m) => m.type() === "error" && !/404|Failed to load resource/.test(m.text()) && errors.push(`${step} :: ${m.text().slice(0, 200)}`));
page.on("dialog", (d) => d.accept());
async function t(name, fn) {
  step = name;
  try { results.push(["PASS", name, (await fn()) ?? ""]); }
  catch (e) { results.push(["FAIL", name, e.message.split("\n")[0].slice(0, 300)]); await page.screenshot({ path: `${S}/neg-fail-${results.length}.png`, fullPage: true }).catch(() => {}); }
}
const alertText = async () => (await page.locator("p[role=alert], div[role=alert]:not(#__next-route-announcer__)").first().textContent({ timeout: 15000 })).trim();
await page.goto(B + "/login");
await page.fill("input[name=email]", (process.env.QA_EMAIL ?? "admin@example.local"));
await page.fill("input[name=password]", (process.env.QA_PASSWORD ?? "change-me-please"));
await page.click("button[type=submit]");
await page.waitForURL(B + "/", { waitUntil: "commit" });

for (const [label, file] of [["повреждённый xlsx", "broken.xlsx"], ["пустой файл", "empty.csv"], ["exe под видом сметы", "script.exe"], ["xlsx без заголовков", "noheaders.xlsx"]]) {
  await t(`Смета: ${label} — понятная ошибка`, async () => {
    await page.goto(P + "/estimate");
    await page.setInputFiles("input[type=file]", `${DATA}/${file}`);
    await page.fill("input[name=name]", "негатив");
    await page.click("text=Загрузить и проверить");
    await page.waitForTimeout(1500);
    if (/import\//.test(page.url())) {
      const body = await page.locator("body").innerText();
      const m = body.match(/(Ошибок: \d+|Не выбран[^\n]*|Не удалось[^\n]*)/);
      if (!m) throw new Error("принят без ошибок: " + page.url());
      return "предпросмотр: " + m[0];
    }
    return await alertText();
  });
}
await t("1С: пустой файл", async () => {
  await page.goto(P + "/accounting");
  await page.setInputFiles("input[type=file]", `${DATA}/empty.csv`);
  await page.click("text=Загрузить и проверить");
  return await alertText();
});
await t("1С: повреждённый xlsx", async () => {
  await page.goto(P + "/accounting");
  await page.setInputFiles("input[type=file]", `${DATA}/broken.xlsx`);
  await page.click("text=Загрузить и проверить");
  return await alertText();
});
await t("АВР по фото: HTML под видом jpg", async () => {
  await page.goto(P + "/acts/capture");
  await page.locator("input[type=file][multiple]").setInputFiles(`${DATA}/fake.jpg`);
  await page.waitForSelector("text=Стр. 1");
  await page.click("button:has-text('Распознать')");
  await page.waitForTimeout(2500);
  if (/recognition\//.test(page.url())) throw new Error("файл принят: " + page.url());
  return await alertText();
});
await t("Договор: отрицательная сумма отклонена", async () => {
  await page.goto(P + "/contracts/new");
  await page.click("button:has-text('Новый')");
  await page.fill("input[name=newContractorName]", "ОсОО Негатив");
  await page.fill("input[name=number]", "NEG-1");
  await page.fill("input[name=totalAmount]", "-5000");
  await page.click("text=Сохранить реквизиты");
  await page.waitForTimeout(1500);
  if (/contracts\/c[a-z0-9]+/.test(page.url())) throw new Error("договор с отрицательной суммой создан");
  return await alertText();
});
await t("Договор: нечисловая/огромная сумма отклонена", async () => {
  await page.goto(P + "/contracts/new");
  await page.click("button:has-text('Новый')");
  await page.fill("input[name=newContractorName]", "ОсОО Негатив");
  await page.fill("input[name=number]", "NEG-2");
  await page.fill("input[name=totalAmount]", "1e99");
  await page.click("text=Сохранить реквизиты");
  await page.waitForTimeout(1500);
  if (/contracts\/c[a-z0-9]+/.test(page.url())) throw new Error("создан с суммой 1e99");
  return await alertText();
});
await t("Договор: двойной клик создаёт одну запись", async () => {
  await page.goto(P + "/contracts/new");
  await page.click("button:has-text('Новый')");
  const num = "DBL-" + Date.now();
  await page.fill("input[name=newContractorName]", "ОсОО Двойной");
  await page.fill("input[name=number]", num);
  await page.fill("input[name=totalAmount]", "1000");
  await page.locator("button:has-text('Сохранить реквизиты')").dblclick();
  await page.waitForURL(/contracts\/c[a-z0-9]+/, { waitUntil: "commit" });
  await page.goto(P + "/contracts?q=" + num);
  const n = await page.locator(`tbody tr:has-text("${num}")`).count();
  if (n !== 1) throw new Error("записей: " + n);
  return "записей: 1";
});
await t("Выполнение: отрицательный объём отклонён", async () => {
  await page.goto(P + "/registry");
  await page.locator("tbody a").first().click();
  await page.waitForURL(/items\//, { waitUntil: "commit" });
  await page.fill("input[name=quantity]", "-10");
  await page.fill("textarea[name=comment]", "негатив");
  await page.click("text=Сохранить выполнение");
  return await alertText();
});
await t("Выполнение: дата в будущем отклонена", async () => {
  await page.fill("input[name=quantity]", "10");
  await page.fill("input[name=asOfDate]", "2030-01-01");
  await page.click("text=Сохранить выполнение");
  const a = await alertText().catch(() => null);
  if (!a) throw new Error("будущая дата принята");
  return a;
});
await t("Просроченная сессия: действие отклоняется, данные не меняются", async () => {
  await page.goto(P + "/contracts/new");
  await ctx.clearCookies();
  await page.click("button:has-text('Новый')");
  await page.fill("input[name=newContractorName]", "ОсОО Без сессии");
  await page.fill("input[name=number]", "NOSESS");
  await page.click("text=Сохранить реквизиты");
  await page.waitForTimeout(2000);
  const url = page.url();
  const a = await page.locator("p[role=alert], div[role=alert]:not(#__next-route-announcer__)").first().textContent().catch(() => "");
  if (/contracts\/c[a-z0-9]+/.test(url)) throw new Error("создано без сессии");
  return url.includes("/login") ? "перенаправлено на вход" : "сообщение: " + a;
});
for (const r of results) console.log(r.join(" | "));
console.log("errors:", errors);
await browser.close();
