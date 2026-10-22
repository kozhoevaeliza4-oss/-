import { chromium } from "playwright";
const S = process.argv[2];
const B = (process.env.QA_BASE_URL ?? "http://localhost:3000");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !/404|favicon/.test(m.text()) && errors.push(`${page.url()} :: ${m.text()}`));
await page.goto(B + "/login");
await page.fill("input[name=email]", (process.env.QA_EMAIL ?? "admin@example.local"));
await page.fill("input[name=password]", (process.env.QA_PASSWORD ?? "change-me-please"));
await page.click("button[type=submit]");
await page.waitForURL(B + "/", { waitUntil: "commit" });
await page.waitForSelector("h1");
const href = await page.locator("a", { hasText: "Жилой" }).first().getAttribute("href");
const P = B + href;
const paths = ["", "/registry", "/registry?contract=uncovered&sort=plannedCost:desc", "/registry?asOf=2026-06-01", "/estimate", "/contracts", "/acts", "/acts/capture", "/acts/new", "/accounting", "/accounting/transactions", "/accounting/rules", "/issues", "/reports", "/structure", "/members", "/audit", "/explain?metric=plannedCost", "/explain?metric=contractsTotal", "/explain?metric=actsSigned", "/explain?metric=earned"];
const reports = ["coverage","estimate-compare","plan-fact","progress","no-contract","unfinished","acts","reconciliation","contractors","structure","unclassified-1c","forecast","audit","critical"];
for (const r of reports) paths.push(`/reports/${r}`);
const bad = [];
for (const p of paths) {
  const resp = await page.goto(P + p);
  const status = resp?.status();
  const title = await page.locator("h1").first().textContent().catch(() => null);
  if (status !== 200 || !title) bad.push(`${p} -> ${status} ${title}`);
}
// детальные страницы
for (const [list, sel] of [["/contracts", "a[href*='/contracts/c']"], ["/acts", "a[href*='/acts/c']"], ["/issues", "a[href*='/issues/c']"]]) {
  await page.goto(P + list);
  const h = await page.locator(sel).first().getAttribute("href").catch(() => null);
  if (!h) { bad.push(`${list}: нет ссылок`); continue; }
  const resp = await page.goto(B + h);
  if (resp?.status() !== 200) bad.push(`${h} -> ${resp?.status()}`);
}
await page.goto(P);
await page.screenshot({ path: `${S}/20-dashboard.png`, fullPage: true });
await page.goto(P + "/contracts");
await page.screenshot({ path: `${S}/21-contracts.png`, fullPage: true });
await page.goto(P + "/issues");
await page.screenshot({ path: `${S}/22-issues.png`, fullPage: true });
await page.goto(P + "/reports/coverage");
await page.screenshot({ path: `${S}/23-report.png`, fullPage: true });
// экспорт
for (const r of reports) for (const f of ["xlsx", "pdf"]) {
  const res = await page.request.get(`${B}/api${href}/reports/${r}?format=${f}`);
  if (res.status() !== 200) bad.push(`export ${r}.${f} -> ${res.status()}`);
}
console.log("bad:", bad);
console.log("errors:", errors);
await browser.close();
