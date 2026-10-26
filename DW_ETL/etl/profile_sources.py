import sys
import pandas as pd
from etl.config import DATA_DIR

REQUIRED_COLUMNS = {
    "olist_orders_dataset.csv": {
        "order_id", "customer_id", "order_status", "order_purchase_timestamp",
        "order_approved_at", "order_delivered_carrier_date",
        "order_delivered_customer_date", "order_estimated_delivery_date",
    },
    "olist_order_items_dataset.csv": {
        "order_id", "order_item_id", "product_id", "seller_id",
        "shipping_limit_date", "price", "freight_value",
    },
    "olist_sellers_dataset.csv": {
        "seller_id", "seller_zip_code_prefix", "seller_city", "seller_state",
    },
    "olist_products_dataset.csv": {
        "product_id", "product_category_name", "product_name_lenght",
        "product_description_lenght", "product_photos_qty", "product_weight_g",
        "product_length_cm", "product_height_cm", "product_width_cm",
    },
    "olist_customers_dataset.csv": {
        "customer_id", "customer_unique_id", "customer_zip_code_prefix",
        "customer_city", "customer_state",
    },
    "olist_order_reviews_dataset.csv": {
        "review_id", "order_id", "review_score", "review_comment_title",
        "review_comment_message", "review_creation_date", "review_answer_timestamp",
    },
    "product_category_name_translation.csv": {
        "product_category_name", "product_category_name_english",
    },
}

def main():
    print(f"Data directory: {DATA_DIR}")
    if not DATA_DIR.exists():
        print("ERROR: Không tìm thấy thư mục dữ liệu.", file=sys.stderr)
        sys.exit(1)
    failed = False
    for filename, required in REQUIRED_COLUMNS.items():
        path = DATA_DIR / filename
        if not path.exists():
            print(f"\n[MISSING] {filename}")
            failed = True
            continue
        try:
            df = pd.read_csv(path, low_memory=False)
        except Exception as exc:
            print(f"\n[READ ERROR] {filename}: {exc}")
            failed = True
            continue
        missing_cols = sorted(required - set(df.columns))
        print(f"\n[{'OK' if not missing_cols else 'COLUMN ERROR'}] {filename}")
        print(f"  Rows: {len(df):,}; columns: {len(df.columns)}")
        if missing_cols:
            print(f"  Missing required columns: {missing_cols}")
            failed = True
        if filename == "olist_order_items_dataset.csv":
            dup = int(df.duplicated(["order_id", "order_item_id"]).sum())
            print(f"  Duplicate (order_id, order_item_id): {dup:,}")
        elif filename == "olist_orders_dataset.csv":
            dup = int(df["order_id"].duplicated().sum())
            print(f"  Duplicate order_id: {dup:,}")
            print(f"  Missing delivered timestamp: {df['order_delivered_customer_date'].isna().sum():,}")
        elif filename == "olist_order_reviews_dataset.csv":
            print(f"  Missing review_score: {df['review_score'].isna().sum():,}")
            print(f"  Duplicate order_id (allowed at source grain): {df['order_id'].duplicated().sum():,}")
    if failed:
        print("\nSource check FAILED. Hãy sửa đường dẫn/tên file/cột trước khi load.")
        sys.exit(2)
    print("\nSource check PASSED: đủ 7 file và các cột bắt buộc.")

if __name__ == "__main__":
    main()
