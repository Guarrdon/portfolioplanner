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
    
    # TODO: Implement real Schwab API client
    # credentials = db.query(UserSchwabCredentials).filter(
    #     UserSchwabCredentials.user_id == user_id
    # ).first()
    # 
    # if not credentials:
    #     raise ValueError("Schwab credentials not found for user")
    # 
    # # Decrypt tokens
    # access_token = decrypt_data(credentials.access_token)
    # 
    # # Create schwab-py client
    # return create_real_schwab_client(access_token)
    
    raise NotImplementedError("Real Schwab API not yet implemented")


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
    
    # Filter to only enabled accounts if account_ids provided
    if account_ids:
        accounts = [acc for acc in accounts if acc["hashValue"] in account_ids]
    else:
        # Get user's enabled accounts from database
        enabled_accounts = db.query(UserSchwabAccount).filter(
            UserSchwabAccount.user_id == user_id,
            UserSchwabAccount.sync_enabled == True
        ).all()
        
        if enabled_accounts:
            enabled_hashes = {acc.account_hash for acc in enabled_accounts}
            accounts = [acc for acc in accounts if acc["hashValue"] in enabled_hashes]
    
    # Fetch position data for each account
    all_positions = []
    account_info_list = []
    
    for account in accounts:
        account_hash = account["hashValue"]
        
        try:
            # Fetch account details with positions
            details_response = client.get_account(account_hash, fields="positions")
            
            if details_response.status_code != 200:
                print(f"Warning: Failed to fetch details for account {account_hash}")
                continue
            
            account_data = details_response.json()
            securities_account = account_data.get("securitiesAccount", {})
            
            # Extract account info
            account_info = {
                "hash_value": account_hash,
                "account_number": securities_account.get("accountNumber"),
                "account_type": securities_account.get("type"),
                "nlv": securities_account.get("currentBalances", {}).get("liquidationValue", 0.0)
            }
            account_info_list.append(account_info)
            
            # Process positions
            positions = securities_account.get("positions", [])
            for position in positions:
                transformed = transform_schwab_position(position, account_info)
                if transformed:
                    all_positions.append(transformed)
        
        except Exception as e:
            print(f"Error fetching data for account {account_hash}: {e}")
            continue
    
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
    
    # Parse expiration date
    expiration = None
    if expiration_str:
        try:
            expiration = datetime.fromisoformat(expiration_str).date()
        except:
            pass
    
    # Extract strike from symbol if not provided
    strike = None
    match = re.search(r'(\d{8})$', symbol.replace(' ', ''))
    if match:
        strike = Decimal(match.group(1)) / Decimal(1000)
    
    # Calculate quantity (long - short)
    quantity = Decimal(str(schwab_position.get("longQuantity", 0.0))) - Decimal(str(schwab_position.get("shortQuantity", 0.0)))
    
    market_value = Decimal(str(schwab_position.get("marketValue", 0.0)))
    average_price = Decimal(str(schwab_position.get("averagePrice", 0.0)))
    
    # Cost basis calculation
    cost_basis = abs(quantity) * average_price * Decimal(100)
    unrealized_pnl = market_value - cost_basis if quantity < 0 else market_value + cost_basis
    
    return {
        "symbol": symbol,
        "underlying": underlying,
        "asset_type": "option",
        "option_type": put_call,
        "strike": float(strike) if strike else None,
        "expiration": expiration,
        "quantity": float(quantity),
        "cost_basis": float(cost_basis),
        "current_value": float(market_value),
        "unrealized_pnl": float(unrealized_pnl),
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
    
    cost_basis = quantity * average_price
    unrealized_pnl = market_value - cost_basis
    
    return {
        "symbol": symbol,
        "underlying": symbol,
        "asset_type": "stock",
        "option_type": None,
        "strike": None,
        "expiration": None,
        "quantity": float(quantity),
        "cost_basis": float(cost_basis),
        "current_value": float(market_value),
        "unrealized_pnl": float(unrealized_pnl),
        "account_hash": account_info["hash_value"],
        "account_number": mask_account_number(account_info["account_number"]),
        "account_type": account_info["account_type"]
    }


def group_positions_by_strategy(positions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Group individual positions into strategies (covered calls, spreads, etc.)
    
    This analyzes positions for the same underlying and attempts to detect
    known strategy patterns like covered calls, spreads, etc.
    """
    # Group by underlying symbol
    by_underlying = {}
    for pos in positions:
        underlying = pos["underlying"]
        if underlying not in by_underlying:
            by_underlying[underlying] = []
        by_underlying[underlying].append(pos)
    
    result_positions = []
    
    for underlying, group in by_underlying.items():
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
                            exp_options.remove(opt)
                            break
            
            # Try to detect put spread
            puts = [o for o in exp_options if o["option_type"] == "put"]
            if len(puts) == 2:
                sorted_puts = sorted(puts, key=lambda x: x["strike"], reverse=True)
                if sorted_puts[0]["quantity"] < 0 and sorted_puts[1]["quantity"] > 0:
                    detected_strategies.append({
                        "strategy_type": "put_spread",
                        "legs": sorted_puts,
                        "underlying": underlying
                    })
                    for p in sorted_puts:
                        if p in remaining_options:
                            remaining_options.remove(p)
            
            # Try to detect call spread
            calls = [o for o in exp_options if o["option_type"] == "call"]
            if len(calls) == 2:
                sorted_calls = sorted(calls, key=lambda x: x["strike"])
                if sorted_calls[0]["quantity"] < 0 and sorted_calls[1]["quantity"] > 0:
                    detected_strategies.append({
                        "strategy_type": "call_spread",
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
            result_positions.append({
                "strategy_type": "dividend" if stock["quantity"] > 0 else "short_stock",
                "legs": [stock],
                "underlying": underlying
            })
        
        for opt in remaining_options:
            result_positions.append({
                "strategy_type": "big_option",
                "legs": [opt],
                "underlying": underlying
            })
    
    return result_positions


def mask_account_number(account_number: Optional[str]) -> Optional[str]:
    """Mask account number for display (show only last 4 digits)"""
    if not account_number:
        return None
    if len(account_number) <= 4:
        return account_number
    return "****" + account_number[-4:]

