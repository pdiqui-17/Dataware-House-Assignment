# Module B – What-if cam kết ngày giao hàng: đặc tả pipeline

Tài liệu này dùng để giao cho Codex hiện thực. Mọi tham số chưa được quyết định đều nằm trong `config.ts` (Bước 0), không hard-code. Pipeline viết hoàn toàn bằng TypeScript, chạy chung dự án backend Express + `pg`.

## 0. Bối cảnh và mục tiêu

**Quyết định cần hỗ trợ:** với từng bang khách hàng, ngày giao dự kiến hiển thị cho khách nên cộng thêm (`k > 0`) hay bớt đi (`k < 0`) bao nhiêu ngày.

**Mục tiêu tối ưu (xác định rõ để không mơ hồ):**
1. **Ràng buộc cứng:** tỷ lệ đơn giao trễ ≤ `target_late_rate` (mặc định 0.05).
2. **Tối ưu:** trong các `k` thỏa ràng buộc, chọn `k` **nhỏ nhất** (cam kết ngắn nhất, hấp dẫn nhất với khách).
3. **Chỉ báo phụ (không tối ưu):** điểm review kỳ vọng, hiển thị để quản lý cân nhắc. Có thể bật thêm ràng buộc `max_review_drop` (xem config).

**Ký hiệu:** `d = delay_days` của một đơn (ngày giao thực tế − ngày giao dự kiến, số nguyên). Cộng `k` ngày vào cam kết thì độ trễ mới là `d − k`; đơn trễ khi `d − k > 0`, tức `d > k`. Do đó:

```
late_rate(k) = COUNT(d > k) / COUNT(*)      -- không tăng khi k tăng
k*           = min { k nguyên trong [k_min, k_max] : late_rate(k) <= target }
```

**Môi trường có sẵn:** PostgreSQL 16, schema `dw` (kho dữ liệu) và `dss` (cấu hình DSS); backend Express + TypeScript dùng `pg`; pipeline Module B cũng viết bằng TypeScript trong cùng dự án. Bảng `dss.*` không được nằm trong danh sách TRUNCATE của ETL.

**Nguồn dữ liệu:** `dw.fact_delivery_order` (grain 1 dòng/đơn, `is_delivery_eligible`, `delay_days`, `delivery_days`), `dw.dim_customer` (`customer_state`), `dw.fact_review` (có thể nhiều review/đơn → phải gộp về cấp đơn trước khi nối).

## 1. Cấu trúc thư mục và cách chạy

Toàn bộ pipeline viết bằng **TypeScript trong cùng dự án backend**, dùng thư viện `pg` có sẵn. Không cần Python.

```
src/dss/delivery-policy/
  config.ts                          # Bước 0: tham số (có kiểu, có chú thích)
  core.ts                            # hàm thuần: học k, đường cong, review, Wilson CI (không đụng DB)
  repository.ts                      # mọi truy vấn SQL (đọc view, ghi bảng đầu ra)
  profile.ts                         # Bước 2: báo cáo chọn mốc chia
  build.ts                           # Bước 3-8: chia tập, học, backtest, ghi DB
  sql/005_delivery_policy.sql        # view + bảng đầu ra
  tests/core.test.ts
src/dss/deliveryBuffer.api.ts        # Bước 9: endpoint đọc bảng
```

Thêm vào `package.json` (dùng `tsx` hoặc `ts-node`, loại nào dự án đang có):

```json
"scripts": {
  "dss:delivery:profile": "tsx src/dss/delivery-policy/profile.ts",
  "dss:delivery:build":   "tsx src/dss/delivery-policy/build.ts"
}
```

Ví dụ chạy, tham số dòng lệnh ghi đè giá trị trong `config.ts`:

```
npm run dss:delivery:profile
npm run dss:delivery:build -- --split-date 2018-03-01 --test-end 2018-08-31
npm run dss:delivery:build -- --split-dates 2018-02-01,2018-03-01,2018-04-01 --test-end 2018-08-31
```

### Lưu ý hiện thực bằng TypeScript và `pg`

- **Số từ PostgreSQL:** `pg` trả `NUMERIC` và `BIGINT` (kể cả kết quả `COUNT`, `SUM`) dưới dạng **string**. Phải ép bằng `Number(...)` ở `repository.ts`; không ép thì phép so sánh và tính toán sai âm thầm.
- **Ngày:** `pg` ép kiểu `DATE` thành đối tượng `Date` của JS và có thể lệch ngày theo múi giờ. Trong SQL luôn viết `purchase_date::text` để nhận chuỗi `YYYY-MM-DD`, và so sánh ngày bằng chuỗi ISO.
- **Bộ nhớ:** chỉ khoảng 96.000 dòng, nên tải một lần các cột `customer_state, purchase_date, estimated_days, delay_days, avg_review_score` vào mảng rồi xử lý trong bộ nhớ.
- **Ghi DB:** một `client` lấy từ Pool, bọc trong `BEGIN ... COMMIT`, `ROLLBACK` khi có lỗi. Chèn nhiều dòng bằng một câu `INSERT ... SELECT ... FROM unnest($1::text[], $2::smallint[], ...)` theo lô, không chèn từng dòng.
- **Kết thúc script:** gọi `pool.end()` để tiến trình thoát; thoát với mã khác 0 nếu lỗi.
- **Xác định:** thứ tự phân khúc sắp xếp theo mã bang; không dùng số ngẫu nhiên; thời gian hiện tại chỉ dùng cho `created_at`.
- **Số thực:** tính bằng `number`, chỉ làm tròn khi ghi DB (đúng scale của cột `NUMERIC`), không làm tròn khi so sánh với `target`.

## 2. Bước 0 – `config.ts`

```ts
export interface DeliveryPolicyConfig {
  segmentDim: 'customer_state';      // phân khúc theo bang khách hàng
  targetLateRate: number;            // ràng buộc: late_rate <= target
  safetyMargin: number;              // học với (target - margin); thử 0, 0.005, 0.01 và xem backtest
  kMin: number;
  kMax: number;
  trainStartDate: string | null;     // null = từ đơn sớm nhất; khuyến nghị '2017-01-01' (2016 rất ít đơn)
  splitDate: string | null;          // BẮT BUỘC điền trước khi build: train < splitDate <= test
  testEndDate: string | null;        // BẮT BUỘC điền
  minSegmentNTrain: number;          // dưới mức này -> dùng chính sách toàn sàn (fallback)
  minSegmentNTest: number;           // dưới mức này -> backtest gắn low_power, không kết luận đạt/không đạt
  backtestTolerance: number;         // đạt nếu actual_late <= target + tolerance
  maxReviewDrop: number | null;      // null = tắt; ví dụ 0.1 = không chấp nhận k làm review kỳ vọng giảm quá 0.1 so với k=0
  reviewBucketEdges: number[];       // biên các nhóm độ trễ, xem Bước 5
  minBucketN: number;                // nhóm ít hơn thì gộp với nhóm kề
}

export const defaultConfig: DeliveryPolicyConfig = {
  segmentDim: 'customer_state',
  targetLateRate: 0.05,
  safetyMargin: 0,
  kMin: -30,
  kMax: 30,
  trainStartDate: null,
  splitDate: null,
  testEndDate: null,
  minSegmentNTrain: 100,
  minSegmentNTest: 300,
  backtestTolerance: 0.02,
  maxReviewDrop: null,
  reviewBucketEdges: [-15, -8, -1, 0, 3, 7],
  minBucketN: 100,
};
```

Quy tắc: tham số dòng lệnh ghi đè `defaultConfig`; `build.ts` từ chối chạy (thoát với thông báo rõ) nếu `splitDate` hoặc `testEndDate` còn `null`. Cấu hình cuối cùng được lưu nguyên vào `dss.delivery_run.params`.

## 3. Bước 1 – View cấp đơn

Tạo (nếu chưa có) trong `sql/005_delivery_policy.sql`:

```sql
CREATE OR REPLACE VIEW dw.v_delivery_promise_base AS
WITH rv AS (
    SELECT order_id, AVG(review_score)::numeric(4,2) AS avg_review_score
    FROM dw.fact_review
    GROUP BY order_id
)
SELECT d.order_id,
       c.customer_state,
       d.purchase_date_key                                    AS purchase_date,
       (d.estimated_delivery_date_key - d.purchase_date_key)  AS estimated_days,
       d.delivery_days,
       d.delay_days,
       rv.avg_review_score
FROM dw.fact_delivery_order d
JOIN dw.dim_customer c ON c.customer_key = d.customer_key
LEFT JOIN rv ON rv.order_id = d.order_id
WHERE d.is_delivery_eligible;
```

**Kiểm tra bắt buộc:**
- Không trùng `order_id`.
- `delay_days = delivery_days − estimated_days` đúng với mọi dòng (nếu sai thì định nghĩa ngày không nhất quán, dừng lại điều tra).
- Tổng số dòng = số đơn đủ điều kiện ở `fact_delivery_order` (96.470 với bộ dữ liệu hiện tại).

## 4. Bước 2 – Profile dữ liệu để chọn mốc chia (`profile.ts`)

Người dùng chưa chọn `split_date`, nên script này xuất báo cáo (CSV và in ra console) để quyết định:

1. **Số đơn theo tháng mua:** tổng đơn, đơn đủ điều kiện, tỷ lệ đủ điều kiện (`fact_delivery_order`, nhóm theo `date_trunc('month', purchase_date)`).
2. **Tỷ lệ đủ điều kiện theo tháng.** Tháng cuối của dữ liệu thường thấp bất thường vì đơn chưa giao xong bị loại, mà đơn giao chậm lại nằm trong nhóm bị loại → **tỷ lệ trễ ở tháng cuối bị ước lượng thấp** (thiên lệch). Báo cáo phải đánh dấu các tháng có tỷ lệ đủ điều kiện thấp hơn rõ rệt.
3. **Số đơn theo (bang × tháng)** cho các bang lớn.
4. **Phân phối `delay_days`** theo bang: min, P5, P50, P95, P99, max, tỷ lệ `d > 0`.
5. **Gợi ý mốc chia** theo quy tắc: train ≥ 6 tháng; test ≥ 3 tháng; `test_end_date` nằm trước các tháng bị thiên lệch ở mục 2; mỗi bang lớn có ≥ `min_segment_n_test` đơn kiểm. In ra vài cặp `(split_date, test_end_date)` thỏa quy tắc, kèm số đơn train/test mỗi cặp.

Người dùng chọn mốc rồi điền vào `config.ts` (hoặc truyền qua tham số dòng lệnh). (Tùy chọn: `npm run dss:delivery:build -- --split-dates a,b,c` chạy nhiều mốc để so độ nhạy, xem Bước 7.)

## 5. Bước 3 – Chia tập (`build.ts`)

```
train = eligible orders với  train_start_date <= purchase_date <  split_date
test  = eligible orders với  split_date       <= purchase_date <= test_end_date
```

- Chia **theo thời gian**, không ngẫu nhiên.
- Assert `max(train.purchase_date) < min(test.purchase_date)`.
- **Mọi thứ được học (k, nhóm review, chính sách fallback) chỉ dùng train.** Test chỉ dùng ở Bước 7.
- Phân khúc = `customer_state`. Thêm phân khúc đặc biệt `ALL` (toàn sàn) tính trên toàn bộ train, dùng làm fallback.

## 6. Bước 4 – Học `k*` cho từng phân khúc (`core.ts`)

Với mỗi phân khúc có `n_train >= min_segment_n_train`:

1. Với mỗi `k` nguyên từ `k_min` đến `k_max` tính `late_rate_train(k) = count(d > k) / n_train` (sắp xếp mảng `d` một lần, rồi tìm nhị phân vị trí đầu tiên có `d > k` cho mỗi `k`).
2. `target_used = target_late_rate − safety_margin`.
3. `k*` = `k` nhỏ nhất có `late_rate_train(k) <= target_used`.
4. Nếu không có `k` nào trong khoảng thỏa → `k* = k_max`, đặt `attainable = false`.
5. Nếu `max_review_drop` khác null: loại các `k` có `expected_review(k) < expected_review(0) − max_review_drop`, rồi chọn `k` nhỏ nhất còn lại thỏa ràng buộc trễ; nếu rỗng thì đặt `attainable = false`.

Phân khúc có `n_train < min_segment_n_train`: dùng `k*` của `ALL`, đặt `fallback = true`.

## 7. Bước 5 – Mô hình review kỳ vọng

Mục đích: ước lượng điểm review khi độ trễ thay đổi. Chỉ là mối liên hệ thống kê, không phải nhân quả.

1. Trên **toàn bộ train** (mọi bang), chia `delay_days` thành các nhóm theo `review_bucket_edges` (mặc định: `<= -15`, `-14..-8`, `-7..-1`, `0`, `1..3`, `4..7`, `>= 8`).
2. Với mỗi nhóm tính `n_reviewed` và `mean_score` (bỏ đơn không có review). Nhóm có `n_reviewed < min_bucket_n` thì gộp với nhóm kề.
3. Lưu vào `dss.review_bucket`. **Báo cáo cảnh báo nếu `mean_score` không giảm khi độ trễ tăng** (vi phạm tính đơn điệu); khi đó đưa cảnh báo vào `meta.assumptions` của API và vào báo cáo.
4. Review kỳ vọng của phân khúc `s` ở mức `k`: với mọi đơn train đủ điều kiện của `s` (kể cả đơn không có review), tra nhóm của `d − k`, lấy `mean_score` của nhóm đó, rồi trung bình.

## 8. Bước 6 – Dựng bảng đường cong

Với mọi phân khúc (gồm `ALL`) và mọi `k` trong `[k_min, k_max]` ghi một dòng vào `dss.delivery_curve`:

| Cột | Cách tính |
|---|---|
| `late_rate_train` | `count(d > k) / n_train` |
| `late_rate_test` | `count(d > k) / n_test` trên tập test (NULL nếu `n_test = 0`) |
| `promised_days_avg` | trung bình `estimated_days` của train + `k` |
| `expected_review` | theo Bước 5 |
| `n_train`, `n_test` | cỡ mẫu |

Nhờ có cả `late_rate_train` và `late_rate_test` ở mọi `k`, API có thể trả chính sách và kết quả backtest cho **bất kỳ** `target_late_rate` nào mà không phải chạy lại pipeline: chọn `k` từ cột train, đọc kết quả thực tế ở cột test.

## 9. Bước 7 – Backtest

Với mỗi phân khúc, lấy `k*` từ Bước 4 rồi đọc tập test:

| Cột `dss.delivery_backtest` | Ý nghĩa |
|---|---|
| `predicted_late` | `late_rate_train(k*)` |
| `actual_late` | `late_rate_test(k*)` |
| `deviation` | `actual_late − predicted_late` |
| `ci_low`, `ci_high` | khoảng tin cậy Wilson 95% của `actual_late` theo `n_test` |
| `status` | `low_power` nếu `n_test < min_segment_n_test`; ngược lại `passed` nếu `actual_late <= target + tolerance`, còn lại `failed` |

Cộng thêm:
- **Dòng tổng toàn sàn:** tỷ lệ trễ thực tế trên test khi mỗi đơn dùng `k*` của bang mình (trung bình có trọng số theo số đơn test).
- **Hai baseline trên cùng tập test:** (a) cam kết hiện tại (`k = 0` ở mọi bang); (b) một `k` chung toàn sàn (`k*` của `ALL`). Báo cáo `late_rate` và `promised_days_avg` của cả ba chính sách.
- **Kiểm tra mô hình review trên test (sanity check):** với `k = 0`, so `expected_review` dự đoán và điểm review trung bình thực tế trên test theo bang.

**Quét mốc chia (tùy chọn):** `--split-dates a,b,c` chạy lặp toàn bộ pipeline cho từng mốc, ghi mỗi mốc thành một `run_id`, và xuất bảng so sánh `(split_date, k*, actual_late)` cho vài bang lớn. Dùng làm phân tích độ nhạy trong báo cáo.

## 10. Bước 8 – Bảng đầu ra (`sql/005_delivery_policy.sql`)

```sql
CREATE TABLE IF NOT EXISTS dss.delivery_run (
    run_id        BIGSERIAL PRIMARY KEY,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    params        JSONB NOT NULL,
    train_start   DATE, split_date DATE NOT NULL, test_end DATE NOT NULL,
    n_train       INT NOT NULL, n_test INT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS dss.delivery_curve (
    run_id BIGINT REFERENCES dss.delivery_run(run_id) ON DELETE CASCADE,
    segment VARCHAR(8) NOT NULL,            -- mã bang hoặc 'ALL'
    k SMALLINT NOT NULL,
    promised_days_avg NUMERIC(6,2),
    late_rate_train   NUMERIC(6,5) NOT NULL,
    late_rate_test    NUMERIC(6,5),
    expected_review   NUMERIC(4,3),
    n_train INT NOT NULL, n_test INT NOT NULL,
    PRIMARY KEY (run_id, segment, k)
);

CREATE TABLE IF NOT EXISTS dss.delivery_policy (
    run_id BIGINT REFERENCES dss.delivery_run(run_id) ON DELETE CASCADE,
    segment VARCHAR(8) NOT NULL,
    k_recommended SMALLINT NOT NULL,
    fallback   BOOLEAN NOT NULL,
    attainable BOOLEAN NOT NULL,
    PRIMARY KEY (run_id, segment)
);

CREATE TABLE IF NOT EXISTS dss.delivery_backtest (
    run_id BIGINT REFERENCES dss.delivery_run(run_id) ON DELETE CASCADE,
    segment VARCHAR(8) NOT NULL,
    k SMALLINT NOT NULL,
    n_test INT NOT NULL,
    predicted_late NUMERIC(6,5), actual_late NUMERIC(6,5), deviation NUMERIC(6,5),
    ci_low NUMERIC(6,5), ci_high NUMERIC(6,5),
    status VARCHAR(10) NOT NULL CHECK (status IN ('passed','failed','low_power')),
    PRIMARY KEY (run_id, segment)
);

CREATE TABLE IF NOT EXISTS dss.review_bucket (
    run_id BIGINT REFERENCES dss.delivery_run(run_id) ON DELETE CASCADE,
    bucket_label VARCHAR(24) NOT NULL,
    delay_min INT, delay_max INT,           -- NULL = không giới hạn
    n_reviewed INT NOT NULL, mean_score NUMERIC(4,3) NOT NULL,
    PRIMARY KEY (run_id, bucket_label)
);
```

**Quy tắc ghi:** mỗi lần chạy tạo `run_id` mới trong một transaction; ghi xong thì đặt `is_active = TRUE` cho run mới và `FALSE` cho run cũ. Chạy lại cùng cấu hình trên cùng dữ liệu phải cho kết quả giống hệt (xác định, không có yếu tố ngẫu nhiên). Sau mỗi lần chạy lại ETL phải chạy lại `npm run dss:delivery:build`.

## 11. Bước 9 – API (`deliveryBuffer.api.ts`)

`GET /api/v1/dss/delivery-buffer`

| Tham số | Mặc định | Kiểm tra (sai → 400 `{ "error": "..." }`) |
|---|---|---|
| `state` | không có | 2 chữ cái in hoa; không có = trả bảng chính sách mọi bang |
| `target_late_rate` | 0.05 | số trong (0, 1) |
| `k_min`, `k_max` | -10, 10 | nguyên, `k_min <= k_max`, nằm trong khoảng đã tính |
| `run_id` | run `is_active` | tồn tại |

API **chỉ đọc bảng**, không tính toán nặng. Với `target_late_rate` do người dùng chọn: `k_recommended` = `k` nhỏ nhất có `late_rate_train <= target` trong `delivery_curve` của phân khúc; backtest lấy `late_rate_test` tại `k` đó. Phân khúc không có trong `delivery_curve` hoặc có `fallback` thì dùng dòng `ALL` và trả `fallback: true`.

Dạng phản hồi cho một bang:

```json
{
  "data": {
    "segment": { "customer_state": "RJ", "fallback": false, "attainable": true },
    "current":     { "k": 0, "promised_days": 0, "late_rate": 0, "expected_review": 0 },
    "recommended": { "k": 0, "promised_days": 0, "late_rate": 0, "expected_review": 0 },
    "curve": [ { "k": 0, "promised_days": 0, "late_rate": 0, "expected_review": 0 } ],
    "backtest": { "n_test": 0, "predicted_late_rate": 0, "actual_late_rate": 0,
                  "deviation": 0, "ci": [0, 0], "status": "passed" }
  },
  "meta": {
    "run_id": 1, "target_late_rate": 0.05,
    "learn_period": ["...", "..."], "test_period": ["...", "..."],
    "n_train": 0, "n_test": 0,
    "assumptions": [
      "Hành vi seller không đổi khi cam kết đổi",
      "Không mô hình hóa việc khách bỏ đơn vì cam kết dài hơn",
      "Liên hệ giữa độ trễ và điểm review chỉ là tương quan",
      "Chỉ gồm đơn đã giao; đơn chưa giao bị loại có thể làm tỷ lệ trễ bị ước lượng thấp"
    ]
  }
}
```

(Các số `0` chỉ là chỗ giữ vị trí cho khung JSON.) Thêm cảnh báo vào `assumptions` khi mô hình review vi phạm tính đơn điệu (Bước 5.3).

Dùng lại Pool `pg` và các kiểu/hàm chung của Module A (`dss.repository.ts`, `sellerScorecard.api.ts`) làm mẫu; giữ cùng cấu trúc routes → controllers → services và cùng định dạng lỗi với các API OLAP và Module A hiện có.

## 12. Bước 10 – Kiểm thử

**Unit test cho `core.ts`** (`tests/core.test.ts`, dùng test runner của dự án) (dữ liệu giả, đáp án tính tay):
- Mảng `d = [-5, -3, 0, 2, 4]`, target 0.2: `late_rate(k)` lần lượt đúng; `k*` đúng (ở đây `k = 2` cho `late_rate = 0.2`).
- `k*` không tăng khi `target` tăng.
- `d` toàn âm → `k*` âm; `d` toàn dương lớn hơn `k_max` → `attainable = false`.
- Phân khúc nhỏ → `fallback = true`.
- Biên: `n = 0`, mọi `d` bằng nhau.
- Chia tập: `max(train) < min(test)`, train ∪ test không trùng đơn.
- Nhóm review: tổng `n_reviewed` các nhóm = số đơn train có review.

**Đối soát với DW:**
- `late_rate_train(0)` và `late_rate_test(0)` gộp lại theo số đơn phải khớp tỷ lệ giao trễ tính từ `fact_delivery_order` trên cùng khoảng ngày (khoảng 6,77% nếu train ∪ test phủ toàn bộ dữ liệu).
- Số đơn train + test khớp số đơn đủ điều kiện trong khoảng ngày tương ứng.

**API / Postman:** thêm folder `DSS – Delivery buffer` gồm: request hợp lệ (có và không có `state`), `state=invalid`, `target_late_rate=0`, `target_late_rate=1.5`, `k_min > k_max`, `run_id` không tồn tại. Test hợp lệ kiểm tra `curve` được sắp theo `k` tăng dần, `late_rate` trong đường cong không tăng, `recommended.late_rate <= target_late_rate`.

## 13. Bước 11 – Sản phẩm phục vụ báo cáo

`build.ts` xuất vào `reports/delivery_policy/`:
1. Bảng chính sách theo bang (`k`, cam kết hiện tại và mới, `n_train`, cờ).
2. Bảng backtest (kèm baseline và dòng toàn sàn).
3. Bảng nhóm review và cảnh báo đơn điệu.
4. Bảng giải thích mốc chia (đầu ra Bước 2).
5. Bảng so sánh độ nhạy theo mốc chia (nếu chạy `--split-dates`).
6. Danh sách phân khúc `failed`, `low_power`, `fallback`, `attainable = false`.

## 14. Tiêu chí hoàn thành

- [ ] View `v_delivery_promise_base` qua cả ba kiểm tra ở Bước 1.
- [ ] `npm run dss:delivery:profile` chạy được và xuất báo cáo; `split_date`, `test_end_date` do người dùng điền.
- [ ] `npm run dss:delivery:build` chạy lại nhiều lần cho kết quả giống nhau, mỗi lần một `run_id`, run mới nhất là `is_active`.
- [ ] Không có dữ liệu test lọt vào bất kỳ bước học nào (có test tự động).
- [ ] Unit test và đối soát DW đều qua.
- [ ] API và Postman qua, mọi trường hợp lỗi tham số trả 400.
- [ ] Bảng backtest nêu rõ phân khúc không đạt và phân khúc thiếu dữ liệu, không che giấu.