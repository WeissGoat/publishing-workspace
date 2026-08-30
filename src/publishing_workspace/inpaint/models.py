from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class InpaintCandidate(BaseModel):
    candidate_id: str
    filename: str
    preview_url: str
    seed: int
    width: int
    height: int
    size_bytes: int


class InpaintGenerateRequest(BaseModel):
    mask_base64: str
    prompt: str | None = None
    negative_prompt: str | None = None
    strength: float = 0.7
    count: int = 2


class InpaintSessionResult(BaseModel):
    session_id: str
    asset_id: str
    candidates: list[InpaintCandidate]
    prompt: str
    negative_prompt: str
    strength: float
    model: str


class ApplyCandidateRequest(BaseModel):
    session_id: str
    candidate_id: str
