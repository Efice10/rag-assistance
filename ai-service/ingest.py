"""Document ingestion: extract text, chunk, embed, store with RBAC metadata."""

from pathlib import Path

from docx import Document as DocxDocument
from langchain_text_splitters import RecursiveCharacterTextSplitter
from psycopg2.extras import execute_values
from pydantic import BaseModel, Field
from pypdf import PdfReader

from config import settings
from database import get_connection, set_document_status
from embeddings import embed_documents


class IngestRequest(BaseModel):
    document_id: int
    organization_id: int
    department_id: int
    clearance_level: int = Field(ge=1, le=4)
    title: str
    file_path: str
    mime_type: str | None = None


class IngestError(Exception):
    """A problem with the document itself (missing, unreadable, empty)."""


def extract_pages(path: Path) -> list[tuple[int, str]]:
    """Return (page_number, text) pairs. Page numbers start at 1."""
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        reader = PdfReader(str(path))
        pages = [(number, page.extract_text() or "") for number, page in enumerate(reader.pages, start=1)]
    elif suffix == ".docx":
        # DOCX files have no fixed pages (pagination happens at render time),
        # so the whole document is cited as page 1.
        document = DocxDocument(str(path))
        parts = [paragraph.text for paragraph in document.paragraphs]
        for table in document.tables:
            for row in table.rows:
                parts.append(" | ".join(cell.text for cell in row.cells))
        pages = [(1, "\n".join(parts))]
    else:
        raise IngestError(f"Unsupported file type: {suffix or 'none'}. Only PDF and DOCX are accepted.")

    return [(number, text.strip()) for number, text in pages if text and text.strip()]


def chunk_pages(pages: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """Split each page into overlapping chunks, keeping the page number."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
    )
    return [(number, chunk) for number, text in pages for chunk in splitter.split_text(text)]


def ingest_document(request: IngestRequest) -> int:
    """Index one document and return the number of chunks stored.

    The document's status is set to 'indexed' on success and 'failed' (with a
    message) on any error, so the dashboard always reflects the outcome.
    """
    try:
        path = Path(request.file_path)
        if not path.is_file():
            raise IngestError(f"File not found: {path}")

        chunks = chunk_pages(extract_pages(path))
        if not chunks:
            raise IngestError("No extractable text was found. Scanned PDFs need OCR before upload.")

        vectors = embed_documents([text for _, text in chunks])

        rows = [
            (
                request.document_id,
                request.organization_id,
                request.department_id,
                request.clearance_level,
                request.title,
                page_number,
                # PostgreSQL text columns cannot hold NUL bytes, which some PDFs contain.
                text.replace("\x00", ""),
                vector,
            )
            for (page_number, text), vector in zip(chunks, vectors)
        ]

        with get_connection() as conn, conn.cursor() as cur:
            # Re-ingesting a document replaces its chunks instead of duplicating them.
            cur.execute("DELETE FROM document_chunks WHERE document_id = %s", (request.document_id,))
            execute_values(
                cur,
                """
                INSERT INTO document_chunks
                    (document_id, organization_id, department_id, clearance_level,
                     document_title, page_number, content, embedding)
                VALUES %s
                """,
                rows,
                template="(%s, %s, %s, %s, %s, %s, %s, %s::vector)",
            )
            cur.execute(
                "UPDATE documents SET status = 'indexed', error_message = NULL, updated_at = NOW() WHERE id = %s",
                (request.document_id,),
            )

        return len(rows)
    except Exception as error:
        try:
            set_document_status(request.document_id, "failed", str(error)[:500])
        except Exception:
            pass  # The database itself may be the problem; the caller still gets the error.
        raise
