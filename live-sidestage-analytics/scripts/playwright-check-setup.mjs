import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 900 } });

await page.goto("http://localhost:3000/login");
await page.locator('input[placeholder="dev@local.test"]').fill("dev@local.test");
await Promise.all([
  page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 }),
  page.getByRole("button", { name: "ログイン", exact: true }).click(),
]);
console.log("after login url=", page.url());

await page.goto("http://localhost:3000/setup");
await page.waitForTimeout(1500);
await page.screenshot({ path: ".impeccable/review/setup-merge-banner/web-blocked.png", fullPage: true });

console.log("done, url=", page.url());
await browser.close();
