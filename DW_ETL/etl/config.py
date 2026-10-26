from pathlib import Path
import os
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")
DATA_DIR = Path(os.getenv("OLIST_DATA_DIR", PROJECT_ROOT / "data" / "raw"))
DB_CONFIG = {
    "host": os.getenv("POSTGRES_HOST", "localhost"),
    "port": int(os.getenv("POSTGRES_PORT", "5432")),
    "dbname": os.getenv("POSTGRES_DB", "olist_dw"),
    "user": os.getenv("POSTGRES_USER", "dw_user"),
    "password": os.getenv("POSTGRES_PASSWORD"),
    "connect_timeout": 10,
}
if not DB_CONFIG["password"]:
    raise RuntimeError("POSTGRES_PASSWORD chưa được cấu hình trong file .env")
