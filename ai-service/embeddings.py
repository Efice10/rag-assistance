"""Ollama clients for embeddings and chat."""

from typing import Iterator, Sequence

import ollama

from config import EMBEDDING_DIMENSIONS, settings

_client = ollama.Client(host=settings.ollama_url)

# nomic-embed-text is trained with task prefixes; using them noticeably
# improves retrieval quality.
DOCUMENT_PREFIX = "search_document: "
QUERY_PREFIX = "search_query: "

_BATCH_SIZE = 32


def _embed(texts: Sequence[str]) -> list[list[float]]:
    response = _client.embed(model=settings.embed_model, input=list(texts))
    vectors = [list(vector) for vector in response["embeddings"]]

    for vector in vectors:
        if len(vector) != EMBEDDING_DIMENSIONS:
            raise RuntimeError(
                f"{settings.embed_model} returned {len(vector)} dimensions; "
                f"the database column expects {EMBEDDING_DIMENSIONS}."
            )

    return vectors


def embed_documents(chunks: Sequence[str]) -> list[list[float]]:
    vectors: list[list[float]] = []
    for start in range(0, len(chunks), _BATCH_SIZE):
        batch = chunks[start : start + _BATCH_SIZE]
        vectors.extend(_embed([DOCUMENT_PREFIX + text for text in batch]))
    return vectors


def embed_query(prompt: str) -> list[float]:
    return _embed([QUERY_PREFIX + prompt])[0]


def stream_chat(messages: list[dict[str, str]]) -> Iterator[str]:
    """Yield the answer token by token."""
    stream = _client.chat(
        model=settings.chat_model,
        messages=messages,
        stream=True,
        options={"temperature": 0.1},
    )
    for part in stream:
        text = part["message"]["content"]
        if text:
            yield text


def check_ollama() -> bool:
    try:
        _client.list()
        return True
    except Exception:
        return False
