#!/bin/bash

# Clear Schwab Data - Testing Utility
# Removes all Schwab accounts and positions from database
# Useful for testing sync with fresh data

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Clear Schwab Data Utility${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# Determine which database to clear
echo "Which instance's data do you want to clear?"
echo "  1) Instance A (portfolio_user_a.db)"
echo "  2) Instance B (portfolio_user_b.db)"
echo "  3) Both"
echo "  4) Cancel"
echo ""
read -p "Enter choice [1-4]: " choice

case $choice in
    1)
        DB_FILE="backend/portfolio_user_a.db"
        INSTANCE="Instance A"
        ;;
    2)
        DB_FILE="backend/portfolio_user_b.db"
        INSTANCE="Instance B"
        ;;
    3)
        DB_FILE="both"
        INSTANCE="Both Instances"
        ;;
    4)
        echo "Cancelled"
        exit 0
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${RED}WARNING: This will DELETE:${NC}"
echo "  - All Schwab account records"
echo "  - All positions with flavor='actual'"
echo "  - All position legs for actual positions"
echo ""
echo -e "${YELLOW}Positions with flavor='idea' and 'shared' will be preserved${NC}"
echo ""
read -p "Are you sure? (type 'yes' to confirm): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Cancelled"
    exit 0
fi

clear_database() {
    local db_path=$1
    local instance_name=$2
    
    if [ ! -f "$db_path" ]; then
        echo -e "${YELLOW}  Database not found: $db_path (skipping)${NC}"
        return
    fi
    
    echo ""
    echo -e "${YELLOW}Clearing $instance_name...${NC}"
    
    # Create SQL commands to clear data
    sqlite3 "$db_path" << 'SQL'
.timeout 5000

-- Get counts before deletion
SELECT 'Before deletion:';
SELECT '  Schwab accounts: ' || COUNT(*) FROM user_schwab_accounts;
SELECT '  Actual positions: ' || COUNT(*) FROM positions WHERE flavor = 'actual';
SELECT '  Position legs: ' || COUNT(*) FROM position_legs;

-- Delete position legs for actual positions first (FK constraint)
DELETE FROM position_legs 
WHERE position_id IN (
    SELECT id FROM positions WHERE flavor = 'actual'
);

-- Delete actual positions
DELETE FROM positions WHERE flavor = 'actual';

-- Delete Schwab accounts
DELETE FROM user_schwab_accounts;

-- Show counts after deletion
SELECT '';
SELECT 'After deletion:';
SELECT '  Schwab accounts: ' || COUNT(*) FROM user_schwab_accounts;
SELECT '  Actual positions: ' || COUNT(*) FROM positions WHERE flavor = 'actual';
SELECT '  Position legs: ' || COUNT(*) FROM position_legs;
SELECT '  Idea positions preserved: ' || COUNT(*) FROM positions WHERE flavor = 'idea';
SQL
    
    echo -e "${GREEN}  ✓ Cleared $instance_name${NC}"
}

# Clear selected database(s)
if [ "$DB_FILE" = "both" ]; then
    clear_database "backend/portfolio_user_a.db" "Instance A"
    clear_database "backend/portfolio_user_b.db" "Instance B"
else
    clear_database "$DB_FILE" "$INSTANCE"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Cleanup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Restart your backend if it's running"
echo "  2. Trigger a fresh sync from the UI or:"
echo "     curl -X POST http://localhost:8000/api/v1/positions/sync"
echo ""

