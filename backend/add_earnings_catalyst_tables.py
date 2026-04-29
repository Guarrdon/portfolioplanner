"""Migration: create earnings_cache and user_catalysts tables.

Run from backend/:
    python add_earnings_catalyst_tables.py
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
            CREATE TABLE IF NOT EXISTS earnings_cache (
                symbol VARCHAR(32) PRIMARY KEY,
                next_earnings_date DATE,
                has_no_data VARCHAR(1) NOT NULL DEFAULT 'N',
                fetched_at DATETIME NOT NULL
            )
        """)
        print("  earnings_cache ready")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_catalysts (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                symbol VARCHAR(32) NOT NULL,
                catalyst_date DATE NOT NULL,
                label VARCHAR(128),
                created_at DATETIME NOT NULL
            )
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_user_catalysts_user_id "
            "ON user_catalysts(user_id)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_user_catalysts_symbol "
            "ON user_catalysts(symbol)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_user_catalysts_user_symbol "
            "ON user_catalysts(user_id, symbol)"
        )
        print("  user_catalysts ready")

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
