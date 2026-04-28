"""
Migration: introduce classified positions + tags.

  1. Rename table:    transaction_link_groups → transaction_positions
  2. Add column:      transaction_positions.position_type (default 'manual')
  3. Rename column:   transaction_annotations.link_group_id → transaction_position_id
  4. Create:          tags, tag_memberships

Idempotent — safe to re-run. Run from backend/:

    python migrate_to_classifications.py portfolio.db
"""
import sqlite3
import sys
from pathlib import Path


def _table_exists(cur, name):
    cur.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,))
    return cur.fetchone() is not None


def _columns(cur, table):
    cur.execute(f"PRAGMA table_info({table})")
    return [row[1] for row in cur.fetchall()]


def migrate(db_path: str):
    print(f"Migrating: {db_path}")
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()

        # 1) transaction_link_groups → transaction_positions
        old_exists = _table_exists(cur, "transaction_link_groups")
        new_exists = _table_exists(cur, "transaction_positions")
        if old_exists and not new_exists:
            print("  Renaming transaction_link_groups → transaction_positions")
            cur.execute("ALTER TABLE transaction_link_groups RENAME TO transaction_positions")
        elif old_exists and new_exists:
            # New table got auto-created (e.g. by init_db) before this migration ran.
            # Copy old rows over (defaulting position_type to 'manual') and drop the old table.
            cur.execute("SELECT COUNT(*) FROM transaction_positions")
            new_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM transaction_link_groups")
            old_count = cur.fetchone()[0]
            if new_count == 0 and old_count > 0:
                print(f"  Copying {old_count} rows from transaction_link_groups → transaction_positions")
                # position_type column may not exist yet — added below; copy is safe either way
                cur.execute("PRAGMA table_info(transaction_positions)")
                tp_cols = [r[1] for r in cur.fetchall()]
                if "position_type" in tp_cols:
                    cur.execute("""
                        INSERT INTO transaction_positions (id, user_id, name, note, position_type, created_at, updated_at)
                        SELECT id, user_id, name, note, 'manual', created_at, updated_at FROM transaction_link_groups
                    """)
                else:
                    cur.execute("""
                        INSERT INTO transaction_positions (id, user_id, name, note, created_at, updated_at)
                        SELECT id, user_id, name, note, created_at, updated_at FROM transaction_link_groups
                    """)
            else:
                print(f"  ⚠ both tables present ({old_count} old, {new_count} new) — leaving old in place; reconcile manually")
            if new_count > 0 or old_count == 0:
                pass  # don't drop if there might be unmerged data
            else:
                cur.execute("DROP TABLE transaction_link_groups")
                print("  Dropped transaction_link_groups")
        elif new_exists:
            print("  ✓ transaction_positions already exists")
        else:
            print("  Creating transaction_positions (no prior link_groups table)")
            cur.execute("""
                CREATE TABLE transaction_positions (
                    id VARCHAR PRIMARY KEY,
                    user_id CHAR(36) NOT NULL,
                    name VARCHAR,
                    note TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            """)
            cur.execute("CREATE INDEX ix_transaction_positions_user_id ON transaction_positions(user_id)")

        # 2) Add position_type to transaction_positions
        cols = _columns(cur, "transaction_positions")
        if "position_type" not in cols:
            print("  Adding transaction_positions.position_type")
            cur.execute("ALTER TABLE transaction_positions ADD COLUMN position_type VARCHAR")
            cur.execute("UPDATE transaction_positions SET position_type='manual' WHERE position_type IS NULL")
            cur.execute("CREATE INDEX IF NOT EXISTS ix_transaction_positions_position_type ON transaction_positions(position_type)")
        else:
            print("  ✓ position_type column already present")

        # 3) Rename annotation.link_group_id → transaction_position_id
        ann_cols = _columns(cur, "transaction_annotations")
        if "link_group_id" in ann_cols and "transaction_position_id" not in ann_cols:
            print("  Renaming transaction_annotations.link_group_id → transaction_position_id")
            cur.execute("ALTER TABLE transaction_annotations RENAME COLUMN link_group_id TO transaction_position_id")
            # Recreate the index under the new name
            cur.execute("DROP INDEX IF EXISTS ix_transaction_annotations_link_group_id")
            cur.execute("CREATE INDEX IF NOT EXISTS ix_transaction_annotations_transaction_position_id ON transaction_annotations(transaction_position_id)")
        elif "transaction_position_id" in ann_cols:
            print("  ✓ transaction_position_id column already present")
        else:
            print("  ⚠ neither link_group_id nor transaction_position_id found — annotations table missing column")

        # 4) tags + tag_memberships
        if not _table_exists(cur, "tags"):
            print("  Creating tags")
            cur.execute("""
                CREATE TABLE tags (
                    id CHAR(36) PRIMARY KEY,
                    user_id CHAR(36) NOT NULL,
                    name VARCHAR NOT NULL,
                    note TEXT,
                    color VARCHAR,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    CONSTRAINT uq_user_tag_name UNIQUE (user_id, name)
                )
            """)
            cur.execute("CREATE INDEX ix_tags_user_id ON tags(user_id)")
        else:
            print("  ✓ tags already exists")

        if not _table_exists(cur, "tag_memberships"):
            print("  Creating tag_memberships")
            cur.execute("""
                CREATE TABLE tag_memberships (
                    id CHAR(36) PRIMARY KEY,
                    tag_id CHAR(36) NOT NULL,
                    member_type VARCHAR NOT NULL,
                    member_id VARCHAR NOT NULL,
                    created_at DATETIME NOT NULL,
                    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
                    CONSTRAINT uq_tag_member UNIQUE (tag_id, member_type, member_id)
                )
            """)
            cur.execute("CREATE INDEX ix_tag_memberships_tag_id ON tag_memberships(tag_id)")
            cur.execute("CREATE INDEX ix_tag_memberships_member_type ON tag_memberships(member_type)")
            cur.execute("CREATE INDEX ix_tag_memberships_member_id ON tag_memberships(member_id)")
        else:
            print("  ✓ tag_memberships already exists")

        conn.commit()
        print("✅ Migration complete")
    except Exception as e:
        conn.rollback()
        print(f"❌ Migration failed: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    db_arg = sys.argv[1] if len(sys.argv) > 1 else "portfolio.db"
    db_path = Path(db_arg)
    if not db_path.exists():
        print(f"Database not found: {db_path}")
        sys.exit(1)
    migrate(str(db_path))
