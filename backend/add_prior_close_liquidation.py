"""One-shot migration: add prior_close_liquidation_value column to
user_schwab_accounts. Idempotent — re-running is a no-op once the column
exists. Backfills the existing column with the current liquidation_value
so that day P&L reads as $0 for any account that hasn't been resynced
under the new sync code yet (rather than treating the missing field as
prior_close=0, which would falsely report a huge day gain).
"""
from sqlalchemy import text
from app.core.database import engine


def column_exists(conn, table: str, column: str) -> bool:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return any(r[1] == column for r in rows)


def main():
    with engine.begin() as conn:
        if column_exists(conn, "user_schwab_accounts", "prior_close_liquidation_value"):
            print("column already exists; nothing to do")
            return
        conn.execute(text(
            "ALTER TABLE user_schwab_accounts "
            "ADD COLUMN prior_close_liquidation_value FLOAT DEFAULT 0.0"
        ))
        # Seed with current liquidation_value: a freshly-added column reads
        # as 0 → day_pnl would be (current - 0) = full account value, which
        # is wrong. Pretending today's start equals today's now means a $0
        # day P&L until the next sync writes a real prior-close.
        conn.execute(text(
            "UPDATE user_schwab_accounts "
            "SET prior_close_liquidation_value = liquidation_value"
        ))
        print("added prior_close_liquidation_value (seeded from liquidation_value)")


if __name__ == "__main__":
    main()
