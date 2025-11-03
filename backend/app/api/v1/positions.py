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
from app.services.websocket_manager import (
    broadcast_position_update,
    broadcast_comment_added,
    broadcast_position_shared,
    broadcast_share_revoked
)
from app.services.collaboration_client import get_collaboration_client
from app.core.config import settings

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


@router.patch("/actual/{position_id}/strategy", response_model=PositionResponse)
def update_position_strategy(
    position_id: UUID,
    strategy_type: str = Query(..., description="New strategy type"),
    user_id: Optional[str] = Query(None, description="User ID (for testing without auth)"),
    db: Session = Depends(get_db)
):
    """
    Manually update the strategy type for a position.
    
    Allows users to override automatic strategy detection and assign
    positions to their preferred strategy categories.
    """
    # TODO: Use real user_id when auth is enabled
    test_user_id = user_id or "00000000-0000-0000-0000-000000000001"
    
    position = db.query(models.Position).filter(
        models.Position.id == position_id,
        models.Position.user_id == test_user_id,
        models.Position.flavor == "actual"
    ).first()
    
    if not position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position not found"
        )
    
    # Update strategy type
    old_strategy = position.strategy_type
    position.strategy_type = strategy_type
    db.commit()
    db.refresh(position)
    
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Manual strategy update: {position.symbol} | {old_strategy} → {strategy_type}")
    
    return position


@router.get("/ideas/{position_id}/public", response_model=PositionResponse)
def get_position_public(
    position_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get a single position by ID without authentication.
    
    This endpoint is used by remote backends to fetch shared positions.
    In production, this should be secured with some form of share token or API key.
    """
    position = db.query(models.Position).filter(
        models.Position.id == position_id,
        models.Position.flavor == "idea"  # Only allow fetching ideas
    ).first()
    
    if not position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position not found or not shareable"
        )
    
    # Add shared_with list
    shares = db.query(models.PositionShare).filter(
        models.PositionShare.position_id == position.id,
        models.PositionShare.is_active == True
    ).all()
    position.shared_with = [str(share.recipient_id) for share in shares]
    
    return position


@router.get("/ideas", response_model=PositionListResponse)
def get_trade_ideas(
    status: Optional[str] = Query(None),
    symbol: Optional[str] = Query(None),
    strategy_type: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    user_id: Optional[str] = Query(None, description="User ID (for testing without auth)"),
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
    - user_id: User ID (temporary for testing without auth)
    """
    # TODO: Use real user_id when auth is enabled
    test_user_id = user_id or "00000000-0000-0000-0000-000000000001"
    
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
    user_id: Optional[str] = Query(None, description="User ID (for testing without auth)"),
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """
    Create a new trade idea
    
    Body: PositionCreate schema with position details and legs
    """
    # TODO: Use real user_id when auth is enabled
    test_user_id = user_id or "00000000-0000-0000-0000-000000000001"
    
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
    user_id: Optional[str] = Query(None, description="User ID (for testing without auth)"),
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """Get a specific trade idea by ID"""
    # TODO: Use real user_id when auth is enabled
    test_user_id = user_id or "00000000-0000-0000-0000-000000000001"
    
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
async def update_trade_idea(
    position_id: UUID,
    position_update: PositionUpdate,
    user_id: Optional[str] = Query(None, description="User ID (for testing without auth)"),
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """Update a trade idea"""
    # TODO: Use real user_id when auth is enabled
    test_user_id = user_id or "00000000-0000-0000-0000-000000000001"
    
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
    
    # Add shared_with list
    shares = db.query(models.PositionShare).filter(
        models.PositionShare.position_id == updated_position.id,
        models.PositionShare.is_active == True
    ).all()
    updated_position.shared_with = [share.recipient_id for share in shares]
    
    # Broadcast update to all connected clients who have access
    await broadcast_position_update(
        position_id=str(position_id),
        position_data={
            "id": str(updated_position.id),
            "symbol": updated_position.symbol,
            "tags": updated_position.tags,
            "status": updated_position.status,
            "notes": updated_position.notes,
            "updated_at": updated_position.updated_at.isoformat() if updated_position.updated_at else None
        },
        owner_id=test_user_id,
        shared_with=updated_position.shared_with
    )
    
    return updated_position


@router.patch("/ideas/{position_id}/tags", response_model=PositionResponse)
async def update_trade_idea_tags(
    position_id: UUID,
    tags: List[str],
    user_id: Optional[str] = Query(None, description="User ID (for testing without auth)"),
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """
    Update tags on a trade idea
    
    Allows both owners AND recipients to add/remove tags
    """
    # TODO: Use real user_id when auth is enabled
    test_user_id = user_id or "00000000-0000-0000-0000-000000000001"
    
    updated_position = position_service.update_position_tags(
        db,
        position_id=position_id,
        user_id=test_user_id,
        tags=tags
    )
    
    if not updated_position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade idea not found or you don't have access to update tags"
        )
    
    # Add shared_with list
    shares = db.query(models.PositionShare).filter(
        models.PositionShare.position_id == updated_position.id,
        models.PositionShare.is_active == True
    ).all()
    updated_position.shared_with = [share.recipient_id for share in shares]
    
    # Broadcast update to all connected clients who have access
    await broadcast_position_update(
        position_id=str(position_id),
        position_data={
            "id": str(updated_position.id),
            "symbol": updated_position.symbol,
            "tags": updated_position.tags,
            "status": updated_position.status,
        },
        owner_id=test_user_id,
        shared_with=updated_position.shared_with
    )
    
    return updated_position


@router.delete("/ideas/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trade_idea(
    position_id: UUID,
    user_id: Optional[str] = Query(None, description="User ID (for testing without auth)"),
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """Delete a trade idea (only owner can delete)"""
    # TODO: Use real user_id when auth is enabled
    test_user_id = user_id or "00000000-0000-0000-0000-000000000001"
    
    success = position_service.delete_position(db, position_id, test_user_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade idea not found or cannot be deleted (you may not be the owner)"
        )
    
    return None


@router.delete("/ideas/{position_id}/unshare", status_code=status.HTTP_204_NO_CONTENT)
async def unshare_from_me(
    position_id: UUID,
    user_id: Optional[str] = Query(None, description="User ID (for testing without auth)"),
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """
    Remove a shared position from your view (recipient removing themselves from share)
    
    DELETE /api/v1/positions/ideas/{position_id}/unshare
    """
    # TODO: Use real user_id when auth is enabled
    current_user_id = user_id or "00000000-0000-0000-0000-000000000001"
    
    # Find the share where current user is the recipient
    from app.models.position import PositionShare
    share = db.query(PositionShare).filter(
        PositionShare.position_id == position_id,
        PositionShare.recipient_id == current_user_id,
        PositionShare.is_active == True
    ).first()
    
    if not share:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This position is not shared with you"
        )
    
    # Deactivate the share
    share.is_active = False
    db.commit()
    
    # Broadcast to WebSocket
    from app.services.websocket_manager import manager
    await manager.broadcast_to_user(
        current_user_id,
        {
            "event": "share_revoked",
            "data": {
                "position_id": str(position_id),
                "message": "Position removed from your view"
            }
        }
    )
    
    return None


@router.post("/ideas/{position_id}/share", status_code=status.HTTP_200_OK)
async def share_trade_idea(
    position_id: UUID,
    share_request: PositionShareCreate,
    user_id: Optional[str] = Query(None, description="User ID (for testing without auth)"),
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """
    Share a trade idea with friends
    
    Body:
    - friend_ids: List of friend user IDs to share with (empty array to unshare all)
    - access_level: Access level (view, comment)
    """
    # TODO: Use real user_id when auth is enabled
    test_user_id = user_id or "00000000-0000-0000-0000-000000000001"
    
    try:
        # Get existing shares before update
        existing_shares = db.query(models.PositionShare).filter(
            models.PositionShare.position_id == position_id,
            models.PositionShare.is_active == True
        ).all()
        existing_recipient_ids = set(str(share.recipient_id) for share in existing_shares)
        
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
        
        new_recipient_ids = set(str(share.recipient_id) for share in shares)
        
        # Determine who got new access and who lost access
        added_recipients = new_recipient_ids - existing_recipient_ids
        removed_recipients = existing_recipient_ids - new_recipient_ids
        
        # Broadcast to newly added recipients (local WebSocket)
        if added_recipients:
            await broadcast_position_shared(
                position_id=str(position_id),
                recipient_ids=list(added_recipients),
                owner_id=test_user_id
            )
            
            # Also send via collaboration service for distributed instances
            if settings.ENABLE_COLLABORATION:
                collab_client = get_collaboration_client()
                if collab_client and collab_client.is_connected():
                    # Fetch full position data to share
                    position = db.query(models.Position).filter(
                        models.Position.id == position_id
                    ).first()
                    
                    if position:
                        # Build share URL for recipients to fetch from
                        share_url = f"{settings.BACKEND_URL}/api/v1/positions/ideas/{position_id}"
                        
                        await collab_client.send_event(
                            event_type='position_shared',
                            to_users=list(added_recipients),
                            data={
                                'position_id': str(position_id),
                                'share_url': share_url,
                                'shared_at': position.created_at.isoformat() if position.created_at else None
                            }
                        )
        
        # Broadcast to removed recipients (local WebSocket)
        if removed_recipients:
            await broadcast_share_revoked(
                position_id=str(position_id),
                recipient_ids=list(removed_recipients)
            )
            
            # Also send via collaboration service
            if settings.ENABLE_COLLABORATION:
                collab_client = get_collaboration_client()
                if collab_client and collab_client.is_connected():
                    await collab_client.send_event(
                        event_type='share_revoked',
                        to_users=list(removed_recipients),
                        data={
                            'position_id': str(position_id)
                        }
                    )
        
        return {
            "success": True,
            "message": f"Position shared with {len(shares)} friends" if len(shares) > 0 else "All shares removed",
            "share_count": len(shares),
            "shared_with": [str(share.recipient_id) for share in shares]
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
    user_id: Optional[str] = Query(None, description="User ID (for testing without auth)"),
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """
    Get all positions shared with current user
    
    Query parameters:
    - skip: Pagination offset
    - limit: Pagination limit
    - user_id: User ID (temporary for testing without auth)
    """
    # TODO: Use real user_id when auth is enabled
    # For now, accept user_id from query param, default to User 1
    test_user_id = user_id or "00000000-0000-0000-0000-000000000001"
    
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
        
        # Initialize empty shared_with list for new trade idea
        trade_idea.shared_with = []
        
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
    from app.models.position import Position
    
    # Verify position exists (without ownership check - comments visible to all with access)
    position = db.query(Position).filter(Position.id == position_id).first()
    
    if not position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position not found"
        )
    
    # Get comments with user info (eager load user relationship) - LATEST FIRST
    from sqlalchemy.orm import joinedload
    comments = db.query(Comment).options(
        joinedload(Comment.user)
    ).filter(
        Comment.position_id == position_id
    ).order_by(Comment.created_at.desc()).offset(skip).limit(limit).all()
    
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
async def create_position_comment(
    position_id: UUID,
    comment_data: CommentCreate,
    db: Session = Depends(get_db)
    # TODO: Re-enable auth when frontend login is implemented
    # current_user: User = Depends(get_current_active_user)
):
    """Add a comment to a position"""
    from app.models.comment import Comment
    from app.models.position import Position
    
    # TODO: Use real user_id when auth is enabled
    test_user_id = "00000000-0000-0000-0000-000000000001"
    
    # Verify position exists (without ownership check)
    position = db.query(Position).filter(Position.id == position_id).first()
    
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
    
    # Eager load user relationship
    from sqlalchemy.orm import joinedload
    comment = db.query(Comment).options(
        joinedload(Comment.user)
    ).filter(Comment.id == comment.id).first()
    
    # Attach user info
    if comment.user:
        comment.user.display_name = comment.user.full_name or comment.user.username
    
    # Get shared_with list for broadcasting
    shares = db.query(models.PositionShare).filter(
        models.PositionShare.position_id == position_id,
        models.PositionShare.is_active == True
    ).all()
    shared_with = [str(share.recipient_id) for share in shares]
    
    # Broadcast new comment to all users with access (local WebSocket)
    comment_payload = {
        "id": str(comment.id),
        "text": comment.text,
        "user": {
            "id": str(comment.user_id),
            "display_name": comment.user.display_name if comment.user else "User"
        },
        "created_at": comment.created_at.isoformat() if comment.created_at else None
    }
    
    await broadcast_comment_added(
        position_id=str(position_id),
        comment_data=comment_payload,
        owner_id=str(position.user_id),
        shared_with=shared_with
    )
    
    # Also send via collaboration service for distributed instances
    if settings.ENABLE_COLLABORATION:
        collab_client = get_collaboration_client()
        if collab_client and collab_client.is_connected():
            # Send to owner (if different from commenter) + all shared users
            recipients = [str(position.user_id)]
            recipients.extend([uid for uid in shared_with if uid != str(position.user_id)])
            # Remove the commenter from recipients (they already see it)
            recipients = [uid for uid in recipients if uid != test_user_id]
            
            if recipients:
                await collab_client.send_event(
                    event_type='comment_added',
                    to_users=recipients,
                    data={
                        'position_id': str(position_id),
                        'comment': comment_payload
                    }
                )
    
    return comment

