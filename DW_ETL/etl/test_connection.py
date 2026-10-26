
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

# Đọc file .env ở thư mục gốc dự án
PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

conn_params = {
    "host": "localhost",
    "port": int(os.getenv("POSTGRES_PORT", "5432")),
    "dbname": os.getenv("POSTGRES_DB", "olist_dw"),
    "user": os.getenv("POSTGRES_USER", "dw_user"),
    "password": os.getenv("POSTGRES_PASSWORD"),
    "connect_timeout": 5,
}

if not conn_params["password"]:
    raise RuntimeError("Không tìm thấy POSTGRES_PASSWORD trong file .env")

with psycopg.connect(**conn_params) as conn:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT current_database(), current_schema(), version()
        """)
        database, schema, version = cur.fetchone()

        cur.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'dw'
              AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """)
        tables = [row[0] for row in cur.fetchall()]

print(f"Database: {database}")
print(f"Current schema: {schema}")
print(f"PostgreSQL: {version.split(',')[0]}")
print(f"Số bảng DW: {len(tables)}")

for table in tables:
    print(f"  - {table}")

if len(tables) != 8:
    raise RuntimeError(
        f"Mong đợi 8 bảng DW nhưng tìm thấy {len(tables)} bảng."
    )

print("Kết nối Python -> PostgreSQL thành công.")
