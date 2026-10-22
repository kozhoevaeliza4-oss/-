import { chromium, devices } from "playwright";
const S = process.env.QA_OUT_DIR ?? "./qa-out";
const B = (process.env.QA_BASE_URL ?? "http://localhost:3000");
const P = "/projects/" + process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const paths = ["", "/registry", "/estimate", "/contracts", "/acts", "/acts/capture", "/accounting", "/accounting/transactions", "/issues", "/reports", "/reports/coverage", "/structure", "/explain?metric=plannedCost"];
for (const [name, opts] of [["phone", { ...devices["iPhone 13"] }], ["tablet", { viewport: { width: 768, height: 1024 } }], ["desktop", { viewport: { width: 1280, height: 900 } }]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(B + "/login");
  await page.fill("input[name=email]", (process.env.QA_EMAIL ?? "admin@example.local"));
  await page.fill("input[name=password]", (process.env.QA_PASSWORD ?? "change-me-please"));
  await page.click("button[type=submit]");
  await page.waitForURL(B + "/", { waitUntil: "commit" });
  const bad = [];
  for (const p of paths) {
    await page.goto(B + P + p, { waitUntil: "networkidle" });
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const over = [];
      // элементы, выходящие за ширину экрана, кроме содержимого контейнеров с собственной прокруткой
      for (const el of document.querySelectorAll("body *")) {
        const rect = el.getBoundingClientRect();
        if (rect.right > vw + 1 && rect.width > 0) {
          let p = el.parentElement, scrolled = false;
          while (p) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX)) { scrolled = true; break; } p = p.parentElement; }
          if (!scrolled) over.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} → ${Math.round(rect.right)}`);
        }
      }
      return { sw: document.documentElement.scrollWidth, vw, over: over.slice(0, 3) };
    });
    if (r.sw > r.vw + 1) bad.push(`${p || "/"}: scrollWidth ${r.sw} > ${r.vw} ${r.over.join("; ")}`);
    if (name === "phone" && ["", "/registry", "/acts/capture"].includes(p)) await page.screenshot({ path: `${S}/m-${p.replace(/\W/g, "") || "dash"}.png`, fullPage: false });
  }
  console.log(name, bad.length ? bad : "нет горизонтальной прокрутки страницы");
  await ctx.close();
}
await browser.close();
