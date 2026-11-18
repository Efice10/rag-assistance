"""FastAPI AI service. Internal only: bind to 127.0.0.1 and call it from Laravel.

Run:  uvicorn main:app --reload --port 8001
"""

import hmac
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import settings
from database import check_database
from embeddings import check_ollama
from ingest import IngestError, IngestRequest, extract_pages, ingest_document
from rag import QueryRequest, answer_stream

app = FastAPI(title="Enterprise RAG AI Service", docs_url=None, redoc_url=None, openapi_url=None)


def require_internal_secret(x_internal_secret: str | None = Header(default=None)) -> None:
    """Reject any call that does not carry the secret shared with Laravel."""
    expected = settings.internal_api_secret

    if not expected:
        raise HTTPException(status_code=503, detail="INTERNAL_API_SECRET is not configured.")

    if not x_internal_secret or not hmac.compare_digest(x_internal_secret, expected):
        raise HTTPException(status_code=401, detail="Invalid internal secret.")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "database": check_database(), "ollama": check_ollama()}


@app.post("/ingest", dependencies=[Depends(require_internal_secret)])
def ingest(request: IngestRequest) -> dict:
    try:
        result = ingest_document(request)
    except IngestError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        print(f"[ingest] document {request.document_id} failed: {error!r}", flush=True)
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {error}") from error

    return {"document_id": request.document_id, **result.model_dump()}


class PreviewRequest(BaseModel):
    file_path: str


# Enough for any policy document; a preview is for reading, not for export.
PREVIEW_MAX_CHARS = 300_000


@app.post("/preview", dependencies=[Depends(require_internal_secret)])
def preview(request: PreviewRequest) -> dict:
    """The document's text, page by page, for in-app viewing of formats a
    browser cannot display (DOCX, XLSX, PPTX, TXT, MD). Laravel checks access
    before calling this and passes the stored file's path."""
    path = Path(request.file_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="The stored file is missing.")
    try:
        pages = extract_pages(path)
    except IngestError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    result, used, truncated = [], 0, False
    for number, text in pages:
        if used + len(text) > PREVIEW_MAX_CHARS:
            result.append({"page": number, "text": text[: max(0, PREVIEW_MAX_CHARS - used)]})
            truncated = True
            break
        result.append({"page": number, "text": text})
        used += len(text)
    return {"pages": result, "truncated": truncated}


@app.post("/query", dependencies=[Depends(require_internal_secret)])
def query(request: QueryRequest) -> StreamingResponse:
    return StreamingResponse(
        answer_stream(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
