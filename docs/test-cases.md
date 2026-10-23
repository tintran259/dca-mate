# Test case DCA Mate

Hai lớp test:

- **Unit test** (`npm test`): phần tính toán trong `src/lib/calc.ts`: giá vốn, chuỗi DCA, chuỗi chốt lời, bước giá, lô 100.
- **E2E** (`npm run test:e2e`, 24 case): chạy app thật trên trình duyệt Chrome với database tạm, đi qua các luồng dưới đây. Không đụng tới dữ liệu trong `.data/`.

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
