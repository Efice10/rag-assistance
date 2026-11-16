"""PostgreSQL access. This service is the only one that reads or writes document_chunks."""

from contextlib import contextmanager
from typing import Iterator

import psycopg2
from pgvector.psycopg2 import register_vector
from psycopg2.extensions import connection as Connection

from config import settings


@contextmanager
def get_connection() -> Iterator[Connection]:
    """Open a connection, commit on success, roll back on error, always close."""
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not set in ai-service/.env")

    conn = psycopg2.connect(settings.database_url, connect_timeout=10)
    try:
        register_vector(conn)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def set_document_status(document_id: int, status: str, error_message: str | None = None) -> None:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE documents SET status = %s, error_message = %s, updated_at = NOW() WHERE id = %s",
            (status, error_message, document_id),
        )


def check_database() -> bool:
    try:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            return True
    except Exception:
        return False
