# Phân tích hệ thống thực tế — Mộc Café (bản đối chiếu source)

## 1. Phạm vi và bằng chứng

Tài liệu được lập từ mã nguồn trong workspace vào ngày 24/10/2026. Không đọc tệp `.dev.vars`, secret Cloudflare hay dữ liệu D1 production. Nhận định quan trọng đều kèm đường dẫn nguồn. Dự án là ứng dụng đặt món cho quán cà phê, ưu tiên mobile, vận hành trên một Cloudflare Worker có frontend tĩnh cùng origin.

## 2. Kiến trúc và công nghệ đã xác minh

| Lớp | Thành phần | Bằng chứng |
|---|---|---|
| Giao diện khách | HTML/CSS/JavaScript thuần, dialog giỏ hàng/checkout, `localStorage` | `public/index.html`, `public/app.js`, `public/app.css` |
| Giao diện quản trị | HTML/CSS/JavaScript thuần, Bearer token trong `sessionStorage` | `public/admin.html`, `public/admin.js` |
| API | Hono 4, TypeScript, Zod 4 | `src/index.ts`, `src/validation.ts`, `package.json` |
| Dữ liệu | Cloudflare D1 (SQLite) | `migrations/*.sql`, `wrangler.jsonc` |
| Ảnh | Cloudflare R2; ảnh mẫu nằm trong `public/images` | `src/index.ts`, `wrangler.jsonc` |
| Thanh toán | VNPay sandbox/production theo cấu hình; HMAC SHA-512 | `src/vnpay.ts`, `README.md` |
| Vận chuyển | GHN API: danh mục địa chỉ, báo phí, tạo/tra vận đơn | `src/ghn.ts`, `src/index.ts` |
| Kiểm thử | Vitest: 7 test đơn vị | `tests/*.test.ts`, `package.json` |
| Triển khai | Wrangler 4, Workers Assets | `wrangler.jsonc`, `package.json` |

Mô hình là **modular monolith/serverless**, không có bằng chứng về microservices, Docker hay pipeline CI/CD.

## 3. Cấu trúc mã nguồn

| Đường dẫn | Vai trò |
|---|---|
| `src/index.ts` | Khởi tạo Hono, toàn bộ endpoint, nghiệp vụ đơn/admin/ảnh và xử lý lỗi |
| `src/validation.ts` | Schema Zod cho tạo đơn và báo phí |
| `src/ghn.ts` | Client GHN, kiểm tra cấu hình, tính trọng lượng, gọi API có timeout 10 giây |
| `src/vnpay.ts` | Tạo URL VNPay, ký/xác minh HMAC-SHA512 |
| `migrations/` | Schema và dữ liệu menu mẫu, thay đổi checkout/shipping/payment |
| `public/` | Tài nguyên giao diện được Workers Assets phục vụ |
| `tests/` | Test validation, VNPay signing và GHN quote |
| `wrangler.jsonc` | Worker, Assets, binding D1/R2 và biến không bí mật |

## 4. Chức năng và tác nhân

**Khách hàng:** xem/lọc sản phẩm, thêm/xóa/chỉnh số lượng giỏ, chọn lấy tại quán hoặc giao hàng, tạo đơn, nhận hướng dẫn chuyển khoản, chuyển hướng VNPay và xem trạng thái kết quả trả về. Giỏ ở trình duyệt; server luôn đọc giá từ D1 trước khi ghi đơn (`src/index.ts`, POST `/api/orders`).

**Quản trị viên:** đăng nhập bằng token, xem tối đa 100 đơn mới nhất, lọc trạng thái, cập nhật trạng thái, đánh dấu tiền mặt/chuyển khoản đã thanh toán, tạo và làm mới vận đơn GHN, tải ảnh sản phẩm lên R2 (`public/admin.js`, `/api/admin/*`).

## 5. Mô hình dữ liệu

| Bảng | Mục đích | Khóa/liên hệ |
|---|---|---|
| `products` | Menu, giá, trạng thái bán, ảnh R2, trọng lượng | PK `id`; được `order_items` tham chiếu |
| `orders` | Khách, nhận món, tổng tiền, thanh toán, GHN | PK UUID `id` |
| `order_items` | Snapshot món, giá, số lượng tại thời điểm đặt | FK `order_id`, `product_id` |

Schema cuối cùng được hình thành qua migration `0001`–`0005`. `0005` tái tạo `orders` để bổ sung `bank_transfer`; đây là thao tác migration có chủ đích, không phải luồng runtime.

## 6. API đã hiện diện

| Nhóm | Endpoint |
|---|---|
| Sức khỏe/cấu hình | `GET /api/health`, `GET /api/config` |
| Menu/ảnh | `GET /api/categories`, `GET /api/products`, `GET /api/images/:productId` |
| GHN | `GET /api/ghn/provinces`, `/districts`, `/wards`; `POST /api/shipping/quote` |
| Đơn/thanh toán | `POST /api/orders`; `GET /api/payments/vnpay/ipn`, `/return` |
| Admin | `POST /api/admin/session`; đọc/sửa đơn; mark-paid; tạo/làm mới shipment; upload ảnh |

Chi tiết request/response cần đối chiếu trực tiếp `src/index.ts`; chưa có OpenAPI/Swagger.

## 7. Bảo mật và kiểm tra dữ liệu

- Zod giới hạn trường khách, số lượng 1–99, tối đa 30 dòng và cấm trùng sản phẩm (`src/validation.ts`).
- Backend lấy sản phẩm/giá/trọng lượng từ D1; không tin giá gửi từ client.
- Admin yêu cầu `Authorization: Bearer <ADMIN_TOKEN>` và so sánh constant-time (`src/index.ts`). Token phía browser chỉ nằm trong `sessionStorage` của tab (`public/admin.js`).
- VNPay tạo và kiểm tra chữ ký HMAC-SHA512; kiểm tra mã merchant, tiền, trạng thái đơn (`src/vnpay.ts`).
- Upload chỉ JPEG/PNG/WebP, tối đa 5 MB; nếu cập nhật D1 thất bại, cố xóa object R2 vừa tạo (`src/index.ts`).

Hạn chế: chưa thấy rate limit, CSP/security headers chuyên biệt, RBAC nhiều vai trò, CSRF strategy hay audit log; không kết luận chúng hoàn toàn không có ở tầng Cloudflare ngoài mã nguồn.

## 8. Trạng thái chạy, kiểm thử và triển khai

Đã chạy an toàn trong workspace: `npm run typecheck` thành công; `npm test` thành công với 2 file/7 test. Chưa chạy migration hoặc test tích hợp HTTP/D1/GHN/VNPay vì tránh tạo/đổi dữ liệu và phụ thuộc cấu hình thật. Log người dùng cung cấp trước đó cho thấy một lần deploy từng thất bại do D1 ID giả; không coi đó là bằng chứng deployment thành công.

Local theo `README.md`: Node 20.19+ hoặc 22.12+, `npm install`, `npm run db:migrate:local`, `npm run dev`. Production cần D1, R2, `ADMIN_TOKEN`; GHN/VNPay/bank là tùy cấu hình.
