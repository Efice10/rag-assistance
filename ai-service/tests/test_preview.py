"""The /preview endpoint used by the in-app document viewer."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from docx import Document as DocxDocument
from fastapi.testclient import TestClient

import main
from config import settings

SECRET = {"X-Internal-Secret": "right"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "settings", type(settings)(**{**settings.__dict__, "internal_api_secret": "right"}))
    return TestClient(main.app)


def test_preview_requires_the_internal_secret(client, tmp_path):
    path = tmp_path / "a.txt"
    path.write_text("hello")

    assert client.post("/preview", json={"file_path": str(path)}).status_code == 401
    assert client.post("/preview", json={"file_path": str(path)}, headers={"X-Internal-Secret": "wrong"}).status_code == 401


def test_preview_returns_text_page_by_page(client, tmp_path):
    path = tmp_path / "policy.docx"
    document = DocxDocument()
    document.add_paragraph("Staff are entitled to 14 days of annual leave.")
    document.save(str(path))

    response = client.post("/preview", json={"file_path": str(path)}, headers=SECRET)

    assert response.status_code == 200
    assert response.json() == {
        "pages": [{"page": 1, "text": "Staff are entitled to 14 days of annual leave."}],
        "truncated": False,
    }


def test_preview_keeps_personal_details_like_the_downloadable_file(client, tmp_path):
    # The viewer shows what an authorized download would show; masking is
    # for the search index and answers only.
    path = tmp_path / "contacts.txt"
    path.write_text("Contact hr@acme.test for leave questions.")

    text = client.post("/preview", json={"file_path": str(path)}, headers=SECRET).json()["pages"][0]["text"]

    assert "hr@acme.test" in text


def test_very_long_documents_are_truncated(client, tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PREVIEW_MAX_CHARS", 10)
    path = tmp_path / "long.txt"
    path.write_text("abcdefghijklmnopqrstuvwxyz")

    body = client.post("/preview", json={"file_path": str(path)}, headers=SECRET).json()

    assert body["truncated"] is True and body["pages"][0]["text"] == "abcdefghij"


def test_missing_or_unsupported_files_are_reported(client, tmp_path):
    assert client.post("/preview", json={"file_path": str(tmp_path / "gone.pdf")}, headers=SECRET).status_code == 404

    odd = tmp_path / "macro.exe"
    odd.write_bytes(b"MZ")
    assert client.post("/preview", json={"file_path": str(odd)}, headers=SECRET).status_code == 422
