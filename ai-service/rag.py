"""Retrieval-augmented generation with RBAC enforced inside the vector search."""

import json
from dataclasses import dataclass
from typing import Iterator, Literal

from pydantic import BaseModel, Field

from config import settings
from database import get_connection
from embeddings import embed_query, stream_chat

REFUSAL = "I do not have authorized access to documents containing that information."

SYSTEM_PROMPT = f"""You are an enterprise knowledge and compliance assistant.

Rules you must follow without exception:
1. Answer ONLY from the context excerpts provided below. Never use outside knowledge.
2. After every claim, cite its source in the form [Document Title, Page X], using the titles and page numbers given with the excerpts.
3. If the excerpts do not contain the answer, reply with exactly this sentence and nothing else: "{REFUSAL}"
4. Never mention documents, departments, or clearance levels that are not in the excerpts, and never speculate about what other documents might contain.
5. Be concise and factual."""


class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class QueryRequest(BaseModel):
    """Scope fields come from Laravel, which derives them from the authenticated user.

    `history` holds earlier turns of the user's own conversation (Laravel has
    already removed answers the user may no longer see). It only shapes the
    wording of the answer; retrieval is still filtered by the scope fields.
    """

    prompt: str = Field(min_length=1, max_length=4000)
    organization_id: int
    department_id: int
    clearance_level: int = Field(ge=1, le=4)
    is_admin: bool = False
    history: list[HistoryTurn] = Field(default_factory=list, max_length=12)


MAX_HISTORY_TURNS = 6
MAX_HISTORY_CHARS = 4000


def trimmed_history(request: QueryRequest) -> list[HistoryTurn]:
    """The last few turns, newest kept first when the character budget runs out."""
    kept: list[HistoryTurn] = []
    budget = MAX_HISTORY_CHARS
    for turn in reversed(request.history[-MAX_HISTORY_TURNS:]):
        if len(turn.content) > budget:
            break
        budget -= len(turn.content)
        kept.append(turn)
    return list(reversed(kept))


def retrieval_text(request: QueryRequest) -> str:
    """What gets embedded for the search: the question, plus the previous user
    question when there is one, so a follow-up such as "what about under
    RM 500?" still finds the right policy. Assistant turns are never embedded."""
    previous = next((turn.content for turn in reversed(request.history) if turn.role == "user"), None)
    return f"{previous}\n{request.prompt}" if previous else request.prompt


@dataclass(frozen=True)
class Chunk:
    document_id: int
    document_title: str
    page_number: int
    content: str
    similarity: float


def build_search_query(request: QueryRequest, embedding: list[float], limit: int) -> tuple[str, tuple]:
    """Build the similarity search. The RBAC filter is part of the WHERE clause,
    so rows outside the user's scope are never read, ranked, or returned.

    Every value is a bound parameter; nothing is interpolated into the SQL.
    """
    if request.is_admin:
        # Admins see every department, but only inside their own organization.
        where = "organization_id = %s AND clearance_level <= %s"
        scope: tuple = (request.organization_id, request.clearance_level)
    else:
        where = "organization_id = %s AND department_id = %s AND clearance_level <= %s"
        scope = (request.organization_id, request.department_id, request.clearance_level)

    sql = f"""
        SELECT document_id, document_title, page_number, content,
               1 - (embedding <=> %s::vector) AS similarity
        FROM document_chunks
        WHERE {where}
        ORDER BY embedding <=> %s::vector
        LIMIT %s
    """
    return sql, (embedding, *scope, embedding, limit)


def retrieve(request: QueryRequest) -> list[Chunk]:
    embedding = embed_query(retrieval_text(request))
    sql, params = build_search_query(request, embedding, settings.top_k)

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        chunks = [Chunk(*row) for row in cur.fetchall()]

    return [chunk for chunk in chunks if chunk.similarity >= settings.min_similarity]


def build_messages(prompt: str, chunks: list[Chunk], history: list[HistoryTurn] | None = None) -> list[dict[str, str]]:
    context = "\n\n".join(
        f"[{chunk.document_title}, Page {chunk.page_number}]\n{chunk.content}" for chunk in chunks
    )
    earlier = [{"role": turn.role, "content": turn.content} for turn in history or []]
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        *earlier,
        {"role": "user", "content": f"Context excerpts:\n\n{context}\n\nQuestion: {prompt}"},
    ]


def unique_sources(chunks: list[Chunk]) -> list[dict]:
    seen: set[tuple[int, int]] = set()
    sources = []
    for chunk in chunks:
        key = (chunk.document_id, chunk.page_number)
        if key not in seen:
            seen.add(key)
            sources.append(
                {
                    "document_id": chunk.document_id,
                    "document_title": chunk.document_title,
                    "page_number": chunk.page_number,
                }
            )
    return sources


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def answer_stream(request: QueryRequest) -> Iterator[str]:
    """Yield Server-Sent Events: `token` events, then one `sources` event, then `done`.

    On failure a single `error` event is sent instead, with no internal details.
    """
    try:
        chunks = retrieve(request)

        if not chunks:
            # Nothing in the user's scope is relevant enough: refuse without calling the model.
            yield sse("token", {"text": REFUSAL})
            yield sse("sources", {"sources": []})
            yield sse("done", {})
            return

        answer = ""
        for text in stream_chat(build_messages(request.prompt, chunks, trimmed_history(request))):
            answer += text
            yield sse("token", {"text": text})

        # A refusal cites nothing, even though excerpts were retrieved.
        refused = "do not have authorized access" in answer.lower()
        yield sse("sources", {"sources": [] if refused else unique_sources(chunks)})
        yield sse("done", {})
    except Exception as error:  # noqa: BLE001 - the stream must end cleanly
        print(f"[query] failed: {error!r}", flush=True)
        yield sse("error", {"message": "The assistant could not complete this request."})
