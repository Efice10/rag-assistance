"""Unit tests that need neither a database nor Ollama.

Run from ai-service/:  .\\venv\\Scripts\\python.exe -m pytest
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from docx import Document as DocxDocument
from fastapi.testclient import TestClient

import main
import rag
from config import settings
from ingest import IngestError, chunk_pages, extract_pages
from rag import Chunk, QueryRequest, build_search_query, unique_sources

EMBEDDING = [0.0] * 768


def make_request(**overrides) -> QueryRequest:
    values = {"prompt": "What is the travel policy?", "organization_id": 7, "department_id": 3, "clearance_level": 2}
    return QueryRequest(**{**values, **overrides})


class TestSearchQuery:
    def test_non_admin_is_filtered_by_organization_department_and_clearance(self):
        sql, params = build_search_query(make_request(), EMBEDDING, 5)

        assert "WHERE organization_id = %s AND department_id = %s AND clearance_level <= %s" in sql
        assert params == (EMBEDDING, 7, 3, 2, EMBEDDING, 5)

    def test_admin_drops_only_the_department_filter(self):
        sql, params = build_search_query(make_request(is_admin=True, clearance_level=4), EMBEDDING, 5)

        assert "WHERE organization_id = %s AND clearance_level <= %s" in sql
        assert "department_id = %s" not in sql
        assert params == (EMBEDDING, 7, 4, EMBEDDING, 5)

    def test_scope_values_are_bound_parameters_never_interpolated(self):
        sql, _ = build_search_query(make_request(organization_id=987654), EMBEDDING, 5)

        assert "987654" not in sql

    @pytest.mark.parametrize("level", [0, 5, -1])
    def test_clearance_outside_1_to_4_is_rejected(self, level):
        with pytest.raises(ValueError):
            make_request(clearance_level=level)


class TestAnswerStream:
    def test_refuses_without_calling_the_model_when_nothing_is_retrieved(self, monkeypatch):
        monkeypatch.setattr(rag, "retrieve", lambda request: [])
        monkeypatch.setattr(rag, "stream_chat", lambda messages: pytest.fail("model must not be called"))

        events = "".join(rag.answer_stream(make_request()))

        assert rag.REFUSAL in events
        assert '"sources": []' in events
        assert events.rstrip().endswith("data: {}")

    def test_streams_tokens_then_unique_sources(self, monkeypatch):
        chunks = [
            Chunk(11, "Travel Policy", 2, "Flights must be economy.", 0.9),
            Chunk(11, "Travel Policy", 2, "Hotels are capped.", 0.8),
            Chunk(12, "Expense SOP", 1, "Submit within 30 days.", 0.7),
        ]
        monkeypatch.setattr(rag, "retrieve", lambda request: chunks)
        monkeypatch.setattr(rag, "stream_chat", lambda messages: iter(["Economy ", "only."]))

        events = list(rag.answer_stream(make_request()))

        assert events[0].startswith("event: token")
        assert events[-2].startswith("event: sources")
        assert events[-2].count('"document_id"') == 2
        assert events[-1].startswith("event: done")

    def test_a_refusal_from_the_model_cites_no_sources(self, monkeypatch):
        monkeypatch.setattr(rag, "retrieve", lambda request: [Chunk(11, "Travel Policy", 2, "Text", 0.9)])
        monkeypatch.setattr(rag, "stream_chat", lambda messages: iter([rag.REFUSAL]))

        events = list(rag.answer_stream(make_request()))

        assert '"sources": []' in events[-2]

    def test_errors_become_a_generic_error_event(self, monkeypatch):
        def boom(request):
            raise RuntimeError("connection string with secrets")

        monkeypatch.setattr(rag, "retrieve", boom)

        events = "".join(rag.answer_stream(make_request()))

        assert "event: error" in events
        assert "secrets" not in events

    def test_unique_sources_keeps_distinct_pages(self):
        chunks = [Chunk(1, "A", 1, "x", 0.9), Chunk(1, "A", 2, "y", 0.8), Chunk(1, "A", 1, "z", 0.7)]

        assert [source["page_number"] for source in unique_sources(chunks)] == [1, 2]


class TestInternalSecret:
    client = TestClient(main.app)
    payload = {"prompt": "hi", "organization_id": 1, "department_id": 1, "clearance_level": 1}

    def test_missing_secret_is_rejected(self):
        assert self.client.post("/query", json=self.payload).status_code in (401, 503)

    def test_wrong_secret_is_rejected(self, monkeypatch):
        monkeypatch.setattr(main, "settings", type(settings)(**{**settings.__dict__, "internal_api_secret": "right"}))

        response = self.client.post("/query", json=self.payload, headers={"X-Internal-Secret": "wrong"})

        assert response.status_code == 401

    def test_ingest_also_requires_the_secret(self, monkeypatch):
        monkeypatch.setattr(main, "settings", type(settings)(**{**settings.__dict__, "internal_api_secret": "right"}))

        response = self.client.post("/ingest", json={}, headers={"X-Internal-Secret": "wrong"})

        assert response.status_code == 401


class TestExtraction:
    def test_docx_text_is_extracted_as_page_one(self, tmp_path):
        path = tmp_path / "policy.docx"
        document = DocxDocument()
        document.add_paragraph("Leave requests need manager approval.")
        document.save(str(path))

        assert extract_pages(path) == [(1, "Leave requests need manager approval.")]

    def test_unsupported_files_are_rejected(self, tmp_path):
        path = tmp_path / "notes.txt"
        path.write_text("hello")

        with pytest.raises(IngestError):
            extract_pages(path)

    def test_chunks_keep_their_page_number_and_respect_the_size_limit(self):
        chunks = chunk_pages([(1, "alpha " * 400), (2, "beta " * 50)])

        assert {page for page, _ in chunks} == {1, 2}
        assert all(len(text) <= settings.chunk_size for _, text in chunks)
        assert len([text for page, text in chunks if page == 1]) > 1
