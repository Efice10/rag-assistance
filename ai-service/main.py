"""FastAPI AI service. Internal only: bind to 127.0.0.1 and call it from Laravel.

Run:  uvicorn main:app --reload --port 8001
"""

import hmac

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse

from config import settings
from database import check_database
from embeddings import check_ollama
from ingest import IngestError, IngestRequest, ingest_document
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


@app.post("/query", dependencies=[Depends(require_internal_secret)])
def query(request: QueryRequest) -> StreamingResponse:
    return StreamingResponse(
        answer_stream(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
