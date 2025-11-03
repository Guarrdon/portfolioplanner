"""
Regenerate all position signatures with the new stable algorithm

Run this after updating the signature algorithm to ensure all existing
signatures are regenerated with the new logic.
"""
import sys
sys.path.insert(0, '/Users/mlyons/Development/Guarrdon/portfolioplanner/backend')

from app.core.database import engine
from app.models.position import Position
from app.services.position_signature import generate_position_signature_from_db_legs
from sqlalchemy.orm import Session

def regenerate_signatures(db_path: str):
    """Regenerate signatures for all positions in a database"""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    
    engine = create_engine(f"sqlite:///{db_path}")
    
    with Session(engine) as db:
        # Find all actual positions with signatures
        positions = db.query(Position).filter(
            Position.flavor == "actual"
        ).all()
        
        print(f"\n{'='*60}")
        print(f"Database: {db_path}")
        print(f"{'='*60}")
        print(f"Found {len(positions)} actual positions")
        
        regenerated = 0
        for pos in positions:
            if pos.legs:
                old_sig = pos.schwab_position_signature
                new_sig = generate_position_signature_from_db_legs(pos, pos.legs)
                
                if old_sig != new_sig:
                    print(f"  {pos.symbol} ({pos.strategy_type}):")
                    print(f"    Old: {old_sig[:20] if old_sig else 'None'}...")
                    print(f"    New: {new_sig[:20]}...")
                    pos.schwab_position_signature = new_sig
                    regenerated += 1
        
        db.commit()
        print(f"\n✅ Regenerated {regenerated} signatures")
        print(f"✅ {len(positions) - regenerated} signatures unchanged")

if __name__ == "__main__":
    import os
    
    backend_dir = "/Users/mlyons/Development/Guarrdon/portfolioplanner/backend"
    
    databases = [
        os.path.join(backend_dir, "portfolio.db"),
        os.path.join(backend_dir, "portfolio_user_a.db"),
        os.path.join(backend_dir, "portfolio_user_b.db"),
    ]
    
    print("\n" + "="*60)
    print("Position Signature Regeneration")
    print("="*60)
    print("\nThis will regenerate all position signatures using the new")
    print("stable algorithm (structural data only, no prices/quantities)")
    print("")
    
    for db_path in databases:
        if os.path.exists(db_path):
            regenerate_signatures(db_path)
        else:
            print(f"\nSkipping {os.path.basename(db_path)} (not found)")
    
    print("\n" + "="*60)
    print("✅ All signatures regenerated!")
    print("="*60)
    print("\nYou can now test locking positions to 'unallocated'")
    print("and they should persist across syncs.")
    print("")

