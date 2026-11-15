# Spec hiện thực Pivot cho Data Warehouse API

Tài liệu dành cho Codex. Đọc hết trước khi sửa code. Làm đúng phạm vi, không thêm tính năng ngoài danh sách.

## 1. Bối cảnh

- Backend: Express + TypeScript, kiến trúc `route -> controller -> service -> repository`, validate input bằng Zod, query PostgreSQL parameterized (schema `dw`).
- Đã có: `GET /api/v1/sale/analysis`, `GET /api/v1/delivery/analysis` (roll-up/drill-down theo `dim` + `depth`), `GET /api/v1/delivery/distribution`, `GET /api/v1/reviews/by-delay`, `GET /api/v1/meta/dimensions`, các endpoint DSS.
- Mục tiêu: thêm thao tác OLAP **pivot** (cross-tab hai chiều: một thuộc tính ở hàng, một thuộc tính ở cột, một measure ở ô).
- Convention hiện có cần giữ: lỗi validate trả HTTP 400 `{ "error": "<thông báo tiếng Việt>" }`; query param là chuỗi; không nối chuỗi từ input vào SQL.

## 2. Phạm vi

**Làm:**
1. `GET /api/v1/sale/pivot`
2. `GET /api/v1/delivery/pivot`
3. `GET /api/v1/meta/pivot`
4. Test tự động, cập nhật Postman collection, cập nhật API docs.

**Không làm:** drill-through, drill-across, pivot cho review, so sánh theo thời gian, sửa response của các endpoint hiện có, frontend, thay đổi schema DW/ETL.

## 3. Endpoint

### 3.1 `GET /api/v1/sale/pivot`

Query parameters:

| Param | Bắt buộc | Mô tả |
|---|---|---|
| `rows` | Có | Axis hàng, thuộc whitelist sales (mục 4.1) |
| `cols` | Có | Axis cột, thuộc whitelist sales, phải khác `rows` |
| `measure` | Không | Mặc định `total_price`. Giá trị: `total_price`, `total_freight`, `n_orders`, `n_items` |
| `from`, `to` | Không | Ngày mua, inclusive, `YYYY-MM-DD` |
| `year`, `quarter`, `month` | Không | Như `/sale/analysis` (`month` là 1–12) |
| `state`, `city` | Không | Seller state / seller city, như `/sale/analysis` |
| `category` | Không | Product category, như `/sale/analysis` |
| `status` | Không | Danh sách phân cách dấu phẩy. Mặc định `delivered`, trừ trường hợp ngoại lệ ở mục 6.3 |
| `max_rows` | Không | Số hàng tối đa, 1–50, mặc định 20 |
| `max_cols` | Không | Số cột tối đa, 1–50, mặc định 10 |

### 3.2 `GET /api/v1/delivery/pivot`

| Param | Bắt buộc | Mô tả |
|---|---|---|
| `rows`, `cols` | Có | Axis thuộc whitelist delivery (mục 4.2), khác nhau |
| `measure` | Không | Mặc định `late_rate`. Giá trị: `eligible_orders`, `late_orders`, `late_rate`, `avg_delivery_days`, `avg_delay_days` |
| `from`, `to`, `year`, `quarter`, `month` | Không | Như `/delivery/analysis` |
| `state`, `city` | Không | Customer state / customer city |
| `max_rows`, `max_cols` | Không | Như trên |

Chỉ tính đơn `is_delivery_eligible = true` (giống `/delivery/analysis`).

### 3.3 `GET /api/v1/meta/pivot`

Không có tham số. Trả về:

```json
{
  "data": {
    "sales": {
      "axes": [{ "key": "year", "label": "Năm", "kind": "time" }, ...],
      "measures": [{ "key": "total_price", "label": "Tổng giá trị hàng", "unit": "currency" }, ...]
    },
    "delivery": { "axes": [...], "measures": [...] }
  }
}
```

`kind` là `time` hoặc `category`. `unit` là một trong `currency`, `count`, `ratio`, `days`. Dữ liệu sinh từ cùng hằng số whitelist dùng cho validate, không được viết tay trùng lặp.

## 4. Whitelist axis và measure

Mỗi axis là một object cấu hình cố định gồm: `key`, `label`, `kind`, biểu thức SQL cho key (`keyExpr`), biểu thức SQL cho label (`labelExpr`), và quy tắc sắp xếp. Tên axis từ client chỉ dùng để tra bảng cấu hình, tuyệt đối không đưa vào SQL.

### 4.1 Sales

Bảng nguồn: `dw.fact_sales_item f` JOIN `dw.dim_date d ON d.date_key = f.purchase_date_key`, JOIN `dw.dim_seller s ON s.seller_key = f.seller_key`, JOIN `dw.dim_product p ON p.product_key = f.product_key`, JOIN `dw.dim_order_status st ON st.order_status_key = f.order_status_key`.

| Axis | kind | keyExpr | Ghi chú |
|---|---|---|---|
| `year` | time | `d.year` | sắp tăng dần |
| `year_quarter` | time | `d.year \|\| '-Q' \|\| d.quarter` | ví dụ `2018-Q1`; sắp theo (year, quarter) |
| `year_month` | time | `to_char(d.date_key, 'YYYY-MM')` | sắp tăng dần |
| `seller_state` | category | `s.seller_state` | |
| `seller_city` | category | `s.seller_state \|\| ' - ' \|\| s.seller_city` | tránh trùng tên thành phố khác bang |
| `category` | category | `COALESCE(p.product_category_name, 'unknown')` | label: `product_category_name_english` nếu có, ngược lại dùng key |
| `order_status` | category | `st.order_status` | |

Không đưa `product` vào whitelist vì cardinality quá lớn (32,951).

### 4.2 Delivery

Bảng nguồn: `dw.fact_delivery_order f` JOIN `dw.dim_date d ON d.date_key = f.purchase_date_key`, JOIN `dw.dim_customer c ON c.customer_key = f.customer_key`. Điều kiện cố định: `f.is_delivery_eligible = true`.

| Axis | kind | keyExpr |
|---|---|---|
| `year`, `year_quarter`, `year_month` | time | như sales |
| `customer_state` | category | `c.customer_state` |
| `customer_city` | category | `c.customer_state \|\| ' - ' \|\| c.customer_city` |
| `delay_bucket` | category | CASE theo `f.delay_days` (bên dưới) |

`delay_bucket` dùng đúng bucket của `/delivery/distribution`, thứ tự cố định và label tiếng Việt như docs hiện có:

| key | điều kiện `delay_days` | label |
|---|---|---|
| `early_8plus` | `<= -8` | Sớm từ 8 ngày |
| `early_1_7` | `-7..-1` | Sớm 1-7 ngày |
| `on_time` | `= 0` | Đúng ngày dự kiến |
| `late_1_3` | `1..3` | Trễ 1-3 ngày |
| `late_4_7` | `4..7` | Trễ 4-7 ngày |
| `late_8plus` | `>= 8` | Trễ từ 8 ngày |

Nếu đã có hằng số/CASE bucket trong code của `/delivery/distribution`, **tái sử dụng**, không định nghĩa lại.

### 4.3 Measure

Sales:

| measure | SQL |
|---|---|
| `total_price` | `SUM(f.price)` |
| `total_freight` | `SUM(f.freight_value)` |
| `n_orders` | `COUNT(DISTINCT f.order_id)` |
| `n_items` | `SUM(f.item_count)` |

Delivery:

| measure | SQL |
|---|---|
| `eligible_orders` | `COUNT(*)` |
| `late_orders` | `COUNT(*) FILTER (WHERE f.is_delayed)` |
| `late_rate` | `late_orders / NULLIF(eligible_orders, 0)`, kiểu số **0–1** (giống `/delivery/analysis`, không phải phần trăm) |
| `avg_delivery_days` | `AVG(f.delivery_days)` |
| `avg_delay_days` | `AVG(f.delay_days)` |

Làm tròn số thực ở tầng response (giá trị tiền 2 chữ số thập phân, tỷ lệ 4, số ngày 2). Giá trị `NULL` giữ là `null`, không đổi thành 0.

## 5. Chiến lược truy vấn

Yêu cầu bắt buộc: tổng hàng, tổng cột và grand total phải được tính **trực tiếp từ dữ liệu fact**, không cộng từ các ô, vì `COUNT(DISTINCT order_id)` và các tỷ lệ/trung bình không cộng được.

Gợi ý hiện thực, một câu SQL duy nhất:

1. CTE `base`: áp filter, chọn `row_key`, `row_label`, `col_key`, `col_label` và các cột cần cho measure.
2. CTE `agg`: `GROUP BY GROUPING SETS ((row_key, row_label, col_key, col_label), (row_key, row_label), (col_key, col_label), ())` kèm `GROUPING(...)` để phân biệt cell, row total, col total, grand total.
3. Chọn hàng/cột hiển thị dựa trên row total và col total (cùng measure):
   - Axis `time`: lấy `max_rows`/`max_cols` kỳ **mới nhất**, trình bày theo thứ tự thời gian tăng dần.
   - Axis `category`: lấy top theo giá trị measure giảm dần (NULL xếp cuối, tie-break theo key tăng dần để kết quả ổn định). Riêng `delay_bucket` luôn đủ 6 bucket theo thứ tự cố định, không áp `max_*`.
4. Chỉ trả các cell có `row_key` và `col_key` nằm trong tập được chọn.
5. Nếu số hàng/cột phân biệt lớn hơn giới hạn, đặt `meta.truncated` tương ứng. Có thể dùng thêm một câu `COUNT(DISTINCT ...)` nhẹ để lấy số hàng/cột phân biệt tổng.

Được phép tách thành 2–3 query nếu code rõ hơn, nhưng không được tính tổng bằng cách cộng ô, và không được `SELECT` toàn bộ cell lên Node rồi lọc nếu cardinality lớn (ví dụ `seller_city x category`).

Tất cả tham số truyền qua parameterized query. Biểu thức axis/measure lấy từ whitelist cố định.

## 6. Quy tắc validate và nghiệp vụ

6.1. `rows`, `cols` bắt buộc, thuộc whitelist của cube tương ứng, và `rows !== cols`. Sai thì 400.

6.2. `measure` thuộc whitelist của cube. Nếu một axis là `delay_bucket` thì `measure` chỉ được là `eligible_orders` hoặc `avg_delivery_days` (các measure còn lại suy biến theo bucket). Sai thì 400 với thông báo nêu các giá trị hợp lệ.

6.3. **Ngoại lệ status (sales):** nếu `rows` hoặc `cols` là `order_status` và client không truyền `status`, **không** áp mặc định `delivered`. Ghi điều này vào `meta.filters` (không có `status`). Nếu client truyền `status` thì dùng đúng giá trị đó.

6.4. Filter (`from`, `to`, `year`, `quarter`, `month`, `state`, `city`, `category`, `status`) dùng cùng quy tắc parse/validate và cùng ngữ nghĩa với endpoint analysis tương ứng. **Tái sử dụng** hàm validate và hàm dựng điều kiện WHERE hiện có nếu có thể, không sao chép lại. `from > to` thì 400.

6.5. `max_rows`, `max_cols` là số nguyên 1–50, sai thì 400.

6.6. Giá trị `category` null được gom thành `unknown`.

6.7. Kết quả rỗng (không có dữ liệu) vẫn trả 200 với `row_headers: []`, `col_headers: []`, `matrix: []`, `row_totals: []`, `col_totals: []`, `grand_total: null`.

## 7. Response

```json
{
  "cube": "sales",
  "rows": "year_month",
  "cols": "category",
  "measure": "total_price",
  "meta": {
    "filters": { "year": 2018, "status": ["delivered"] },
    "unit": "currency",
    "n_rows": 8,
    "n_cols": 10,
    "total_rows": 8,
    "total_cols": 71,
    "truncated": { "rows": false, "cols": true },
    "notes": [
      "Tổng hàng, tổng cột và tổng chung được tính trực tiếp từ dữ liệu, có thể khác tổng các ô hiển thị khi bị cắt hoặc khi measure không cộng được."
    ]
  },
  "row_headers": [{ "key": "2018-01", "label": "2018-01" }],
  "col_headers": [{ "key": "beleza_saude", "label": "health_beauty" }],
  "matrix": [[12345.67, null, 800.5]],
  "row_totals": [98765.43],
  "col_totals": [12345.67, 500.0, 800.5],
  "grand_total": 543210.98
}
```

Quy ước:
- `matrix[i][j]` ứng với `row_headers[i]` và `col_headers[j]`. Ô không có dữ liệu là `null`.
- `row_totals[i]` là tổng của hàng `i` trên **toàn bộ** cột (kể cả cột bị cắt); `col_totals[j]` tương tự; `grand_total` là tổng toàn bộ dữ liệu đã lọc.
- Khi `truncated.rows` hoặc `truncated.cols` là `true`, `meta.notes` phải có câu giải thích ở trên; khi không bị cắt và measure cộng được (`total_price`, `total_freight`, `n_items`, `eligible_orders`, `late_orders`) thì tổng các ô phải bằng tổng hàng/cột tương ứng.
- Delivery pivot: `meta.unit` theo measure; `late_rate` là số 0–1.
- Key số (ví dụ `year`) trả về dạng chuỗi trong header để thống nhất kiểu.

## 8. Cấu trúc file (bám theo cấu trúc hiện có)

Theo `controller/`, `service/`, `repository/`, `model/` hiện có của project; đặt tên theo thông lệ code đang dùng:

- `model/`: cấu hình axis/measure (whitelist), type của request/response, hằng số bucket (tái sử dụng nếu đã có).
- `repository/`: hàm dựng và chạy SQL pivot (parameterized).
- `service/`: validate nghiệp vụ (mục 6), gọi repository, dựng response matrix từ các dòng cell/total.
- `controller/` + routes: 3 endpoint mới, đăng ký dưới prefix `/api/v1`.
- Zod schema cho query ở biên.

Không đặt logic nghiệp vụ trong route handler.

## 9. Test

Unit test (không cần DB):
1. Validate: thiếu `rows`/`cols`, `rows === cols`, axis/measure ngoài whitelist, `delay_bucket` với measure không hợp lệ, `max_rows=0`/`51`, `from > to` đều trả 400.
2. Dựng matrix từ tập dòng mẫu: đúng vị trí, ô thiếu là `null`, thứ tự header (time tăng dần, category theo measure giảm dần, `delay_bucket` thứ tự cố định).
3. Ngoại lệ status: `order_status` làm axis mà không truyền `status` thì không áp `delivered`.

Integration test (cần DB đã nạp dữ liệu; nếu test infra hiện có không có DB thì viết nhưng đánh dấu skip có điều kiện theo biến môi trường):
1. `sale/pivot?rows=year&cols=category&measure=total_price`: `grand_total` bằng `total_price` của dòng `level=0` trong `/sale/analysis?dim=time` cùng filter.
2. Tương tự cho `n_orders` (đối chiếu analysis) để chứng minh không cộng ô cho distinct count.
3. `delivery/pivot?rows=year&cols=customer_state&measure=late_rate`: `grand_total` bằng `late_rate` toàn bộ của `/delivery/analysis`.
4. Với measure cộng được và `truncated` đều `false`: tổng các ô mỗi hàng bằng `row_totals`.
5. Đổi chỗ `rows` và `cols`: ma trận chuyển vị, `grand_total` không đổi.
6. `meta/pivot` trả đủ axis và measure, khớp whitelist.

## 10. Postman và docs

Thêm folder **Pivot** vào `Data-Warehouse-API.postman_collection.json`, mỗi request có test script theo kiểu hiện có (`pm.test(...)`):

- Sales pivot: `year_month x category` (200, có `matrix`, `row_headers`, `grand_total`).
- Sales pivot: `seller_state x year_quarter`, `measure=n_orders`.
- Sales pivot: `order_status x year` không truyền `status` (200, có nhiều hơn một hàng).
- Delivery pivot: `year_month x customer_state`, `measure=late_rate`.
- Delivery pivot: `delay_bucket x customer_state`, `measure=eligible_orders`.
- Meta pivot (200).
- Validation: `rows=cols` (400), axis không hợp lệ (400), `delay_bucket` + `late_rate` (400).

Cập nhật API docs: thêm mục **Pivot** (3 endpoint, bảng tham số, whitelist axis/measure, ví dụ request/response, quy ước tổng và `truncated`, các mã lỗi). Ghi rõ pivot là thao tác OLAP bổ sung cho roll-up/drill-down, và rotate = hoán đổi `rows`/`cols`.

## 11. Tiêu chí hoàn thành

- [ ] 3 endpoint hoạt động theo mục 3 và 7.
- [ ] Không có chuỗi từ client được nối vào SQL; axis/measure chỉ qua whitelist.
- [ ] Tổng hàng/cột/chung tính trực tiếp từ dữ liệu; test đối chiếu với analysis đạt.
- [ ] Mọi lỗi validate trả 400 `{ "error": ... }`; kết quả rỗng trả 200.
- [ ] Hiệu năng: mọi tổ hợp axis hợp lệ trên bộ dữ liệu Olist hiện tại phản hồi trong vài giây; `seller_city x category` không kéo toàn bộ cell lên ứng dụng.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` đều pass.
- [ ] Postman collection và API docs đã cập nhật.
- [ ] Không thay đổi response/hành vi của các endpoint hiện có.

## 12. Lưu ý cuối

- Không đổi schema hay ETL. Nếu thiếu cột/index cần thiết thì dừng và ghi chú lại, đừng tự thêm migration.
- Nếu một yêu cầu trong tài liệu mâu thuẫn với code hiện có (ví dụ tên bảng/cột khác), ưu tiên DDL thực tế trong `sql/001_create_dw.sql`, và nêu rõ chỗ lệch trong mô tả PR.