import json
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal, get_db
from app.models.chat import ChatMessage, Conversation
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.chat import (
    ChatMessageIn,
    ChatMessageOut,
    ChatReply,
    ConversationCreate,
    ConversationDetail,
    ConversationOut,
    ConversationRename,
    OllamaStatus,
)

router = APIRouter(prefix="/api/chat", tags=["chat"])

OLLAMA_CHAT_URL = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
OLLAMA_TAGS_URL = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/tags"
MAX_HISTORY_MESSAGES = 20


def _get_conversation(db: Session, conversation_id: int, user: User) -> Conversation:
    conversation = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.user_id == user.id)
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


def _system_prompt(role: str, language: str | None) -> str:
    lang = language or "en"
    return (
        "You are AgriSave AI, a helpful agricultural assistant for farmers, FPOs "
        "(Farmer Producer Organizations), and agri-marketers in India. "
        f"The current user's role is '{role}'. "
        "Give clear, practical and concise answers using simple language. "
        "For recommendations, mention safety and the need to verify locally. "
        "Never invent government scheme details, mandi prices or weather data. "
        "If you are unsure, say so and suggest an official source. "
        f"Reply in the language with ISO code '{lang}' unless the user asks for another language."
    )


def _history(db: Session, conversation: Conversation) -> list[ChatMessage]:
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conversation.id)
        .order_by(ChatMessage.id.desc())
        .limit(MAX_HISTORY_MESSAGES)
        .all()
    )
    return list(reversed(rows))


def _ollama_messages(
    history: list[ChatMessage], role: str, language: str | None, content: str
) -> list[dict]:
    messages = [{"role": "system", "content": _system_prompt(role, language)}]
    for msg in history:
        if msg.role in ("user", "assistant"):
            messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": content})
    return messages


def _save_user_message(db: Session, conversation: Conversation, content: str) -> ChatMessage:
    message = ChatMessage(conversation_id=conversation.id, role="user", content=content)
    if not conversation.title or conversation.title == "New chat":
        title = " ".join(content.split())
        conversation.title = (title[:60] or "New chat")
    conversation.updated_at = datetime.utcnow()
    db.add(message)
    db.commit()
    db.refresh(message)
    db.refresh(conversation)
    return message


def _conversation_dict(conversation: Conversation) -> dict:
    return ConversationOut.model_validate(conversation).model_dump(mode="json")


def _message_dict(message: ChatMessage) -> dict:
    return ChatMessageOut.model_validate(message).model_dump(mode="json")


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.get("/status", response_model=OllamaStatus)
async def ollama_status(_user: User = Depends(get_current_user)):
    models: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(3.0, connect=2.0)) as client:
            resp = await client.get(OLLAMA_TAGS_URL)
            resp.raise_for_status()
            models = [m.get("name", "") for m in resp.json().get("models", []) if m.get("name")]
    except Exception:
        return OllamaStatus(
            available=False,
            model=settings.OLLAMA_MODEL,
            models=[],
            detail="Ollama is not reachable. Start Ollama and try again.",
        )

    available = settings.OLLAMA_MODEL in models
    detail = None
    if not available:
        detail = (
            f"Model '{settings.OLLAMA_MODEL}' is not installed. "
            f"Run: ollama pull {settings.OLLAMA_MODEL}"
        )
    return OllamaStatus(
        available=available,
        model=settings.OLLAMA_MODEL,
        models=models,
        detail=detail,
    )


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return (
        db.query(Conversation)
        .filter(Conversation.user_id == user.id)
        .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
        .all()
    )


@router.post("/conversations", response_model=ConversationOut, status_code=201)
def create_conversation(
    data: ConversationCreate | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    title = (data.title if data and data.title else "New chat").strip() or "New chat"
    conversation = Conversation(user_id=user.id, title=title)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _get_conversation(db, conversation_id, user)


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
def rename_conversation(
    conversation_id: int,
    data: ConversationRename,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conversation = _get_conversation(db, conversation_id, user)
    conversation.title = data.title.strip()
    conversation.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(conversation)
    return conversation


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conversation = _get_conversation(db, conversation_id, user)
    db.delete(conversation)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/conversations/{conversation_id}/messages", response_model=ChatReply)
async def send_message(
    conversation_id: int,
    data: ChatMessageIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conversation = _get_conversation(db, conversation_id, user)
    content = data.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    history = _history(db, conversation)
    user_message = _save_user_message(db, conversation, content)
    messages = _ollama_messages(history, user.role, data.language, content)

    payload = {
        "model": settings.OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.7},
    }
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(settings.OLLAMA_TIMEOUT_SECONDS, connect=5.0)
        ) as client:
            response = await client.post(OLLAMA_CHAT_URL, json=payload)
    except httpx.HTTPError:
        raise HTTPException(
            status_code=503,
            detail="Ollama is not reachable. Make sure it is running on the configured URL.",
        )

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Ollama returned an error")

    reply_text = (response.json().get("message") or {}).get("content", "").strip()
    if not reply_text:
        raise HTTPException(status_code=502, detail="Ollama returned an empty reply")

    assistant_message = ChatMessage(
        conversation_id=conversation.id, role="assistant", content=reply_text
    )
    conversation.updated_at = datetime.utcnow()
    db.add(assistant_message)
    db.commit()
    db.refresh(assistant_message)
    db.refresh(conversation)

    return ChatReply(
        conversation=conversation,
        user_message=user_message,
        assistant_message=assistant_message,
    )


@router.post("/conversations/{conversation_id}/messages/stream")
async def stream_message(
    conversation_id: int,
    data: ChatMessageIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conversation = _get_conversation(db, conversation_id, user)
    content = data.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    history = _history(db, conversation)
    user_message = _save_user_message(db, conversation, content)
    user_message_payload = _message_dict(user_message)
    conversation_payload = _conversation_dict(conversation)
    messages = _ollama_messages(history, user.role, data.language, content)

    async def event_stream():
        parts: list[str] = []
        error_detail: str | None = None
        yield _sse(
            "start",
            {"user_message": user_message_payload, "conversation": conversation_payload},
        )

        payload = {
            "model": settings.OLLAMA_MODEL,
            "messages": messages,
            "stream": True,
            "options": {"temperature": 0.7},
        }
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(settings.OLLAMA_TIMEOUT_SECONDS, connect=5.0)
            ) as client:
                async with client.stream("POST", OLLAMA_CHAT_URL, json=payload) as response:
                    if response.status_code != 200:
                        error_detail = "Ollama returned an error"
                    else:
                        async for line in response.aiter_lines():
                            if not line.strip():
                                continue
                            try:
                                chunk = json.loads(line)
                            except json.JSONDecodeError:
                                continue
                            delta = (chunk.get("message") or {}).get("content") or ""
                            if delta:
                                parts.append(delta)
                                yield _sse("delta", {"content": delta})
                            if chunk.get("done"):
                                break
        except httpx.HTTPError:
            error_detail = "Ollama is not reachable. Make sure it is running."

        reply_text = "".join(parts).strip()
        if not reply_text:
            yield _sse(
                "error",
                {"detail": error_detail or "Ollama returned an empty reply"},
            )
            return

        stream_db = SessionLocal()
        try:
            saved_conversation = (
                stream_db.query(Conversation)
                .filter(
                    Conversation.id == conversation_id,
                    Conversation.user_id == user.id,
                )
                .first()
            )
            if not saved_conversation:
                yield _sse("error", {"detail": "Conversation no longer exists"})
                return
            assistant_message = ChatMessage(
                conversation_id=conversation_id, role="assistant", content=reply_text
            )
            saved_conversation.updated_at = datetime.utcnow()
            stream_db.add(assistant_message)
            stream_db.commit()
            stream_db.refresh(assistant_message)
            stream_db.refresh(saved_conversation)
            payload_out = {
                "assistant_message": _message_dict(assistant_message),
                "conversation": _conversation_dict(saved_conversation),
            }
            if error_detail:
                payload_out["warning"] = error_detail
            yield _sse("done", payload_out)
        finally:
            stream_db.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
