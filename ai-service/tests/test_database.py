"""Connection pooling in database.py, with psycopg2 replaced by fakes."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2
import pytest

import database


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=None):
        if self.conn.fail_next:
            self.conn.fail_next = False
            raise psycopg2.OperationalError("server closed the connection unexpectedly")
        self.conn.executed.append(sql)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeInfo:
    transaction_status = psycopg2.extensions.TRANSACTION_STATUS_IDLE


class FakeConn:
    info = FakeInfo()

    def __init__(self):
        self.closed = 0
        self.fail_next = False
        self.executed = []
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = 1


@pytest.fixture
def opened(monkeypatch):
    """Every connection the pool opens, in order."""
    connections: list[FakeConn] = []

    def connect(*args, **kwargs):
        assert kwargs["keepalives"] == 1
        conn = FakeConn()
        connections.append(conn)
        return conn

    monkeypatch.setattr(database, "settings", type(database.settings)(**{**database.settings.__dict__, "database_url": "postgresql://fake"}))
    monkeypatch.setattr(psycopg2, "connect", connect)
    monkeypatch.setattr(psycopg2.pool.psycopg2, "connect", connect, raising=False)
    monkeypatch.setattr(database, "register_vector", lambda conn: None)
    monkeypatch.setattr(database, "_pool", None)
    monkeypatch.setattr(database, "_prepared", set())
    monkeypatch.setattr(database, "_last_used", {})
    return connections


def test_requests_reuse_one_connection(opened):
    for _ in range(5):
        with database.get_connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")

    # POOL_MIN connections are opened up front; every request reuses them.
    assert len(opened) == database.POOL_MIN
    assert sum(conn.commits for conn in opened) == 5


def test_a_network_failure_discards_the_connection(opened):
    with pytest.raises(psycopg2.OperationalError):
        with database.get_connection() as failed, failed.cursor() as cur:
            failed.fail_next = True
            cur.execute("SELECT 1")

    assert failed.closed

    for _ in range(3):
        with database.get_connection() as conn:
            assert conn is not failed and not conn.closed


def test_an_ordinary_sql_error_rolls_back_and_keeps_the_connection(opened):
    with pytest.raises(ValueError):
        with database.get_connection() as used:
            raise ValueError("bad input")

    assert used.rollbacks == 1 and not used.closed
    with database.get_connection() as again:
        assert again is used


def test_a_connection_idle_too_long_is_checked_and_replaced_if_dead(opened):
    with database.get_connection() as stale:
        pass
    # Pretend it sat idle for ten minutes and the server dropped it meanwhile.
    database._last_used[id(stale)] -= 600
    stale.fail_next = True

    with database.get_connection() as conn:
        assert conn is not stale and not conn.closed
    assert stale.closed
