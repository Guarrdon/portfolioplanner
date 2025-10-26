"""
Mock Schwab API data generator for development

This module generates realistic mock data that simulates Schwab API responses.
Used when USE_MOCK_SCHWAB_DATA=true in environment variables.
"""
from datetime import datetime, date, timedelta
from decimal import Decimal
from typing import List, Dict, Any
import random


def generate_mock_accounts() -> List[Dict[str, str]]:
    """Generate mock Schwab account data"""
    return [
        {
            "accountNumber": "12345678",
            "hashValue": "E5B3F89A2C1D4E6F7A8B9C0D"
        },
        {
            "accountNumber": "87654321",
            "hashValue": "F9C2A8D5E4B6F1A3C7E9D2B4"
        }
    ]


def generate_mock_covered_call(underlying: str = "AAPL") -> List[Dict[str, Any]]:
    """Generate a covered call position (stock + short call)"""
    stock_price = Decimal(random.uniform(150, 200))
    call_strike = float(stock_price * Decimal("1.05"))  # 5% OTM
    expiration = date.today() + timedelta(days=random.randint(20, 45))
    
    return [
        {
            "instrument": {
                "assetType": "EQUITY",
                "symbol": underlying
            },
            "longQuantity": 100.0,
            "shortQuantity": 0.0,
            "averagePrice": float(stock_price * Decimal("0.98")),
            "marketValue": float(stock_price * 100)
        },
        {
            "instrument": {
                "assetType": "OPTION",
                "symbol": f"{underlying}  {expiration.strftime('%y%m%d')}C{int(call_strike * 1000):08d}",
                "underlyingSymbol": underlying,
                "putCall": "CALL",
                "optionExpirationDate": expiration.isoformat(),
                "optionMultiplier": 100.0
            },
            "longQuantity": 0.0,
            "shortQuantity": 1.0,
            "averagePrice": 2.50,
            "marketValue": -250.00
        }
    ]


def generate_mock_put_spread(underlying: str = "SPY") -> List[Dict[str, Any]]:
    """Generate a bull put spread (short put + long put at lower strike)"""
    underlying_price = Decimal(random.uniform(550, 600))
    short_strike = float(underlying_price * Decimal("0.95"))  # 5% OTM
    long_strike = short_strike - 5  # $5 wide
    expiration = date.today() + timedelta(days=random.randint(15, 30))
    quantity = random.choice([5, 10, 15, 20])
    
    return [
        {
            "instrument": {
                "assetType": "OPTION",
                "symbol": f"{underlying}   {expiration.strftime('%y%m%d')}P{int(short_strike * 1000):08d}",
                "underlyingSymbol": underlying,
                "putCall": "PUT",
                "optionExpirationDate": expiration.isoformat(),
                "optionMultiplier": 100.0
            },
            "longQuantity": 0.0,
            "shortQuantity": float(quantity),
            "averagePrice": 3.50,
            "marketValue": float(-3.50 * quantity * 100)
        },
        {
            "instrument": {
                "assetType": "OPTION",
                "symbol": f"{underlying}   {expiration.strftime('%y%m%d')}P{int(long_strike * 1000):08d}",
                "underlyingSymbol": underlying,
                "putCall": "PUT",
                "optionExpirationDate": expiration.isoformat(),
                "optionMultiplier": 100.0
            },
            "longQuantity": float(quantity),
            "shortQuantity": 0.0,
            "averagePrice": 2.20,
            "marketValue": float(2.20 * quantity * 100)
        }
    ]


def generate_mock_call_spread(underlying: str = "QQQ") -> List[Dict[str, Any]]:
    """Generate a bear call spread (short call + long call at higher strike)"""
    underlying_price = Decimal(random.uniform(450, 500))
    short_strike = float(underlying_price * Decimal("1.05"))  # 5% OTM
    long_strike = short_strike + 5  # $5 wide
    expiration = date.today() + timedelta(days=random.randint(15, 30))
    quantity = random.choice([5, 10, 15])
    
    return [
        {
            "instrument": {
                "assetType": "OPTION",
                "symbol": f"{underlying}   {expiration.strftime('%y%m%d')}C{int(short_strike * 1000):08d}",
                "underlyingSymbol": underlying,
                "putCall": "CALL",
                "optionExpirationDate": expiration.isoformat(),
                "optionMultiplier": 100.0
            },
            "longQuantity": 0.0,
            "shortQuantity": float(quantity),
            "averagePrice": 2.80,
            "marketValue": float(-2.80 * quantity * 100)
        },
        {
            "instrument": {
                "assetType": "OPTION",
                "symbol": f"{underlying}   {expiration.strftime('%y%m%d')}C{int(long_strike * 1000):08d}",
                "underlyingSymbol": underlying,
                "putCall": "CALL",
                "optionExpirationDate": expiration.isoformat(),
                "optionMultiplier": 100.0
            },
            "longQuantity": float(quantity),
            "shortQuantity": 0.0,
            "averagePrice": 1.50,
            "marketValue": float(1.50 * quantity * 100)
        }
    ]


def generate_mock_long_put(underlying: str = "TSLA") -> List[Dict[str, Any]]:
    """Generate a long put position"""
    underlying_price = Decimal(random.uniform(200, 300))
    strike = float(underlying_price * Decimal("0.95"))  # 5% OTM
    expiration = date.today() + timedelta(days=random.randint(30, 60))
    quantity = random.choice([1, 2, 3, 5])
    
    return [
        {
            "instrument": {
                "assetType": "OPTION",
                "symbol": f"{underlying}  {expiration.strftime('%y%m%d')}P{int(strike * 1000):08d}",
                "underlyingSymbol": underlying,
                "putCall": "PUT",
                "optionExpirationDate": expiration.isoformat(),
                "optionMultiplier": 100.0
            },
            "longQuantity": float(quantity),
            "shortQuantity": 0.0,
            "averagePrice": 8.50,
            "marketValue": float(8.50 * quantity * 100)
        }
    ]


def generate_mock_dividend_stock(symbol: str = "T") -> List[Dict[str, Any]]:
    """Generate a dividend stock position"""
    stock_price = Decimal(random.uniform(15, 25))
    quantity = random.randint(200, 500)
    
    return [
        {
            "instrument": {
                "assetType": "EQUITY",
                "symbol": symbol
            },
            "longQuantity": float(quantity),
            "shortQuantity": 0.0,
            "averagePrice": float(stock_price * Decimal("0.97")),
            "marketValue": float(stock_price * quantity)
        }
    ]


def generate_mock_positions(account_hash: str) -> Dict[str, Any]:
    """Generate comprehensive mock position data for an account"""
    
    # Build a consistent set of positions for testing
    positions = []
    
    # ALWAYS include covered calls (with both stock and option legs)
    positions.extend(generate_mock_covered_call("AAPL"))
    positions.extend(generate_mock_covered_call("MSFT"))
    
    # Add put spreads
    positions.extend(generate_mock_put_spread("SPY"))
    if random.random() > 0.6:
        positions.extend(generate_mock_put_spread("IWM"))
    
    # Add call spreads
    if random.random() > 0.5:
        positions.extend(generate_mock_call_spread("QQQ"))
    
    # Add some naked puts/calls
    if random.random() > 0.5:
        positions.extend(generate_mock_long_put("TSLA"))
    
    # Add dividend stocks (standalone shares)
    if random.random() > 0.4:
        positions.extend(generate_mock_dividend_stock("T"))
    if random.random() > 0.6:
        positions.extend(generate_mock_dividend_stock("VZ"))
    
    # Calculate total account value
    total_value = sum(pos.get("marketValue", 0) for pos in positions)
    
    return {
        "securitiesAccount": {
            "accountNumber": account_hash[:8],
            "type": random.choice(["MARGIN", "CASH", "IRA"]),
            "currentBalances": {
                "liquidationValue": float(total_value + random.uniform(10000, 50000)),
                "equity": float(total_value + random.uniform(10000, 50000)),
                "cashBalance": float(random.uniform(5000, 20000))
            },
            "positions": positions
        }
    }


class MockSchwabClient:
    """
    Mock Schwab API client that simulates schwab-py library responses
    """
    
    def __init__(self):
        self.accounts = generate_mock_accounts()
    
    def get_account_numbers(self):
        """Mock get_account_numbers API call"""
        return MockResponse(200, self.accounts)
    
    def get_account(self, account_hash: str, fields=None):
        """Mock get_account API call"""
        account_data = generate_mock_positions(account_hash)
        return MockResponse(200, account_data)


class MockResponse:
    """Mock HTTP response object"""
    
    def __init__(self, status_code: int, data: Any):
        self.status_code = status_code
        self._data = data
    
    def json(self):
        """Return response data as JSON"""
        return self._data


# Convenience function to get mock client
def get_mock_schwab_client():
    """Get a mock Schwab API client for testing"""
    return MockSchwabClient()

