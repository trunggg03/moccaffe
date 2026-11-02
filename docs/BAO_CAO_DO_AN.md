# BÁO CÁO ĐỒ ÁN WEB APPLICATION

## Hệ thống đặt món Mộc Café

**Trường:** [CHƯA CÓ DỮ LIỆU]  
**Khoa/Bộ môn:** [CHƯA CÓ DỮ LIỆU]  
**Sinh viên thực hiện:** [CHƯA CÓ DỮ LIỆU]  
**MSSV:** [CHƯA CÓ DỮ LIỆU]  
**Giảng viên hướng dẫn:** [CHƯA CÓ DỮ LIỆU]  
**Địa điểm, năm:** [CHƯA CÓ DỮ LIỆU], 2026

## Lời cảm ơn

[SCHƯA CÓ DỮ LIỆU]

## Lời cam đoan

[Sinh viên bổ sung theo yêu cầu học phần. Báo cáo kỹ thuật này được đối chiếu với mã nguồn hiện có; các phần chưa kiểm chứng được ghi rõ.]

## Tóm tắt

Mộc Café là web application đặt món cho quán cà phê, thiết kế ưu tiên thiết bị di động. Khách hàng có thể xem menu, lọc theo danh mục, duy trì giỏ hàng trên trình duyệt, đặt lấy tại quán hoặc giao hàng, và chọn thanh toán tiền mặt, chuyển khoản hoặc VNPay khi merchant được cấu hình. Quản trị viên dùng mã quản trị để xem và cập nhật đơn, xác nhận thanh toán thủ công, thao tác vận đơn GHN và tải ảnh sản phẩm.

Hệ thống được triển khai theo kiến trúc modular monolith trên Cloudflare Workers: Hono xử lý API; D1 lưu menu/đơn; R2 lưu ảnh; Workers Assets phục vụ giao diện HTML/CSS/JavaScript. Báo cáo phân tích trực tiếp source, migration và test hiện có. Typecheck và 7 kiểm thử đơn vị đã chạy thành công; kiểm thử tích hợp với Cloudflare, GHN và VNPay chưa được xác minh trong đợt khảo sát.

## Mục lục

Mục lục tự động được tạo/cập nhật từ các Heading trong tệp Word. Với Markdown, dùng cây tiêu đề bên trái của trình soạn thảo.

## Danh mục từ viết tắt

| Viết tắt | Ý nghĩa |
|---|---|
| API | Application Programming Interface |
| D1 | Dịch vụ cơ sở dữ liệu SQLite của Cloudflare |
| R2 | Dịch vụ object storage của Cloudflare |
| GHN | Giao Hàng Nhanh |
| HMAC | Hash-based Message Authentication Code |
| IPN | Instant Payment Notification |
| UI | User Interface |

## Danh mục sơ đồ

1. Sơ đồ kiến trúc hệ thống — `diagrams/architecture.mmd`.
2. Sơ đồ use case — `diagrams/use-case.mmd`.
3. Sơ đồ ERD — `diagrams/erd.mmd`.
4. Sơ đồ tuần tự tạo đơn — `diagrams/order-sequence.mmd`.

# Chương 1. Tổng quan đề tài

## 1.1. Lý do chọn đề tài và bối cảnh

Quán đồ uống cần một kênh nhận đơn trực tuyến gọn nhẹ: khách tự xem menu và gửi thông tin nhận hàng, nhân viên có màn hình tập trung để xử lý. Mã nguồn hiện tại đáp ứng bài toán này bằng một web app cùng origin, giảm nhu cầu cài ứng dụng riêng. Đây là nhận định về bài toán thể hiện qua `README.md`, `public/index.html` và `public/admin.html`, không phải số liệu khảo sát thị trường.

## 1.2. Mục tiêu

Mục tiêu tổng quát là hỗ trợ đặt món và quản lý đơn cho Mộc Café. Mục tiêu cụ thể đã có bằng chứng gồm: hiển thị menu từ D1; giỏ hàng; tạo đơn; tính phí giao; thanh toán COD/chuyển khoản/VNPay theo cấu hình; quản trị đơn; tích hợp GHN; quản lý ảnh R2. Không có bằng chứng về tài khoản khách hàng, khuyến mãi, tồn kho định lượng hoặc đa chi nhánh.

## 1.3. Đối tượng, phạm vi và phương pháp

Người dùng gồm khách hàng và quản trị viên quán. Phạm vi frontend là website mobile-first có `dialog` cho giỏ/checkout. Backend là một Worker TypeScript. Phương pháp phát triển suy ra từ artifact là phát triển lặp với migration tăng dần (`0001`–`0005`) và kiểm thử đơn vị Vitest. Không có tài liệu sprint hoặc kế hoạch dự án để xác nhận quy trình chính thức.

## 1.4. Kết quả thực tế và cấu trúc báo cáo

Kết quả đã có: source app, migrations, giao diện khách/admin, test validation/payment/shipping. Kết quả chưa xác minh: deployment production thành công, merchant VNPay/GHN thật, ảnh R2 thật, dữ liệu đơn thực. Các chương sau lần lượt trình bày yêu cầu, thiết kế, công nghệ, triển khai, kiểm thử, vận hành và đánh giá.

# Chương 2. Khảo sát và phân tích yêu cầu

## 2.1. Tác nhân và nghiệp vụ

Khách hàng duyệt menu, thao tác giỏ, chọn hình thức nhận, nhập liên hệ/địa chỉ, tạo đơn và hoàn tất phương thức thanh toán. Quản trị viên đăng nhập bằng `ADMIN_TOKEN`, theo dõi và xử lý đơn. GHN và VNPay là hệ thống ngoài, tương tác qua API/callback chứ không phải người dùng.

## 2.2. Yêu cầu chức năng

| Mã | Yêu cầu | Trạng thái/bằng chứng |
|---|---|---|
| FR-01 | Hiển thị và lọc menu còn bán | Đã triển khai: `/api/products`, `public/app.js` |
| FR-02 | Giỏ hàng, tăng/giảm số lượng 1–99 | Đã triển khai: `localStorage`, `public/app.js` |
| FR-03 | Tạo đơn lấy tại quán hoặc giao hàng | Đã triển khai: POST `/api/orders` |
| FR-04 | Tính lại giá/tổng tiền ở server | Đã triển khai: đọc `products` trong `src/index.ts` |
| FR-05 | Báo phí GHN hoặc phí thủ công | Đã triển khai theo cấu hình |
| FR-06 | Thanh toán cash, bank transfer, VNPay | Đã triển khai; VNPay cần secret merchant |
| FR-07 | Xác thực callback/IPN VNPay | Đã triển khai HMAC-SHA512 |
| FR-08 | Đăng nhập và quản trị đơn | Đã triển khai: `/api/admin/*` |
| FR-09 | Tạo/làm mới vận đơn GHN | Đã triển khai, cần GHN config |
| FR-10 | Upload/đọc ảnh sản phẩm | Đã triển khai: R2, giới hạn 5 MB |

## 2.3. Yêu cầu phi chức năng

| Mã | Yêu cầu quan sát được | Bằng chứng/giới hạn |
|---|---|---|
| NFR-01 | Tương thích mobile | CSS responsive và cấu trúc mobile-first; chưa có test thiết bị thực |
| NFR-02 | Validation dữ liệu đầu vào | Zod, DB CHECK, kiểm tra HTTP; đã có test schema |
| NFR-03 | Bảo vệ thao tác admin | Bearer `ADMIN_TOKEN`; chưa có RBAC/MFA |
| NFR-04 | Không tin tổng tiền client | Server truy vấn giá D1 trước khi ghi đơn |
| NFR-05 | Hiệu năng | [CHƯA CÓ SỐ ĐO] |
| NFR-06 | Khả năng quan sát | `console.error`; chưa thấy logging/monitoring tập trung |

## 2.4. Quy tắc nghiệp vụ và use case trọng yếu

Mỗi product chỉ xuất hiện một lần trong payload; số lượng 1–99; tối đa 30 dòng. Giao hàng yêu cầu địa chỉ đủ dài, và nếu dùng GHN thì bộ quận/phường phải đầy đủ. Giá, trọng lượng và sản phẩm còn bán được kiểm tra lại từ D1. VNPay chỉ khả dụng khi cấu hình; server chỉ cập nhật `paid` khi chữ ký, merchant, số tiền và đơn hợp lệ. Đơn đã có mã GHN không thể bị hủy trên admin trước khi hủy ở GHN. Xem sơ đồ use case tại `diagrams/use-case.mmd`.

## 2.5. Tiêu chí nghiệm thu

Các tiêu chí có thể nghiệm thu local gồm: menu tải được sau migration; đơn hợp lệ ghi D1; lỗi validation trả 400; test unit chạy; admin từ chối token sai. Với GHN/VNPay/R2 production, tiêu chí còn **chưa xác minh** do phụ thuộc secret và tài khoản thật. Không có kịch bản nghiệm thu chính thức trong source.

# Chương 3. Phân tích và thiết kế hệ thống

## 3.1. Kiến trúc tổng thể

Workers Assets phục vụ `public/`, còn `run_worker_first: ["/api/*"]` chuyển API tới Hono (`wrangler.jsonc`). Hono gọi D1 và R2 qua binding; GHN/VNPay qua HTTPS. Đây là một ứng dụng cùng origin, do đó frontend gọi đường dẫn tương đối `/api/...`. Sơ đồ: `diagrams/architecture.mmd`.

## 3.2. Module và luồng xử lý

`src/index.ts` điều phối endpoint/DB; `validation.ts` kiểm tra request; `ghn.ts` đóng gói GHN và timeout; `vnpay.ts` ký/xác minh payment. Luồng tạo đơn: UI gửi danh sách ID/số lượng; Worker parse Zod, lấy product đang bán, tính subtotal, báo phí nếu có GHN, ghi `orders` + `order_items` bằng D1 batch và trả URL VNPay hoặc hướng dẫn bank. Sơ đồ chi tiết: `diagrams/order-sequence.mmd`.

## 3.3. Thiết kế cơ sở dữ liệu

`products` giữ catalog và `image_key`; `orders` giữ snapshot khách/nhận hàng/thanh toán/GHN; `order_items` giữ snapshot giá/số lượng/trọng lượng. Quan hệ là một order có nhiều item; một product xuất hiện nhiều item theo thời gian. Ràng buộc CHECK có mặt cho tiền không âm, quantity dương, enum nhận hàng/trạng thái/thanh toán. Xem ERD `diagrams/erd.mmd` và migration `migrations/0001_initial.sql` đến `0005_bank_transfer.sql`.

## 3.4. Thiết kế API

API được nhóm theo menu, GHN, orders/payment và admin; danh sách tóm tắt có ở `PHAN_TICH_HE_THONG.md`. API chưa công bố schema OpenAPI. HTTP 400 dùng cho input sai, 401 admin sai, 404 resource không có, 409 xung đột trạng thái và 503 khi tích hợp chưa cấu hình. `app.onError` trả lỗi 500 chung, tránh trả stack trace cho client.

## 3.5. UI/UX, xác thực và bảo mật

Khách dùng giỏ local và các dialog native. Admin nhập token, frontend gửi `Authorization: Bearer` và lưu token trong `sessionStorage`; logout xóa token. Upload chấp nhận `Authorization` hoặc `X-Admin-Token`. VNPay dùng HMAC-SHA512 và constant-time compare. Thiết kế chưa hiện diện: account khách, refresh token, permission phân tầng, rate limiting, CSP/CSRF policy ở source; cần đánh giá nếu mở public.

# Chương 4. Công nghệ và môi trường phát triển

| Công nghệ | Vai trò và vị trí | Nhận xét |
|---|---|---|
| TypeScript | Worker, validation, test | Strict mode, typecheck không emit |
| Hono | Router API | Nhẹ, phù hợp Workers (`src/index.ts`) |
| Zod | Validate JSON | Quy tắc order/quote tập trung |
| Cloudflare Workers/Assets | Runtime và static hosting | Deploy bằng Wrangler |
| D1 | SQLite serverless | Menu, order, migration SQL |
| R2 | Object storage | Ảnh sản phẩm qua binding |
| GHN | Phí/vận đơn | Tùy cấu hình credentials/sender |
| VNPay | Thanh toán online | Sandbox URL hiện trong config |
| Vitest | Unit test | 7 test hiện có |

Môi trường theo README yêu cầu Node.js 20.19+ hoặc 22.12+. Không có bằng chứng Git remote, Docker, Kubernetes, ORM hay framework frontend. Lựa chọn serverless/D1/R2 được mã nguồn xác nhận về vai trò; lý do kinh doanh chi tiết không được ghi nhận nên không suy diễn thêm.

# Chương 5. Triển khai hệ thống

## 5.1. Frontend

`public/index.html` khai báo menu, giỏ và checkout. `public/app.js` tải `/api/products` và `/api/config`, dựng menu động, lưu cart `moc-cafe-cart-v1`, điều khiển địa chỉ GHN, submit đơn và xử lý return VNPay. `public/admin.html`/`admin.js` quản lý đơn; admin list giới hạn 100 bản ghi do API quy định. Ảnh fallback là asset local; ảnh R2 được ưu tiên nếu `image_key` tồn tại.

## 5.2. Backend và tích hợp

Endpoint order không nhận giá từ client. Với bank transfer, Worker chỉ trả VietQR khi bốn biến ngân hàng đủ; nếu không, UI báo quán sẽ liên hệ. Với VNPay, URL có hiệu lực 15 phút theo hàm tạo URL. Với GHN, Worker dùng địa chỉ chọn từ master data, gọi báo phí trước khi persist và có cơ chế reservation `ghn_status='creating'` để giảm rủi ro tạo trùng vận đơn.

## 5.3. Xử lý lỗi và validation

Body JSON lỗi được chuyển null và validation trả 400. GHN có timeout 10 giây. Upload kiểm tra MIME/size và hoàn tác object R2 nếu không liên kết D1 được. Có một hạn chế cần lưu ý: transaction D1 batch giúp các statement order cùng batch, nhưng không có test lỗi mạng/khôi phục ngoài hệ thống.

# Chương 6. Kiểm thử và đánh giá chất lượng

## 6.1. Kết quả đã chạy

Ngày khảo sát, đã chạy `npm run typecheck` thành công và `npm test` thành công: 2 file test, 7 test pass. Các test kiểm tra order schema, địa chỉ giao/lấy tại quán, trùng món/quantity/điện thoại, chữ ký VNPay, total weight và GHN quote mock. Không có benchmark, E2E browser hoặc integration test D1/R2 thật.

## 6.2. Test case đề xuất/xác minh

| Mã | Chức năng | Kết quả thực tế |
|---|---|---|
| TC-01 | Validation đơn delivery/pickup hợp lệ | Pass qua `order-validation.test.ts` |
| TC-02 | Từ chối duplicate/quantity/phone sai | Pass qua test unit |
| TC-03 | Ký và xác minh callback VNPay | Pass qua test unit mock |
| TC-04 | Tính trọng lượng và quote GHN | Pass qua test unit mock |
| TC-05 | Tạo đơn với D1 local | [CHƯA XÁC MINH] |
| TC-06 | Upload/đọc ảnh R2 | [CHƯA XÁC MINH] |
| TC-07 | VNPay/GHN thật | [CHƯA XÁC MINH] |
| TC-08 | Đăng nhập admin token sai/đúng qua HTTP | [CHƯA XÁC MINH] |

Đánh giá: validation và module ký/quote có kiểm thử đơn vị. Các luồng có trạng thái ngoài cần test sandbox riêng, không nên chạy vào production chỉ để làm báo cáo.

# Chương 7. Triển khai và vận hành

## 7.1. Local và production

Local: `npm install`, `npm run db:migrate:local`, `npm run dev`. Production: tạo D1/R2, gán ID D1 và bindings trong `wrangler.jsonc`, chạy `npm run db:migrate:remote`, `npm run deploy`. Đây là hướng dẫn theo README/package, không phải bằng chứng deploy thành công.

Biến không bí mật hiện có: `DELIVERY_FEE_VND`, `GHN_API_URL`, `VNPAY_GATEWAY_URL`; các thông tin bank nếu dùng được trả về client nên chỉ là tài khoản nhận tiền công khai của quán. Secrets cần đặt qua Wrangler: `ADMIN_TOKEN`, GHN token/shop ID, VNPay TMN/hash secret. Không ghi giá trị secret vào tài liệu.

## 7.2. Rủi ro vận hành

Phải thay endpoint sandbox GHN/VNPay sang production chỉ khi có merchant/config hợp lệ. Cần cấu hình VNPay IPN URL. Chưa thấy backup policy, dashboard alert, tracing, log retention, CI/CD hoặc runbook phục hồi. D1 migration `0005` tái tạo bảng; phải sao lưu/kiểm tra backup theo khả năng nền tảng trước khi áp dụng vào dữ liệu quan trọng.

# Chương 8. Kết quả, đánh giá và hướng phát triển

## 8.1. Kết quả đạt được

Ứng dụng đã có luồng đặt món hoàn chỉnh ở mức source, quản trị đơn, D1/R2 binding, và integration code GHN/VNPay. Thiết kế server-authoritative pricing, validation và xác minh chữ ký là các điểm tích cực. Typecheck/test unit hiện có pass.

## 8.2. Hạn chế và hướng phát triển

Chưa xác minh end-to-end/deploy, chưa có account khách, tồn kho, coupon, notification, payment refund tự động, webhook GHN, báo cáo kinh doanh, audit log và monitoring. Khuyến nghị ưu tiên: test tích hợp D1/R2 bằng môi trường preview; rate limit và security headers; đưa admin sang xác thực mạnh hơn/RBAC; idempotency cho tạo order/payment; quan sát logs/alert; backup/restore rehearsal; thêm E2E responsive/accessibility.

## 8.3. Kết luận

Mộc Café là nền tảng đặt món serverless có phạm vi rõ ràng và source nhất quán với stack Cloudflare. Báo cáo không khẳng định chất lượng production hay trạng thái triển khai khi chưa có bằng chứng. Với cấu hình secret, test tích hợp và vận hành bổ sung, hệ thống có thể tiếp tục được hoàn thiện cho bối cảnh quán cà phê thực tế.

# Tài liệu tham khảo

1. Cloudflare. *Workers Documentation*. https://developers.cloudflare.com/workers/
2. Cloudflare. *D1 Documentation*. https://developers.cloudflare.com/d1/
3. Cloudflare. *R2 Documentation*. https://developers.cloudflare.com/r2/
4. Hono. *Hono Documentation*. https://hono.dev/docs/
5. Zod. *Zod Documentation*. https://zod.dev/
6. VNPay. *Cổng thanh toán VNPay*. https://sandbox.vnpayment.vn/
7. GHN. *GHN API Documentation*. https://api.ghn.vn/home/docs
8. Vitest. *Vitest Documentation*. https://vitest.dev/

# Phụ lục

## A. Tệp mã nguồn tiêu biểu

`src/index.ts`, `src/validation.ts`, `src/ghn.ts`, `src/vnpay.ts`, `migrations/*.sql`, `public/app.js`, `public/admin.js`, `wrangler.jsonc`, `tests/*.test.ts`.

## B. Sơ đồ nguồn

Các tệp Mermaid nằm tại `docs/diagrams/`. Chúng là sơ đồ có thể xem/chỉnh sửa, phản ánh binding và endpoint đã khảo sát.

## C. Điều chỉnh theo đối chiếu source

Khi có mâu thuẫn, nội dung trong `docs/DIEU_CHINH_BAO_CAO.md` được ưu tiên. Bản điều chỉnh xác nhận menu mẫu có 18 sản phẩm; frontend không gọi endpoint categories; API admin chỉ trả tối đa 100 đơn; admin dùng `ADMIN_TOKEN` thay vì tài khoản mật khẩu; đồng thời ghi nhận hai binding cấu hình chưa xác định và lỗi vị trí listener/timer trong `public/admin.js`. Các tích hợp GHN, VNPay, R2 và deployment vẫn là **chưa xác minh end-to-end**.
