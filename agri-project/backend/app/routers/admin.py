from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import metrics
from app.core.database import get_db
from app.models.chat import ChatMessage, Conversation
from app.models.metrics import ApiRequestStat
from app.models.user import User, VALID_ROLES
from app.routers.auth import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Charts are bucketed in India time, like the rest of the app.
IST = timezone(timedelta(hours=5, minutes=30))
RANGES = {"24h": (24, "hour"), "7d": (7, "day"), "30d": (30, "day")}


def _as_utc(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)


def _buckets(range_key: str) -> tuple[list[datetime], str, datetime]:
    """Bucket starts (IST, aware) for the range, the unit, and the UTC range start."""
    count, unit = RANGES[range_key]
    now = datetime.now(IST)
    if unit == "hour":
        last = now.replace(minute=0, second=0, microsecond=0)
        starts = [last - timedelta(hours=count - 1 - i) for i in range(count)]
    else:
        last = now.replace(hour=0, minute=0, second=0, microsecond=0)
        starts = [last - timedelta(days=count - 1 - i) for i in range(count)]
    return starts, unit, starts[0].astimezone(timezone.utc)


def _bucket_index(moment: datetime, starts: list[datetime], unit: str) -> int | None:
    local = _as_utc(moment).astimezone(IST)
    key = local.replace(minute=0, second=0, microsecond=0)
    if unit == "day":
        key = key.replace(hour=0)
    try:
        return starts.index(key)
    except ValueError:
        return None


@router.get("/overview")
def overview(
    range_key: str = Query("7d", alias="range"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Admin dashboard: users, AI assistant usage and API request monitoring."""
    if range_key not in RANGES:
        raise HTTPException(status_code=400, detail=f"range must be one of: {', '.join(RANGES)}")
    starts, unit, since_utc = _buckets(range_key)
    size = len(starts)

    # ---- Users ----
    role_counts = dict(db.query(User.role, func.count(User.id)).group_by(User.role).all())
    signups = [0] * size
    for (created_at,) in db.query(User.created_at).filter(User.created_at >= since_utc).all():
        index = _bucket_index(created_at, starts, unit)
        if index is not None:
            signups[index] += 1

    # ---- AI assistant ----
    questions = [0] * size
    active_users: set[int] = set()
    rows = (
        db.query(ChatMessage.created_at, Conversation.user_id)
        .join(Conversation, ChatMessage.conversation_id == Conversation.id)
        .filter(ChatMessage.role == "user", ChatMessage.created_at >= since_utc)
        .all()
    )
    for created_at, user_id in rows:
        index = _bucket_index(created_at, starts, unit)
        if index is not None:
            questions[index] += 1
            active_users.add(user_id)
    replies = (
        db.query(func.count(ChatMessage.id))
        .filter(ChatMessage.role == "assistant", ChatMessage.created_at >= since_utc)
        .scalar()
    )
    conversations = db.query(func.count(Conversation.id)).filter(Conversation.created_at >= since_utc).scalar()

    # ---- API requests (stored hourly in UTC + not-yet-flushed counts) ----
    requests = [0] * size
    client_errors = [0] * size
    server_errors = [0] * size
    total_ms = 0.0
    hourly = {
        stat.hour_start: [stat.requests, stat.client_errors, stat.server_errors, stat.total_ms]
        for stat in db.query(ApiRequestStat).filter(ApiRequestStat.hour_start >= since_utc.replace(tzinfo=None) - timedelta(hours=1))
    }
    for bucket, values in metrics.pending_snapshot().items():
        row = hourly.setdefault(bucket, [0, 0, 0, 0.0])
        for i, value in enumerate(values):
            row[i] += value
    for bucket, (count, client, server, ms) in hourly.items():
        index = _bucket_index(bucket, starts, unit)
        if index is None:
            continue
        requests[index] += int(count)
        client_errors[index] += int(client)
        server_errors[index] += int(server)
        total_ms += ms
    total_requests = sum(requests)

    return {
        "range": range_key,
        "unit": unit,
        "buckets": [start.isoformat() for start in starts],
        "users": {
            "total": sum(role_counts.values()),
            "by_role": {role: role_counts.get(role, 0) for role in VALID_ROLES if role_counts.get(role)},
            "new_in_range": sum(signups),
            "signups": signups,
        },
        "ai": {
            "questions": questions,
            "total_questions": sum(questions),
            "replies": replies or 0,
            "conversations": conversations or 0,
            "active_users": len(active_users),
        },
        "requests": {
            "requests": requests,
            "server_errors": server_errors,
            "client_errors": client_errors,
            "total": total_requests,
            "total_server_errors": sum(server_errors),
            "total_client_errors": sum(client_errors),
            "avg_ms": round(total_ms / total_requests, 1) if total_requests else None,
        },
    }
