"""Position API endpoints"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models.user import User
from app.models import position as models
from app.schemas.position import (
    PositionCreate,
    PositionUpdate,
    PositionResponse,
    PositionListResponse,
    PositionShareCreate,
    SyncRequest,
    SyncResponse
)
from app.schemas.comment import (
    CommentCreate,
    CommentResponse,
    CommentListResponse
)
from app.services import position_service

router = APIRouter(prefix="/positions", tags=["positions"])


@router.get("/actual", response_model=PositionListResponse)
def get_actual_positions(
    status: Optional[str] = Query(None),
    account_id: Optional[str] = Query(None),
    symbol: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """
    Get all actual (Schwab-synced) positions for current user
    
    Query parameters:
    - status: Filter by status (active, closed)
    - account_id: Filter by Schwab account ID
    - symbol: Filter by symbol
    - skip: Pagination offset
    - limit: Pagination limit
    """
    # TODO: Use real user_id when auth is enabled
    test_user_id = "00000000-0000-0000-0000-000000000001"
    
    positions = position_service.get_positions(
        db,
        user_id=test_user_id,
        flavor="actual",
        status=status,
        skip=skip,
        limit=limit
    )
    
    # Apply additional filters
    if account_id:
        positions = [p for p in positions if p.account_id == account_id]
    
    if symbol:
        positions = [p for p in positions if p.symbol.upper() == symbol.upper()]
    
    # Fetch accounts for this user
    from app.models.user import UserSchwabAccount
    accounts = db.query(UserSchwabAccount).filter(
        UserSchwabAccount.user_id == test_user_id
    ).all()
    
    return PositionListResponse(
        total=len(positions),
        positions=positions,
        accounts=[{
            "account_number": acc.account_number,
            "account_type": acc.account_type,
            "account_hash": acc.account_hash,
            "cash_balance": acc.cash_balance,
            "liquidation_value": acc.liquidation_value,
            "buying_power": acc.buying_power,
            "buying_power_options": acc.buying_power_options
        } for acc in accounts]
    )


@router.post("/sync", response_model=SyncResponse)
def sync_positions(
    sync_request: SyncRequest,
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """
    Trigger sync from Schwab API
    
    Body:
    - account_ids: Optional list of specific account IDs to sync
    """
    try:
        # TODO: Use real user_id when auth is enabled
        # For now, use a test user ID
        test_user_id = "00000000-0000-0000-0000-000000000001"
        
        synced_positions = position_service.sync_schwab_positions(
            db,
            user_id=test_user_id,
            account_ids=sync_request.account_ids
        )
        
        return SyncResponse(
            success=True,
            message=f"Successfully synced {len(synced_positions)} positions",
            synced_count=len(synced_positions),
            positions=synced_positions
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Sync failed: {str(e)}"
        )


@router.get("/ideas", response_model=PositionListResponse)
def get_trade_ideas(
    status: Optional[str] = Query(None),
    symbol: Optional[str] = Query(None),
    strategy_type: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """
    Get all trade ideas for current user
    
    Query parameters:
    - status: Filter by status (planned, watching, executed, etc.)
    - symbol: Filter by symbol
    - strategy_type: Filter by strategy type
    - skip: Pagination offset
    - limit: Pagination limit
    """
    # TODO: Use real user_id when auth is enabled
    test_user_id = "00000000-0000-0000-0000-000000000001"
    
    positions = position_service.get_positions(
        db,
        user_id=test_user_id,
        flavor="idea",
        status=status,
        skip=skip,
        limit=limit
    )
    
    # Apply additional filters
    if symbol:
        positions = [p for p in positions if p.symbol.upper() == symbol.upper()]
    
    if strategy_type:
        positions = [p for p in positions if p.strategy_type == strategy_type]
    
    # Add shared_with list to each position
    for position in positions:
        shares = db.query(models.PositionShare).filter(
            models.PositionShare.position_id == position.id,
            models.PositionShare.is_active == True
        ).all()
        position.shared_with = [share.recipient_id for share in shares]
    
    return PositionListResponse(
        total=len(positions),
        positions=positions
    )


@router.post("/ideas", response_model=PositionResponse, status_code=status.HTTP_201_CREATED)
def create_trade_idea(
    position: PositionCreate,
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """
    Create a new trade idea
    
    Body: PositionCreate schema with position details and legs
    """
    # TODO: Use real user_id when auth is enabled
    test_user_id = "00000000-0000-0000-0000-000000000001"
    
    try:
        created_position = position_service.create_trade_idea(
            db,
            position_data=position,
            user_id=test_user_id
        )
        return created_position
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create trade idea: {str(e)}"
        )


@router.get("/ideas/{position_id}", response_model=PositionResponse)
def get_trade_idea(
    position_id: UUID,
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """Get a specific trade idea by ID"""
    # TODO: Use real user_id when auth is enabled
    test_user_id = "00000000-0000-0000-0000-000000000001"
    
    position = position_service.get_position_by_id(db, position_id, test_user_id)
    
    if not position or position.flavor != "idea":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade idea not found"
        )
    
    # Add shared_with list
    shares = db.query(models.PositionShare).filter(
        models.PositionShare.position_id == position.id,
        models.PositionShare.is_active == True
    ).all()
    position.shared_with = [share.recipient_id for share in shares]
    
    return position


@router.put("/ideas/{position_id}", response_model=PositionResponse)
def update_trade_idea(
    position_id: UUID,
    position_update: PositionUpdate,
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """Update a trade idea"""
    # TODO: Use real user_id when auth is enabled
    test_user_id = "00000000-0000-0000-0000-000000000001"
    
    updated_position = position_service.update_position(
        db,
        position_id=position_id,
        user_id=test_user_id,
        update_data=position_update
    )
    
    if not updated_position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade idea not found or cannot be updated"
        )
    
    return updated_position


@router.delete("/ideas/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trade_idea(
    position_id: UUID,
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """Delete a trade idea"""
    # TODO: Use real user_id when auth is enabled
    test_user_id = "00000000-0000-0000-0000-000000000001"
    
    success = position_service.delete_position(db, position_id, test_user_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade idea not found or cannot be deleted"
        )
    
    return None


@router.post("/ideas/{position_id}/share", status_code=status.HTTP_200_OK)
def share_trade_idea(
    position_id: UUID,
    share_request: PositionShareCreate,
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """
    Share a trade idea with friends
    
    Body:
    - friend_ids: List of friend user IDs to share with
    - access_level: Access level (view, comment)
    """
    # TODO: Use real user_id when auth is enabled
    test_user_id = "00000000-0000-0000-0000-000000000001"
    
    try:
        # Convert friend_ids to UUIDs if they're strings
        friend_uuids = []
        for friend_id in share_request.friend_ids:
            try:
                if isinstance(friend_id, str):
                    friend_uuids.append(UUID(friend_id))
                else:
                    friend_uuids.append(friend_id)
            except ValueError as ve:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid friend ID format: {friend_id}"
                )
        
        shares = position_service.share_position(
            db,
            position_id=position_id,
            user_id=test_user_id,
            friend_ids=friend_uuids
        )
        
        return {
            "success": True,
            "message": f"Position shared with {len(shares)} friends",
            "share_count": len(shares)
        }
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        import traceback
        print(f"Share error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to share position: {str(e)}"
        )


@router.get("/shared", response_model=PositionListResponse)
def get_shared_positions(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """
    Get all positions shared with current user
    
    Query parameters:
    - skip: Pagination offset
    - limit: Pagination limit
    """
    # TODO: Use real user_id when auth is enabled
    test_user_id = "00000000-0000-0000-0000-000000000001"
    
    # Get positions where user is a recipient of a share
    from app.models.position import PositionShare
    
    shares = db.query(PositionShare).filter(
        PositionShare.recipient_id == test_user_id,
        PositionShare.is_active == True
    ).all()
    
    position_ids = [share.position_id for share in shares]
    
    from app.models.position import Position
    positions = db.query(Position).filter(Position.id.in_(position_ids)).all()
    
    return PositionListResponse(
        total=len(positions),
        positions=positions
    )


@router.post("/actual/{position_id}/convert-to-idea", response_model=PositionResponse, status_code=status.HTTP_201_CREATED)
def convert_actual_to_trade_idea(
    position_id: UUID,
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """
    Convert an actual (Schwab) position to a trade idea for collaboration
    
    This creates a new trade idea based on the actual position's details,
    allowing users to share and collaborate on trading strategies based on real positions.
    """
    try:
        # TODO: Use real user_id when auth is enabled
        test_user_id = "00000000-0000-0000-0000-000000000001"
        
        trade_idea = position_service.convert_actual_to_trade_idea(
            db,
            position_id=position_id,
            user_id=test_user_id
        )
        
        return trade_idea
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to convert position: {str(e)}"
        )


@router.get("/{position_id}", response_model=PositionResponse)
def get_position(
    position_id: UUID,
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """Get any position by ID (actual, idea, or shared)"""
    # TODO: Use real user_id when auth is enabled
    test_user_id = "00000000-0000-0000-0000-000000000001"
    
    position = position_service.get_position_by_id(db, position_id, test_user_id)
    
    if not position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position not found"
        )
    
    return position


@router.get("/{position_id}/comments", response_model=CommentListResponse)
def get_position_comments(
    position_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """Get all comments for a position"""
    from app.models.comment import Comment
    
    # Verify position exists
    test_user_id = "00000000-0000-0000-0000-000000000001"
    position = position_service.get_position_by_id(db, position_id, test_user_id)
    
    if not position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position not found"
        )
    
    # Get comments with user info
    comments = db.query(Comment).filter(
        Comment.position_id == position_id
    ).order_by(Comment.created_at.asc()).offset(skip).limit(limit).all()
    
    # Attach user info to each comment
    for comment in comments:
        if comment.user:
            comment.user.display_name = comment.user.full_name or comment.user.username
    
    total = db.query(Comment).filter(Comment.position_id == position_id).count()
    
    return CommentListResponse(
        total=total,
        comments=comments
    )


@router.post("/{position_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def create_position_comment(
    position_id: UUID,
    comment_data: CommentCreate,
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """Add a comment to a position"""
    from app.models.comment import Comment
    
    # TODO: Use real user_id when auth is enabled
    test_user_id = "00000000-0000-0000-0000-000000000001"
    
    # Verify position exists
    position = position_service.get_position_by_id(db, position_id, test_user_id)
    
    if not position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position not found"
        )
    
    # Create comment
    comment = Comment(
        position_id=position_id,
        user_id=test_user_id,
        text=comment_data.text
    )
    
    db.add(comment)
    db.commit()
    db.refresh(comment)
    
    # Attach user info
    if comment.user:
        comment.user.display_name = comment.user.full_name or comment.user.username
    
    return comment

