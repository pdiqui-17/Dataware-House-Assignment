# Data Warehouse API

Backend API phục vụ dashboard OLAP và phân tích delivery/review.

## Base URL

Mặc định khi chạy local:

```text
http://localhost:3000
```

Tất cả API trả về JSON. Query parameter dùng kiểu chuỗi trong URL; các giá trị
`year`, `quarter`, `month`, `depth` được parse thành số ở backend.

## Requirements

- Node.js 24 LTS (or another supported LTS compatible with your deployment)
- npm

## Quick start

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Kiểm tra nhanh:

- `GET http://localhost:3000/`
- `GET http://localhost:3000/api/v1/health`

## API reference

### 1. Server information

#### `GET /`

```json
{
  "data": {
    "name": "Express TypeScript API",
    "version": "1.0.0"
  }
}
```

### 2. Health

#### `GET /api/v1/health`

```json
{
  "data": {
    "status": "ok",
    "timestamp": "2026-11-02T00:00:00.000Z",
    "uptimeSeconds": 123
  }
}
```

#### `GET /api/v1/db-health`

```json
{
  "status": "ok",
  "database": "connected",
  "time": "2026-11-02T00:00:00.000Z"
}
```

### 3. Metadata

#### `GET /api/v1/meta/dimensions`

Trả về các dimension dùng cho màn hình phân tích.

```json
{
  "data": ["time", "seller_geo", "product"]
}
```

### 4. Sales OLAP

#### `GET /api/v1/sale/analysis`

Query parameters:

| Parameter  | Required | Values/example                  | Description                                                     |
| ---------- | -------: | ------------------------------- | --------------------------------------------------------------- |
| `dim`      |       No | `time`, `seller_geo`, `product` | Dimension phân tích. Mặc định `time`.                           |
| `depth`    |       No | `1`, `2`, `3`                   | Số level hierarchy.                                             |
| `from`     |       No | `2018-01-01`                    | Ngày mua từ ngày này, inclusive.                                |
| `to`       |       No | `2018-12-31`                    | Ngày mua đến ngày này, inclusive.                               |
| `year`     |       No | `2018`                          | Lọc theo năm.                                                   |
| `quarter`  |       No | `1` - `4`                       | Lọc theo quý.                                                   |
| `month`    |       No | `1` - `12`                      | Lọc theo tháng.                                                 |
| `state`    |       No | `SP`                            | Seller state.                                                   |
| `city`     |       No | `sao paulo`                     | Seller city.                                                    |
| `category` |       No | `beleza_saude`                  | Product category.                                               |
| `status`   |       No | `delivered,canceled`            | Danh sách status phân cách bằng dấu phẩy. Mặc định `delivered`. |

Hierarchy:

- `time`: `year` → `quarter` → `month`
- `seller_geo`: `seller_state` → `seller_city`
- `product`: `category` → `product`

Ví dụ:

```text
GET /api/v1/sale/analysis?dim=time&depth=3&year=2018&quarter=1
```

Response:

```json
{
  "dim": "time",
  "levels": ["year", "quarter", "month"],
  "data": [
    {
      "level": 3,
      "level_name": "month",
      "keys": {
        "year": 2018,
        "quarter": 1,
        "month": 1
      },
      "total_price": 111798.3,
      "total_freight": 18234.5,
      "n_orders": 748,
      "n_items": 812
    },
    {
      "level": 0,
      "level_name": "grand_total",
      "keys": {},
      "total_price": 111798.3,
      "total_freight": 18234.5,
      "n_orders": 748,
      "n_items": 812
    }
  ]
}
```

`level = 0` là tổng toàn bộ; các record còn lại là level tương ứng trong
hierarchy.

### 5. Delivery OLAP

#### `GET /api/v1/delivery/analysis`

Query parameters:

| Parameter    | Required | Values/example         | Description                 |
| ------------ | -------: | ---------------------- | --------------------------- |
| `dim`        |       No | `time`, `customer_geo` | Mặc định `time`.            |
| `depth`      |       No | `1`, `2`, `3`          | Số level hierarchy.         |
| `from`, `to` |       No | `2018-01-01`           | Khoảng ngày mua, inclusive. |
| `year`       |       No | `2018`                 | Năm.                        |
| `quarter`    |       No | `1` - `4`              | Quý.                        |
| `month`      |       No | `1` - `12`             | Tháng.                      |
| `state`      |       No | `SP`                   | Customer state.             |
| `city`       |       No | `sao paulo`            | Customer city.              |

Hierarchy:

- `time`: `year` → `quarter` → `month`
- `customer_geo`: `customer_state` → `customer_city`

Chỉ các delivery order đủ điều kiện được tính.

Ví dụ:

```text
GET /api/v1/delivery/analysis?dim=customer_geo&depth=2&state=SP
```

Response:

```json
{
  "dim": "customer_geo",
  "levels": ["customer_state", "customer_city"],
  "data": [
    {
      "level": 2,
      "level_name": "customer_city",
      "keys": {
        "customer_state": "SP",
        "customer_city": "sao paulo"
      },
      "measures": {
        "eligible_orders": 40000,
        "late_orders": 3000,
        "late_rate": 0.075,
        "avg_delivery_days": 12.4,
        "avg_delay_days": 2.5
      }
    }
  ]
}
```

#### `GET /api/v1/delivery/distribution`

Dùng để vẽ biểu đồ phân phối delay. Nhận cùng các filter của delivery analysis.

```text
GET /api/v1/delivery/distribution?dim=time&year=2018
```

Response:

```json
{
  "meta": {
    "cube": "delivery",
    "metric": "delay_days",
    "basis": "eligible_orders",
    "total": 96470,
    "filters": {
      "year": 2018
    },
    "buckets": [
      { "key": "early_8plus", "label": "Sớm từ 8 ngày", "side": "early" },
      { "key": "early_1_7", "label": "Sớm 1-7 ngày", "side": "early" },
      { "key": "on_time", "label": "Đúng ngày dự kiến", "side": "on_time" },
      { "key": "late_1_3", "label": "Trễ 1-3 ngày", "side": "late" },
      { "key": "late_4_7", "label": "Trễ 4-7 ngày", "side": "late" },
      { "key": "late_8plus", "label": "Trễ từ 8 ngày", "side": "late" }
    ],
    "notes": ["Chỉ tính đơn đủ điều kiện (delivered, có đủ timestamp)."]
  },
  "summary": {
    "early_orders": 87000,
    "on_time_orders": 1200,
    "late_orders": 8270,
    "late_rate": 8.57
  },
  "data": [
    {
      "bucket": "late_1_3",
      "label": "Trễ 1-3 ngày",
      "side": "late",
      "n_orders": 2500,
      "pct": 2.59
    }
  ]
}
```

`pct` và `late_rate` là phần trăm, không phải tỷ lệ từ 0 đến 1.

### 6. Pivot OLAP

Pivot adds a two-dimensional cross-tab for sales and delivery. Choose one axis for rows (`rows`), one for columns (`cols`), and one measure for each cell. Rotate the table by swapping `rows` and `cols`.

#### `GET /api/v1/sale/pivot`

#### `GET /api/v1/delivery/pivot`

Both endpoints require distinct `rows` and `cols`. `measure` is optional. Date, time, geography, and business filters follow the corresponding analysis endpoint.

| Parameter | Description |
| --- | --- |
| `rows`, `cols` | Row and column axes from the cube whitelist |
| `measure` | Measure to calculate; defaults to `total_price` for sales and `late_rate` for delivery |
| `from`, `to` | Inclusive purchase date range in `YYYY-MM-DD` format |
| `year`, `quarter`, `month` | Time filters; quarter is 1-4 and month is 1-12 |
| `state`, `city` | Seller geography for sales; customer geography for delivery |
| `category`, `status` | Sales only; `status` is a comma-separated list |
| `max_rows`, `max_cols` | Display limits from 1 to 50; defaults are 20 and 10 |

Sales axes: `year`, `year_quarter`, `year_month`, `seller_state`, `seller_city`, `category`, `order_status`.

Sales measures: `total_price`, `total_freight`, `n_orders`, `n_items`.

Delivery axes: `year`, `year_quarter`, `year_month`, `customer_state`, `customer_city`, `delay_bucket`.

Delivery measures: `eligible_orders`, `late_orders`, `late_rate`, `avg_delivery_days`, `avg_delay_days`. `late_rate` is a ratio from 0 to 1. With `delay_bucket`, only `eligible_orders` and `avg_delivery_days` are accepted; all six buckets are always returned in fixed order.

Examples:

```text
GET /api/v1/sale/pivot?rows=year_month&cols=category&measure=total_price&year=2018
GET /api/v1/delivery/pivot?rows=year_month&cols=customer_state&measure=late_rate
```

The response contains `row_headers`, `col_headers`, `matrix`, row and column totals, and `grand_total`. `matrix[i][j]` corresponds to the headers at the same indexes; a missing cell is `null`. Totals are calculated directly from filtered fact rows, not from visible cells. `meta.truncated` indicates whether rows or columns were limited; `meta.total_rows` and `meta.total_cols` report cardinality before the limit.

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
    "notes": ["Totals are calculated directly from filtered fact rows."]
  },
  "row_headers": [{ "key": "2018-01", "label": "2018-01" }],
  "col_headers": [{ "key": "beleza_saude", "label": "health_beauty" }],
  "matrix": [[12345.67]],
  "row_totals": [98765.43],
  "col_totals": [12345.67],
  "grand_total": 543210.98
}
```

An empty result still returns HTTP 200 with empty header lists and matrix, and `grand_total: null`. Invalid parameters return HTTP 400 as `{ "error": "..." }`. Sales defaults to `delivered`, except when `order_status` is an axis and no `status` is provided.

#### `GET /api/v1/meta/pivot`

Returns the axes and measures whitelist for both cubes, including each key, label, kind, and unit. Metadata is generated from the same configuration used to validate pivot requests.

### 7. Review theo độ trễ


#### `GET /api/v1/reviews/by-delay`

API đọc từ view `dw.v_order_review`.

Query parameters:

| Parameter | Required | Values/example   | Description        |
| --------- | -------: | ---------------- | ------------------ |
| `group`   |       No | `bucket`, `flag` | Mặc định `bucket`. |
| `from`    |       No | `2018-01-01`     | Ngày mua bắt đầu.  |
| `to`      |       No | `2018-12-31`     | Ngày mua kết thúc. |
| `state`   |       No | `SP`             | Customer state.    |

Với `group=bucket`, nhóm gồm:
`early_8plus`, `early_1_7`, `on_time`, `late_1_3`, `late_4_7`, `late_8plus`.

```text
GET /api/v1/reviews/by-delay?group=bucket
```

```json
{
  "meta": {
    "group": "bucket",
    "filters": {},
    "total_orders": 96470,
    "orders_with_review": 95000,
    "orders_without_review": 1470
  },
  "data": [
    {
      "group": "late_4_7",
      "label": "Trễ 4-7 ngày",
      "n_orders": 1800,
      "avg_score": 2.4,
      "low_review_rate": 0.52
    }
  ]
}
```

Với `group=flag`, API nhóm thành `not_late` và `late`, đồng thời trả thêm:

```text
GET /api/v1/reviews/by-delay?group=flag&state=SP
```

```json
{
  "meta": {
    "group": "flag",
    "filters": { "state": "SP" },
    "p0": 0.0677,
    "avg_late": 2.5,
    "avg_ok": 4.25
  },
  "data": [
    {
      "group": "not_late",
      "label": "Không trễ",
      "n_orders": 40000,
      "avg_score": 4.25,
      "low_review_rate": 0.07
    },
    {
      "group": "late",
      "label": "Trễ",
      "n_orders": 3000,
      "avg_score": 2.5,
      "low_review_rate": 0.48
    }
  ]
}
```

`avg_score`, `avg_late`, `avg_ok` là điểm review trung bình. `low_review_rate`
và `p0` là tỷ lệ từ `0` đến `1`.

### 8. Seller scorecard (DSS)

#### `GET /api/v1/dss/seller-scorecard`

Tính điểm và gắn nhãn cho seller dựa trên GMV, tỷ lệ giao trễ và tỷ lệ review
thấp. Kết quả được sắp xếp theo `score` giảm dần; seller chưa đủ dữ liệu được
trả về sau nhóm seller đủ tin cậy với `score` bằng `null`.

| Parameter | Required | Values/example                              | Description                                                                                               |
| --------- | -------: | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `limit`   |       No | `10`                                        | Số seller trả về, từ `1` đến `100`. Mặc định `50`.                                                        |
| `state`   |       No | `SP`                                        | Seller state gồm đúng 2 chữ cái in hoa.                                                                   |
| `weights` |       No | `gmv:0.2,late_rate:0.5,low_review_rate:0.3` | Override trọng số; mỗi giá trị từ `0` đến `1`. Các tiêu chí không truyền sẽ dùng cấu hình trong database. |

Ví dụ:

```text
GET /api/v1/dss/seller-scorecard?limit=10
GET /api/v1/dss/seller-scorecard?state=SP&weights=gmv:0.2,late_rate:0.5,low_review_rate:0.3
```

Response:

```json
{
  "data": [
    {
      "seller_id": "seller-id",
      "seller_state": "SP",
      "gmv": 12345.67,
      "late_rate": 0.08,
      "low_review_rate": 0.1,
      "rank": 1,
      "score": 0.82,
      "gmv_pct": 0.95,
      "parts": {
        "gmv": 0.9,
        "late_rate": 0.8,
        "low_review_rate": 0.75
      },
      "label": "Retain",
      "action": "Hiệu quả tốt",
      "freight_ratio": 0.12
    }
  ],
  "pagination": {
    "limit": 10,
    "total": 120
  },
  "weights": [{ "criterion": "gmv", "weight": 0.2, "direction": "higher" }]
}
```

#### `GET /api/v1/dss/config`

Trả về cấu hình hiện tại của DSS gồm `weights`, `rules` và `settings`.

```text
GET /api/v1/dss/config
```

`weights` gồm các tiêu chí `gmv`, `late_rate`, `low_review_rate`; `direction`
là `higher` hoặc `lower`. `settings` gồm ngưỡng số đơn tối thiểu và ngưỡng GMV
cho seller chưa đủ dữ liệu nhưng có doanh số cao.

#### `GET /api/v1/dss/delivery-buffer` (Module B)

Đọc chính sách cam kết giao hàng đã được build. API so sánh ba chính sách trên
cùng tập test: `state_k` (mỗi bang một `k`), `global_k` (dùng chung `k` của toàn
sàn) và `current_k0` (giữ nguyên cam kết, `k = 0`). Endpoint chỉ đọc dữ liệu đã
lưu trong DSS; cần chạy pipeline trước.

| Parameter          | Required | Values/example | Description                                                                                                                |
| ------------------ | -------: | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `state`            |       No | `SP`           | Bang khách hàng gồm đúng 2 chữ cái in hoa. Có tham số này thì trả chi tiết một bang; bỏ qua để nhận tổng hợp toàn bộ bang. |
| `target_late_rate` |       No | `0.05`         | Tỷ lệ trễ mục tiêu trong khoảng `(0, 1)`. Mặc định `0.05`.                                                                 |
| `k_min`            |       No | `-10`          | Cận dưới nguyên của dải `k` cần trả về. Mặc định `-10`; phải nằm trong dải đã build.                                       |
| `k_max`            |       No | `10`           | Cận trên nguyên của dải `k` cần trả về. Mặc định `10`; phải nằm trong dải đã build và không nhỏ hơn `k_min`.               |
| `run_id`           |       No | `12`           | Run cụ thể cần đọc. Mặc định là run `is_active`; run không tồn tại trả `404`.                                              |

Ví dụ:

```text
GET /api/v1/dss/delivery-buffer
GET /api/v1/dss/delivery-buffer?state=SP
GET /api/v1/dss/delivery-buffer?state=RJ&target_late_rate=0.05&k_min=-5&k_max=20
GET /api/v1/dss/delivery-buffer?run_id=12
```

Khi truyền `state`, response có `current`, `recommended`, `global_comparison` và
`curve`. `recommended` gồm `k`, tỷ lệ trễ train/test, review kỳ vọng, trạng thái
đánh giá, khoảng tin cậy Wilson 95% và số đơn test. Bang có ít hơn
`minSegmentNTrain` dùng `k` của toàn sàn và được đánh dấu `fallback: true`.

Khi bỏ `state`, `data.summary` chứa kết quả tổng hợp của ba chính sách;
`data.segments` chứa kết quả riêng từng bang. `low_power` không được tính vào số
bang được chấm hoặc `pct_orders_in_met`, nhưng vẫn có trọng số trong `late_rate`
gộp toàn sàn.

Các trạng thái đánh giá:

- `met`: tỷ lệ trễ test `<= target_late_rate`.
- `missed`: tỷ lệ trễ test `> target_late_rate`.
- `low_power`: số đơn test thấp hơn `minSegmentNTest`, chưa đủ cơ sở kết luận.
- `significantly_above_target`: cận dưới Wilson 95% lớn hơn `target_late_rate`.

Nếu chưa có run hoạt động, API trả `404`. Giá trị tham số không hợp lệ hoặc
`k_min`/`k_max` nằm ngoài dải đã build trả `400`.

#### `GET /api/v1/dss/delivery-buffer/tradeoff`

Trả bảng so sánh đánh đổi giữa các `safety_margin` đã build cho cùng một khoảng
train/test. Mặc định dùng khoảng thời gian của run đang hoạt động. Nếu truyền
`split_date` và `test_end`, phải truyền cả hai; không tìm thấy run phù hợp trả
`404`.

| Parameter    | Required | Values/example | Description                                     |
| ------------ | -------: | -------------- | ----------------------------------------------- |
| `split_date` |       No | `2018-03-01`   | Ngày bắt đầu tập test, định dạng `YYYY-MM-DD`.  |
| `test_end`   |       No | `2018-08-31`   | Ngày kết thúc tập test, định dạng `YYYY-MM-DD`. |

Ví dụ:

```text
GET /api/v1/dss/delivery-buffer/tradeoff
GET /api/v1/dss/delivery-buffer/tradeoff?split_date=2018-03-01&test_end=2018-08-31
```

Mỗi dòng `data` gồm `run_id`, `safety_margin`, `late_rate`,
`promised_days_avg`, `n_segments_scored`, `n_segments_met`, `pct_orders_in_met`,
`worst_segment` và `worst_late_rate`. Nếu đã build lại cùng một margin nhiều lần,
endpoint trả run mới nhất cho margin đó; các dòng được sắp theo margin tăng dần.

#### Build dữ liệu cho Module B

Trên database mới, áp dụng `src/sql/006_delivery_policy.sql` để tạo view và các
bảng v1 trước. Sau đó áp dụng `src/sql/006_delivery_policy_v2.sql` trước lần
build v2 đầu tiên. Khi nâng cấp database đã chạy v1, chỉ cần áp dụng migration
v2. Migration v2 xóa các run delivery policy cũ vì chúng dùng trạng thái
`passed`/`failed`; chỉ chạy migration này một lần.

```powershell
npm run dss:delivery:profile
npm run dss:delivery:build -- --split-date 2018-03-01 --test-end 2018-08-31
npm run dss:delivery:build -- --split-date 2018-03-01 --test-end 2018-08-31 --margins 0,0.005,0.01
```

Profile xuất tỷ lệ đủ điều kiện theo tháng để kiểm tra thiên lệch ở các tháng
cuối. Margin sweep tạo một run cho mỗi giá trị; run có margin bằng
`defaultConfig.safetyMargin` được kích hoạt. Không kết hợp `--margins` với
`--split-dates`. Báo cáo JSON/CSV được ghi vào `reports/delivery_policy/`.

### 9. Error response

Validation error dùng HTTP `400`:

```json
{
  "error": "group phải là bucket hoặc flag"
}
```

Resource không tồn tại dùng HTTP `404`:

```json
{
  "error": "Not found"
}
```

## Scripts

- `npm run dev`: development server with reload
- `npm run build`: compile TypeScript into `dist/`
- `npm start`: run compiled server
- `npm run typecheck`: TypeScript checks
- `npm run lint`: ESLint
- `npm run format`: Prettier
- `npm test`: run tests
- `npm run dss:delivery:profile`: profile monthly delivery completeness and delay distribution
- `npm run dss:delivery:build -- --split-date <date> --test-end <date>`: build a delivery policy run
- Add `--margins 0,0.005,0.01` to build and compare safety margins; do not combine it with `--split-dates`

## Structure

```text
src/
  app.ts                 # Configure Express and middleware
  server.ts              # Listen, graceful shutdown
  config/env.ts          # Validate environment variables
  controller/            # HTTP request handlers, including DSS delivery policy
  model/                 # Scorecard and delivery-policy calculations
  repository/            # Parameterized PostgreSQL queries
  scripts/               # Delivery profile and build commands
  service/               # DSS business logic
  sql/                   # Warehouse views and DSS migrations
  lib/logger.ts           # Shared structured logger
  middleware/
    error-handler.ts     # Central error handler
    not-found.ts          # Consistent 404
  modules/
    health/
      health.routes.ts   # Health endpoint
      health.test.ts     # API integration tests
```

## Conventions

- Keep `app.ts` separate from `server.ts` so tests can import the app without opening a port.
- Put routes and domain logic into feature modules, not one giant route file.
- Validate all external input at the boundary (e.g. Zod).
- Use parameterized queries; never concatenate user input into SQL.
- Do not commit `.env` or secrets.
- Use migrations for schema changes.
- Add authentication, authorization, rate limiting, and request size limits before exposing sensitive endpoints publicly.
- Configure CORS to known frontend origins in production.
- Keep logs structured and redact secrets.
- Add request IDs and observability when the app grows.
- Keep business logic out of route handlers as the domain grows: route -> service -> repository.
