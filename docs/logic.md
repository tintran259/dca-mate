# DCA Mate: tính năng và logic hiện tại

Tài liệu này mô tả app đang làm gì và tính toán thế nào, để đọc lại khi cần sửa hoặc mở rộng.
Danh sách test case chi tiết nằm ở [test-cases.md](test-cases.md).

## 1. App dùng để làm gì

Trợ lý cho **một nhà đầu tư cá nhân** mua cổ phiếu Việt Nam theo kế hoạch:

- Ghi lại từng lệnh mua/bán, tự tính giá vốn trung bình, giá hòa vốn, lãi/lỗ.
- Lập kế hoạch **DCA** (mua thêm khi giá giảm) và **chốt lời** (bán dần khi giá tăng) theo từng nấc.
- Kiểm tra giá định kỳ, khi giá chạm nấc thì **nhắc qua Telegram** và hiện cảnh báo trên web.
- Giữ kỷ luật: lập kế hoạch lúc tỉnh táo, rồi làm đúng kế hoạch khi thị trường biến động.

## 2. Công nghệ và chi phí

| Thành phần | Dùng gì | Ghi chú |
|---|---|---|
| Web + API | Next.js 16 (App Router, Cache Components), TypeScript, Tailwind v4 | Deploy Vercel gói Hobby (miễn phí), region `sin1` |
| Database | Neon Postgres + Drizzle ORM | Chạy local không cần Neon: tự dùng PGlite (Postgres nhúng) lưu ở `.data/` |
| Giá cổ phiếu | API công khai VPS → SSI → DNSE | Nguồn này lỗi thì tự thử nguồn khác; có thể nhập giá tay |
| Kiểm tra giá định kỳ | cron-job.org gọi `/api/cron/check-prices` mỗi 5 phút | Ngoài giờ giao dịch (T2–T6, 9h–15h giờ VN) route tự bỏ qua |
| Thông báo | Telegram Bot | |
| Đăng nhập | 1 mật khẩu trong `APP_PASSWORD`, cookie ký HMAC | Local không đặt mật khẩu thì bỏ qua đăng nhập |
| Font, UI | IBM Plex Sans (có dấu tiếng Việt), icon SVG tự vẽ | Thiết kế mobile-first, có dark mode |

## 3. Các màn hình

| Trang | Nội dung |
|---|---|
| **Tổng quan** `/` | Vốn đang rót, giá trị thị trường, lãi/lỗ tạm tính, lãi đã chốt; các nấc sắp chạm; thẻ từng mã đang giữ; mục "Đã đóng" |
| **Thêm mã** `/positions/new` | Desktop 2 cột: trái là lệnh mua đầu tiên + nút Lưu (dính khi cuộn), phải là kế hoạch DCA và chốt lời. Gõ mã thì tự nhận sàn và giá hiện tại |
| **Chi tiết mã** `/positions/[id]` | Chỉ số vị thế; bậc thang kế hoạch (các nấc xếp theo giá); mô phỏng DCA; sửa kế hoạch; lịch sử lệnh; ghi lệnh mua/bán; luận điểm đầu tư; nhập giá tay |
| **Cảnh báo** `/alerts` | Tab "Cần xử lý" / "Đã xử lý"; mỗi cảnh báo có giá chạm, việc cần làm, nấc; nút "Đã làm, ghi lệnh" và "Bỏ qua" |
| **Cài đặt** `/settings` | Trạng thái cấu hình, hướng dẫn Telegram và cron-job.org, nút kiểm tra giá ngay |
| **Đăng nhập** `/login` | |

## 4. Quy tắc tính toán

Toàn bộ phép tính nằm trong [src/lib/calc.ts](../src/lib/calc.ts) (hàm thuần, có unit test), dùng chung cho giao diện, server và cron.

### 4.1 Giá vốn, hòa vốn, lãi/lỗ

- **Giá vốn TB** = (tổng tiền mua + phí mua) / khối lượng đang giữ. Bán không làm đổi giá vốn TB.
- **Lãi đã chốt** của một lệnh bán = tiền bán − phí − thuế − giá vốn TB × KL bán.
- **Giá hòa vốn** = giá vốn TB / (1 − phí bán − thuế bán).
- **Lãi/lỗ tạm tính** = giá hiện tại × KL × (1 − phí bán − thuế bán) − vốn đang giữ.
- Phí mặc định 0,15% mỗi chiều (đổi được qua `NEXT_PUBLIC_BUY_FEE_RATE`, `NEXT_PUBLIC_SELL_FEE_RATE`), thuế bán 0,1%.
- Bán hết thì vị thế chuyển sang **Đã đóng**. Mua lại sau đó thì tính lại từ đầu.

### 4.2 Bước giá và lô

- **Bước giá HOSE:** dưới 10.000 là 10đ, từ 10.000 đến dưới 50.000 là 50đ, từ 50.000 là 100đ. **HNX và UPCoM:** 100đ.
- Giá nấc DCA làm tròn **xuống**, giá nấc chốt lời làm tròn **lên** theo bước giá. Có trừ sai số số thực, VD 21.000 × 1,1 vẫn ra 23.100.
- Khối lượng theo kế hoạch làm tròn xuống **lô 100**.

### 4.3 Chuỗi DCA (mua thêm khi giá giảm)

Các nấc nối tiếp nhau theo đúng thứ tự trong kế hoạch:

| Nấc | Tính % giảm từ |
|---|---|
| Nấc đầu tiên còn chờ | **Giá khớp thực tế của nấc DCA gần nhất đã làm**; chưa khớp nấc nào thì từ **giá vốn TB** |
| Các nấc sau | **Giá mua của nấc trước** |

- Lệnh mua thêm **ngoài kế hoạch** chỉ làm đổi giá vốn TB, không làm mốc tính nấc.
- Nấc đã nhắc nhưng chưa ghi lệnh được coi như sẽ khớp khi tính các nấc sau.
- Mỗi nấc hiện: mua khi giá ≤ X, số tiền, **giá vốn sau DCA**.

Ví dụ: mua 21.000 × 1.000 cp (giá vốn 21.032 gồm phí), 3 nấc −10%:
nấc 1 ≤ 18.900 → nấc 2 ≤ 17.000 → nấc 3 ≤ 15.300.

**"Nếu khớp hết N nấc"** hiện: tổng vốn, **lỗ tạm tính** (bằng tiền và %) tại giá nấc cuối, tổng KL, giá vốn TB, % giá cần hồi để hòa vốn.

### 4.4 Chuỗi chốt lời (bán dần khi giá tăng)

| Nấc | Tính % tăng từ |
|---|---|
| Nấc 1 | **Giá vốn TB hiện tại** (chưa DCA là giá gốc, đã DCA là giá vốn sau DCA) |
| Các nấc sau | **Giá của nấc trước**; nấc đã bán dùng giá bán thực tế |

- **% bán** tính trên **số cổ còn lại sau nấc trước**; đặt 100% là bán hết.
- Mỗi nấc hiện: bán khi giá ≥ X, **số cổ bán, số cổ còn lại, tiền lãi** (so với giá vốn, đã trừ phí và thuế).
- Mẫu nhanh: "3 nấc" (+10% bán 30%, +20% bán 50%, +30% bán 100%), "2 nấc", "Bán hết +20%".

Ví dụ với 1.000 cp, giá vốn 21.032: bán ≥ 23.150 (300 cp) → ≥ 27.800 (300 cp, vì 50% của 700 làm tròn lô ra 300) → ≥ 36.150 (400 cp).

### 4.5 Đối chiếu lệnh tay với kế hoạch

Khi ghi lệnh mua/bán tay (không bấm "Đã làm" ở nấc), app so sánh lệnh với kế hoạch (`planHints`, `classifyTrade`):

| Lệnh | Kết quả |
|---|---|
| Mua giá ≥ giá vốn TB | Ngoài kế hoạch: chỉ ghi lệnh |
| Mua giá ≤ giá nấc DCA đang chờ | **Tự đánh dấu nấc đó đã làm**, lưu giá khớp |
| Mua dưới giá vốn và dưới mốc nhưng chưa tới nấc | **Popup "Giá mua lệch kế hoạch DCA"**: "Thêm nấc mới và ghi lệnh" hoặc "Hủy" |
| Bán | Đối xứng với chốt lời: ≥ nấc đang chờ thì tự đánh dấu; trên giá vốn nhưng chưa tới nấc thì hiện popup thêm nấc chốt lời |
| Bán đúng bằng số đang giữ | **Popup "Bán hết?"**: bán hết đồng nghĩa với đóng mã |

**Thêm nấc mới:** nấc mới ở trạng thái đã làm, có % tính từ mốc hiện tại và KL của lệnh (với lệnh bán thì % bán = KL bán / KL đang giữ). Nấc mới đặt vào **vị trí của nấc đang chờ**, nấc đó và các nấc sau **lùi xuống 1 bậc** và được tính lại từ giá vừa khớp.

### 4.6 Trạng thái nấc

| Trạng thái | Ý nghĩa |
|---|---|
| Chờ | Chưa chạm |
| Đã nhắc | Giá đã chạm, đã gửi cảnh báo, chờ người dùng xử lý |
| Đã làm | Đã có lệnh thật; lưu **giá khớp**. Bị khóa trong "Sửa kế hoạch" (không sửa, không xóa) |
| Bỏ qua | Không tính vào chuỗi nữa |

- Nút **"Đã làm"** (ở bậc thang hoặc ở trang Cảnh báo) mở **popup xác nhận**: giá và KL điền sẵn theo nấc, sửa được; hiện giá vốn trước → sau lệnh (hoặc tiền lãi nếu bán). Bấm xác nhận là ghi lệnh luôn.
- **Khôi phục** (ở bậc thang) đưa nấc về trạng thái chờ.
- **Xóa một lệnh theo kế hoạch** trong lịch sử thì nấc tương ứng về trạng thái chờ.
- Lịch sử lệnh ghi nhãn **"Done theo kế hoạch · Nấc …"** cho lệnh thực hiện theo nấc.

### 4.7 Cảnh báo

- Cron (hoặc nút "Cập nhật giá", hoặc nhập giá tay) lấy giá, so với kế hoạch. Nấc chạm lần đầu thì tạo cảnh báo, chuyển nấc sang "Đã nhắc" và gửi Telegram. **Mỗi nấc chỉ nhắc 1 lần.**
- Ở trang Cảnh báo: "Đã làm, ghi lệnh" mở popup ghi lệnh; "Bỏ qua" và "Bỏ qua tất cả" có **popup xác nhận**. Cảnh báo đã xử lý **không hoàn tác được** (server cũng chặn).
- Code tính cắt lỗ và trailing stop vẫn còn trong `evaluatePrice` nhưng không còn ô nhập trên giao diện, nên không bao giờ kích hoạt.

### 4.8 Kiểm tra ô nhập

Quy tắc nằm ở [src/lib/validate.ts](../src/lib/validate.ts), dùng chung cho giao diện và server:

| Ô | Giới hạn |
|---|---|
| Giá | 1.000 – 5.000.000đ, đúng bước giá của sàn |
| Khối lượng | > 0; bán không quá số đang giữ |
| Phí, thuế | Không âm, ≤ 1% giá trị lệnh |
| Ngày | Không ở tương lai |
| Nấc DCA | Giảm 0,1 – 99%; KL là bội số của 100 |
| Nấc chốt lời | Tăng 0,1 – 1000%; bán 0,1 – 100% |

Ô sai thì viền đỏ, có dòng lỗi bên dưới; form còn ô lỗi thì **nút gửi bị khóa**.

## 5. Dữ liệu

Schema ở [src/db/schema.ts](../src/db/schema.ts), migration trong `drizzle/` (local tự chạy khi khởi động; Neon chạy `npm run db:migrate`).

| Bảng | Cột chính |
|---|---|
| `positions` | mã, sàn, trạng thái (mở/đóng), luận điểm, giá gần nhất, đỉnh giá |
| `transactions` | mua/bán, ngày, giá, KL, phí, thuế, ghi chú, `level_id` (nấc mà lệnh thực hiện) |
| `plan_levels` | loại (DCA/chốt lời), %, KL hoặc % bán, trạng thái, `filled_price` (giá khớp thực tế), `sort_order` (thứ tự trong chuỗi) |
| `alerts` | loại, giá chạm, nội dung, trạng thái (mới / đã làm / bỏ qua) |

Các cột `max_capital`, `stop_loss_pct`, `trailing_pct` vẫn còn trong bảng `positions` nhưng giao diện không còn dùng.

## 6. Test

- `npm test`: 45 unit test cho phần tính toán và kiểm tra ô nhập.
- `npm run test:e2e`: build rồi chạy 24 case trên Chrome với database tạm (không đụng `.data/`). Danh sách ở [test-cases.md](test-cases.md).

## 7. Lịch sử thay đổi chính

Theo thứ tự đã làm:

1. Dựng dự án: Next.js 16, Drizzle, Neon/PGlite, đăng nhập 1 mật khẩu, lấy giá nhiều nguồn, Telegram, route cron, các trang chính.
2. UI/UX: mobile-first, thanh tab dưới đáy, dark mode, bậc thang kế hoạch, mô phỏng DCA, kiểm tra trên trình duyệt thật.
3. Chuỗi DCA nối tiếp: bỏ chế độ "theo giá mua đầu"; nấc sau tính từ giá mua của nấc trước; nấc đầu tính từ giá khớp nấc gần nhất hoặc giá vốn TB.
4. Chốt lời nối tiếp từ giá vốn TB; hiện số cổ bán, số còn lại, tiền lãi; % bán tính trên số còn lại.
5. "Nếu khớp hết" hiện tổng vốn và lỗ tạm tính; bảng mô phỏng gồm nấc đã làm, dòng hiện tại, nấc còn chờ.
6. Bỏ "Quản trị rủi ro" (cắt lỗ, trailing stop, vốn tối đa) khỏi giao diện.
7. Cài skill UI/UX Pro Max: font IBM Plex Sans, icon SVG thay emoji, label rõ ràng, focus và con trỏ, trang thêm mã 2 cột, sửa tràn ngang trên mobile.
8. Nút "Đã làm" thành popup xác nhận ghi lệnh luôn; mua tay tự khớp nấc; lưu giá khớp và thứ tự nấc; popup thêm nấc khi mua/bán lệch kế hoạch.
9. Khóa nấc đã làm; nút "Lưu kế hoạch" góc phải; nhãn "Done theo kế hoạch" trong lịch sử lệnh.
10. Kiểm tra ô nhập dùng chung client/server; nút bán nhanh theo % kế hoạch chốt lời.
11. Bán hết thì đóng mã (popup xác nhận); bỏ card "Quản lý"; trang Cảnh báo thiết kế lại, không còn hoàn tác.
12. Bộ test e2e tự động và tài liệu test case.
