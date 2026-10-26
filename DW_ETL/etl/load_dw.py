from __future__ import annotations

import csv
import logging
from pathlib import Path
from datetime import date
import pandas as pd
import psycopg
from psycopg.rows import dict_row

from etl.config import DATA_DIR, DB_CONFIG, PROJECT_ROOT

LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "etl_load.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("olist_etl")

SOURCE_FILES = {
    "orders": "olist_orders_dataset.csv",
    "items": "olist_order_items_dataset.csv",
    "sellers": "olist_sellers_dataset.csv",
    "products": "olist_products_dataset.csv",
    "customers": "olist_customers_dataset.csv",
    "reviews": "olist_order_reviews_dataset.csv",
    "translation": "product_category_name_translation.csv",
}

def read_csv(name: str) -> pd.DataFrame:
    path = DATA_DIR / SOURCE_FILES[name]
    if not path.exists():
        raise FileNotFoundError(f"Missing source file: {path}")
    return pd.read_csv(path, low_memory=False)

def parse_dates(df: pd.DataFrame, columns: list[str]) -> None:
    for col in columns:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")

def pyval(value):
    if pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.to_pydatetime()
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    return value

def insert_many(cur, sql: str, rows: list[tuple], page_size: int = 2000):
    if not rows:
        return
    with cur.connection.cursor() as batch_cur:
        for start in range(0, len(rows), page_size):
            batch_cur.executemany(sql, rows[start:start + page_size])

def date_attributes(d: date):
    return (
        d, d.year, (d.month - 1) // 3 + 1, d.month, d.strftime("%B"),
        d.day, d.isoweekday(), d.strftime("%A"), d.isoweekday() >= 6
    )

def write_rejects(rejects: list[dict]):
    path = LOG_DIR / "etl_rejects.csv"
    fields = ["source", "business_key", "reason"]
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rejects)
    logger.info("Reject log written: %s (%s rows)", path, len(rejects))

def main():
    logger.info("Starting controlled full refresh")
    # Read all source files before opening a write transaction.
    orders = read_csv("orders")
    items = read_csv("items")
    sellers = read_csv("sellers")
    products = read_csv("products")
    customers = read_csv("customers")
    reviews = read_csv("reviews")
    translation = read_csv("translation")

    parse_dates(orders, [
        "order_purchase_timestamp", "order_approved_at",
        "order_delivered_carrier_date", "order_delivered_customer_date",
        "order_estimated_delivery_date",
    ])
    parse_dates(reviews, ["review_creation_date", "review_answer_timestamp"])

    # Basic source-key validation.
    rejects: list[dict] = []
    for df, key, source in [
        (orders, "order_id", "orders"),
        (items, "order_id", "order_items"),
        (sellers, "seller_id", "sellers"),
        (products, "product_id", "products"),
        (customers, "customer_id", "customers"),
    ]:
        if df[key].isna().any():
            for idx in df.index[df[key].isna()]:
                rejects.append({"source": source, "business_key": "", "reason": f"NULL {key}"})
    if orders["order_id"].duplicated().any():
        raise ValueError("orders.order_id contains duplicates; stopping before full refresh.")
    if items.duplicated(["order_id", "order_item_id"]).any():
        raise ValueError("order_items business key duplicates; stopping before full refresh.")
    if sellers["seller_id"].duplicated().any() or products["product_id"].duplicated().any() or customers["customer_id"].duplicated().any():
        raise ValueError("Duplicate source dimension business keys; stopping before full refresh.")

    # Translation should be one row/category. Reject duplicate translation keys.
    translation = translation.dropna(subset=["product_category_name"])
    translation = translation.drop_duplicates(subset=["product_category_name"], keep="first")
    product_data = products.merge(
        translation, on="product_category_name", how="left", validate="many_to_one"
    )

    # Prepare valid order/customer references and source lookup tables.
    order_lookup = orders.set_index("order_id", drop=False)
    seller_ids = set(sellers["seller_id"].dropna())
    product_ids = set(products["product_id"].dropna())
    customer_ids = set(customers["customer_id"].dropna())
    status_values = sorted(orders["order_status"].dropna().astype(str).unique())

    # Gather all calendar dates used by the DW, including dates with NULL timestamps excluded.
    all_dates = set()
    date_columns = [
        (orders, "order_purchase_timestamp"),
        (orders, "order_estimated_delivery_date"),
        (orders, "order_delivered_customer_date"),
        (reviews, "review_creation_date"),
    ]
    for df, col in date_columns:
        for ts in df[col].dropna():
            all_dates.add(ts.date())
    # Empty data range is an error, not a silent empty date dimension.
    if not all_dates:
        raise ValueError("No usable dates found for dim_date.")

    # Build dimension rows.
    seller_rows = [
        (str(r.seller_id), pyval(r.seller_zip_code_prefix), pyval(r.seller_city), pyval(r.seller_state))
        for r in sellers.itertuples(index=False)
    ]
    product_rows = []
    for r in product_data.itertuples(index=False):
        product_rows.append((
            str(r.product_id), pyval(r.product_category_name),
            pyval(r.product_category_name_english),
            pyval(getattr(r, "product_name_lenght")),
            pyval(getattr(r, "product_description_lenght")),
            pyval(r.product_photos_qty), pyval(r.product_weight_g),
            pyval(r.product_length_cm), pyval(r.product_height_cm), pyval(r.product_width_cm)
        ))
    customer_rows = [
        (str(r.customer_id), pyval(r.customer_unique_id),
         pyval(r.customer_zip_code_prefix), pyval(r.customer_city), pyval(r.customer_state))
        for r in customers.itertuples(index=False)
    ]
    min_date = min(all_dates)
    max_date = max(all_dates)
    all_calendar_dates = pd.date_range(
        start=min_date,
        end=max_date,
        freq="D",
    ).date
    date_rows = [date_attributes(d) for d in all_calendar_dates]
    status_rows = [(s,) for s in status_values]

    with psycopg.connect(**DB_CONFIG) as conn:
        with conn.cursor() as cur:
            # Set schema explicitly; all changes are transactional.
            cur.execute("SET search_path TO dw, public")
            cur.execute("""
                TRUNCATE TABLE
                    fact_review, fact_delivery_order, fact_sales_item,
                    dim_order_status, dim_customer, dim_product, dim_seller, dim_date
                RESTART IDENTITY
            """)

            insert_many(cur, """
                INSERT INTO dim_date
                (date_key, year, quarter, month, month_name, day_of_month,
                 day_of_week, day_name, is_weekend)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, date_rows)

            insert_many(cur, """
                INSERT INTO dim_seller
                (seller_id, seller_zip_code_prefix, seller_city, seller_state)
                VALUES (%s,%s,%s,%s)
            """, seller_rows)

            insert_many(cur, """
                INSERT INTO dim_product
                (product_id, product_category_name, product_category_name_english,
                 product_name_length, product_description_length, product_photos_qty,
                 product_weight_g, product_length_cm, product_height_cm, product_width_cm)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, product_rows)

            insert_many(cur, """
                INSERT INTO dim_customer
                (customer_id, customer_unique_id, customer_zip_code_prefix,
                 customer_city, customer_state)
                VALUES (%s,%s,%s,%s,%s)
            """, customer_rows)

            insert_many(cur, """
                INSERT INTO dim_order_status (order_status) VALUES (%s)
            """, status_rows)

            # Read surrogate-key lookups from the just-loaded dimensions.
            cur.execute("SELECT seller_id, seller_key FROM dim_seller")
            seller_key = dict(cur.fetchall())
            cur.execute("SELECT product_id, product_key FROM dim_product")
            product_key = dict(cur.fetchall())
            cur.execute("SELECT customer_id, customer_key FROM dim_customer")
            customer_key = dict(cur.fetchall())
            cur.execute("SELECT order_status, order_status_key FROM dim_order_status")
            status_key = dict(cur.fetchall())

            date_key = {d: d for d in all_dates}

            # fact_sales_item: one row per (order_id, order_item_id).
            sales_rows = []
            for r in items.itertuples(index=False):
                order_id = pyval(r.order_id)
                if pd.isna(r.order_id) or pd.isna(r.seller_id) or pd.isna(r.product_id):
                    rejects.append({"source": "order_items", "business_key": str(order_id or ""), "reason": "NULL order_id/seller_id/product_id"})
                    continue
                if str(r.order_id) not in order_lookup.index:
                    rejects.append({"source": "order_items", "business_key": str(order_id), "reason": "order_id not found in orders"})
                    continue
                if str(r.seller_id) not in seller_key:
                    rejects.append({"source": "order_items", "business_key": f"{order_id}/{r.order_item_id}", "reason": "seller dimension key not found"})
                    continue
                if str(r.product_id) not in product_key:
                    rejects.append({"source": "order_items", "business_key": f"{order_id}/{r.order_item_id}", "reason": "product dimension key not found"})
                    continue
                order = order_lookup.loc[str(r.order_id)]
                purchase_ts = order["order_purchase_timestamp"]
                status = order["order_status"]
                if pd.isna(purchase_ts) or pd.isna(status) or str(status) not in status_key:
                    rejects.append({"source": "order_items", "business_key": f"{order_id}/{r.order_item_id}", "reason": "missing purchase date or status dimension"})
                    continue
                try:
                    price, freight = float(r.price), float(r.freight_value)
                    if price < 0 or freight < 0:
                        raise ValueError
                except Exception:
                    rejects.append({"source": "order_items", "business_key": f"{order_id}/{r.order_item_id}", "reason": "invalid price/freight_value"})
                    continue
                sales_rows.append((
                    str(r.order_id), int(r.order_item_id), seller_key[str(r.seller_id)],
                    product_key[str(r.product_id)], purchase_ts.date(), price, freight, 1,
                    status_key[str(status)]
                ))
            insert_many(cur, """
                INSERT INTO fact_sales_item
                (order_id, order_item_id, seller_key, product_key, purchase_date_key,
                 price, freight_value, item_count, order_status_key)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, sales_rows)

            # fact_delivery_order: one row/order. Keep ineligible rows; NULL KPI when not eligible.
            delivery_rows = []
            for r in orders.itertuples(index=False):
                oid = pyval(r.order_id)
                if pd.isna(r.order_id) or pd.isna(r.customer_id) or pd.isna(r.order_status):
                    rejects.append({"source": "orders", "business_key": str(oid or ""), "reason": "NULL order_id/customer_id/order_status"})
                    continue
                if str(r.customer_id) not in customer_key:
                    rejects.append({"source": "orders", "business_key": str(oid), "reason": "customer dimension key not found"})
                    continue
                if str(r.order_status) not in status_key:
                    rejects.append({"source": "orders", "business_key": str(oid), "reason": "order status dimension key not found"})
                    continue
                purchase = r.order_purchase_timestamp
                estimated = r.order_estimated_delivery_date
                actual = r.order_delivered_customer_date
                eligible = (
                    str(r.order_status) == "delivered"
                    and not pd.isna(actual) and not pd.isna(estimated)
                )
                delivery_days = (actual.date() - purchase.date()).days if eligible and not pd.isna(purchase) else None
                delay_days = (actual.date() - estimated.date()).days if eligible else None
                is_delayed = (delay_days > 0) if delay_days is not None else None
                if eligible and delivery_days is not None and delivery_days < 0:
                    rejects.append({"source": "orders", "business_key": str(oid), "reason": "actual delivery before purchase date"})
                    continue
                delivery_rows.append((
                    str(r.order_id), customer_key[str(r.customer_id)],
                    purchase.date() if not pd.isna(purchase) else None,
                    estimated.date() if not pd.isna(estimated) else None,
                    actual.date() if not pd.isna(actual) else None,
                    status_key[str(r.order_status)],
                    pyval(purchase), pyval(estimated), pyval(actual),
                    delivery_days, delay_days, is_delayed, bool(eligible)
                ))
            insert_many(cur, """
                INSERT INTO fact_delivery_order
                (order_id, customer_key, purchase_date_key, estimated_delivery_date_key,
                 actual_delivery_date_key, order_status_key, order_purchase_timestamp,
                 order_estimated_delivery_date, order_delivered_customer_date,
                 delivery_days, delay_days, is_delayed, is_delivery_eligible)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, delivery_rows)

            # fact_review: one row per source review with valid score; no customer_key in V1.
            review_rows = []
            for r in reviews.itertuples(index=False):
                if pd.isna(r.order_id) or pd.isna(r.review_score):
                    rejects.append({"source": "reviews", "business_key": str(pyval(r.review_id) or ""), "reason": "NULL order_id/review_score"})
                    continue
                try:
                    score = int(r.review_score)
                    if score < 1 or score > 5:
                        raise ValueError
                except Exception:
                    rejects.append({"source": "reviews", "business_key": str(pyval(r.review_id) or ""), "reason": "review_score outside 1..5 or invalid"})
                    continue
                review_date = r.review_creation_date
                review_rows.append((
                    pyval(r.review_id), str(r.order_id),
                    review_date.date() if not pd.isna(review_date) else None,
                    score, pyval(r.review_comment_title), pyval(r.review_comment_message),
                    pyval(r.review_answer_timestamp)
                ))
            insert_many(cur, """
                INSERT INTO fact_review
                (review_id, order_id, review_creation_date_key, review_score,
                 review_comment_title, review_comment_message, review_answer_timestamp)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
            """, review_rows)

            # Validate grain counts inside the transaction.
            cur.execute("SELECT COUNT(*) FROM dim_date"); date_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM dim_seller"); seller_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM dim_product"); product_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM dim_customer"); customer_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM dim_order_status"); status_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM fact_sales_item"); sales_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM fact_delivery_order"); delivery_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM fact_review"); review_count = cur.fetchone()[0]

            # Automated post-load quality gates. Any failed critical check raises
            # an exception and rolls back the full-refresh transaction.
            qa_checks = []

            cur.execute("""
                SELECT COUNT(*) FROM (
                    SELECT order_id, order_item_id
                    FROM fact_sales_item
                    GROUP BY order_id, order_item_id
                    HAVING COUNT(*) > 1
                ) d
            """)
            qa_checks.append(("duplicate_sales_item_grain", cur.fetchone()[0] == 0, 0))

            cur.execute("""
                SELECT COUNT(*) FROM (
                    SELECT order_id FROM fact_delivery_order
                    GROUP BY order_id HAVING COUNT(*) > 1
                ) d
            """)
            qa_checks.append(("duplicate_delivery_order_grain", cur.fetchone()[0] == 0, 0))

            cur.execute("""
                SELECT COUNT(*) FROM fact_sales_item f
                LEFT JOIN dim_seller s ON s.seller_key = f.seller_key
                LEFT JOIN dim_product p ON p.product_key = f.product_key
                LEFT JOIN dim_date d ON d.date_key = f.purchase_date_key
                LEFT JOIN dim_order_status st ON st.order_status_key = f.order_status_key
                WHERE s.seller_key IS NULL OR p.product_key IS NULL
                   OR d.date_key IS NULL OR st.order_status_key IS NULL
            """)
            qa_checks.append(("sales_item_orphan_dimension_keys", cur.fetchone()[0] == 0, 0))

            cur.execute("""
                SELECT COUNT(*) FROM fact_delivery_order f
                LEFT JOIN dim_customer c ON c.customer_key = f.customer_key
                LEFT JOIN dim_order_status st ON st.order_status_key = f.order_status_key
                WHERE c.customer_key IS NULL OR st.order_status_key IS NULL
            """)
            qa_checks.append(("delivery_orphan_dimension_keys", cur.fetchone()[0] == 0, 0))

            cur.execute("""
                SELECT COUNT(*) FROM fact_review
                WHERE review_score NOT BETWEEN 1 AND 5
            """)
            qa_checks.append(("review_score_range", cur.fetchone()[0] == 0, 0))

            cur.execute("""
                SELECT COUNT(*) FROM fact_delivery_order
                WHERE (is_delivery_eligible = FALSE AND (delay_days IS NOT NULL OR is_delayed IS NOT NULL))
                   OR (is_delivery_eligible = TRUE AND (delay_days IS NULL OR is_delayed IS NULL))
                   OR (is_delivery_eligible = TRUE AND is_delayed IS DISTINCT FROM (delay_days > 0))
            """)
            qa_checks.append(("delivery_kpi_consistency", cur.fetchone()[0] == 0, 0))

            cur.execute("""
                SELECT COUNT(*), MIN(date_key), MAX(date_key),
                       (MAX(date_key) - MIN(date_key) + 1)
                FROM dim_date
            """)
            date_n, date_min, date_max, expected_date_n = cur.fetchone()
            qa_checks.append(("continuous_date_dimension", date_n == expected_date_n, 0))

            for check_name, passed, _ in qa_checks:
                logger.info("QA %s: %s", check_name, "PASS" if passed else "FAIL")
            failed_checks = [name for name, passed, _ in qa_checks if not passed]
            if failed_checks:
                raise RuntimeError("Post-load QA failed; transaction rolled back: " + ", ".join(failed_checks))

            cur.execute("""
                SELECT COUNT(*),
                       ROUND(AVG(delay_days)::numeric, 2),
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY delay_days),
                       MIN(delay_days), MAX(delay_days),
                       COUNT(*) FILTER (WHERE delay_days < 0),
                       COUNT(*) FILTER (WHERE delay_days = 0),
                       COUNT(*) FILTER (WHERE delay_days > 0)
                FROM fact_delivery_order
                WHERE is_delivery_eligible = TRUE
            """)
            delay_profile = cur.fetchone()
            logger.info(
                "Delivery delay profile (eligible_count, avg, median, min, max, early, on_time, late): %s",
                delay_profile
            )

        # Commit happens when connection context exits successfully.
    write_rejects(rejects)
    logger.info("Full refresh committed successfully.")
    logger.info(
        "Counts: dim_date=%s, dim_seller=%s, dim_product=%s, dim_customer=%s, "
        "dim_order_status=%s, fact_sales_item=%s, fact_delivery_order=%s, fact_review=%s",
        date_count, seller_count, product_count, customer_count, status_count,
        sales_count, delivery_count, review_count
    )
    logger.info("Reject rows: %s", len(rejects))

if __name__ == "__main__":
    main()
