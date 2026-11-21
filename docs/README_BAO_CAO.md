# Hướng dẫn sử dụng bộ báo cáo

## Tệp bàn giao

- `BAO_CAO_DO_AN.md`: bản Markdown đầy đủ, thuận tiện review bằng VS Code.
- `BAO_CAO_DO_AN.docx`: bản Word có Heading, header/footer, bảng, danh mục hình/sơ đồ và mục lục dạng field để cập nhật.
- `PHAN_TICH_HE_THONG.md`: bằng chứng phân tích cô đọng theo đường dẫn mã nguồn.
- `diagrams/*.mmd`: mã Mermaid của bốn sơ đồ kỹ thuật.
- `scripts/generate_report.py`: script tạo lại DOCX từ nội dung đã định nghĩa; không tác động source ứng dụng.

## Mở và hoàn thiện Word

Mở `BAO_CAO_DO_AN.docx` bằng Microsoft Word. Điền các trường trong ngoặc vuông ở bìa: tên trường, khoa, sinh viên, MSSV, giảng viên, địa điểm và năm. Nhấp phải vào mục lục, chọn **Update Field** → **Update entire table** để Word tạo số trang thật. Word sẽ tự đánh số trang ở footer.

Sơ đồ Mermaid được giữ thành tệp nguồn để dễ kiểm chứng/chỉnh sửa. DOCX liệt kê vị trí và đường dẫn của từng sơ đồ; chưa chèn ảnh raster vì môi trường tạo báo cáo không có Mermaid CLI/renderer. Có thể xuất `.mmd` bằng Mermaid Live Editor hoặc công cụ Mermaid CLI rồi chèn ảnh vào đúng chú thích tương ứng.

## Cách tái tạo DOCX

Yêu cầu Python và `python-docx`. Từ root project:

```powershell
python docs/scripts/generate_report.py
```

## Lưu ý trước khi nộp

1. Bổ sung thông tin cá nhân/học vụ ở trang bìa.
2. Cập nhật mục lục Word.
3. Chỉ thay trạng thái “[CHƯA XÁC MINH]” khi có bằng chứng mới, ví dụ ảnh deploy hoặc test tích hợp.
4. Không đưa `ADMIN_TOKEN`, GHN token, VNPay hash secret hay thông tin ngân hàng bí mật vào báo cáo.
5. Nếu cần ảnh giao diện, chạy local bằng dữ liệu test và tự chụp; báo cáo hiện không tuyên bố có ảnh chụp runtime.
