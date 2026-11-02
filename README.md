# Mộc Café — ứng dụng đặt món

Ứng dụng web đặt món cho quán cà phê, thiết kế ưu tiên mobile. Khách có thể lọc thực đơn, thêm món vào giỏ, chọn đến lấy hoặc giao hàng GHN, thanh toán khi nhận hoặc chuyển sang VNPay. Frontend là HTML/CSS/JavaScript tĩnh; API chạy trên Cloudflare Workers với Hono, Cloudflare D1 lưu sản phẩm/đơn hàng và Cloudflare R2 lưu ảnh sản phẩm.

## Chạy ở máy local

Yêu cầu Node.js 20.19+ hoặc 22.12+.

```sh
npm install
npm run db:migrate:local
npm run dev
```

Mở URL Wrangler in ra (thường là `http://localhost:8787`). Wrangler dùng D1 và R2 local; các migration thêm thực đơn mẫu và 10 món mới. Khi chưa cấu hình GHN, khách vẫn có thể giao tận nhà bằng cách nhập địa chỉ dạng văn bản; phí mặc định là 15.000₫.
Để đăng nhập admin local, tạo file `.dev.vars` (đã được gitignore) và khai báo `ADMIN_TOKEN` bên trong. Có thể khai báo thêm `BANK_NAME`, `BANK_BIN`, `BANK_ACCOUNT_NUMBER` và `BANK_ACCOUNT_HOLDER` để hiển thị thông tin/QR chuyển khoản. Không dùng thông tin tài khoản giả; nếu chưa khai báo, quán cần xác nhận tài khoản với khách sau khi nhận đơn.

## Kiểm tra

```sh
npm run typecheck
npm test
```

## Triển khai Cloudflare

1. Tạo D1 database `moc-cafe-db` và R2 bucket `moc-cafe-product-images`.
2. Thay `database_id` trong `wrangler.jsonc` bằng ID D1 vừa tạo.
3. Tạo Vectorize index cho chatbot với 768 chiều và cosine distance:

   ```sh
   npx wrangler vectorize create moc-cafe-menu --dimensions=768 --metric=cosine
   ```

   `wrangler.jsonc` đã khai báo Workers AI binding `AI` và Vectorize binding `MENU_VECTORIZE`. Chatbot dùng `@cf/google/embeddinggemma-300m` để nhúng câu hỏi và dữ liệu menu/FAQ, sau đó dùng `@cf/google/gemma-4-26b-a4b-it` để tạo câu trả lời dựa trên nội dung tìm được.
   Ở mỗi lượt chat, menu và giá đang bán được đọc trực tiếp từ D1 nên gợi ý món luôn dùng dữ liệu mới nhất, không phụ thuộc việc menu đã được seed vào Vectorize hay chưa.
   Chatbot chỉ đề xuất tối đa 3 món có trong menu hiện tại; không tự xác nhận tồn kho, thành phần, ưu đãi, đơn hàng, thanh toán, hủy đơn hoặc hoàn tiền nếu hệ thống không cung cấp dữ liệu/chức năng xác minh tương ứng.

4. Cấu hình thông tin điểm gửi GHN trong `vars`: `GHN_FROM_NAME`, `GHN_FROM_PHONE`, `GHN_FROM_ADDRESS`, `GHN_FROM_WARD_CODE`, `GHN_FROM_WARD_NAME`, `GHN_FROM_DISTRICT_ID`, `GHN_FROM_DISTRICT_NAME`. GHN phải có thông tin shop/địa chỉ gửi hợp lệ để báo phí và tạo vận đơn. Thêm các khóa này vào mục `vars` trong `wrangler.jsonc` hoặc Worker settings, ví dụ:

   ```json
   {
     "GHN_FROM_NAME": "Moc Cafe",
     "GHN_FROM_PHONE": "<so-dien-thoai-diem-gui>",
     "GHN_FROM_ADDRESS": "<dia-chi-diem-gui>",
     "GHN_FROM_WARD_CODE": "<ma-phuong-cua-GHN>",
     "GHN_FROM_WARD_NAME": "<ten-phuong>",
     "GHN_FROM_DISTRICT_ID": "<ma-quan-cua-GHN>",
     "GHN_FROM_DISTRICT_NAME": "<ten-quan>"
   }
   ```
5. Thiết lập các secret (không commit giá trị bí mật vào mã nguồn):

   ```sh
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put GHN_TOKEN
   npx wrangler secret put GHN_SHOP_ID
   npx wrangler secret put VNPAY_TMN_CODE
   npx wrangler secret put VNPAY_HASH_SECRET
   ```

   Thêm `BANK_NAME`, `BANK_BIN`, `BANK_ACCOUNT_NUMBER`, `BANK_ACCOUNT_HOLDER` trong Cloudflare Worker Settings → Variables and Secrets nếu muốn khách nhận hướng dẫn/QR chuyển khoản tự động. Các giá trị tài khoản được gửi công khai đến trình duyệt qua `/api/config`, vì vậy chỉ nhập tài khoản nhận tiền của quán. Có thể đổi phí giao thủ công bằng biến `DELIVERY_FEE_VND`.

6. `wrangler.jsonc` mặc định dùng môi trường sandbox GHN và VNPay. Trước khi chạy thật, đổi `GHN_API_URL` thành `https://online-gateway.ghn.vn` và `VNPAY_GATEWAY_URL` thành `https://pay.vnpay.vn/vpcpay.html`; lấy mã merchant và secret key từ tài khoản VNPay production.
7. Cấu hình URL IPN sau khi deploy trong VNPay Merchant Portal: `https://<ten-worker>/api/payments/vnpay/ipn`. URL Return URL được ký và tạo tự động từ domain đang chạy.
8. Cài dependency, áp dụng migration lên D1 production và deploy:

   ```sh
   npm install
   npm run db:migrate:remote
   npm run deploy
   ```

   Sau khi deploy, tạo vector FAQ trong Vectorize bằng token quản trị (menu vẫn được đọc trực tiếp từ D1):

   ```sh
   curl -X POST "https://<ten-worker>/api/chat/seed" `
     -H "Authorization: Bearer <ADMIN_TOKEN>"
   ```

   Chạy lại endpoint seed sau khi cập nhật thực đơn để làm mới dữ liệu tìm kiếm.

## Quản trị, thanh toán và giao hàng

- Mở `/admin.html`, đăng nhập bằng `ADMIN_TOKEN`; mã được giữ trong `sessionStorage` của tab trình duyệt và gửi qua HTTPS trong header Bearer.
- Bảng quản trị liệt kê 100 đơn gần nhất, lọc theo trạng thái, xem thông tin/chi tiết món, cập nhật trạng thái và xác nhận đã nhận tiền mặt/chuyển khoản.
- Đơn VNPay chỉ được đánh dấu đã thanh toán sau khi xác minh HMAC-SHA512, mã đơn và số tiền từ Return URL/IPN. Chỉ tạo vận đơn GHN cho đơn VNPay đã thanh toán.
- Khi GHN được cấu hình, địa chỉ giao nhận dùng danh mục tỉnh/quận/phường từ GHN; phí được GHN báo tại lúc khách đặt hàng và máy chủ tính lại trước khi lưu đơn. Khi chưa cấu hình GHN, khách nhập địa chỉ đầy đủ dạng văn bản và phí cố định lấy từ `DELIVERY_FEE_VND` (mặc định 15.000₫); đơn này không tạo được vận đơn GHN.
- Chuyển khoản ngân hàng là xác nhận thủ công: chỉ cấu hình tài khoản quán thật qua `BANK_NAME`, `BANK_BIN`, `BANK_ACCOUNT_NUMBER`, `BANK_ACCOUNT_HOLDER`; admin phải xác nhận tiền đã vào tài khoản. Mã QR được tạo theo định dạng VietQR từ BIN và số tài khoản đã cấu hình.
- Quản lý có thể tạo vận đơn từ chi tiết đơn và yêu cầu đồng bộ trạng thái mới nhất từ GHN. Cước giao hàng đã thu từ khách được quán thanh toán cho GHN; đơn COD yêu cầu GHN thu tổng tiền đơn từ người nhận.
- Hoàn tiền VNPay và webhook trạng thái giao hàng tự động chưa được bật; hoàn tiền cần xử lý qua Merchant Portal. Sau khi đã tạo vận đơn, hãy hủy trực tiếp với GHN trước khi hủy đơn trong bảng quản trị.

## Tải ảnh sản phẩm lên R2

Endpoint chỉ nhận ảnh JPEG, PNG hoặc WebP, tối đa 5 MB; cần gửi token `ADMIN_TOKEN`. Ảnh được lưu trong R2, còn khóa ảnh liên kết với sản phẩm trong D1.

```sh
curl -X POST "https://<ten-worker>/api/admin/products/ca-phe-sua-da/image" `
  -H "X-Admin-Token: <ADMIN_TOKEN>" `
  -F "file=@ca-phe-sua-da.webp"
```

Sản phẩm chưa có ảnh sẽ dùng artwork minh họa tích hợp sẵn. Không đưa `ADMIN_TOKEN` vào frontend hoặc mã nguồn.

## Tùy chỉnh

- Sửa sản phẩm, giá và danh mục mẫu trong `migrations/0002_seed_products.sql` trước khi áp dụng migration lần đầu.
- Migration `0004_add_menu_items.sql` bổ sung 10 món cà phê, trà và bánh; áp dụng migration local hoặc remote để đồng bộ thực đơn.
- Có thể chỉnh phí giao thủ công bằng biến `DELIVERY_FEE_VND`; không để phí âm hoặc lớn hơn 10.000.000₫.
- Ảnh menu mặc định là ảnh chụp thực tế dùng làm ảnh tham khảo, được lưu trong `public/images` và có ghi nguồn trong `public/images/credits.txt`; đây chưa phải ảnh tự chụp món do quán pha/chế biến. Ảnh thật của quán tải lên R2 sẽ được ưu tiên hiển thị.
- Khi chưa cấu hình thông tin merchant VNPay, lựa chọn thanh toán online sẽ được ẩn; thanh toán khi nhận và chuyển khoản thủ công vẫn khả dụng.
