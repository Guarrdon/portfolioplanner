"""
Strategy Types - Centralized definition of all valid strategy types

This module defines all valid strategy types that can be used in the system,
including both auto-detected strategies and user-defined custom strategies.
"""

# Auto-detected strategy types (assigned by grouping logic)
AUTO_DETECTED_STRATEGIES = [
    "covered_call",      # Long stock + short calls
    "vertical_spread",   # Long/short options at different strikes
    "box_spread",        # 4-leg spread (bull call + bear put)
    "long_stock",        # Simple long equity position
    "short_stock",       # Simple short equity position
    "big_option",        # Large option position (>=10 contracts or $5k+)
    "single_option",     # Small single option position
]

# User-defined custom strategy types
CUSTOM_STRATEGIES = [
    "unallocated",       # Catch-all for positions not assigned to any strategy
    "wheel_strategy",    # User-defined: wheel trading strategy
    "iron_condor",       # User-defined: 4-leg strategy
    "iron_butterfly",    # User-defined: 4-leg strategy
    "calendar_spread",   # User-defined: same strike, different expirations
    "diagonal_spread",   # User-defined: different strikes and expirations
    "straddle",          # User-defined: same strike call + put
    "strangle",          # User-defined: different strike call + put
    "collar",            # User-defined: protective put + covered call
    "protective_put",    # User-defined: long stock + long put
    "cash_secured_put",  # User-defined: short put with cash reserve
    "custom",            # User-defined: generic custom strategy
]

# All valid strategy types
ALL_STRATEGY_TYPES = AUTO_DETECTED_STRATEGIES + CUSTOM_STRATEGIES

# Strategy labels for display
STRATEGY_LABELS = {
    "covered_call": "Covered Call",
    "vertical_spread": "Vertical Spread",
    "box_spread": "Box Spread",
    "long_stock": "Long Stock",
    "short_stock": "Short Stock",
    "big_option": "Big Option",
    "single_option": "Single Option",
    "unallocated": "Unallocated",
    "wheel_strategy": "Wheel Strategy",
    "iron_condor": "Iron Condor",
    "iron_butterfly": "Iron Butterfly",
    "calendar_spread": "Calendar Spread",
    "diagonal_spread": "Diagonal Spread",
    "straddle": "Straddle",
    "strangle": "Strangle",
    "collar": "Collar",
    "protective_put": "Protective Put",
    "cash_secured_put": "Cash Secured Put",
    "custom": "Custom Strategy",
}

def is_valid_strategy(strategy_type: str) -> bool:
    """Check if a strategy type is valid"""
    return strategy_type in ALL_STRATEGY_TYPES

def is_auto_detected(strategy_type: str) -> bool:
    """Check if a strategy type is auto-detected (vs custom)"""
    return strategy_type in AUTO_DETECTED_STRATEGIES

def get_strategy_label(strategy_type: str) -> str:
    """Get display label for a strategy type"""
    return STRATEGY_LABELS.get(strategy_type, strategy_type.replace("_", " ").title())

