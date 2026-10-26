## Yêu cầu

- Docker Desktop
- Python và môi trường ảo `.venv`
- 7 CSV nguồn đặt trong `data/raw/`

## Chạy dự án (Windows PowerShell)

Khởi động PostgreSQL:

```powershell
docker compose up -d
```

Tạo/kích hoạt môi trường Python nếu chưa có:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install pandas "psycopg[binary]" python-dotenv
```

Kiểm tra CSV và chạy ETL:

```powershell
python -m etl.profile_sources
python -m etl.load_dw
```

Chờ log báo full refresh commit thành công. ETL hiện dùng **controlled full refresh**; không chạy đồng thời nhiều phiên và không ngắt giữa chừng nếu không chủ ý hủy lượt chạy.

## Nếu Python không tìm thấy pandas

Xác nhận interpreter:

```powershell
python -c "import sys; print(sys.executable)"
```

Đường dẫn phải trỏ đến `DW_ETL\.venv\Scripts\python.exe`. Nếu không, chạy trực tiếp:

```powershell
.\.venv\Scripts\python.exe -m etl.profile_sources
.\.venv\Scripts\python.exe -m etl.load_dw
```

## Kiểm tra dữ liệu

```powershell
Get-Content ".\sql\002_validation_and_reconciliation.sql" -Raw |
    docker exec -i olist-dw-postgres psql -U dw_user -d olist_dw -v ON_ERROR_STOP=1
```
