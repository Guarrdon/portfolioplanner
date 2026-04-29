"""
Migration script to add `iv` (implied volatility) column to position_legs.

Greeks (delta/gamma/theta/vega) already exist on the model; IV was the only
gap. Run from backend/:

    python add_position_leg_iv.py
"""
import sqlite3
import sys
from pathlib import Path


def migrate_database(db_path: str) -> bool:
    print(f"Migrating database: {db_path}")
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        cursor.execute("PRAGMA table_info(position_legs)")
        columns = [row[1] for row in cursor.fetchall()]

        if "iv" in columns:
            print("  iv column already exists")
        else:
            print("  Adding iv column...")
            cursor.execute("ALTER TABLE position_legs ADD COLUMN iv NUMERIC(10, 4)")
            print("  Added iv column")

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
