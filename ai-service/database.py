"""PostgreSQL access. This service is the only one that reads or writes document_chunks.

Connections are pooled: opening one to Supabase costs a TCP + TLS + login
handshake (hundreds of milliseconds), so each request borrows an open
connection instead of creating a new one.
"""

import os
import threading
import time
from contextlib import contextmanager
from typing import Iterator

import psycopg2
from pgvector.psycopg2 import register_vector
from psycopg2 import pool
from psycopg2.extensions import connection as Connection

from config import settings

# psycopg2 keeps at most POOL_MIN idle connections and closes the rest when
# they are returned, so POOL_MIN is the number kept warm between requests.
POOL_MIN = int(os.getenv("DB_POOL_MIN", "2"))
POOL_MAX = max(POOL_MIN, int(os.getenv("DB_POOL_MAX", "8")))
# A connection idle longer than this is checked before use: the network or
# the Supabase pooler may have dropped it in the meantime.
CHECK_AFTER_IDLE_SECONDS = 60

_pool: pool.ThreadedConnectionPool | None = None
_lock = threading.Lock()
_prepared: set[int] = set()  # connections with the pgvector type registered
_last_used: dict[int, float] = {}


def _get_pool() -> pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _lock:
            if _pool is None:
                if not settings.database_url:
                    raise RuntimeError("DATABASE_URL is not set in ai-service/.env")
                # Created on the first request, which opens POOL_MIN connections.
                _pool = pool.ThreadedConnectionPool(
                    POOL_MIN,
                    POOL_MAX,
                    settings.database_url,
                    connect_timeout=10,
                    # Keep idle connections alive through NAT and the pooler.
                    keepalives=1,
                    keepalives_idle=30,
                    keepalives_interval=10,
                    keepalives_count=3,
                )
    return _pool


def _usable(conn: Connection) -> bool:
    if conn.closed:
        return False
    last_used = _last_used.get(id(conn))
    # Never used yet means just opened: nothing to check.
    if last_used is None or time.monotonic() - last_used < CHECK_AFTER_IDLE_SECONDS:
        return True
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        conn.rollback()
        return True
    except psycopg2.Error:
        return False


def _discard(connections: pool.ThreadedConnectionPool, conn: Connection) -> None:
    _prepared.discard(id(conn))
    _last_used.pop(id(conn), None)
    connections.putconn(conn, close=True)


@contextmanager
def get_connection() -> Iterator[Connection]:
    """Borrow a connection: commit on success, roll back on error, always return it.

    A connection that failed at the network level is discarded, not reused.
    """
    connections = _get_pool()
    conn = connections.getconn()
    if not _usable(conn):
        _discard(connections, conn)
        conn = connections.getconn()
    if id(conn) not in _prepared:
        register_vector(conn)
        _prepared.add(id(conn))

    broken = False
    try:
        yield conn
        conn.commit()
    except Exception as error:
        broken = bool(conn.closed) or isinstance(error, (psycopg2.OperationalError, psycopg2.InterfaceError))
        if not conn.closed:
            try:
                conn.rollback()
            except psycopg2.Error:
                broken = True
        raise
    finally:
        if broken or conn.closed:
            _discard(connections, conn)
        else:
            _last_used[id(conn)] = time.monotonic()
            connections.putconn(conn)


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
