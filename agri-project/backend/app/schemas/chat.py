from datetime import datetime

from pydantic import BaseModel, Field


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=120)


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class ConversationOut(BaseModel):
    id: int
    title: str
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class ChatMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    language: str | None = Field(default="en", max_length=10)


class ChatMessageOut(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class ConversationDetail(ConversationOut):
    messages: list[ChatMessageOut] = []


class ChatReply(BaseModel):
    conversation: ConversationOut
    user_message: ChatMessageOut
    assistant_message: ChatMessageOut


class OllamaStatus(BaseModel):
    available: bool
    model: str
    models: list[str] = []
    detail: str | None = None
