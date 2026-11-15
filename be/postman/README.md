# Postman test configuration

Thư mục này chứa:

- `Data-Warehouse-API.postman_collection.json`: collection gồm toàn bộ API hiện có, request mẫu và test tự động.
- `Data-Warehouse-API.postman_environment.json`: environment cho local với `baseUrl`, filter và khoảng ngày mẫu.

## Import vào Postman

1. Khởi động backend:

   ```powershell
   cd "D:\Năm 4\Data warehouse\assignment\be"
   npm install
   Copy-Item .env.example .env
   npm run dev
   ```

2. Trong Postman chọn **Import**.
3. Chọn cả hai file JSON trong thư mục `postman`.
4. Vào menu environment ở góc phải, chọn **Data Warehouse API - Local**.
5. Nếu server chạy cổng khác, sửa biến `baseUrl` thành `http://localhost:<port>`.
6. Chạy từng request hoặc chọn collection > **Run collection**.

## Thứ tự chạy khuyến nghị

Chạy `System` trước để kiểm tra server và database, sau đó chạy `Metadata`,
`Sales`, `Delivery`, `Reviews`, `Sellers` và `DSS`. Request `List sellers` tự lưu
`sellerId` đầu tiên vào collection variable để request `Seller detail` dùng lại.
Nhóm `DSS` cần dữ liệu warehouse và các bảng cấu hình trong schema `dss`.

`Database health` yêu cầu PostgreSQL và database đã được cấu hình trong `.env`.
Các request phân tích cũng cần dữ liệu warehouse đã được load; nếu chưa có dữ
liệu, request vẫn kiểm tra schema/status nhưng có thể trả về tập `data` rỗng.

## Chạy bằng Newman (tuỳ chọn)

```powershell
npx newman run .\postman\Data-Warehouse-API.postman_collection.json `
  -e .\postman\Data-Warehouse-API.postman_environment.json
```

Để chạy backend ở port khác mà không sửa file:

```powershell
npx newman run .\postman\Data-Warehouse-API.postman_collection.json `
  -e .\postman\Data-Warehouse-API.postman_environment.json `
  --env-var "baseUrl=http://localhost:4000"
```

## Pivot requests

The `Pivot` folder covers sales and delivery cross-tabs, pivot metadata, and invalid parameter responses.
