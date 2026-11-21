# Điều chỉnh bắt buộc đối với báo cáo Mộc Café

Tệp này được lập sau khi đọc lại source. Các nhận định tại đây **ưu tiên hơn** các câu mô tả khái quát trong bản báo cáo trước.

## Sự thật kỹ thuật đã đối chiếu

1. Đây là một Cloudflare Worker duy nhất (`src/index.ts`) kết hợp Workers Assets (`public/`), không có backend/frontend tách thành hai ứng dụng và không có microservice.
2. Frontend khách gọi `GET /api/products` và tự suy ra category từ trường `category`; **không gọi** `GET /api/categories`, dù endpoint đó tồn tại.
3. Menu mẫu từ migration gồm **18 sản phẩm**: 8 record ở `0002_seed_products.sql` và 10 record ở `0004_add_menu_items.sql`.
4. Order payload chỉ chứa ID/số lượng; server truy vấn lại product còn bán, giá và trọng lượng trong `findProducts()` trước khi ghi D1. Không được mô tả như client gửi giá sản phẩm.
5. `GET /api/admin/orders` chỉ trả tối đa 100 đơn mới nhất. API có query `status`, nhưng `public/admin.js` hiện gọi endpoint không kèm query và lọc dữ liệu ở client.
6. Admin không có username/password database. UI gửi `Authorization: Bearer <ADMIN_TOKEN>`; token trong `sessionStorage`. `ADMIN_TOKEN` là Worker secret, không có giá trị trong source.
7. VNPay chỉ bật khi tồn tại cả `VNPAY_TMN_CODE` và `VNPAY_HASH_SECRET`. GHN chỉ bật khi có token, shop ID và toàn bộ thông tin người gửi. Các luồng này có mã nguồn nhưng chưa được xác minh với tài khoản thật.
8. Bank transfer không tự xác minh giao dịch. Admin gọi endpoint `mark-paid`; QR chỉ được trả khi bốn biến `BANK_*` cùng tồn tại.
9. Upload ảnh yêu cầu quyền admin, JPEG/PNG/WebP và kích thước 1 byte–5 MB. Object được lưu R2 trước, sau đó liên kết vào `products.image_key`; có cleanup nếu cập nhật D1 lỗi.
10. `wrangler.jsonc` có hai binding được source sử dụng: `DB`, `PRODUCT_IMAGES`; đồng thời còn `moc_cafe_db` và `s` không xuất hiện trong interface `Env`/logic app. Mục đích của hai binding sau là **[CHƯA CÓ DỮ LIỆU]**.

## Vấn đề mã nguồn không được che giấu

Trong `public/admin.js`, listener của ô tìm kiếm và timer `setInterval` 30 giây được đặt bên trong listener thay đổi status filter. Vì vậy trước lần đổi filter đầu tiên, chúng chưa được đăng ký; mỗi lần đổi filter lại thêm một listener/timer. Đây là lỗi cần sửa/kiểm thử, không được ghi thành “auto refresh đã hoạt động ổn định”.

Trường `shipping_label_url` có trong migration nhưng `src/index.ts` không ghi hoặc trả giá trị này. Không được khẳng định hệ thống tạo/hiển thị nhãn vận đơn.

## Trạng thái bằng chứng

- Đã chạy: `npm run typecheck`; `npm test` — 2 file, 7 test pass.
- Chưa chạy: migration local/remote, HTTP integration, D1/R2 thật, GHN/VNPay sandbox hoặc production, deploy thành công, E2E browser/accessibility/performance.
- Không có dữ liệu để kết luận về số người dùng, hiệu năng, uptime, backup, CI/CD, log/monitoring production.
