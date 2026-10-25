// E2E cho DCA Mate: chạy `npm run test:e2e`.
// Build vào .next-e2e (không đụng .next của `next dev` đang chạy), khởi động `next start` với database tạm
// (PGlite) để không đụng tới .data/ của người dùng, rồi dùng Chrome đã cài trên máy để đi qua các case
// trong docs/test-cases.md.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 3211);
const BASE = `http://localhost:${PORT}`;
const PASSWORD = "e2e-pass";
const CRON_SECRET = "e2e-cron";
// Giá giả lập thay cho API giá thật, để kết quả không đổi theo thị trường; FPT cố ý không có giá
const MOCK_PRICES = "HPG:21000,CTG:30950";
const dbDir = mkdtempSync(join(tmpdir(), "dca-mate-e2e-"));

process.env.NEXT_DIST_DIR = ".next-e2e";
if (!process.argv.includes("--no-build")) {
  const build = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], { stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

// ---------- khởi động server ----------
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
  env: { ...process.env, APP_PASSWORD: PASSWORD, CRON_SECRET, MOCK_PRICES, PGLITE_DIR: join(dbDir, "pglite"), DATABASE_URL: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${BASE}/login`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Server không khởi động được:\n" + serverLog);
}

function cleanup() {
  server.kill();
  try {
    rmSync(dbDir, { recursive: true, force: true });
  } catch {
    // Windows có thể còn giữ file một lúc, bỏ qua
  }
}

// ---------- tiện ích ----------
const results = [];
async function tc(id, name, fn) {
  try {
    await fn();
    results.push({ id, name, ok: true });
    console.log(`  ✓ ${id} ${name}`);
  } catch (err) {
    results.push({ id, name, ok: false, err });
    console.log(`  ✗ ${id} ${name}\n      ${String(err?.message ?? err).split("\n")[0]}`);
  }
}
function expect(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: mong đợi "${expected}", nhận "${actual}"`);
}
function expectIncludes(text, part, label) {
  if (!text.includes(part)) throw new Error(`${label}: không thấy "${part}" trong "${text.slice(0, 200)}"`);
}
/** Lấy số đầu tiên sau nhãn, VD "Giá vốn TB" → "19.980" */
function after(text, label) {
  const m = text.split("\n").join(" | ").match(new RegExp(`${label} \\| ([\\d.]+)`));
  return m?.[1] ?? null;
}

await waitForServer();
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

let positionPath = "";
let ctgPath = "";
const stats = () => page.locator("section[aria-label='Chỉ số vị thế']").innerText();
const dcaRung = (i) => page.locator("ol.relative > li").filter({ hasText: "DCA -10,0%" }).nth(i);
async function openDetail() {
  await page.goto(BASE + positionPath);
  await page.getByText("Bậc thang kế hoạch").waitFor();
}
async function openPlan() {
  await openDetail();
  await page.locator("#plan summary").click();
}
const history = () => page.locator("section", { hasText: "Lịch sử lệnh" }).last().innerText();
const txCount = () => page.locator("section", { hasText: "Lịch sử lệnh" }).last().locator("li").count();
const simulation = () => page.locator("section", { hasText: "Mô phỏng DCA" }).last().locator("table").innerText();
const planDca = (i) => page.locator("#plan ol").filter({ hasText: "Giá giảm" }).first().locator("> li").nth(i);
const planTp = (i) => page.locator("#plan ol").filter({ hasText: "Bán (% số còn lại)" }).first().locator("> li").nth(i);
async function manualTrade(side, price, qty) {
  await openDetail();
  if (side === "sell") await page.getByRole("radio", { name: "Bán" }).check({ force: true });
  await page.locator("#tx-price").fill(price);
  await page.locator("#tx-qty").fill(qty);
  await page.locator("#tx-qty").press("Enter");
  const msg = page.getByRole(side === "sell" ? "alert" : "status").filter({ hasText: side === "sell" ? /bán/ : /Giá vốn mới/ });
  await msg.first().waitFor();
  return msg.first().innerText();
}

console.log("DCA Mate E2E");
try {
  await tc("TC01", "Đăng nhập", async () => {
    await page.goto(BASE + "/positions/new");
    expectIncludes(page.url(), "/login", "chuyển tới login");
    await page.locator("#password").fill("sai");
    await page.locator("#password").press("Enter");
    await page.getByText("Mật khẩu không đúng.").waitFor();
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#password").press("Enter");
    await page.locator("#symbol").waitFor();
  });

  await tc("TC02", "Chuỗi DCA trong form", async () => {
    await page.locator("#symbol").fill("HPG");
    await page.locator("#price").fill("21000");
    await page.locator("#quantity").fill("1000");
    const list = page.locator("ol").filter({ hasText: "Giá giảm" }).first();
    for (const [i, qty] of [[0, "1000"], [1, "1000"], [2, "1500"]]) {
      await page.getByRole("button", { name: "Thêm nấc DCA" }).click();
      await list.locator("> li").nth(i).getByLabel("Giá giảm").fill("10");
      await list.locator("> li").nth(i).getByLabel("Mua thêm").fill(qty);
    }
    const texts = await list.locator("> li .bg-surface-2").allInnerTexts();
    expectIncludes(texts[0], "≤ 18.900", "nấc 1");
    expectIncludes(texts[0], "19.980", "giá vốn sau nấc 1");
    expectIncludes(texts[1], "≤ 17.000", "nấc 2");
    expectIncludes(texts[2], "≤ 15.300", "nấc 3");
  });

  await tc("TC03", "Chuỗi chốt lời trong form", async () => {
    await page.getByRole("button", { name: "3 nấc" }).click();
    const list = page.locator("ol").filter({ hasText: "Bán (% số còn lại)" }).first();
    const t = await list.locator("> li .bg-surface-2").allInnerTexts();
    expectIncludes(t[0], "≥ 23.150", "chốt lời 1");
    expectIncludes(t[1], "≥ 27.800", "chốt lời 2");
    expectIncludes(t[2], "≥ 36.150", "chốt lời 3");
    expect(after(t[0], "Bán"), "300", "bán nấc 1");
    expect(after(t[0], "Còn lại"), "700", "còn lại nấc 1");
    expect(after(t[1], "Bán"), "300", "bán nấc 2 (50% của 700 → lô 300)");
    expect(after(t[2], "Bán"), "400", "bán nấc 3");
    expect(after(t[2], "Còn lại"), "0", "còn lại nấc 3");
  });

  await tc("TC04", "Lưu vị thế", async () => {
    await page.getByRole("button", { name: "Lưu vị thế" }).click();
    await page.waitForURL(/\/positions\/\d+/);
    positionPath = new URL(page.url()).pathname;
    await page.getByText("Bậc thang kế hoạch").waitFor();
    const ladder = await page.locator("ol.relative").innerText();
    for (const p of ["18.900", "17.000", "15.300", "23.150"]) expectIncludes(ladder, p, "bậc thang");
    expect(after(await stats(), "Giá vốn TB"), "21.032", "giá vốn TB");
  });

  await tc("TC05", "Trùng mã đang mở", async () => {
    await page.goto(BASE + "/positions/new");
    await page.locator("#symbol").fill("HPG");
    await page.locator("#price").fill("21000");
    await page.locator("#quantity").fill("1000");
    await page.getByRole("button", { name: "Lưu vị thế" }).click();
    await page.getByRole("alert").filter({ hasText: "đang mở" }).waitFor();
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
    expectIncludes(focused, "đang mở", "focus tới thông báo lỗi");
  });

  await tc("TC06", 'Nút "Đã làm" nấc DCA: popup xác nhận rồi ghi lệnh luôn', async () => {
    await openDetail();
    await dcaRung(0).getByRole("button", { name: "Đã làm" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    expectIncludes(await dialog.innerText(), "Xác nhận đã mua", "tiêu đề popup");
    expect(await dialog.getByLabel("Giá khớp").inputValue(), "18.900", "giá điền sẵn");
    expect(await dialog.getByLabel("Khối lượng").inputValue(), "1.000", "KL điền sẵn");
    expectIncludes(await dialog.innerText(), "19.980", "popup báo giá vốn sau lệnh");
    await dialog.getByRole("button", { name: "Xác nhận mua" }).click();
    await dcaRung(0).getByRole("button", { name: "Khôi phục" }).waitFor();
    const s = await stats();
    expect(after(s, "Đang giữ"), "2.000", "đang giữ");
    expect(after(s, "Giá vốn TB"), "19.980", "giá vốn TB sau DCA");
    expectIncludes(await history(), "Done theo kế hoạch · Nấc DCA 1", "lịch sử lệnh");
  });

  await tc("TC07", "Chuỗi sau khi khớp nấc 1", async () => {
    await openPlan();
    expectIncludes(await planDca(0).innerText(), "Đã khớp ở 18.900", "nấc 1");
    const n2 = await planDca(1).innerText();
    expectIncludes(n2, "≤ 17.000", "nấc 2");
    expectIncludes(n2, "giá khớp nấc 1 18.900", "mốc nấc 2");
    const t1 = await planTp(0).innerText();
    expectIncludes(t1, "≥ 22.000", "chốt lời 1");
    expectIncludes(t1, "từ giá vốn TB 19.980", "mốc chốt lời 1");
    expect(await page.getByText("Xem chốt lời theo kịch bản").count(), 0, "đã bỏ kịch bản");
    expect(await planDca(0).getByLabel("Giá giảm").isDisabled(), true, "nấc đã làm khóa ô % giảm");
    expect(await planDca(0).getByLabel("Mua thêm").isDisabled(), true, "nấc đã làm khóa ô khối lượng");
    expect(await planDca(0).getByRole("button", { name: /Xóa nấc/ }).isDisabled(), true, "nấc đã làm không xóa được");
    const sim = await simulation();
    expectIncludes(sim, "Nấc 1", "mô phỏng có nấc đã làm");
    expectIncludes(sim, "Đã làm", "mô phỏng đánh dấu nấc đã làm");
    expectIncludes(sim, "Hiện tại", "mô phỏng có dòng hiện tại");
    expectIncludes(sim, "Nấc 2", "mô phỏng có nấc chờ");
    expect(await page.getByRole("heading", { name: "Quản lý" }).count(), 0, "đã bỏ card Quản lý");
  });

  await tc("TC08", "Mua thêm trên giá vốn: không hỏi, không đổi kế hoạch", async () => {
    const msg = await manualTrade("buy", "21200", "200");
    if (msg.includes("nấc")) throw new Error("không được đụng tới nấc: " + msg);
    await openPlan();
    expectIncludes(await planDca(1).innerText(), "≤ 17.000", "nấc 2 giữ nguyên");
  });

  await tc("TC09", 'Mua lệch kế hoạch: popup không còn "Chỉ ghi lệnh", bấm Hủy thì không ghi gì', async () => {
    await openDetail();
    const before = await txCount();
    await page.locator("#tx-price").fill("18500");
    await page.locator("#tx-qty").fill("100");
    await page.locator("#tx-qty").press("Enter");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    expectIncludes(await dialog.innerText(), "chưa tới nấc DCA 2", "nội dung popup");
    expect(await dialog.getByRole("button", { name: "Chỉ ghi lệnh" }).count(), 0, "đã bỏ nút Chỉ ghi lệnh");
    await dialog.getByRole("button", { name: "Hủy" }).click();
    await dialog.waitFor({ state: "hidden" });
    await openDetail();
    expect(await txCount(), before, "không ghi lệnh khi hủy");
  });

  await tc("TC10", 'Mua lệch kế hoạch, chọn "Thêm nấc mới": chèn vào vị trí nấc 2', async () => {
    await openDetail();
    await page.locator("#tx-price").fill("18000");
    await page.locator("#tx-qty").fill("500");
    await page.locator("#tx-qty").press("Enter");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    // 18.000 / 18.900 - 1 = -4,76% → -4,8%
    expectIncludes(await dialog.innerText(), "-4,8% so với 18.900", "% tính từ giá khớp nấc 1");
    await dialog.getByRole("button", { name: "Thêm nấc mới và ghi lệnh" }).click();
    const st = page.getByRole("status").filter({ hasText: /Giá vốn mới/ });
    await st.waitFor();
    expectIncludes(await st.innerText(), "Đã thêm nấc DCA mới (-4,8%) vào vị trí nấc 2", "thông báo");
    await openPlan();
    expect(await page.locator("#plan ol").filter({ hasText: "Giá giảm" }).first().locator("> li").count(), 4, "thành 4 nấc DCA");
    expectIncludes(await planDca(1).innerText(), "Đã khớp ở 18.000", "nấc mới ở vị trí 2");
    const n3 = await planDca(2).innerText();
    expectIncludes(n3, "≤ 16.200", "nấc 2 cũ thành nấc 3, tính từ 18.000");
    expectIncludes(n3, "giá khớp nấc 2 18.000", "mốc nấc 3");
    expectIncludes(await planDca(3).innerText(), "≤ 14.550", "nấc 4 = 16.200 × 0,9");
    const sim = await simulation();
    for (const part of ["Nấc 2 -4,8%", "18.000", "Nấc 3", "16.200", "Nấc 4", "14.550"]) expectIncludes(sim, part, "mô phỏng sau khi chèn nấc");
    expectIncludes(await history(), "Done theo kế hoạch · Nấc DCA 2", "lệnh chèn nấc ghi trong lịch sử");
  });

  await tc("TC11", "Mua tay chạm nấc tự đánh dấu", async () => {
    const msg = await manualTrade("buy", "16100", "1000");
    expectIncludes(msg, "Đã tự đánh dấu nấc DCA 3", "thông báo");
    await openPlan();
    expectIncludes(await planDca(3).innerText(), "≤ 14.450", "nấc 4 tính từ 16.100");
  });

  await tc("TC12", "Bán quá số đang giữ", async () => {
    const msg = await manualTrade("sell", "26000", "99900");
    expectIncludes(msg, "không bán quá số này", "thông báo");
    expect(await page.locator("#tx-price").inputValue(), "26.000", "giữ giá đã nhập");
  });

  await tc("TC13", "Bán lệch kế hoạch chốt lời: thêm nấc chốt lời mới", async () => {
    await openPlan();
    const avg = Number(after(await stats(), "Giá vốn TB").replace(/\./g, ""));
    const tp1 = Number((await planTp(0).innerText()).match(/≥ ([\d.]+)/)[1].replace(/\./g, ""));
    const sellPrice = Math.ceil((avg * 1.03) / 50) * 50; // trên giá vốn, dưới chốt lời 1
    if (!(sellPrice < tp1)) throw new Error(`giá thử ${sellPrice} không nằm dưới chốt lời 1 ${tp1}`);
    await page.getByRole("radio", { name: "Bán" }).check({ force: true });
    await page.locator("#tx-price").fill(String(sellPrice));
    await page.locator("#tx-qty").fill("1000");
    await page.locator("#tx-qty").press("Enter");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    expectIncludes(await dialog.innerText(), "chưa tới nấc chốt lời 1", "nội dung popup");
    await dialog.getByRole("button", { name: "Thêm nấc mới và ghi lệnh" }).click();
    const st = page.getByRole("status").filter({ hasText: /Giá vốn mới/ });
    await st.waitFor();
    expectIncludes(await st.innerText(), "Đã thêm nấc chốt lời mới", "thông báo");
    await openPlan();
    const fmt = sellPrice.toLocaleString("vi-VN");
    expectIncludes(await planTp(0).innerText(), `≥ ${fmt}`, "nấc chốt lời mới ở vị trí 1");
    expectIncludes(await planTp(1).innerText(), `từ chốt lời nấc 1 ${fmt}`, "chốt lời cũ lùi xuống, tính từ giá vừa bán");
  });

  await tc("TC14", "Cảnh báo khi giá chạm nấc", async () => {
    await openDetail();
    await page.getByLabel("Giá hiện tại").fill("14400");
    await page.getByLabel("Giá hiện tại").press("Enter");
    const st = page.getByRole("status").filter({ hasText: /Đã cập nhật giá/ });
    await st.waitFor();
    expectIncludes(await st.innerText(), "1 cảnh báo mới", "số cảnh báo");
  });

  await tc("TC15", '"Đã làm, ghi lệnh" ở trang Cảnh báo: popup xác nhận', async () => {
    await page.goto(BASE + "/alerts");
    expectIncludes(await page.getByRole("link", { name: /Cần xử lý/ }).innerText(), "1", "số cảnh báo cần xử lý");
    const item = page.locator("li.card").filter({ hasText: "Mua 1.500 cp" }).first();
    await item.getByRole("button", { name: "Đã làm, ghi lệnh" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    expect(await dialog.getByLabel("Giá khớp").inputValue(), "14.400", "giá điền sẵn");
    expect(await dialog.getByLabel("Khối lượng").inputValue(), "1.500", "KL điền sẵn");
    await dialog.getByRole("button", { name: "Xác nhận mua" }).click();
    await page.getByText("Không còn cảnh báo cần xử lý").waitFor();
    await openPlan();
    expectIncludes(await planDca(3).innerText(), "Đã khớp ở 14.400", "nấc 4");
  });

  await tc("TC16", "Khôi phục nấc", async () => {
    await openDetail();
    await dcaRung(2).getByRole("button", { name: "Khôi phục" }).click();
    await dcaRung(2).getByRole("button", { name: "Đã làm" }).waitFor();
  });

  await tc("TC17", "Lưu kế hoạch không làm mất hay đổi nấc đã làm", async () => {
    await openPlan();
    await page.getByRole("button", { name: "Lưu kế hoạch" }).click();
    await page.getByRole("status").filter({ hasText: "Đã lưu kế hoạch" }).waitFor().catch(() => {});
    await openPlan();
    expectIncludes(await planDca(0).innerText(), "Đã khớp ở 18.900", "nấc 1 vẫn đã làm");
    expectIncludes(await planDca(1).innerText(), "Đã khớp ở 18.000", "nấc 2 vẫn đã làm");
  });

  await tc("TC18", "Xóa lệnh theo kế hoạch thì nấc về trạng thái chờ", async () => {
    await openDetail();
    page.once("dialog", (d) => d.accept());
    const row = page.locator("section", { hasText: "Lịch sử lệnh" }).locator("li").filter({ hasText: "Nấc DCA 2" });
    await row.getByRole("button", { name: "Xóa lệnh" }).click();
    await row.waitFor({ state: "detached" });
    await openPlan();
    const n2 = await planDca(1).innerText();
    if (n2.includes("Đã khớp")) throw new Error("nấc 2 phải về trạng thái chờ: " + n2);
  });

  await tc("TC19", "Báo lỗi ngay dưới ô khi nhập vượt giá trị cho phép", async () => {
    await openDetail();
    const before = await txCount();
    // Giá sai bước giá HOSE (vùng 10.000–50.000 bước 50đ)
    await page.locator("#tx-price").fill("21030");
    await page.locator("#tx-qty").fill("100");
    expectIncludes(await page.locator("#tx-price-error").innerText(), "bước 50đ", "lỗi bước giá");
    expect(await page.locator("#tx-price").getAttribute("aria-invalid"), "true", "ô giá đánh dấu lỗi");
    expect(await page.getByRole("button", { name: "Ghi lệnh mua" }).isDisabled(), true, "khóa nút ghi lệnh khi còn lỗi");
    await page.locator("#tx-price").fill("21000");
    expect(await page.getByRole("button", { name: "Ghi lệnh mua" }).isDisabled(), false, "hết lỗi thì mở lại nút");
    // Phí vượt 1% giá trị lệnh
    await page.locator("#tx-price").fill("21000");
    await page.locator("#tx-fee").fill("500000");
    expectIncludes(await page.locator("#tx-fee-error").innerText(), "tối đa 1%", "lỗi phí");
    // Bán quá số đang giữ: báo ngay, chưa cần bấm gửi
    await page.getByRole("radio", { name: "Bán" }).check({ force: true });
    await page.locator("#tx-qty").fill("99900");
    expectIncludes(await page.locator("#tx-qty-error").innerText(), "không bán quá số này", "lỗi bán quá");
    await openDetail();
    expect(await txCount(), before, "không có lệnh nào được ghi");
    // Nấc DCA % giảm vượt 99%
    await openPlan();
    const n = page.locator("#plan ol").filter({ hasText: "Giá giảm" }).first().locator("> li").last();
    await n.getByLabel("Giá giảm").fill("150");
    expectIncludes(await n.innerText(), "Giá giảm từ 0,1% đến 99%", "lỗi % nấc DCA");
    expect(await page.getByRole("button", { name: "Lưu kế hoạch" }).isDisabled(), true, "khóa nút lưu kế hoạch khi còn lỗi");
  });

  await tc("TC20", "Nút bán theo % kế hoạch chốt lời", async () => {
    await openDetail();
    await page.getByRole("radio", { name: "Bán" }).check({ force: true });
    const btn = page.getByRole("button", { name: /^Nấc \d+ · / }).first();
    const label = await btn.innerText();
    const qty = label.match(/· ([\d.]+) cp/)[1];
    await btn.click();
    expect(await page.locator("#tx-qty").inputValue(), qty, `KL theo nút "${label}"`);
    expect(await page.getByRole("button", { name: "25%" }).count(), 0, "đã bỏ nút 25%/50%");
    await page.getByRole("button", { name: /^Bán hết/ }).click();
    expect(await page.locator("#tx-qty").inputValue(), after(await stats(), "Đang giữ"), "bán hết = số đang giữ");
  });

  await tc("TC21", "Bỏ qua cảnh báo: có popup xác nhận, đã xử lý thì không hoàn tác", async () => {
    // Giá cao vượt các nấc chốt lời → sinh cảnh báo chốt lời
    await openDetail();
    await page.getByLabel("Giá hiện tại").fill("40000");
    await page.getByLabel("Giá hiện tại").press("Enter");
    await page.getByRole("status").filter({ hasText: /Đã cập nhật giá/ }).waitFor();
    await page.goto(BASE + "/alerts");
    const item = page.locator("li.card").first();
    await item.getByRole("button", { name: "Bỏ qua" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    expectIncludes(await dialog.innerText(), "không hoàn tác được", "popup cảnh báo không hoàn tác");
    await dialog.getByRole("button", { name: "Hủy" }).click();
    await dialog.waitFor({ state: "hidden" });
    const before = await page.locator("li.card").count();
    await item.getByRole("button", { name: "Bỏ qua" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Bỏ qua cảnh báo" }).click();
    await page.waitForFunction((n) => document.querySelectorAll("li.card").length < n, before);
    await page.goto(BASE + "/alerts?tab=done");
    // Danh sách stream về sau khung trang: chờ đúng phần tử
    await page.locator("main li").filter({ hasText: "Bỏ qua" }).first().waitFor();
    expect(await page.getByRole("button", { name: /Hoàn tác/ }).count(), 0, "không còn nút hoàn tác");
  });

  await tc("TC22", "Bán hết: popup xác nhận, đóng mã và về trang tổng quan", async () => {
    await openDetail();
    await page.getByRole("radio", { name: "Bán" }).check({ force: true });
    await page.locator("#tx-price").fill("30000");
    await page.getByRole("button", { name: /^Bán hết/ }).click();
    await page.getByRole("button", { name: "Ghi lệnh bán" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    expectIncludes(await dialog.innerText(), "đóng mã HPG", "popup bán hết");
    await dialog.getByRole("button", { name: "Bán hết và đóng mã" }).click();
    await page.waitForURL(/\/\?closed=HPG/);
    await page.getByText("Đã bán hết HPG").waitFor();
    await page.getByText("Đã đóng (1)").waitFor();
    expect(await page.getByText("Đang nắm giữ (").count(), 0, "không còn mã đang nắm giữ");
  });

  await tc("TC23", "Route cron", async () => {
    const noAuth = await fetch(`${BASE}/api/cron/check-prices`);
    expect(noAuth.status, 401, "không có secret");
    const ok = await fetch(`${BASE}/api/cron/check-prices?force=1`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    expect(ok.status, 200, "có secret");
    const body = await ok.json();
    if (typeof body.checked !== "number") throw new Error("thiếu trường checked: " + JSON.stringify(body));
  });

  await tc("TC24", "Responsive 375px không tràn ngang", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const path of ["/", positionPath, "/alerts", "/settings", "/positions/new"]) {
      await page.goto(BASE + path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, 0, `tràn ngang ở ${path}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  const header = async () => ({
    price: await page.locator(".num.text-3xl").first().innerText(),
    pnl: await page.locator(".num.text-3xl + div").first().innerText(),
    label: await page.locator("h1").locator("xpath=../following-sibling::p").innerText(),
  });
  const digits = async (sel) => (await page.locator(sel).inputValue()).replace(/\D/g, "");

  await tc("TC25", "Tạo mã: giá hiện tại lấy theo thị trường, không phải giá mua", async () => {
    await page.goto(BASE + "/positions/new");
    await page.locator("#symbol").fill("CTG");
    await page.locator("#price").fill("34000");
    await page.locator("#quantity").fill("100");
    expect(await digits("#fee"), "5100", "phí mua tự tính 0,15%");
    await page.getByRole("button", { name: "Lưu vị thế" }).click();
    await page.waitForURL(/\/positions\/\d+/);
    ctgPath = new URL(page.url()).pathname;
    await page.getByText("Bậc thang kế hoạch").waitFor();
    const h = await header();
    expect(h.price, "30.950", "giá hiện tại");
    expectIncludes(h.label, "Giá cập nhật", "nhãn giá");
    expectIncludes(h.pnl, "-9,3%", "lỗ so với giá vốn 34.051");
    expect(after(await stats(), "Giá vốn TB"), "34.051", "giá vốn TB gồm phí");
  });

  await tc("TC26", "Tạo mã khi không lấy được giá: tạm dùng giá mua", async () => {
    await page.goto(BASE + "/positions/new");
    await page.locator("#symbol").fill("FPT");
    await page.locator("#price").fill("100000");
    await page.locator("#quantity").fill("100");
    await page.getByRole("button", { name: "Lưu vị thế" }).click();
    await page.waitForURL(/\/positions\/\d+/);
    await page.getByText("Bậc thang kế hoạch").waitFor();
    const h = await header();
    expect(h.price, "100.000", "giá hiện tại = giá mua");
    expectIncludes(h.label, "Giá lúc mua", "nhãn giá");
  });

  await tc("TC27", "Phí, thuế tự tính khi ghi lệnh mua/bán", async () => {
    await page.goto(BASE + ctgPath);
    await page.getByText("Bậc thang kế hoạch").waitFor();
    await page.locator("#tx-price").fill("31000");
    await page.locator("#tx-qty").fill("100");
    expect(await digits("#tx-fee"), "4650", "phí mua 0,15%");
    await page.getByRole("radio", { name: "Bán" }).check({ force: true });
    await page.locator("#tx-price").fill("31000");
    await page.locator("#tx-qty").fill("100");
    expect(await digits("#tx-fee"), "4650", "phí bán 0,15%");
    expect(await digits("#tx-tax"), "3100", "thuế bán 0,1%");
  });

  await tc("TC28", "Route cron cập nhật giá theo nguồn, mã không có giá báo thiếu", async () => {
    const res = await fetch(`${BASE}/api/cron/check-prices?force=1`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    const body = await res.json();
    expect(body.checked, 2, "số mã đang giữ");
    expect(body.updated.join(","), "CTG", "mã cập nhật được");
    expect(body.missing.join(","), "FPT", "mã không có giá");
  });
  await tc("TC37", "SEO: file công khai đọc được khi bật mật khẩu, trang dữ liệu không cho index", async () => {
    // fetch không có cookie đăng nhập
    for (const [route, type] of [
      ["/robots.txt", "text/plain"],
      ["/sitemap.xml", "application/xml"],
      ["/opengraph-image", "image/png"],
      ["/apple-icon", "image/png"],
      ["/manifest.webmanifest", "application/manifest+json"],
    ]) {
      const res = await fetch(BASE + route, { redirect: "manual" });
      expect(res.status, 200, route);
      expectIncludes(res.headers.get("content-type") ?? "", type, `${route} content-type`);
    }
    const robots = await (await fetch(BASE + "/robots.txt")).text();
    expectIncludes(robots, "Allow: /login", "robots cho phép trang đăng nhập");
    expectIncludes(robots, "Disallow: /", "robots chặn trang dữ liệu");
    const login = await (await fetch(BASE + "/login", { headers: { "User-Agent": "Googlebot/2.1" } })).text();
    expectIncludes(login, 'property="og:image"', "trang đăng nhập có ảnh xem trước");
    expectIncludes(login, 'rel="canonical"', "trang đăng nhập có canonical");
    if (login.includes("noindex")) throw new Error("trang đăng nhập không được noindex");
    await page.goto(BASE + "/");
    const robotsMeta = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robotsMeta, "noindex, nofollow", "trang tổng quan");
  });

  await tc("TC33", "Điện thoại: menu ☰ mở drawer, chuyển trang thì tự đóng", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + "/");
    expect(await page.locator("nav[aria-label='Điều hướng chính']").filter({ visible: true }).count(), 0, "không còn thanh nav hiện sẵn");
    await page.getByRole("button", { name: "Mở menu" }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await menu.waitFor();
    await menu.getByRole("link", { name: "Cảnh báo" }).click();
    await page.waitForURL(/\/alerts/);
    await menu.waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await tc("TC29", "Điện thoại: Ghi lệnh mở trong bottom sheet, đóng bằng Esc", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + ctgPath);
    await page.getByText("Bậc thang kế hoạch").waitFor();
    const sheet = page.locator("dialog#trade");
    expect(await sheet.isVisible(), false, "sheet ẩn khi chưa mở");
    await page.getByRole("button", { name: "Ghi lệnh", exact: true }).click();
    await page.getByRole("dialog", { name: "Ghi lệnh mua / bán" }).waitFor();
    expect(await page.locator("#tx-price").isVisible(), true, "form nằm trong sheet");
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden" });
  });

  await tc("TC30", "Điện thoại: Sửa kế hoạch mở trong sheet, nút lưu luôn thấy", async () => {
    await page.getByRole("button", { name: "Sửa kế hoạch", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Sửa kế hoạch" });
    await dialog.waitFor();
    await page.waitForTimeout(600);
    const save = dialog.getByRole("button", { name: "Lưu kế hoạch" });
    expect(await save.isVisible(), true, "nút lưu hiện");
    const box = await save.boundingBox();
    if (!box || box.y + box.height > 844) throw new Error("nút lưu nằm ngoài màn hình: " + JSON.stringify(box));
    await dialog.getByRole("button", { name: "Đóng" }).click();
    await page.locator("dialog#plan").waitFor({ state: "hidden" });
  });

  await tc("TC34", "Trang Cảnh báo, Cài đặt rộng bằng Tổng quan", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const width = async (path) => {
      await page.goto(BASE + path);
      await page.waitForLoadState("networkidle");
      return page.evaluate(() => Math.round(document.querySelector("main > *").getBoundingClientRect().width));
    };
    const overview = await width("/");
    expect(await width("/alerts"), overview, "Cảnh báo");
    expect(await width("/settings"), overview, "Cài đặt");
    expect(await width("/positions/new"), overview, "Thêm mã");
  });

  await tc("TC31", "Desktop: Ghi lệnh và Sửa kế hoạch nằm sẵn trong trang, không phải popup", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + ctgPath);
    await page.getByText("Bậc thang kế hoạch").waitFor();
    expect(await page.locator("#tx-price").isVisible(), true, "form ghi lệnh hiện sẵn");
    expect(await page.getByRole("dialog").count(), 0, "không có popup nào đang mở");
    expect(await page.getByRole("button", { name: "Ghi lệnh", exact: true }).isVisible(), false, "ẩn nút mở sheet");
  });

  await tc("TC32", "Biểu đồ ở tổng quan: đổi chế độ, xem dạng bảng", async () => {
    await page.goto(BASE + "/");
    const chart = page.locator("section[aria-labelledby=portfolio-chart-title]");
    await chart.waitFor();
    expectIncludes(await chart.innerText(), "Biểu đồ danh mục", "tiêu đề");
    // E2E có 2 mã đang giữ (CTG, FPT) nên có đủ 3 chế độ
    for (const view of ["Giá", "Tài sản", "Theo mã"]) {
      await chart.getByText(view, { exact: true }).click();
      await page.waitForTimeout(100);
    }
    expectIncludes(await chart.innerText(), "CTG", "chú thích có mã đang giữ");
    await chart.getByText("Tài sản", { exact: true }).click();
    expectIncludes(await chart.innerText(), "Vốn đang rót", "chú thích vốn");
    await chart.getByText("Xem dạng bảng").click();
    const rows = await chart.locator("tbody tr").count();
    if (rows < 1) throw new Error("bảng không có dòng nào");
    // Khung thời gian: 1D, 1W, 1M, 3M, 6M, 1Y; không còn "Tất cả"
    const ranges = await chart.locator("[role=radiogroup]").last().innerText();
    expect(ranges.replace(/\s+/g, " ").trim(), "1D 1W 1M 3M 6M 1Y", "các khung thời gian");
    // Giá giả lập không có nến trong phiên: 1D báo chưa có dữ liệu thay vì vẽ sai
    await chart.getByText("1D", { exact: true }).click();
    await chart.getByText("Chưa có dữ liệu trong phiên").waitFor();
  });
} finally {
  await browser.close();
  cleanup();
}

const failed = results.filter((r) => !r.ok);
// Lỗi console của trang (bỏ qua lỗi 401 cố ý ở TC14 vì gọi bằng fetch, không qua trình duyệt)
if (consoleErrors.length) console.log(`\nLỗi console trên trang (${consoleErrors.length}):\n  ` + consoleErrors.slice(0, 5).join("\n  "));
console.log(`\n${results.length - failed.length}/${results.length} case đạt`);
process.exit(failed.length || consoleErrors.length ? 1 : 0);
