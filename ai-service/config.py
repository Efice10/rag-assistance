"""Settings for the AI service, loaded from ai-service/.env."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# nomic-embed-text produces 768-dimension vectors. The document_chunks.embedding
# column is vector(768); changing the model means changing that column too.
EMBEDDING_DIMENSIONS = 768


@dataclass(frozen=True)
class Settings:
    database_url: str
    ollama_url: str
    embed_model: str
    chat_model: str
    internal_api_secret: str
    top_k: int
    min_similarity: float
    chunk_size: int
    chunk_overlap: int


def load_settings() -> Settings:
    return Settings(
        database_url=os.getenv("DATABASE_URL", ""),
        ollama_url=os.getenv("OLLAMA_URL", "http://127.0.0.1:11434"),
        embed_model=os.getenv("EMBED_MODEL", "nomic-embed-text"),
        chat_model=os.getenv("CHAT_MODEL", "llama3.2"),
        internal_api_secret=os.getenv("INTERNAL_API_SECRET", ""),
        top_k=int(os.getenv("TOP_K", "5")),
        min_similarity=float(os.getenv("MIN_SIMILARITY", "0.55")),
        chunk_size=int(os.getenv("CHUNK_SIZE", "800")),
        chunk_overlap=int(os.getenv("CHUNK_OVERLAP", "150")),
    )


settings = load_settings()
