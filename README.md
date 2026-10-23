# dca-mate

Nhật ký lệnh, kế hoạch DCA và nhắc chốt lời cho nhà đầu tư cổ phiếu Việt Nam. App dành cho 1 người dùng và chạy miễn phí.

- Ghi lệnh mua/bán. App tự tính giá vốn trung bình (gồm phí), giá hòa vốn (gồm phí, thuế bán), lãi/lỗ và số ngày nắm giữ.
- Kế hoạch **DCA nối tiếp**: nấc đầu tính từ giá vốn TB (hoặc giá khớp của nấc DCA gần nhất), nấc sau tính từ giá mua của nấc trước. Mỗi nấc hiện giá vốn sau DCA.
- Kế hoạch **chốt lời nối tiếp** từ giá vốn TB, % bán tính trên số cổ còn lại; hiện số cổ bán, còn lại và tiền lãi từng nấc.
- Nút "Đã làm" mở popup xác nhận và ghi lệnh luôn; lệnh mua/bán tay tự khớp nấc hoặc đề nghị thêm nấc mới khi lệch kế hoạch.
- Giá làm tròn theo bước giá HOSE/HNX/UPCoM, khối lượng theo lô 100; kiểm tra ô nhập ngay khi gõ.
- Kiểm tra giá mỗi 5 phút trong giờ giao dịch. Khi giá chạm nấc, app gửi Telegram và hiện cảnh báo trên web. Mỗi nấc chỉ nhắc 1 lần.

Chi tiết logic: [docs/logic.md](docs/logic.md). Test case: [docs/test-cases.md](docs/test-cases.md).

## Chạy local

```bash
npm install
npm run dev
```

Mở http://localhost:3000. Khi chưa có `DATABASE_URL`, app dùng Postgres nhúng (PGlite) lưu ở `.data/`. Khi chưa có `APP_PASSWORD`, app không yêu cầu đăng nhập (chỉ áp dụng khi chạy local).

```bash
npm test          # unit test phần tính toán
npm run test:e2e  # build rồi chạy 24 case E2E trên Chrome với database tạm (cần cài Chrome)
npm run lint
npm run build
```

Danh sách test case và quy tắc tính đang áp dụng: [docs/test-cases.md](docs/test-cases.md).

## Đưa lên Vercel (miễn phí)

1. **Database:** tạo project trên [neon.tech](https://neon.tech), chọn region Singapore, rồi chép connection string.
2. Tạo `.env.local` từ `.env.example`, điền `DATABASE_URL`, rồi chạy `npm run db:migrate` để tạo bảng.
3. Đẩy code lên GitHub, import vào Vercel. Khai báo các biến môi trường:
   - `DATABASE_URL`
   - `APP_PASSWORD`: mật khẩu đăng nhập
   - `CRON_SECRET`: chuỗi ngẫu nhiên, ví dụ tạo bằng `openssl rand -hex 24`
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`: xem hướng dẫn trong trang **Cài đặt** của app
   - `APP_URL`: ví dụ `https://dca-mate.vercel.app`
4. **Kiểm tra giá tự động:** trên [cron-job.org](https://cron-job.org), tạo job gọi `https://<app>/api/cron/check-prices` mỗi 5 phút, kèm header `Authorization: Bearer <CRON_SECRET>`. Ngoài giờ giao dịch (T2–T6, 9h–15h giờ VN), route tự bỏ qua.

`vercel.json` đặt function ở region `sin1` (Singapore) để gọi API giá Việt Nam ổn định hơn.

## Nguồn giá

Lần lượt thử VPS, SSI iBoard rồi DNSE ([src/lib/prices.ts](src/lib/prices.ts)). Đây là API công khai không chính thức nên có thể đổi bất cứ lúc nào. Khi mọi nguồn đều lỗi, bạn vẫn nhập giá tay được trong trang chi tiết mã.

## Cấu trúc

- [src/lib/calc.ts](src/lib/calc.ts): giá vốn, mô phỏng DCA, đánh giá cảnh báo (hàm thuần, có test)
- [src/lib/market.ts](src/lib/market.ts): bước giá, lô, phí, thuế
- [src/lib/check.ts](src/lib/check.ts): lấy giá, lưu cảnh báo, gửi Telegram
- [src/db/schema.ts](src/db/schema.ts): schema Drizzle; migration nằm trong `drizzle/`
- [src/app/actions.ts](src/app/actions.ts): server actions
- [src/proxy.ts](src/proxy.ts): chặn truy cập khi chưa đăng nhập

Sau khi sửa schema, chạy `npm run db:generate` rồi `npm run db:migrate`.
