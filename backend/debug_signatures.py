"""Debug script to check signature matching"""
import sys
sys.path.insert(0, '/Users/mlyons/Development/Guarrdon/portfolioplanner/backend')

from app.core.database import engine
from app.models.position import Position
from app.services.position_signature import generate_position_signature_from_db_legs, generate_position_signature
from sqlalchemy.orm import Session

with Session(engine) as db:
    # Find a closed unallocated position
    closed_unalloc = db.query(Position).filter(
        Position.strategy_type == "unallocated",
        Position.status == "closed",
        Position.is_manual_strategy == True
    ).first()
    
    if closed_unalloc:
        print(f"=== Closed Unallocated Position ===")
        print(f"Symbol: {closed_unalloc.symbol}")
        print(f"Stored signature: {closed_unalloc.schwab_position_signature}")
        print(f"Legs: {len(closed_unalloc.legs)}")
        for leg in closed_unalloc.legs:
            print(f"  - {leg.asset_type}: symbol={leg.symbol}, qty={leg.quantity}, premium={leg.premium}")
            if leg.asset_type == 'option':
                print(f"    option_type={leg.option_type}, strike={leg.strike}, exp={leg.expiration}")
        
        # Regenerate from DB
        new_sig = generate_position_signature_from_db_legs(closed_unalloc, closed_unalloc.legs)
        print(f"\nRegenerated signature: {new_sig}")
        print(f"Match: {new_sig == closed_unalloc.schwab_position_signature}")
        
        # Now check against active positions with same symbol
        print(f"\n=== Active {closed_unalloc.symbol} Positions ===")
        active = db.query(Position).filter(
            Position.symbol == closed_unalloc.symbol,
            Position.status == "active"
        ).all()
        
        for pos in active:
            print(f"\nStrategy: {pos.strategy_type}, Locked: {pos.is_manual_strategy}")
            print(f"Signature: {pos.schwab_position_signature}")
            print(f"Match with closed: {pos.schwab_position_signature == closed_unalloc.schwab_position_signature}")
            print(f"Legs: {len(pos.legs)}")
            for leg in pos.legs:
                print(f"  - {leg.asset_type}: symbol={leg.symbol}, qty={leg.quantity}, premium={leg.premium}")
                if leg.asset_type == 'option':
                    print(f"    option_type={leg.option_type}, strike={leg.strike}, exp={leg.expiration}")
    else:
        print("No closed unallocated positions found")

