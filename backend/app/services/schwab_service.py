"""
Schwab API integration service

Handles authentication, data fetching, and transformation from Schwab API.
Supports both mock data (development) and real API (production).
"""
from typing import List, Dict, Any, Optional
from datetime import datetime, date, timedelta
from decimal import Decimal
import re
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import encrypt_data, decrypt_data
from app.models.user import UserSchwabCredentials, UserSchwabAccount
from app.services.mock_schwab_data import get_mock_schwab_client


def get_schwab_client(user_id: str, db: Session):
    """
    Get Schwab API client for a user
    
    Returns mock client in development mode, real client in production
    """
    if settings.USE_MOCK_SCHWAB_DATA:
        return get_mock_schwab_client()
    
    # Real Schwab API using schwab-py library
    try:
        import schwab.auth as schwab_auth
        import toml
        import os
    except ImportError as e:
        raise RuntimeError(f"Required library not installed: {e}")
    
    # Load config from schwab_config.toml
    config_path = os.path.join(os.path.dirname(__file__), '../../schwab_config.toml')
    if not os.path.exists(config_path):
        raise ValueError(f"Schwab configuration file not found at {config_path}")
    
    with open(config_path, 'r') as f:
        config = toml.load(f)
    
    consumer_key = config.get('consumer_key')
    app_secret = config.get('app_secret')
    token_path = config.get('token_path', 'schwab_tokens.json')
    
    if not consumer_key or not app_secret:
        raise ValueError("Schwab credentials not configured in schwab_config.toml")
    
    # Make token path absolute
    if not os.path.isabs(token_path):
        token_path = os.path.join(os.path.dirname(__file__), '../..', token_path)
    
    if not os.path.exists(token_path):
        raise ValueError(f"Schwab token file not found at {token_path}. Run get_schwab_token.py first.")
    
    # Create client from token file
    try:
        client = schwab_auth.client_from_token_file(
            token_path,
            consumer_key,
            app_secret,
            enforce_enums=False
        )
        return client
    except Exception as e:
        raise RuntimeError(f"Failed to create Schwab client: {e}")


def fetch_account_data(user_id: str, db: Session, account_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Fetch account and position data from Schwab API
    
    Args:
        user_id: User ID
        db: Database session
        account_ids: Optional list of specific account IDs to fetch
        
    Returns:
        Dictionary with account data and positions
    """
    client = get_schwab_client(user_id, db)
    
    # Get all accounts for user
    accounts_response = client.get_account_numbers()
    if accounts_response.status_code != 200:
        raise Exception(f"Failed to fetch account numbers: {accounts_response.status_code}")
    
    accounts = accounts_response.json()
    print(f"DEBUG: Found {len(accounts)} accounts from Schwab API")
    for acc in accounts:
        print(f"  - Account: {acc.get('accountNumber', 'N/A')}")
    
    # Filter to only enabled accounts if account_ids provided
    if account_ids:
        accounts = [acc for acc in accounts if acc["hashValue"] in account_ids]
    else:
        # Get user's enabled accounts from database
        enabled_accounts = db.query(UserSchwabAccount).filter(
            UserSchwabAccount.user_id == user_id,
            UserSchwabAccount.sync_enabled == True
        ).all()
        
        print(f"DEBUG: Found {len(enabled_accounts)} enabled accounts in database")
        
        if enabled_accounts:
            enabled_hashes = {acc.account_hash for acc in enabled_accounts}
            print(f"DEBUG: Enabled hashes from DB: {enabled_hashes}")
            schwab_hashes = {acc["hashValue"] for acc in accounts}
            print(f"DEBUG: Hashes from Schwab API: {schwab_hashes}")
            filtered_accounts = [acc for acc in accounts if acc["hashValue"] in enabled_hashes]
            print(f"DEBUG: Matched accounts: {len(filtered_accounts)}")
            
            # If no matches found, the DB has stale hashes (e.g., from mock data)
            # Fall back to fetching ALL accounts
            if not filtered_accounts:
                print("DEBUG: No matches found - database has stale account hashes. Fetching ALL accounts.")
            else:
                accounts = filtered_accounts
        # If no enabled accounts in DB, fetch from ALL accounts
    
    print(f"DEBUG: Will fetch positions from {len(accounts)} accounts")
    
    # Fetch position data for each account
    all_positions = []
    account_info_list = []
    
    for account in accounts:
        account_hash = account["hashValue"]
        
        try:
            # Fetch account details with positions
            # Use the proper enum value from schwab-py library
            import schwab
            details_response = client.get_account(
                account_hash, 
                fields=schwab.client.Client.Account.Fields.POSITIONS
            )
            
            if details_response.status_code != 200:
                print(f"ERROR: Failed to fetch details for account {account_hash}")
                print(f"  Status code: {details_response.status_code}")
                print(f"  Response: {details_response.text}")
                continue
            
            account_data = details_response.json()
            securities_account = account_data.get("securitiesAccount", {})
            
            # Extract account info including balances
            current_balances = securities_account.get("currentBalances", {})
            
            account_info = {
                "hash_value": account_hash,
                "account_number": securities_account.get("accountNumber"),
                "account_type": securities_account.get("type"),
                "cash_balance": current_balances.get("cashBalance", 0.0),
                "liquidation_value": current_balances.get("liquidationValue", 0.0),
                "buying_power": current_balances.get("buyingPower", 0.0),  # Stock buying power (with margin)
                "buying_power_options": current_balances.get("availableFunds", 0.0)  # Options buying power (cash)
            }
            account_info_list.append(account_info)
            
            # Process positions
            positions = securities_account.get("positions", [])
            print(f"DEBUG: Account {account_info['account_number']} has {len(positions)} positions")
            
            # Log a sample position to see all available fields
            if positions and len(positions) > 0:
                print(f"DEBUG: Sample position keys: {list(positions[0].keys())}")
                if 'instrument' in positions[0]:
                    print(f"DEBUG: Sample instrument keys: {list(positions[0]['instrument'].keys())}")
            
            for position in positions:
                transformed = transform_schwab_position(position, account_info)
                if transformed:
                    all_positions.append(transformed)
                    # Log first few transformed positions to verify data
                    if len(all_positions) <= 2:
                        print(f"DEBUG: Transformed position - Symbol: {transformed.get('symbol')}, Type: {transformed.get('asset_type')}, Value: ${transformed.get('current_value', 0):.2f}, Legs: {len(transformed.get('legs', []))}")
                else:
                    print(f"DEBUG: Skipped position {position.get('instrument', {}).get('symbol', 'UNKNOWN')}")
        
        except Exception as e:
            print(f"Error fetching data for account {account_hash}: {e}")
            import traceback
            traceback.print_exc()
            continue
    
    print(f"DEBUG: Total positions fetched: {len(all_positions)}")
    
    return {
        "accounts": account_info_list,
        "positions": all_positions
    }


def transform_schwab_position(schwab_position: Dict[str, Any], account_info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Transform Schwab API position to our internal format
    
    Args:
        schwab_position: Raw position data from Schwab API
        account_info: Account metadata
        
    Returns:
        Transformed position dictionary or None if invalid
    """
    instrument = schwab_position.get("instrument", {})
    asset_type = instrument.get("assetType")
    
    if asset_type == "OPTION":
        return transform_option_position(schwab_position, account_info)
    elif asset_type in ["EQUITY", "ETF", "PREFERRED_STOCK"]:
        return transform_equity_position(schwab_position, account_info)
    
    return None


def transform_option_position(schwab_position: Dict[str, Any], account_info: Dict[str, Any]) -> Dict[str, Any]:
    """Transform option position from Schwab format"""
    instrument = schwab_position["instrument"]
    
    symbol = instrument.get("symbol", "").strip()
    underlying = instrument.get("underlyingSymbol", "")
    put_call = instrument.get("putCall", "").lower()
    expiration_str = instrument.get("optionExpirationDate")
    
    # Parse expiration date - try from API first, then decode from OCC symbol
    expiration = None
    if expiration_str:
        try:
            expiration = datetime.fromisoformat(expiration_str).date()
        except:
            pass
    
    # If API didn't provide expiration, extract from OCC symbol
    # OCC format: TICKER(variable)YYMMDD(6)P/C(1)STRIKE(8)
    # Example: "AAL   260116C00017000" -> date is 260116 (Jan 16, 2026)
    if not expiration and symbol:
        try:
            # Remove all spaces and extract date portion (6 digits after ticker, before P/C)
            clean_symbol = symbol.replace(' ', '')
            # Match: letters, then 6 digits (YYMMDD), then P or C
            match = re.match(r'^[A-Z]+(\d{6})[PC]', clean_symbol)
            if match:
                date_str = match.group(1)  # YYMMDD
                # Parse as YY-MM-DD
                year = 2000 + int(date_str[0:2])
                month = int(date_str[2:4])
                day = int(date_str[4:6])
                expiration = datetime(year, month, day).date()
        except Exception as e:
            pass  # Failed to decode expiration from symbol
    
    # Extract strike from symbol if not provided
    strike = None
    match = re.search(r'(\d{8})$', symbol.replace(' ', ''))
    if match:
        strike = Decimal(match.group(1)) / Decimal(1000)
    
    # Calculate quantity (long - short)
    quantity = Decimal(str(schwab_position.get("longQuantity", 0.0))) - Decimal(str(schwab_position.get("shortQuantity", 0.0)))
    
    market_value = Decimal(str(schwab_position.get("marketValue", 0.0)))
    average_price = Decimal(str(schwab_position.get("averagePrice", 0.0)))
    
    # Cost basis calculation (SIGNED for proper multi-leg strategy calculations)
    # - For LONG (quantity > 0): POSITIVE (money paid out - debit)
    # - For SHORT (quantity < 0): NEGATIVE (money received - credit)
    if quantity < 0:
        # Short: negative cost_basis (credit received)
        cost_basis = -(abs(quantity) * average_price * Decimal(100))
    else:
        # Long: positive cost_basis (debit paid)
        cost_basis = abs(quantity) * average_price * Decimal(100)
    
    # P&L calculation:
    # - For SHORT (quantity < 0): P&L = credit_received + market_value (market_value is negative)
    # - For LONG (quantity > 0): P&L = market_value - cost_paid
    unrealized_pnl = market_value - cost_basis
    
    # Additional financial metrics
    maintenance_requirement = schwab_position.get("maintenanceRequirement")
    current_day_pnl = schwab_position.get("currentDayProfitLoss")
    current_day_pnl_pct = schwab_position.get("currentDayProfitLossPercentage")
    
    # Calculate current price per share from market value
    current_price_per_share = abs(market_value / quantity / Decimal(100)) if quantity != 0 else Decimal(0)
    
    return {
        "symbol": symbol,
        "underlying": underlying,
        "asset_type": "option",
        "option_type": put_call,
        "strike": float(strike) if strike else None,
        "expiration": expiration,
        "quantity": float(quantity),
        "average_price": float(average_price),  # Per-share trade price from Schwab
        "current_price": float(current_price_per_share),  # Per-share current price
        "cost_basis": float(cost_basis),
        "current_value": float(market_value),
        "unrealized_pnl": float(unrealized_pnl),
        "maintenance_requirement": float(maintenance_requirement) if maintenance_requirement else None,
        "current_day_pnl": float(current_day_pnl) if current_day_pnl else None,
        "current_day_pnl_percentage": float(current_day_pnl_pct) if current_day_pnl_pct else None,
        "account_hash": account_info["hash_value"],
        "account_number": mask_account_number(account_info["account_number"]),
        "account_type": account_info["account_type"]
    }


def transform_equity_position(schwab_position: Dict[str, Any], account_info: Dict[str, Any]) -> Dict[str, Any]:
    """Transform equity position from Schwab format"""
    instrument = schwab_position["instrument"]
    
    symbol = instrument.get("symbol", "").strip()
    quantity = Decimal(str(schwab_position.get("longQuantity", 0.0)))
    market_value = Decimal(str(schwab_position.get("marketValue", 0.0)))
    average_price = Decimal(str(schwab_position.get("averagePrice", 0.0)))
    
    # Cost basis for stocks (always positive for long stocks)
    cost_basis = quantity * average_price
    unrealized_pnl = market_value - cost_basis
    
    # Calculate current price per share
    current_price = market_value / quantity if quantity != 0 else Decimal(0)
    
    # Additional financial metrics
    maintenance_requirement = schwab_position.get("maintenanceRequirement")
    current_day_pnl = schwab_position.get("currentDayProfitLoss")
    current_day_pnl_pct = schwab_position.get("currentDayProfitLossPercentage")
    
    return {
        "symbol": symbol,
        "underlying": symbol,
        "asset_type": "stock",
        "option_type": None,
        "strike": None,
        "expiration": None,
        "quantity": float(quantity),
        "average_price": float(average_price),  # Per-share trade price
        "current_price": float(current_price),  # Per-share current price
        "cost_basis": float(cost_basis),
        "current_value": float(market_value),
        "unrealized_pnl": float(unrealized_pnl),
        "maintenance_requirement": float(maintenance_requirement) if maintenance_requirement else None,
        "current_day_pnl": float(current_day_pnl) if current_day_pnl else None,
        "current_day_pnl_percentage": float(current_day_pnl_pct) if current_day_pnl_pct else None,
        "account_hash": account_info["hash_value"],
        "account_number": mask_account_number(account_info["account_number"]),
        "account_type": account_info["account_type"]
    }


def group_positions_by_strategy(positions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Group individual positions into strategies (covered calls, spreads, etc.)
    
    This analyzes positions for the same underlying and attempts to detect
    known strategy patterns like covered calls, spreads, etc.
    
    ALL positions will be included in output. Positions that don't match
    known patterns will be marked as 'unallocated' for manual assignment.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info(f"=== GROUPING POSITIONS: {len(positions)} input positions ===")
    
    # Log all input positions for debugging
    for pos in positions:
        logger.info(f"  Input: {pos['underlying']} | {pos['asset_type']} | qty={pos['quantity']} | acct={pos.get('account_number', 'N/A')[-4:]}")
    
    # Group by (underlying, account_hash) to keep positions from different accounts separate
    by_underlying_account = {}
    for pos in positions:
        underlying = pos["underlying"]
        account_hash = pos.get("account_hash", "unknown")
        key = (underlying, account_hash)
        if key not in by_underlying_account:
            by_underlying_account[key] = []
        by_underlying_account[key].append(pos)
    
    result_positions = []
    
    for (underlying, account_hash), group in by_underlying_account.items():
        # Separate stocks and options
        stocks = [p for p in group if p["asset_type"] == "stock"]
        options = [p for p in group if p["asset_type"] == "option"]
        
        # Further group options by expiration
        by_expiration = {}
        for opt in options:
            exp = opt["expiration"]
            if exp not in by_expiration:
                by_expiration[exp] = []
            by_expiration[exp].append(opt)
        
        # Try to detect strategies
        detected_strategies = []
        remaining_stocks = stocks.copy()
        remaining_options = options.copy()
        
        for exp, exp_options in by_expiration.items():
            # Try to detect covered call
            if remaining_stocks:
                for stock in remaining_stocks[:]:
                    for opt in exp_options[:]:
                        if (opt["option_type"] == "call" and 
                            opt["quantity"] < 0 and 
                            stock["quantity"] >= abs(opt["quantity"]) * 100):
                            # Found covered call
                            detected_strategies.append({
                                "strategy_type": "covered_call",
                                "legs": [stock, opt],
                                "underlying": underlying
                            })
                            remaining_stocks.remove(stock)
                            remaining_options.remove(opt)
                            if opt in exp_options:
                                exp_options.remove(opt)
                            break
            
            # Try to detect box spread (4-leg: long call + short call + long put + short put, same exp)
            if len(exp_options) == 4:
                exp_calls = [o for o in exp_options if o["option_type"] == "call"]
                exp_puts = [o for o in exp_options if o["option_type"] == "put"]
                
                if len(exp_calls) == 2 and len(exp_puts) == 2:
                    call_long = next((c for c in exp_calls if c["quantity"] > 0), None)
                    call_short = next((c for c in exp_calls if c["quantity"] < 0), None)
                    put_long = next((p for p in exp_puts if p["quantity"] > 0), None)
                    put_short = next((p for p in exp_puts if p["quantity"] < 0), None)
                    
                    if call_long and call_short and put_long and put_short:
                        # Verify it's a box: call_long_strike = put_short_strike, call_short_strike = put_long_strike
                        if (abs(call_long["strike"] - put_short["strike"]) < 0.1 and
                            abs(call_short["strike"] - put_long["strike"]) < 0.1):
                            detected_strategies.append({
                                "strategy_type": "box_spread",
                                "legs": [call_long, call_short, put_long, put_short],
                                "underlying": underlying
                            })
                            for leg in [call_long, call_short, put_long, put_short]:
                                if leg in remaining_options:
                                    remaining_options.remove(leg)
                            continue
            
            # Try to detect vertical spreads (put or call spreads)
            puts = [o for o in exp_options if o["option_type"] == "put" and o in remaining_options]
            if len(puts) == 2:
                sorted_puts = sorted(puts, key=lambda x: x["strike"], reverse=True)
                if sorted_puts[0]["quantity"] < 0 and sorted_puts[1]["quantity"] > 0:
                    detected_strategies.append({
                        "strategy_type": "vertical_spread",
                        "legs": sorted_puts,
                        "underlying": underlying
                    })
                    for p in sorted_puts:
                        if p in remaining_options:
                            remaining_options.remove(p)
            
            calls = [o for o in exp_options if o["option_type"] == "call" and o in remaining_options]
            if len(calls) == 2:
                sorted_calls = sorted(calls, key=lambda x: x["strike"])
                if sorted_calls[0]["quantity"] > 0 and sorted_calls[1]["quantity"] < 0:
                    detected_strategies.append({
                        "strategy_type": "vertical_spread",
                        "legs": sorted_calls,
                        "underlying": underlying
                    })
                    for c in sorted_calls:
                        if c in remaining_options:
                            remaining_options.remove(c)
        
        # Add detected strategies
        result_positions.extend(detected_strategies)
        
        # Add remaining positions as individual positions
        for stock in remaining_stocks:
            # Classify stocks
            if stock["quantity"] > 0:
                # Check if it's a dividend stock (could add more logic here, like yield > threshold)
                result_positions.append({
                    "strategy_type": "long_stock",
                    "legs": [stock],
                    "underlying": underlying
                })
            else:
                result_positions.append({
                    "strategy_type": "short_stock",
                    "legs": [stock],
                    "underlying": underlying
                })
        
        # Classify remaining single options
        for opt in remaining_options:
            # Differentiate between "big_option" and "single_option" based on size
            # Big Option: |quantity| >= 10 or cost_basis >= $5000
            abs_qty = abs(opt["quantity"])
            cost = abs(opt.get("cost_basis", 0))
            
            if abs_qty >= 10 or cost >= 5000:
                strategy_type = "big_option"
            else:
                strategy_type = "single_option"
            
            result_positions.append({
                "strategy_type": strategy_type,
                "legs": [opt],
                "underlying": underlying
            })
    
    # Log output for verification
    logger.info(f"=== GROUPED OUTPUT: {len(result_positions)} grouped positions ===")
    for gpos in result_positions:
        logger.info(f"  Output: {gpos['underlying']} | {gpos['strategy_type']} | legs={len(gpos['legs'])}")
    
    # CRITICAL: Verify ALL input positions made it to output
    input_count = len(positions)
    output_leg_count = sum(len(gpos['legs']) for gpos in result_positions)
    
    if input_count != output_leg_count:
        logger.error(f"❌ POSITION MISMATCH: Input={input_count}, Output legs={output_leg_count}")
        logger.error("Some positions were dropped during grouping!")
    else:
        logger.info(f"✅ All {input_count} positions accounted for")
    
    return result_positions


def mask_account_number(account_number: Optional[str]) -> Optional[str]:
    """Mask account number for display (show only last 4 digits)"""
    if not account_number:
        return None
    if len(account_number) <= 4:
        return account_number
    return "****" + account_number[-4:]

