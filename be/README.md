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

### 6. Review theo độ trễ

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

### 7. Error response

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

## Structure

```text
src/
  app.ts                 # Configure Express and middleware
  server.ts              # Listen, graceful shutdown
  config/env.ts          # Validate environment variables
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
