"""
Migration script to add strategy locking fields to positions table
Run this script to add is_manual_strategy and schwab_position_signature columns
"""
import sqlite3
import sys
from pathlib import Path

def migrate_database(db_path: str):
    """Add strategy locking columns to positions table"""
    print(f"Migrating database: {db_path}")
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check if columns already exist
        cursor.execute("PRAGMA table_info(positions)")
        columns = [row[1] for row in cursor.fetchall()]
        
        if 'is_manual_strategy' in columns:
            print("  ✅ is_manual_strategy column already exists")
        else:
            print("  Adding is_manual_strategy column...")
            cursor.execute("""
                ALTER TABLE positions 
                ADD COLUMN is_manual_strategy BOOLEAN DEFAULT 0
            """)
            # Set existing positions to FALSE (0)
            cursor.execute("""
                UPDATE positions 
                SET is_manual_strategy = 0 
                WHERE is_manual_strategy IS NULL
            """)
            print("  ✅ Added is_manual_strategy column")
        
        if 'schwab_position_signature' in columns:
            print("  ✅ schwab_position_signature column already exists")
        else:
            print("  Adding schwab_position_signature column...")
            cursor.execute("""
                ALTER TABLE positions 
                ADD COLUMN schwab_position_signature VARCHAR(64)
            """)
            print("  ✅ Added schwab_position_signature column")
        
        # Create index on signature column if it doesn't exist
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_positions_schwab_signature 
            ON positions(schwab_position_signature)
        """)
        print("  ✅ Created index on schwab_position_signature")
        
        conn.commit()
        conn.close()
        
        print(f"✅ Migration complete for {db_path}\n")
        return True
        
    except Exception as e:
        print(f"❌ Migration failed for {db_path}: {e}\n")
        return False

if __name__ == "__main__":
    backend_dir = Path(__file__).parent
    
    # List of databases to migrate
    databases = [
        backend_dir / "portfolio.db",
        backend_dir / "portfolio_user_a.db",
        backend_dir / "portfolio_user_b.db",
    ]
    
    print("=" * 60)
    print("Strategy Locking Migration")
    print("=" * 60)
    print()
    
    success_count = 0
    for db_path in databases:
        if db_path.exists():
            if migrate_database(str(db_path)):
                success_count += 1
        else:
            print(f"Skipping {db_path.name} (does not exist)\n")
    
    print("=" * 60)
    print(f"Migration Summary: {success_count} databases migrated successfully")
    print("=" * 60)
    
    sys.exit(0 if success_count > 0 else 1)

