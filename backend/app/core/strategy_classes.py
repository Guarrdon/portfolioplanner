"""
Strategy classes - the user-facing strategy taxonomy used for Group classification.

This is a *separate axis* from `strategy_types.py`. That module defines
auto-detected position-level strategy types (covered_call, vertical_spread,
etc.) inferred from leg shape. This module defines user-assigned Group-level
*classes* — the strategy areas the user actually thinks in terms of when
evaluating their portfolio: long stock, covered calls, dividends, etc.

A Group (Tag) carries a strategy_class; positions belong to Groups; the UI
renders strategy-specific KPI screens based on the class.
"""

# The 11 strategy classes the user works in.
STRATEGY_CLASSES = [
    "long_stock",
    "covered_calls",
    "dividends",
    "verticals",
    "single_leg",
    "big_options",
    "box_spreads",
    "cash_mgmt",
    "earnings",
    "hedge",
    "futures",
]

STRATEGY_CLASS_LABELS = {
    "long_stock": "Long Stock",
    "covered_calls": "Covered Calls",
    "dividends": "Dividends",
    "verticals": "Verticals",
    "single_leg": "Single-leg",
    "big_options": "Big Options",
    "box_spreads": "Box Spreads",
    "cash_mgmt": "Cash Management",
    "earnings": "Earnings",
    "hedge": "Hedge",
    "futures": "Futures",
}


def is_valid_strategy_class(value) -> bool:
    """True for any of the 11 keys, or None (unclassified)."""
    if value is None:
        return True
    return value in STRATEGY_CLASSES


def normalize_strategy_classes(values) -> list:
    """Validate, dedupe, and normalize a list of strategy class keys.

    None or empty input → []. Raises ValueError on any unknown key. Order is
    preserved (first occurrence wins).
    """
    if values is None:
        return []
    if not isinstance(values, (list, tuple)):
        raise ValueError("strategy_classes must be a list")
    seen = set()
    out = []
    for v in values:
        if v is None or v == "":
            continue
        if v not in STRATEGY_CLASSES:
            raise ValueError(f"invalid strategy_class: {v}")
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out
