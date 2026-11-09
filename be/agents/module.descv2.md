# Module B – What-if cam kết ngày giao hàng (đặc tả v2)

Tài liệu này thay thế bản đặc tả trước và dùng để giao cho Codex. Pipeline đã được hiện thực và chạy được (bản v1). Bản v2 **đổi chính sách chính, cách chấm kết quả và thêm phần so sánh**, các phần còn lại giữ nguyên. Mục 1 liệt kê chính xác những gì phải sửa.

## 0. Câu hỏi, chính sách và nguyên tắc chấm

**Câu hỏi cho quản lý sàn:**

> Với **từng bang**, cần cộng thêm hoặc bớt bao nhiêu ngày vào ngày giao dự kiến để tỷ lệ đơn trễ của bang đó ≤ 5%? Muốn chắc chắn hơn thì phải trả thêm bao nhiêu ngày cam kết?

**Ký hiệu.** `d = delay_days` của một đơn. Cộng `k` ngày vào cam kết thì đơn trễ khi `d > k`.
`late_rate(k) = COUNT(d > k) / COUNT(*)`, không tăng khi `k` tăng.

**Ba chính sách (luôn được tính và so sánh trên cùng tập test):**

| Mã | Mô tả |
|---|---|
| `state_k` | **Chính sách chính.** Mỗi bang dùng `k*` riêng: `k` nhỏ nhất (nguyên, trong `[kMin, kMax]`) có `late_rate_train(k) <= target − safetyMargin`. Bang có `n_train < minSegmentNTrain` dùng `k*` của `ALL` (fallback). |
| `global_k` | Mọi bang dùng `k*` của `ALL` (học trên toàn bộ train). Chỉ để đối chứng. |
| `current_k0` | Mọi bang dùng `k = 0` (cam kết hiện tại). Chỉ để đối chứng. |

**Nguyên tắc chấm (một ngưỡng duy nhất, không còn dung sai 2%):**

Với một phân khúc và một chính sách, trên tập test:

| Trạng thái | Điều kiện |
|---|---|
| `low_power` | `n_test < minSegmentNTest` (không kết luận) |
| `met` | `actual_late <= target` |
| `missed` | `actual_late > target` |

Kèm cờ `significantly_above_target = (ci_low > target)` với `ci_low` là cận dưới khoảng tin cậy Wilson 95% của `actual_late`, để phân biệt "trượt do nhiễu" với "trượt thật".

**Thước đo đánh giá một chính sách** (không dùng tỷ lệ trễ gộp toàn sàn làm tiêu chí đạt hay hỏng):
- `n_segments_scored`: số phân khúc không phải `low_power` (không tính `ALL`).
- `n_segments_met`: số phân khúc `met` trong số đó.
- `pct_orders_in_met`: tổng `n_test` của các phân khúc `met` chia tổng `n_test` của các phân khúc được chấm.
- `worst_segment`, `worst_late_rate`: phân khúc được chấm có `actual_late` cao nhất.
- `late_rate` gộp toàn sàn và `promised_days_avg` (trung bình ngày cam kết trên đơn test), chỉ để tham khảo.

## 1. Danh sách thay đổi so với bản đã hiện thực

| # | Thay đổi | Mục |
|---|---|---|
| 1 | `trainStartDate` mặc định `'2017-01-01'` và **phải thật sự được áp dụng**. Bản chạy trước có `n_train = 57.317`, lớn hơn 267 đơn so với số đơn từ 2017-01 đến 2018-02 trong DW (đúng bằng số đơn của 2016), nên nghi ngờ chưa lọc | 2, 9 |
| 2 | `minSegmentNTrain` từ 100 lên **300** | 2 |
| 3 | Bỏ `backtestTolerance`. Đổi `status` thành `met / missed / low_power`, thêm `significantly_above_target` | 5, 7 |
| 4 | Thêm đánh giá 3 chính sách (`state_k`, `global_k`, `current_k0`) theo từng bang và tổng hợp | 5, 7 |
| 5 | Thêm quét `safetyMargin` (`--margins`), lưu `safety_margin` vào `delivery_run` | 6, 7 |
| 6 | API: trả bảng so sánh 3 chính sách; thêm endpoint `/delivery-buffer/tradeoff` | 8 |
| 7 | Hàm đánh giá đặt trong `core.ts` và dùng chung cho `build.ts` và API | 5, 8 |

Giữ nguyên, không cần sửa: view `v_delivery_promise_base`, `profile.ts`, cách chia train/test, mô hình review (nhóm độ trễ), bảng `delivery_curve`, `delivery_policy`, `review_bucket`.

## 2. `config.ts` (đã sửa)

```ts
export interface DeliveryPolicyConfig {
  segmentDim: 'customer_state';
  targetLateRate: number;          // 0.05
  safetyMargin: number;            // 0: học với (target - margin)
  kMin: number;                    // -30
  kMax: number;                    // 30
  trainStartDate: string | null;   // mặc định '2017-01-01'
  splitDate: string | null;        // bắt buộc điền khi build
  testEndDate: string | null;      // bắt buộc điền khi build
  minSegmentNTrain: number;        // 300: dưới mức này dùng k của ALL (fallback)
  minSegmentNTest: number;         // 300: dưới mức này status = low_power
  maxReviewDrop: number | null;    // null = tắt
  reviewBucketEdges: number[];     // [-15, -8, -1, 0, 3, 7]
  minBucketN: number;              // 100
}
```

Đã bỏ `backtestTolerance`. Lệnh chạy:

```
npm run dss:delivery:build -- --split-date 2018-03-01 --test-end 2018-08-31
npm run dss:delivery:build -- --split-date 2018-03-01 --test-end 2018-08-31 --margins 0,0.005,0.01
```

**Mốc chia chính:** `splitDate = 2018-03-01`, `testEndDate = 2018-08-31` (đã chọn vì tỷ lệ trễ của train và test gần nhau nhất). Trước khi chốt `testEndDate`, `profile.ts` phải in `pct_eligible` theo tháng cho 2018-05 đến 2018-08; nếu tháng 2018-08 thấp hơn rõ rệt các tháng trước thì dùng `2018-07-31`.

`--split-dates` (quét mốc chia) vẫn hỗ trợ như bản v1. `--split-dates` và `--margins` **không dùng cùng nhau**; nếu truyền cả hai thì thoát với thông báo lỗi.

## 3. Các bước giữ nguyên (đã hiện thực, không đổi)

1. **View** `dw.v_delivery_promise_base`: một dòng mỗi đơn đủ điều kiện, có `customer_state`, `purchase_date`, `estimated_days`, `delivery_days`, `delay_days`, `avg_review_score`.
2. **`profile.ts`**: báo cáo số đơn, tỷ lệ đủ điều kiện, phân phối `delay_days`.
3. **Chia tập theo thời gian**: `train = [trainStartDate, splitDate)`, `test = [splitDate, testEndDate]`, assert `max(train) < min(test)`. Mọi thứ được học chỉ dùng train.
4. **Mô hình review** theo nhóm độ trễ trên train, lưu `dss.review_bucket`, cảnh báo nếu không đơn điệu.
5. **Đường cong** `dss.delivery_curve` cho mọi phân khúc và mọi `k` trong `[kMin, kMax]`, gồm `late_rate_train`, `late_rate_test`, `promised_days_avg`, `expected_review`, `n_train`, `n_test`.

## 4. Học `k*` (logic giữ nguyên, đổi ngưỡng fallback)

Với mỗi bang có `n_train >= minSegmentNTrain` (nay là 300):
1. `target_used = targetLateRate − safetyMargin`.
2. `k*` = `k` nhỏ nhất trong `[kMin, kMax]` có `late_rate_train(k) <= target_used`.
3. Không tồn tại → `k* = kMax`, `attainable = false`.
4. Nếu `maxReviewDrop` khác null: áp ràng buộc review như bản v1.

Bang có `n_train < 300` dùng `k*` của `ALL`, `fallback = true`.

## 5. Đánh giá 3 chính sách (mới) – đặt trong `core.ts`

Viết **một hàm thuần** `evaluatePolicies(curveRows, params)` trong `core.ts`:

- **Đầu vào:** các dòng `delivery_curve` (mọi phân khúc, mọi `k`), `targetLateRate`, `minSegmentNTest`, `kGlobal`, và `kState[segment]`.
- **Với mỗi chính sách và mỗi phân khúc:** lấy `k` của chính sách đó (`state_k` dùng `kState` có fallback, `global_k` dùng `kGlobal`, `current_k0` dùng 0). Đọc `late_rate_test` và `n_test` tại `k` đó từ đường cong. Tính `ci_low`, `ci_high` (Wilson 95%), `status`, `significantly_above_target`.
- **Tổng hợp mỗi chính sách:** các thước đo ở mục 0. `late_rate` gộp = Σ(`late_rate_test` × `n_test`) / Σ`n_test`. `promised_days_avg` gộp tương tự, trọng số `n_test`. Chỉ dùng các phân khúc là bang thật, không cộng dòng `ALL` vào tổng.
- **Đầu ra:** danh sách dòng theo (chính sách, phân khúc) và một dòng tổng hợp theo chính sách.

`build.ts` gọi hàm này với `targetLateRate` của run và ghi kết quả vào DB (mục 7). **API dùng đúng hàm này** với `target_late_rate` mà người dùng truyền vào, đọc dữ liệu từ `delivery_curve`, nên không có hai bản logic.

Lưu ý: bang `low_power` vẫn được tính vào `late_rate` gộp nhưng không tính vào `n_segments_scored` và `pct_orders_in_met`.

## 6. Quét `safetyMargin`

Khi truyền `--margins 0,0.005,0.01`:
- Chạy lại toàn bộ pipeline cho từng margin, **mỗi margin một `run_id`**, cùng mốc chia, lưu `safety_margin` vào `delivery_run`.
- Chỉ run có margin bằng `config.safetyMargin` (mặc định 0) được đặt `is_active = TRUE`. Các run còn lại giữ `is_active = FALSE`.
- Không tự động chọn "margin tốt nhất". Bảng so sánh các margin do API `/delivery-buffer/tradeoff` trả về (mục 8), để quản lý tự chọn mức an toàn mong muốn.

Phần này là trade-off cốt lõi của Module B: **margin càng lớn thì càng nhiều bang đạt ≤ 5% trên tập test, nhưng cam kết càng dài.**

## 7. Thay đổi cơ sở dữ liệu (`sql/006_delivery_policy_v2.sql`)

Chạy theo thứ tự sau. Các run cũ dùng nhãn `passed/failed` nên **xóa rồi chạy lại**, không chuyển đổi nhãn (vì `passed` cũ gồm cả 5% đến 7%):

```sql
DELETE FROM dss.delivery_run;   -- cascade xóa curve, policy, backtest, review_bucket của run cũ

ALTER TABLE dss.delivery_run
  ADD COLUMN IF NOT EXISTS safety_margin NUMERIC(5,4) NOT NULL DEFAULT 0;

ALTER TABLE dss.delivery_backtest DROP CONSTRAINT IF EXISTS delivery_backtest_status_check;
ALTER TABLE dss.delivery_backtest
  ADD CONSTRAINT delivery_backtest_status_check CHECK (status IN ('met','missed','low_power'));
ALTER TABLE dss.delivery_backtest
  ADD COLUMN IF NOT EXISTS significantly_above_target BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS dss.delivery_policy_eval (
    run_id BIGINT REFERENCES dss.delivery_run(run_id) ON DELETE CASCADE,
    policy VARCHAR(12) NOT NULL CHECK (policy IN ('current_k0','global_k','state_k')),
    late_rate NUMERIC(6,5) NOT NULL,
    promised_days_avg NUMERIC(6,2) NOT NULL,
    n_segments_scored INT NOT NULL,
    n_segments_met INT NOT NULL,
    pct_orders_in_met NUMERIC(6,5),
    worst_segment VARCHAR(8),
    worst_late_rate NUMERIC(6,5),
    PRIMARY KEY (run_id, policy)
);

CREATE TABLE IF NOT EXISTS dss.delivery_policy_eval_segment (
    run_id BIGINT REFERENCES dss.delivery_run(run_id) ON DELETE CASCADE,
    policy VARCHAR(12) NOT NULL CHECK (policy IN ('current_k0','global_k','state_k')),
    segment VARCHAR(8) NOT NULL,
    k SMALLINT NOT NULL,
    n_test INT NOT NULL,
    late_rate_test NUMERIC(6,5) NOT NULL,
    ci_low NUMERIC(6,5), ci_high NUMERIC(6,5),
    status VARCHAR(10) NOT NULL CHECK (status IN ('met','missed','low_power')),
    significantly_above_target BOOLEAN NOT NULL,
    PRIMARY KEY (run_id, policy, segment)
);
```

`dss.delivery_backtest` vẫn lưu kết quả của chính sách `state_k` (như v1) với nhãn mới. Các bảng `delivery_run`, `delivery_curve`, `delivery_policy`, `review_bucket` giữ nguyên cấu trúc.

## 8. API

### 8.1 `GET /api/v1/dss/delivery-buffer`

| Tham số | Mặc định | Kiểm tra (sai → 400 `{ "error": "..." }`) |
|---|---|---|
| `state` | không có | 2 chữ cái in hoa |
| `target_late_rate` | 0.05 | số trong (0, 1) |
| `k_min`, `k_max` | -10, 10 | nguyên, `k_min <= k_max`, nằm trong khoảng đã tính |
| `run_id` | run `is_active` | tồn tại, nếu không → 404 |

Không có run đang hoạt động → **404** `{ "error": "Chưa có kết quả pipeline. Chạy npm run dss:delivery:build trước." }`.

Với `target_late_rate` người dùng chọn, API tính lại `kGlobal` và `kState` từ `late_rate_train` trong `delivery_curve` (cùng quy tắc mục 4, dùng `safety_margin` của run), rồi gọi `evaluatePolicies`.

**Khi có `state`** (một bang):

```json
{
  "data": {
    "segment": { "customer_state": "RJ", "fallback": false, "attainable": true },
    "current":     { "k": 0, "promised_days": 0, "late_rate_test": 0, "status": "missed" },
    "recommended": { "k": 0, "promised_days": 0, "late_rate_train": 0, "late_rate_test": 0,
                     "expected_review": 0, "status": "met", "significantly_above_target": false,
                     "ci": [0, 0], "n_test": 0 },
    "global_comparison": { "k": 0, "late_rate_test": 0, "status": "missed" },
    "curve": [ { "k": 0, "promised_days": 0, "late_rate_train": 0, "late_rate_test": 0, "expected_review": 0 } ]
  },
  "meta": { "run_id": 1, "target_late_rate": 0.05, "safety_margin": 0,
            "learn_period": ["...", "..."], "test_period": ["...", "..."],
            "n_train": 0, "n_test": 0, "assumptions": ["..."] }
}
```

(Các số `0` chỉ là chỗ giữ vị trí.) `global_comparison` cho thấy bang này sẽ ra sao nếu cả sàn dùng một `k` chung; đây là bằng chứng cho việc tại sao dùng `k` theo bang.

**Khi không có `state`** (toàn bộ):

```json
{
  "data": {
    "summary": {
      "current_k0": { "late_rate": 0, "promised_days_avg": 0, "n_segments_scored": 0,
                      "n_segments_met": 0, "pct_orders_in_met": 0, "worst_segment": "XX", "worst_late_rate": 0 },
      "global_k":   { "...": "như trên" },
      "state_k":    { "...": "như trên" }
    },
    "segments": [
      { "segment": "SP", "n_test": 0, "fallback": false,
        "state_k":    { "k": 0, "late_rate_test": 0, "status": "met" },
        "global_k":   { "k": 0, "late_rate_test": 0, "status": "met" },
        "current_k0": { "k": 0, "late_rate_test": 0, "status": "met" } }
    ]
  },
  "meta": { "...": "như trên" }
}
```

### 8.2 `GET /api/v1/dss/delivery-buffer/tradeoff`

Trả bảng đánh đổi giữa các `safetyMargin` (mỗi dòng một run cùng `split_date` và `test_end`), chỉ cho chính sách `state_k` tại `target` của run:

| Tham số | Mặc định | Kiểm tra |
|---|---|---|
| `split_date`, `test_end` | của run `is_active` | định dạng `YYYY-MM-DD`, phải có run tương ứng (nếu không → 404) |

Mỗi dòng: `run_id`, `safety_margin`, `late_rate`, `promised_days_avg`, `n_segments_scored`, `n_segments_met`, `pct_orders_in_met`, `worst_segment`, `worst_late_rate`, sắp xếp theo `safety_margin` tăng dần. Dùng để vẽ biểu đồ "độ an toàn so với số ngày cam kết".

`meta.assumptions` (cả hai endpoint) luôn gồm:
- Hành vi seller không đổi khi cam kết đổi.
- Không mô hình hóa việc khách bỏ đơn vì cam kết dài hơn.
- Liên hệ giữa độ trễ và điểm review chỉ là tương quan.
- Chỉ gồm đơn đã giao; đơn chưa giao bị loại có thể làm tỷ lệ trễ bị ước lượng thấp.
- Kết quả nhạy với giai đoạn có tỷ lệ trễ đột biến (2018-02 đến 03); cần học lại định kỳ.

## 9. Kiểm thử

**Unit test `core.ts`** (dữ liệu giả, đáp án tính tay):
- `late_rate(k)` và `k*` đúng trên mảng nhỏ; `k*` không giảm khi `safetyMargin` tăng, với mọi phân khúc.
- `status`: đúng ba trường hợp `low_power`, `met` (≤ target, kể cả đúng bằng), `missed`; cờ `significantly_above_target` đúng.
- `evaluatePolicies` trên bộ dữ liệu giả 3 bang: `n_segments_met`, `pct_orders_in_met`, `worst_segment`, `late_rate` gộp khớp đáp án tính tay; bang `low_power` bị loại khỏi các số đếm nhưng vẫn nằm trong `late_rate` gộp.
- Fallback: bang có `n_train < minSegmentNTrain` dùng `k` của `ALL`.
- **Áp dụng `trainStartDate`:** `min(train.purchase_date) >= trainStartDate`; `n_train` bằng số đơn đủ điều kiện trong `[trainStartDate, splitDate)` của DW (kiểm bằng truy vấn đối soát).
- Chia tập: `max(train) < min(test)`, không đơn nào trùng.

**Quét margin:** chạy `--margins 0,0.005,0.01` tạo đúng 3 run, đúng một run `is_active`, `safety_margin` được lưu đúng, `n_train` và `n_test` giống nhau giữa các run.

**Đối soát DW:** `late_rate_train(0)` và `late_rate_test(0)` gộp khớp tỷ lệ trễ tính từ `fact_delivery_order` trên cùng khoảng ngày.

**API / Postman:** folder `DSS – Delivery buffer` gồm: request có và không có `state`; `state=invalid`; `target_late_rate=0` và `1.5`; `k_min > k_max`; `run_id` không tồn tại; `/tradeoff` hợp lệ và với `split_date` không có run. Kiểm tra: `curve` sắp xếp theo `k` tăng dần, `late_rate_train` trong đường cong không tăng, `recommended.late_rate_train <= target_late_rate` (trừ khi `attainable = false`).

## 10. Sản phẩm phục vụ báo cáo (`reports/delivery_policy/`)

1. **Bảng so sánh 3 chính sách** (từ `delivery_policy_eval`): `late_rate`, `promised_days_avg`, `n_segments_met / n_segments_scored`, `pct_orders_in_met`, `worst_segment`.
2. **Bảng theo từng bang** (từ `delivery_policy_eval_segment`): `k` và `late_rate_test` và `status` của cả 3 chính sách, kèm `n_test`. Đây là bảng cho thấy `global_k` làm bang chậm trễ bao nhiêu.
3. **Bảng đánh đổi theo `safetyMargin`** (từ `/tradeoff`).
4. Bảng backtest chính sách `state_k` kèm khoảng tin cậy.
5. Bảng nhóm review và cảnh báo đơn điệu.
6. Bảng giải thích mốc chia và, nếu chạy, bảng độ nhạy theo mốc chia.
7. Danh sách bang `missed`, `low_power`, `fallback`, `attainable = false`.

**Quy tắc báo cáo:** không chọn `safetyMargin` hay mốc chia dựa vào việc kết quả test đẹp nhất. Báo cáo toàn bộ bảng và nêu lựa chọn kèm lý do được đặt ra trước khi xem kết quả test.

## 11. Tiêu chí hoàn thành

- [ ] `trainStartDate` thật sự được áp dụng (có test tự động); `minSegmentNTrain = 300`.
- [ ] `status` chỉ còn `met`, `missed`, `low_power`; không còn dung sai 2%.
- [ ] Ba chính sách được đánh giá ở cả mức từng bang lẫn tổng hợp, bằng một hàm `evaluatePolicies` duy nhất dùng chung cho `build.ts` và API.
- [ ] `--margins` tạo đúng số run, một run `is_active`.
- [ ] Hai endpoint API qua test, lỗi tham số trả 400, không có run trả 404.
- [ ] Mọi kiểm thử ở mục 9 qua.
- [ ] Bảng ở mục 10 được xuất ra, không che giấu bang `missed`.