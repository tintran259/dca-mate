# Test case DCA Mate

Hai lớp test:

- **Unit test** (`npm test`, 103 test): giá vốn, chuỗi DCA, chuỗi chốt lời, bước giá, lô 100 (`calc.test.ts`); kiểm tra ô nhập (`validate.test.ts`); phí, thuế, lãi/lỗ sau phí và giờ trong phiên (`fees.test.ts`); dữ liệu biểu đồ tổng quan (`portfolio.test.ts`); luồng thông báo Telegram (`notify.test.ts`).
- **E2E** (`npm run test:e2e`, 36 case): chạy app thật trên trình duyệt Chrome với database tạm, đi qua các luồng dưới đây. Không đụng tới dữ liệu trong `.data/`. Build vào `.next-e2e` (tsconfig riêng `tsconfig.e2e.json`) nên chạy được trong lúc `npm run dev` đang mở mà không làm hỏng cache của dev server. Thêm `-- --no-build` để chạy lại test mà không build. Giá thị trường dùng giá giả lập `MOCK_PRICES="HPG:21000,CTG:30950"` (FPT cố ý không có giá) để kết quả không đổi theo thị trường.

Số liệu chung cho các case E2E: mã **HPG (HOSE)**, mua đầu **21.000 × 1.000 cp**, phí tự tính 0,15% (31.500đ), nên giá vốn TB là 21.031,5.
Kế hoạch: 3 nấc DCA −10% (mua 1.000 / 1.000 / 1.500 cp), mẫu chốt lời "3 nấc" (+10% bán 30%, +20% bán 50%, +30% bán 100%).

## Quy tắc đang áp dụng

| Phần | Quy tắc |
|---|---|
| DCA nấc đầu tiên còn chờ | Tính % giảm từ **giá khớp của nấc DCA gần nhất đã làm**; chưa khớp nấc nào thì từ **giá vốn TB** |
| DCA nấc sau | Tính từ giá mua của nấc trước |
| Lệnh mua tay giá ≥ giá vốn TB | Ngoài kế hoạch: chỉ ghi lệnh, không đụng tới nấc |
| Lệnh mua tay giá ≤ nấc DCA đang chờ | Tự đánh dấu nấc đó đã làm, lưu giá khớp |
| Lệnh mua tay dưới giá vốn và dưới mốc nhưng chưa tới nấc | Hiện popup: "Thêm nấc mới và ghi lệnh" (chèn nấc đã làm vào vị trí nấc đang chờ, các nấc sau lùi 1 bậc) hoặc "Hủy" (không ghi lệnh) |
| Lệnh bán tay | Đối xứng với mua: ≥ nấc chốt lời đang chờ thì tự đánh dấu; trên giá vốn nhưng chưa tới nấc thì hiện popup thêm nấc chốt lời mới (% bán = KL bán / KL đang giữ) |
| Nút "Đã làm" | Mở popup xác nhận (giá, KL điền sẵn, sửa được; hiện giá vốn sau lệnh hoặc tiền lãi), bấm "Xác nhận" là ghi lệnh luôn |
| Nấc đã làm | Khóa trong "Sửa kế hoạch" (không sửa %, KL, không xóa); lưu kế hoạch không làm đổi nấc đã làm |
| Lệnh theo kế hoạch | Lịch sử lệnh ghi "Done theo kế hoạch · Nấc …"; xóa lệnh đó thì nấc về lại trạng thái chờ |
| Kiểm tra ô nhập | Giá: 1.000–5.000.000đ, đúng bước giá của sàn; KL > 0, bán không quá số đang giữ; phí, thuế không âm và ≤ 1% giá trị lệnh; ngày không ở tương lai; nấc DCA: giảm 0,1–99%, KL bội số 100; nấc chốt lời: tăng 0,1–1000%, bán 0,1–100%. Lỗi hiện ngay dưới ô (viền đỏ); form còn ô lỗi thì nút gửi bị khóa; server kiểm tra lại cùng quy tắc |
| Nút bán nhanh | Thay 25% / 50% bằng các nấc chốt lời đang chờ ("Nấc n · % · KL"), giữ "Bán hết" |
| Bán hết | Hiện popup xác nhận "Bán hết và đóng mã"; sau khi bán, mã chuyển sang "Đã đóng" và quay về trang tổng quan. Trang chi tiết không còn card "Quản lý" |
| Cảnh báo | Tab "Cần xử lý" / "Đã xử lý"; "Bỏ qua" và "Bỏ qua tất cả" có popup xác nhận; cảnh báo đã xử lý không hoàn tác được (không còn nút, server cũng chặn) |
| Mô phỏng DCA | Gồm các nấc đã làm (giá khớp), dòng "Hiện tại", rồi các nấc còn chờ theo đúng thứ tự chuỗi |
| Chốt lời nấc 1 | Tính % tăng từ **giá vốn TB hiện tại** |
| Chốt lời nấc sau | Tính từ giá nấc trước |
| % bán | Tính trên số cổ còn lại sau nấc trước; 100% là bán hết |
| Phí, thuế | Phí mua, phí bán đặt trong Cài đặt (mặc định 0,15%), thuế bán 0,1% cố định; tự điền theo giá trị lệnh, làm tròn tới đồng, sửa tay được. Giá vốn và lãi đã chốt dùng phí đã ghi trong lệnh; lãi/lỗ tạm tính, giá hòa vốn, mô phỏng dùng tỷ lệ |
| Giá hiện tại lúc tạo mã | Lấy giá thị trường; không lấy được thì tạm dùng giá mua, nhãn "Giá lúc mua". Tra mã về muộn không ghi đè giá đã nhập |
| Giờ trong phiên | T2–T6, 9:00–11:30 và 13:00–15:00 giờ VN; ngoài phiên route cron bỏ qua (trừ `force=1`) |
| Làm tròn | Giá DCA làm tròn xuống, giá chốt lời làm tròn lên theo bước giá; khối lượng làm tròn xuống lô 100 |

## Danh sách case

| ID | Tên | Bước | Kết quả mong đợi |
|---|---|---|---|
| TC01 | Đăng nhập | Mở `/positions/new` khi chưa đăng nhập; nhập sai mật khẩu; nhập đúng | Bị chuyển tới `/login`; báo "Mật khẩu không đúng."; đúng thì vào trang thêm mã |
| TC02 | Chuỗi DCA trong form | Nhập lệnh mua và 3 nấc DCA như trên | Nấc 1 ≤ **18.900**, nấc 2 ≤ **17.000**, nấc 3 ≤ **15.300**; giá vốn sau nấc 1 là **19.980** |
| TC03 | Chuỗi chốt lời trong form | Bấm mẫu "3 nấc" | Bán khi ≥ **23.150 / 27.800 / 36.150**; bán **300 / 300 / 400** cp, còn **700 / 400 / 0** |
| TC04 | Lưu vị thế | Bấm "Lưu vị thế" | Sang trang chi tiết; bậc thang có 18.900, 17.000, 15.300, 23.150; giá vốn TB **21.032** |
| TC05 | Trùng mã đang mở | Tạo lại HPG | Báo "đã có vị thế HPG đang mở", focus nhảy tới thông báo lỗi |
| TC06 | Nút "Đã làm" nấc DCA | Bấm "Đã làm" ở nấc DCA 1, xem popup, bấm "Xác nhận mua" | Popup điền sẵn **18.900 / 1.000**, báo giá vốn sau lệnh **19.980**; sau khi xác nhận: giữ **2.000 cp**, giá vốn TB **19.980**, nấc 1 "Đã làm"; lịch sử có "Done theo kế hoạch · Nấc DCA 1" |
| TC07 | Chuỗi sau khi khớp | Mở "Sửa kế hoạch" | Nấc 1 "Đã khớp ở 18.900"; nấc 2 ≤ **17.000** "so với giá khớp nấc 1"; chốt lời 1 ≥ **22.000** "từ giá vốn TB 19.980"; không còn "Xem chốt lời theo kịch bản"; ô nhập và nút xóa của nấc 1 bị khóa; mô phỏng có nấc 1 (đã làm), dòng "Hiện tại", nấc 2; không còn card "Quản lý" |
| TC08 | Mua trên giá vốn | Ghi lệnh mua tay 21.200 × 200 | Không hiện popup, không đụng tới nấc; nấc 2 vẫn ≤ **17.000** |
| TC09 | Mua lệch kế hoạch, bấm "Hủy" | Ghi lệnh mua 18.500 × 100, bấm "Hủy" trong popup | Popup báo "chưa tới nấc DCA 2", không có nút "Chỉ ghi lệnh"; không có lệnh nào được ghi |
| TC10 | Mua lệch kế hoạch, "Thêm nấc mới" | Ghi lệnh mua 18.000 × 500, chọn "Thêm nấc mới và ghi lệnh" | Popup báo **−4,8% so với 18.900**; thành 4 nấc: nấc 2 "Đã khớp ở 18.000", nấc 3 (nấc 2 cũ) ≤ **16.200**, nấc 4 ≤ **14.550**; mô phỏng cập nhật theo; lịch sử có "Done theo kế hoạch · Nấc DCA 2" |
| TC11 | Mua tay chạm nấc | Ghi lệnh mua 16.100 × 1.000 | "Đã tự đánh dấu nấc DCA 3"; nấc 4 ≤ **14.450** |
| TC12 | Bán quá số đang giữ | Ghi lệnh bán 99.900 cp | Báo "không bán quá số này"; dữ liệu đã nhập vẫn giữ |
| TC13 | Bán lệch kế hoạch chốt lời | Bán 1.000 cp ở giá ≈ giá vốn + 3% (dưới chốt lời 1), chọn "Thêm nấc mới và ghi lệnh" | Popup báo "chưa tới nấc chốt lời 1"; nấc chốt lời mới ở vị trí 1, chốt lời cũ lùi xuống và tính từ giá vừa bán |
| TC14 | Cảnh báo khi giá chạm nấc | Nhập giá tay 14.400 | Có 1 cảnh báo mới cho nấc DCA 4 |
| TC15 | "Đã làm, ghi lệnh" ở trang Cảnh báo | Vào `/alerts`, bấm "Đã làm, ghi lệnh", xác nhận trong popup | Popup điền sẵn **14.400 / 1.500**; cảnh báo sang "Đã xử lý", nấc 4 "Đã khớp ở 14.400" |
| TC16 | Khôi phục nấc | Bấm "Khôi phục" ở nấc vừa làm | Nấc về trạng thái chờ, hiện lại nút "Đã làm" |
| TC17 | Lưu kế hoạch giữ nấc đã làm | Mở "Sửa kế hoạch", bấm "Lưu kế hoạch" | Nấc 1 vẫn "Đã khớp ở 18.900", nấc 2 vẫn "Đã khớp ở 18.000" |
| TC18 | Xóa lệnh theo kế hoạch | Xóa lệnh có nhãn "Nấc DCA 2" trong lịch sử | Nấc 2 về trạng thái chờ |
| TC19 | Báo lỗi ô nhập | Nhập giá 21.030; phí 500.000; bán 99.900 cp; nấc DCA giảm 150% | Lỗi "bước 50đ", "tối đa 1%", "không bán quá số này", "Giá giảm từ 0,1% đến 99%" hiện dưới đúng ô; nút "Ghi lệnh" và "Lưu kế hoạch" bị khóa khi còn lỗi, mở lại khi hết lỗi; không có lệnh nào được ghi |
| TC20 | Nút bán theo kế hoạch | Chọn Bán, bấm nút "Nấc n · …%" rồi "Bán hết" | KL điền đúng theo nấc; không còn nút 25%/50%; "Bán hết" = số đang giữ |
| TC21 | Bỏ qua cảnh báo | Nhập giá 40.000 để sinh cảnh báo chốt lời; bấm "Bỏ qua", thử "Hủy" rồi xác nhận | Popup báo "không hoàn tác được"; cảnh báo sang tab "Đã xử lý" với nhãn "Bỏ qua"; không còn nút "Hoàn tác" |
| TC22 | Bán hết | Chọn Bán, "Bán hết", "Ghi lệnh bán", xác nhận | Popup "đóng mã HPG"; về `/` với thông báo "Đã bán hết HPG", mã nằm ở "Đã đóng (1)" |
| TC23 | Route cron | Gọi `/api/cron/check-prices` không có / có `CRON_SECRET` | Không có: **401**; có kèm `force=1`: trả JSON có `checked` |
| TC24 | Responsive | Mở các trang ở chiều rộng 375px | Không tràn ngang |
| TC25 | Giá thị trường lúc tạo mã | Tạo CTG mua 34.000 × 100 (giá thị trường 30.950) | Phí tự điền **5.100**; giá hiện tại **30.950**, nhãn "Giá cập nhật"; giá vốn TB **34.051**; lãi/lỗ **−9,3%** |
| TC26 | Không lấy được giá | Tạo FPT mua 100.000 × 100 (không có giá) | Giá hiện tại **100.000**, nhãn "Giá lúc mua" |
| TC27 | Phí, thuế tự tính | Ở CTG, nhập lệnh mua rồi bán 31.000 × 100 | Phí mua **4.650**; phí bán **4.650**, thuế bán **3.100** |
| TC28 | Cron cập nhật giá | Gọi route cron kèm `force=1` | `checked` = 2, cập nhật **CTG**, thiếu giá **FPT** |
| TC29 | Điện thoại: Ghi lệnh trong sheet | Màn 390px, bấm "Ghi lệnh", rồi Esc | Sheet ẩn khi chưa mở; mở ra là popup "Ghi lệnh mua / bán" có form; Esc thì đóng |
| TC30 | Điện thoại: Sửa kế hoạch trong sheet | Bấm "Sửa kế hoạch", rồi nút đóng | Popup "Sửa kế hoạch"; nút "Lưu kế hoạch" luôn nằm trong màn hình (dính đáy); nút đóng hoạt động |
| TC31 | Desktop giữ bố cục cũ | Màn 1440px mở trang chi tiết | Form ghi lệnh hiện sẵn, không có popup nào mở, không có nút mở sheet |
| TC37 | SEO | Khi bật `APP_PASSWORD`, gọi `/robots.txt`, `/sitemap.xml`, `/opengraph-image`, `/apple-icon`, `/manifest.webmanifest` không kèm cookie; xem thẻ meta | Đều trả 200 đúng loại file; robots cho phép `/login`, chặn phần còn lại; trang đăng nhập có ảnh xem trước, canonical, không noindex; trang tổng quan có `noindex, nofollow` |
| TC38 | Đổi % phí trong Cài đặt | Nhập phí mua 1,5; dùng ô tính từ lệnh khớp (20.000 ÷ 20.000.000); phí bán 0,2; lưu; mở form thêm mã | Báo "Phí phải dưới 1%", khóa nút lưu; tính ra 0,1% và điền vào phí mua; lưu xong form thêm mã tự điền phí 21.000 cho 21.000 × 1.000 và ghi "tự tính 0,1%" |
| TC33 | Menu ☰ trên điện thoại | Màn 390px, bấm ☰, chọn "Cảnh báo" | Không còn thanh nav hiện sẵn; drawer "Menu" mở; chuyển sang `/alerts` thì drawer tự đóng |
| TC32 | Biểu đồ tổng quan | Ở `/`, đổi Giá / Tài sản / Theo mã, mở "Xem dạng bảng" | Có tiêu đề "Biểu đồ danh mục", chú thích có mã đang giữ và "Vốn đang rót"; bảng có dữ liệu; khung thời gian đúng 1D 1W 1M 3M 6M 1Y; 1D không có nến thì báo "Chưa có dữ liệu trong phiên" |
| TC34 | Độ rộng trang | Màn 1440px, mở `/`, `/alerts`, `/settings`, `/positions/new` | Cả 4 trang rộng bằng nhau |

## Unit test bổ sung (`fees.test.ts`)

| Nhóm | Nội dung |
|---|---|
| Phí mặc định | Phí mua/bán 0,15%, thuế bán 0,1%; 21.000 × 1.000 → phí 31.500; 31.000 × 100 → phí bán 4.650, thuế 3.100; 21.050 × 100 → phí 3.158 (làm tròn) |
| Giá vốn, lãi/lỗ | CTG 34.000 × 100 phí 5.100 → giá vốn 34.051; ở giá 30.950 lỗ 317.838đ (**−9,33%**); hòa vốn 34.136; bán 36.000 (phí 5.400, thuế 3.600) lãi chốt 185.900; lệnh ghi phí 0 thì giá vốn đúng 34.000 |
| Giờ trong phiên | Thứ Hai: 8:59 ✗, 9:00 ✓, 11:30 ✓, 11:31 ✗, 12:00 ✗, 13:00 ✓, 15:00 ✓, 15:01 ✗; thứ Bảy, Chủ nhật ✗; tính đúng theo giờ VN dù máy ở múi giờ khác |

## Unit test biểu đồ (`portfolio.test.ts`)

| Nội dung |
|---|
| Chuỗi giá trị danh mục bắt đầu từ ngày mua đầu tiên, mỗi phiên có giá đóng cửa là một điểm, điểm cuối là hôm nay theo giá hiện tại |
| Giá trị = số cổ đang giữ × giá đóng cửa; vốn gồm phí mua; không có giá đóng cửa thì dùng giá khớp gần nhất |
| Bán bớt thì giá trị và vốn giảm theo, bán hết thì mã rời khỏi biểu đồ; nhiều mã cộng dồn, cùng mã mở lại gộp chung |
| Lịch sử giá các mã đang giữ không phụ thuộc ngày mua (xem được cả mã vừa mua), điểm hôm nay theo giá hiện tại |
| Khung thời gian tròn theo lịch (ngày 25/10/2026): 1W từ 19/10, 1M từ 1/10, 3M từ 1/8, 6M từ 1/5, 1Y từ 1/11/2025; lùi qua năm trước đúng; nến trong phiên chỉ lấy phiên gần nhất, mã chưa khớp thì giữ giá mốc trước |

## Thông báo Telegram (`notify.test.ts`)

Chạy thật luồng lấy giá → so với kế hoạch → lưu cảnh báo → gửi Telegram trên database tạm, giá giả lập, Telegram giả (ghi lại tin gửi đi).
Số liệu: HPG mua 21.000 × 1.000 (giá vốn 21.031,5), DCA −10% ≤ 18.900, DCA −10% ≤ 17.000, chốt lời +10% ≥ 23.150 bán 30%.

| ID | Tình huống | Kết quả mong đợi |
|---|---|---|
| N01 | Giá 18.900 chạm nấc DCA 1 | 1 cảnh báo, nấc sang "Đã nhắc", 1 tin: "📉 HPG 18.900 … chạm nấc DCA -10,0%: mua 1.000 cp … Giá vốn sau DCA ≈ 19.980" |
| N02 | Giá 19.000 chưa chạm | Không cảnh báo, không gửi |
| N03 | Kiểm tra lại nhiều lần ở vùng giá đã nhắc | Chỉ 1 tin (mỗi nấc nhắc 1 lần) |
| N04 | Giá 23.150 chạm chốt lời 1 | Tin "🎯 HPG 23.150 chạm nấc chốt lời 1 … bán 300 cp, còn lại 700 cp … Lãi ≈ …" |
| N05 | Giá rơi thẳng xuống 16.900 qua 2 nấc DCA | 2 cảnh báo, gộp trong 1 tin |
| N06 | HPG chạm DCA và FPT chạm chốt lời cùng lúc | 1 tin chứa cả hai mã |
| N07 | Nấc đã bỏ qua / đã làm | Không nhắc |
| N08 | Mã đã đóng | Không kiểm tra |
| N09 | Nhập giá tay chạm nấc | Gửi tin ngay |
| N10 | Chưa cấu hình Telegram | Cảnh báo vẫn lưu trên web, trạng thái "skipped" |
| N11 | Telegram trả lỗi 500 | Cảnh báo vẫn lưu, trạng thái "failed" |
| N12 | Có `APP_URL` | Tin kết thúc bằng link `/alerts` |
| N13 | Không lấy được giá | Báo thiếu giá, không cảnh báo |
| N14 | Khôi phục nấc đã nhắc rồi giá chạm lại | Nhắc lại |
| N15 | Nấc 1 đã khớp ở 18.900 | Nấc 2 không nhắc ở 17.050, nhắc ở 17.000 |

Gửi thật vào chat của bạn (`npm run test:telegram`, đọc `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` từ môi trường): L1 chạm DCA, L2 chạm chốt lời, L3 rơi qua 2 nấc DCA và mã khác chạm chốt lời cùng lúc (1 tin gộp 3 cảnh báo).
Cắt lỗ và trailing stop không có test vì giao diện không còn ô nhập nên không bao giờ kích hoạt.
