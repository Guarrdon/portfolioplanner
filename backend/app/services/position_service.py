"""
Position service for business logic

Handles CRUD operations for positions and syncing with Schwab API.
"""
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from datetime import datetime

from app.models.position import Position, PositionLeg, PositionShare
from app.models.user import UserSchwabAccount
from app.schemas.position import PositionCreate, PositionUpdate
from app.services.schwab_service import fetch_account_data, group_positions_by_strategy


def get_positions(
    db: Session,
    user_id: UUID,
    flavor: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100
) -> List[Position]:
    """
    Get positions for a user with optional filtering
    
    Args:
        db: Database session
        user_id: User ID
        flavor: Optional filter by position flavor (actual, idea, shared)
        status: Optional filter by status (active, closed, etc.)
        skip: Pagination offset
        limit: Pagination limit
        
    Returns:
        List of positions
    """
    query = db.query(Position).filter(Position.user_id == user_id)
    
    if flavor:
        query = query.filter(Position.flavor == flavor)
    
    if status:
        query = query.filter(Position.status == status)
    
    query = query.order_by(Position.created_at.desc())
    
    return query.offset(skip).limit(limit).all()


def get_position_by_id(db: Session, position_id: UUID, user_id: UUID) -> Optional[Position]:
    """
    Get a specific position by ID
    
    Verifies that position belongs to user or is shared with user
    """
    position = db.query(Position).filter(Position.id == position_id).first()
    
    if not position:
        return None
    
    # Check if user owns the position
    if position.user_id == user_id:
        return position
    
    # Check if position is shared with user
    share = db.query(PositionShare).filter(
        PositionShare.position_id == position_id,
        PositionShare.recipient_id == user_id,
        PositionShare.is_active == True
    ).first()
    
    if share:
        return position
    
    return None


def create_trade_idea(db: Session, position_data: PositionCreate, user_id: UUID) -> Position:
    """
    Create a new trade idea position
    
    Args:
        db: Database session
        position_data: Position creation data
        user_id: User creating the position
        
    Returns:
        Created position
    """
    # Extract legs data
    legs_data = position_data.legs
    position_dict = position_data.model_dump(exclude={'legs'})
    
    # Create position
    position = Position(
        **position_dict,
        user_id=user_id,
        flavor="idea",
        read_only=False,
        status="planned"
    )
    
    db.add(position)
    db.flush()  # Get position ID
    
    # Create legs
    for leg_data in legs_data:
        leg = PositionLeg(
            **leg_data.model_dump(),
            position_id=position.id
        )
        db.add(leg)
    
    db.commit()
    db.refresh(position)
    
    return position


def update_position(
    db: Session,
    position_id: UUID,
    user_id: UUID,
    update_data: PositionUpdate
) -> Optional[Position]:
    """
    Update a position
    
    Only allows updates to trade ideas owned by the user
    """
    position = db.query(Position).filter(
        Position.id == position_id,
        Position.user_id == user_id,
        Position.flavor == "idea"
    ).first()
    
    if not position:
        return None
    
    # Update fields
    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(position, key, value)
    
    position.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(position)
    
    return position


def delete_position(db: Session, position_id: UUID, user_id: UUID) -> bool:
    """
    Delete a position
    
    Only allows deletion of trade ideas owned by the user
    """
    position = db.query(Position).filter(
        Position.id == position_id,
        Position.user_id == user_id,
        Position.flavor == "idea"
    ).first()
    
    if not position:
        return False
    
    db.delete(position)
    db.commit()
    
    return True


def sync_schwab_positions(
    db: Session,
    user_id: UUID,
    account_ids: Optional[List[str]] = None
) -> List[Position]:
    """
    Sync positions from Schwab API
    
    Args:
        db: Database session
        user_id: User ID
        account_ids: Optional specific account IDs to sync
        
    Returns:
        List of synced positions
    """
    # Fetch data from Schwab
    schwab_data = fetch_account_data(user_id, db, account_ids)
    
    # Group positions into strategies
    grouped_positions = group_positions_by_strategy(schwab_data["positions"])
    
    # Update account sync timestamps
    for account in schwab_data["accounts"]:
        db_account = db.query(UserSchwabAccount).filter(
            UserSchwabAccount.user_id == user_id,
            UserSchwabAccount.account_hash == account["hash_value"]
        ).first()
        
        if not db_account:
            # Create account if doesn't exist
            db_account = UserSchwabAccount(
                user_id=user_id,
                account_hash=account["hash_value"],
                account_number=account["account_number"],
                account_type=account["account_type"]
            )
            db.add(db_account)
        
        db_account.last_synced = datetime.utcnow()
    
    # Mark existing actual positions as stale
    existing_positions = db.query(Position).filter(
        Position.user_id == user_id,
        Position.flavor == "actual"
    ).all()
    
    existing_by_key = {
        (p.symbol, p.account_id, p.strategy_type): p
        for p in existing_positions
    }
    
    # Process synced positions
    synced_positions = []
    
    for grouped_pos in grouped_positions:
        strategy_type = grouped_pos["strategy_type"]
        underlying = grouped_pos["underlying"]
        legs = grouped_pos["legs"]
        
        if not legs:
            continue
        
        # Use first leg's account info
        first_leg = legs[0]
        account_hash = first_leg["account_hash"]
        account_number = first_leg["account_number"]
        
        # Calculate aggregate values
        total_cost = sum(leg.get("cost_basis", 0) for leg in legs)
        total_value = sum(leg.get("current_value", 0) for leg in legs)
        total_pnl = sum(leg.get("unrealized_pnl", 0) for leg in legs)
        total_quantity = sum(abs(leg.get("quantity", 0)) for leg in legs)
        
        # Determine earliest entry date from legs
        entry_date = None
        for leg in legs:
            if leg.get("expiration"):
                entry_date = datetime.now().date()
                break
        
        # Check if position already exists
        position_key = (underlying, account_hash, strategy_type)
        existing_pos = existing_by_key.get(position_key)
        
        if existing_pos:
            # Update existing position
            existing_pos.quantity = total_quantity
            existing_pos.cost_basis = total_cost
            existing_pos.current_value = total_value
            existing_pos.unrealized_pnl = total_pnl
            existing_pos.last_synced = datetime.utcnow()
            existing_pos.status = "active"
            
            # Update legs (delete old, create new)
            for leg in existing_pos.legs:
                db.delete(leg)
            
            for leg_data in legs:
                leg = PositionLeg(
                    position_id=existing_pos.id,
                    symbol=leg_data.get("symbol"),
                    asset_type=leg_data.get("asset_type"),
                    option_type=leg_data.get("option_type"),
                    strike=leg_data.get("strike"),
                    expiration=leg_data.get("expiration"),
                    quantity=leg_data.get("quantity"),
                    premium=leg_data.get("cost_basis", 0) / 100 if leg_data.get("quantity") else 0,
                    current_price=leg_data.get("current_value", 0) / abs(leg_data.get("quantity", 1)) / 100 if leg_data.get("quantity") else 0
                )
                db.add(leg)
            
            synced_positions.append(existing_pos)
            del existing_by_key[position_key]
        
        else:
            # Create new position
            position = Position(
                user_id=user_id,
                flavor="actual",
                account_id=account_hash,
                account_number=account_number,
                symbol=underlying,
                underlying=underlying,
                strategy_type=strategy_type,
                status="active",
                quantity=total_quantity,
                cost_basis=total_cost,
                current_value=total_value,
                unrealized_pnl=total_pnl,
                entry_date=entry_date,
                last_synced=datetime.utcnow(),
                read_only=True
            )
            
            db.add(position)
            db.flush()
            
            # Create legs
            for leg_data in legs:
                leg = PositionLeg(
                    position_id=position.id,
                    symbol=leg_data.get("symbol"),
                    asset_type=leg_data.get("asset_type"),
                    option_type=leg_data.get("option_type"),
                    strike=leg_data.get("strike"),
                    expiration=leg_data.get("expiration"),
                    quantity=leg_data.get("quantity"),
                    premium=leg_data.get("cost_basis", 0) / 100 if leg_data.get("quantity") else 0,
                    current_price=leg_data.get("current_value", 0) / abs(leg_data.get("quantity", 1)) / 100 if leg_data.get("quantity") else 0
                )
                db.add(leg)
            
            synced_positions.append(position)
    
    # Mark positions that no longer exist as closed
    for remaining_pos in existing_by_key.values():
        remaining_pos.status = "closed"
        remaining_pos.exit_date = datetime.now().date()
    
    db.commit()
    
    # Refresh all synced positions
    for pos in synced_positions:
        db.refresh(pos)
    
    return synced_positions


def share_position(
    db: Session,
    position_id: UUID,
    user_id: UUID,
    friend_ids: List[UUID]
) -> List[PositionShare]:
    """
    Share a trade idea with friends
    
    Args:
        db: Database session
        position_id: Position to share
        user_id: Owner of the position
        friend_ids: List of friend user IDs to share with
        
    Returns:
        List of created shares
    """
    # Verify position exists and is a trade idea owned by user
    position = db.query(Position).filter(
        Position.id == position_id,
        Position.user_id == user_id,
        Position.flavor == "idea"
    ).first()
    
    if not position:
        raise ValueError("Position not found or cannot be shared")
    
    shares = []
    
    for friend_id in friend_ids:
        # Check if already shared
        existing_share = db.query(PositionShare).filter(
            PositionShare.position_id == position_id,
            PositionShare.recipient_id == friend_id
        ).first()
        
        if existing_share:
            existing_share.is_active = True
            shares.append(existing_share)
        else:
            share = PositionShare(
                position_id=position_id,
                owner_id=user_id,
                recipient_id=friend_id,
                access_level="comment"
            )
            db.add(share)
            shares.append(share)
    
    db.commit()
    
    return shares

