-- =====================================================================
-- 004_dss_config.sql
-- Schema `dss`: bảng cấu hình (knowledge base) và bảng kết quả của DSS.
-- Chạy lại được nhiều lần (idempotent).
-- Lưu ý: các bảng này KHÔNG được đưa vào danh sách TRUNCATE của ETL,
--        nếu không mỗi lần full refresh sẽ mất cấu hình.
-- Thứ tự chạy: 001_create_dw.sql -> (ETL) -> 003_dss_views.sql -> 004_dss_config.sql
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS dss;

-- ---------------------------------------------------------------------
-- 0. (Chỉ dùng khi dev) Xóa sạch để tạo lại cấu hình từ đầu
-- ---------------------------------------------------------------------
-- DROP TABLE IF EXISTS dss.order_risk_score;
-- DROP TABLE IF EXISTS dss.decision_rules;
-- DROP TABLE IF EXISTS dss.scoring_weights;
-- DROP TABLE IF EXISTS dss.settings;

-- ---------------------------------------------------------------------
-- 1. Tham số chung của DSS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dss.settings (
    setting_key   VARCHAR(64) PRIMARY KEY,
    setting_value NUMERIC(14,4) NOT NULL,
    description   TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO dss.settings (setting_key, setting_value, description) VALUES
 ('min_eligible_orders', 30,   'Số đơn một seller đủ điều kiện giao hàng tối thiểu để seller được chấm điểm (is_reliable)'),
 ('big_unreliable_gmv',  8168, 'GMV tối thiểu để gắn nhãn "Chưa đủ dữ liệu, doanh số cao" (xấp xỉ P50 của nhóm đủ tin cậy)')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Trọng số và chiều của từng tiêu chí (Module A)
--    direction = 'higher': càng cao càng tốt; 'lower': càng thấp càng tốt
--    Tổng weight được kiểm tra và chuẩn hóa ở tầng service.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dss.scoring_weights (
    criterion   VARCHAR(32) PRIMARY KEY,
    weight      NUMERIC(4,3) NOT NULL CHECK (weight BETWEEN 0 AND 1),
    direction   VARCHAR(8)   NOT NULL CHECK (direction IN ('higher', 'lower')),
    description TEXT,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

INSERT INTO dss.scoring_weights (criterion, weight, direction, description) VALUES
 ('gmv',             0.300, 'higher', 'Quy mô bán hàng = SUM(price), chuẩn hóa trên LN(1+gmv)'),
 ('late_rate',       0.350, 'lower',  'Tỷ lệ giao trễ trên đơn một seller đủ điều kiện'),
 ('low_review_rate', 0.350, 'lower',  'Tỷ lệ review thấp trên đơn một seller có review')
ON CONFLICT (criterion) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Luật quyết định (knowledge base)
--    - Luật có priority nhỏ được xét trước; luật đầu tiên khớp thì dừng.
--    - Các điều kiện khác NULL được nối bằng AND; NULL = không ràng buộc.
--    - Cần "OR" thì tách thành nhiều dòng cùng label.
--    - late_rate, low_review_rate, *_pct là tỷ lệ 0..1 (13% = 0.13).
--    - Luật cuối không có điều kiện đóng vai trò mặc định.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dss.decision_rules (
    rule_id             SERIAL PRIMARY KEY,
    priority            INT         NOT NULL UNIQUE,
    label               VARCHAR(16) NOT NULL
                        CHECK (label IN ('Retain', 'Improve', 'Watch', 'Review')),
    min_score           NUMERIC(4,3) CHECK (min_score BETWEEN 0 AND 1),
    max_score           NUMERIC(4,3) CHECK (max_score BETWEEN 0 AND 1),
    min_gmv_pct         NUMERIC(4,3) CHECK (min_gmv_pct BETWEEN 0 AND 1),
    min_late_rate       NUMERIC(4,3) CHECK (min_late_rate BETWEEN 0 AND 1),
    max_late_rate       NUMERIC(4,3) CHECK (max_late_rate BETWEEN 0 AND 1),
    min_low_review_rate NUMERIC(4,3) CHECK (min_low_review_rate BETWEEN 0 AND 1),
    max_low_review_rate NUMERIC(4,3) CHECK (max_low_review_rate BETWEEN 0 AND 1),
    action_text         TEXT        NOT NULL,
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO dss.decision_rules
 (priority, label, min_score, max_score, min_gmv_pct,
  min_late_rate, max_late_rate, min_low_review_rate, max_low_review_rate, action_text)
VALUES
 (1, 'Review',  NULL, 0.350, NULL, NULL,  NULL,  NULL,  NULL,
     'Điểm thấp: xem xét hạn chế hiển thị hoặc làm việc trực tiếp với seller'),
 (2, 'Review',  NULL, NULL,  NULL, 0.130, NULL,  0.196, NULL,
     'Trễ nhiều và bị chê nhiều: cần can thiệp'),
 (3, 'Improve', NULL, NULL,  0.700, NULL, NULL,  0.150, NULL,
     'Doanh số cao nhưng khách chê nhiều: yêu cầu kế hoạch cải thiện chất lượng'),
 (4, 'Retain',  0.650, NULL, NULL, NULL,  0.080, NULL,  0.120,
     'Hiệu quả tốt: ưu tiên quảng bá, giữ chính sách ưu đãi'),
 (5, 'Watch',   NULL, NULL,  NULL, NULL,  NULL,  NULL,  NULL,
     'Chưa có vấn đề rõ: tiếp tục theo dõi')
ON CONFLICT (priority) DO NOTHING;

-- ---------------------------------------------------------------------
-- 4. (Tùy chọn, Module C) Điểm rủi ro giao trễ theo đơn, do Python ghi vào
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dss.order_risk_score (
    order_id      VARCHAR(64) PRIMARY KEY,
    risk_score    NUMERIC(6,5) NOT NULL CHECK (risk_score BETWEEN 0 AND 1),
    risk_level    VARCHAR(8)   NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
    model_name    VARCHAR(64)  NOT NULL,
    model_version VARCHAR(32)  NOT NULL,
    scored_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_risk_level ON dss.order_risk_score (risk_level);

-- ---------------------------------------------------------------------
-- 5. Kiểm tra nhanh sau khi chạy
-- ---------------------------------------------------------------------
-- SELECT * FROM dss.settings;
-- SELECT * FROM dss.scoring_weights;          -- tổng weight phải = 1.000
-- SELECT priority, label FROM dss.decision_rules ORDER BY priority;