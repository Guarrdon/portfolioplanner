"""
Position signature generation for matching Schwab positions across syncs

This module creates unique signatures for positions based on their legs' characteristics
to enable reliable matching even when there are multiple positions of the same symbol.
"""
import hashlib
from typing import List, Dict, Any
from decimal import Decimal


def generate_position_signature(legs: List[Dict[str, Any]], symbol: str, account_hash: str) -> str:
    """
    Generate a unique signature for a position based on its legs
    
    This allows distinguishing between multiple positions of the same symbol
    (e.g., two different SPY positions entered at different prices/dates).
    
    Args:
        legs: List of position leg dictionaries
        symbol: Underlying symbol
        account_hash: Schwab account hash
        
    Returns:
        64-character hex string signature
        
    Example:
        For SPY covered call: [100 shares @ $450, -2 calls @ $5]
        Signature captures: SPY + account + leg details
        Different entry prices → different signatures
    """
    if not legs:
        return ""
    
    # Sort legs by (asset_type, symbol, strike, expiration) for consistency
    sorted_legs = sorted(legs, key=lambda leg: (
        leg.get('asset_type', ''),
        leg.get('symbol', ''),
        str(leg.get('strike', '')),
        str(leg.get('expiration', ''))
    ))
    
    # Build signature components
    signature_parts = [
        f"symbol:{symbol}",
        f"account:{account_hash}",
    ]
    
    for leg in sorted_legs:
        # Include key leg characteristics
        # NOTE: We intentionally do NOT include quantity or average_price because those
        # change constantly with market fluctuations. We want a STABLE signature that
        # identifies the position STRUCTURE, not its current values.
        leg_signature = f"leg:{leg.get('asset_type')}:{leg.get('symbol')}:"
        
        if leg.get('asset_type') == 'option':
            leg_signature += f"{leg.get('option_type')}:{leg.get('strike')}:{leg.get('expiration')}"
        else:
            # For stocks, include a quantity RANGE to differentiate lot sizes
            # but not exact quantity (which changes with fractional shares, etc.)
            quantity = abs(float(leg.get('quantity', 0)))
            # Group into ranges: tiny (<10), small (10-99), medium (100-999), large (1000+)
            if quantity < 10:
                qty_range = "tiny"
            elif quantity < 100:
                qty_range = "small"
            elif quantity < 1000:
                qty_range = "medium"
            else:
                qty_range = "large"
            leg_signature += f"qty_range:{qty_range}"
        
        signature_parts.append(leg_signature)
    
    # Create hash
    signature_string = "|".join(signature_parts)
    return hashlib.sha256(signature_string.encode()).hexdigest()


def generate_position_signature_from_db_legs(position, legs) -> str:
    """
    Generate signature from database Position and PositionLeg objects
    
    Args:
        position: Position SQLAlchemy model instance
        legs: List of PositionLeg SQLAlchemy model instances
        
    Returns:
        64-character hex string signature
    """
    leg_dicts = []
    for leg in legs:
        leg_dict = {
            'asset_type': leg.asset_type,
            'symbol': leg.symbol,
            'quantity': float(leg.quantity) if leg.quantity else 0,
            'average_price': float(leg.premium) if leg.premium else 0,  # premium is average_price for legs
        }
        
        if leg.asset_type == 'option':
            leg_dict['option_type'] = leg.option_type
            leg_dict['strike'] = float(leg.strike) if leg.strike else 0
            leg_dict['expiration'] = leg.expiration
        
        leg_dicts.append(leg_dict)
    
    return generate_position_signature(
        legs=leg_dicts,
        symbol=position.underlying,
        account_hash=position.account_id
    )


def signatures_match(sig1: str, sig2: str) -> bool:
    """
    Check if two signatures match
    
    Args:
        sig1: First signature
        sig2: Second signature
        
    Returns:
        True if signatures match or if both are empty/None
    """
    if not sig1 or not sig2:
        return False
    return sig1 == sig2


def explain_signature(signature: str, legs: List[Dict[str, Any]], symbol: str) -> str:
    """
    Generate human-readable explanation of what the signature represents
    
    Useful for debugging and logging
    
    Args:
        signature: Position signature
        legs: Position legs
        symbol: Underlying symbol
        
    Returns:
        Human-readable description
    """
    leg_descriptions = []
    for leg in legs:
        if leg.get('asset_type') == 'stock':
            leg_descriptions.append(f"{leg.get('quantity'):.0f} shares @ ${leg.get('average_price'):.2f}")
        elif leg.get('asset_type') == 'option':
            leg_descriptions.append(
                f"{leg.get('quantity'):.0f} {leg.get('option_type')} "
                f"${leg.get('strike'):.0f} exp {leg.get('expiration')}"
            )
    
    return f"{symbol} [{', '.join(leg_descriptions)}] → {signature[:12]}..."

