"""Migration: create benchmark_rate_cache table.

Run from backend/:
    python add_benchmark_rate_table.py
"""
import sqlite3
import sys
from pathlib import Path


def migrate_database(db_path: str) -> bool:
    print(f"Migrating database: {db_path}")
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS benchmark_rate_cache (
                series_id VARCHAR(32) PRIMARY KEY,
                rate_pct FLOAT,
                rate_date DATE,
                fetched_at DATETIME NOT NULL
            )
        """)
        print("  benchmark_rate_cache ready")
        conn.commit()
        conn.close()
        print(f"Migration complete for {db_path}\n")
        return True
    except Exception as e:
        print(f"Migration failed for {db_path}: {e}\n")
        return False


if __name__ == "__main__":
    backend_dir = Path(__file__).parent
    databases = [
        backend_dir / "portfolio.db",
        backend_dir / "portfolio_user_a.db",
        backend_dir / "portfolio_user_b.db",
    ]
    success_count = 0
    for db_path in databases:
        if db_path.exists():
            if migrate_database(str(db_path)):
                success_count += 1
        else:
            print(f"Skipping {db_path.name} (does not exist)\n")
    sys.exit(0 if success_count > 0 else 1)
