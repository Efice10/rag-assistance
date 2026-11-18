"""Document ingestion: extract text, screen it, chunk, embed, store with RBAC metadata."""

import re
import zipfile
from datetime import date
from pathlib import Path
from xml.etree import ElementTree

from docx import Document as DocxDocument
from langchain_text_splitters import RecursiveCharacterTextSplitter
from psycopg2.extras import execute_values
from pydantic import BaseModel, Field
from pypdf import PdfReader

import ocr
from config import settings
from database import get_connection, set_document_status
from embeddings import embed_documents
from events import ExtractedEvent, extract_events
from safety import redact_pii, scan_for_injection

SUPPORTED = ".pdf, .docx, .xlsx, .pptx, .txt and .md"


class IngestRequest(BaseModel):
    document_id: int
    organization_id: int
    department_id: int
    clearance_level: int = Field(ge=1, le=4)
    title: str
    file_path: str
    mime_type: str | None = None
    # Earlier versions of this document. Their chunks are removed in the same
    # transaction that stores the new ones, so exactly one version answers.
    supersedes_document_ids: list[int] = Field(default_factory=list)
    # Set by Laravel once an administrator has approved a flagged document.
    allow_flagged: bool = False
    # "Today" in the organization's calendar time zone, decided by Laravel.
    # Event dates before it are not extracted.
    today: date | None = None


class IngestResult(BaseModel):
    status: str
    chunks: int = 0
    pii_redactions: int = 0
    ocr_pages: int = 0
    events: int = 0
    flag_reasons: list[str] = Field(default_factory=list)


class IngestError(Exception):
    """A problem with the document itself (missing, unreadable, empty)."""


# --- extraction ----------------------------------------------------------------

def extract_pages(path: Path) -> list[tuple[int, str]]:
    """Return (page_number, text) pairs. Page numbers start at 1.

    PDF pages are real pages; a slide is a page; a spreadsheet sheet is a
    page. DOCX, TXT and MD have no fixed pages and are cited as page 1.
    """
    pages, _ = extract_pages_with_ocr(path)
    return pages


def extract_pages_with_ocr(path: Path) -> tuple[list[tuple[int, str]], int]:
    suffix = path.suffix.lower()
    ocr_pages = 0

    if suffix == ".pdf":
        reader = PdfReader(str(path))
        pages = [(number, page.extract_text() or "") for number, page in enumerate(reader.pages, start=1)]
        pages, ocr_pages = ocr.fill_scanned_pages(path, pages)
    elif suffix == ".docx":
        document = DocxDocument(str(path))
        parts = [paragraph.text for paragraph in document.paragraphs]
        for table in document.tables:
            for row in table.rows:
                parts.append(" | ".join(cell.text for cell in row.cells))
        pages = [(1, "\n".join(parts))]
    elif suffix == ".xlsx":
        pages = _xlsx_pages(path)
    elif suffix == ".pptx":
        pages = _pptx_pages(path)
    elif suffix in (".txt", ".md"):
        pages = [(1, path.read_text(encoding="utf-8", errors="replace"))]
    else:
        raise IngestError(f"Unsupported file type: {suffix or 'none'}. Accepted: {SUPPORTED}.")

    return [(number, text.strip()) for number, text in pages if text and text.strip()], ocr_pages


_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_DRAWING = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


def _open_zip(path: Path) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(path)
    except zipfile.BadZipFile as error:
        raise IngestError("The file is damaged or is not a real Office document.") from error


def _xlsx_pages(path: Path) -> list[tuple[int, str]]:
    """One page per sheet; each row becomes 'Header: value | Header: value'
    using the first row as headers, so thresholds keep their labels."""
    with _open_zip(path) as archive:
        names = set(archive.namelist())
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(t.text or "" for t in item.iter(f"{_MAIN}t")) for item in root.iter(f"{_MAIN}si")]

        workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        rels = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {rel.get("Id"): rel.get("Target", "") for rel in rels.iter(f"{_PKG_REL}Relationship")}

        pages = []
        for number, sheet in enumerate(workbook.iter(f"{_MAIN}sheet"), start=1):
            target = targets.get(sheet.get(f"{_REL}id"), "").lstrip("/")
            member = target if target.startswith("xl/") else f"xl/{target}"
            if member not in names:
                continue
            rows = []
            for row in ElementTree.fromstring(archive.read(member)).iter(f"{_MAIN}row"):
                values = []
                for cell in row.iter(f"{_MAIN}c"):
                    kind = cell.get("t")
                    if kind == "inlineStr":
                        value = "".join(t.text or "" for t in cell.iter(f"{_MAIN}t"))
                    else:
                        raw = cell.findtext(f"{_MAIN}v") or ""
                        value = shared[int(raw)] if kind == "s" and raw.isdigit() and int(raw) < len(shared) else raw
                    values.append(value.strip())
                if any(values):
                    rows.append(values)
            if not rows:
                continue
            header, body = rows[0], rows[1:]
            lines = [f"Sheet: {sheet.get('name', number)}", " | ".join(header)]
            for values in body:
                lines.append(" | ".join(
                    f"{header[i]}: {value}" if i < len(header) and header[i] else value
                    for i, value in enumerate(values) if value
                ))
            pages.append((number, "\n".join(lines)))
        return pages


def _pptx_pages(path: Path) -> list[tuple[int, str]]:
    """One page per slide, in slide order."""
    with _open_zip(path) as archive:
        slides = sorted(
            (name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
            key=lambda name: int(re.search(r"(\d+)\.xml$", name).group(1)),
        )
        pages = []
        for name in slides:
            number = int(re.search(r"(\d+)\.xml$", name).group(1))
            root = ElementTree.fromstring(archive.read(name))
            paragraphs = ["".join(t.text or "" for t in p.iter(f"{_DRAWING}t")) for p in root.iter(f"{_DRAWING}p")]
            pages.append((number, "\n".join(text for text in paragraphs if text.strip())))
        return pages


# --- chunking ------------------------------------------------------------------

def chunk_pages(pages: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """Split each page into overlapping chunks, keeping the page number."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
    )
    return [(number, chunk) for number, text in pages for chunk in splitter.split_text(text)]


def redact_pages(pages: list[tuple[int, str]]) -> tuple[list[tuple[int, str]], int]:
    """Redact PII page by page. The stored file itself is never changed."""
    redacted_pages = []
    total = 0
    for number, text in pages:
        clean, count = redact_pii(text)
        total += count
        redacted_pages.append((number, clean))
    return redacted_pages, total


def prepare_chunks(pages: list[tuple[int, str]]) -> tuple[list[tuple[int, str]], int]:
    """Redact PII page by page, then chunk. Returns the chunks and how many
    values were redacted."""
    redacted_pages, total = redact_pages(pages)
    return chunk_pages(redacted_pages), total


# --- pipeline ------------------------------------------------------------------

def ingest_document(request: IngestRequest) -> IngestResult:
    """Index one document.

    Outcomes, each written to the documents row so the dashboard reflects it:
    - 'flagged': the text looks like a prompt-injection attempt; nothing is
      indexed until an administrator approves it.
    - 'indexed': chunks stored (PII redacted); earlier versions superseded.
    - 'failed': any error, with a message.
    """
    try:
        path = Path(request.file_path)
        if not path.is_file():
            raise IngestError(f"File not found: {path}")

        pages, ocr_pages = extract_pages_with_ocr(path)
        if not pages:
            raise IngestError(ocr.no_text_message())

        reasons = scan_for_injection("\n".join(text for _, text in pages))
        if reasons and not request.allow_flagged:
            with get_connection() as conn, conn.cursor() as cur:
                cur.execute("DELETE FROM document_chunks WHERE document_id = %s", (request.document_id,))
                cur.execute("DELETE FROM document_events WHERE document_id = %s", (request.document_id,))
                cur.execute(
                    "UPDATE documents SET status = 'flagged', error_message = %s, updated_at = NOW() WHERE id = %s",
                    (("Held for review: " + "; ".join(reasons))[:500], request.document_id),
                )
            return IngestResult(status="flagged", flag_reasons=reasons, ocr_pages=ocr_pages)

        redacted, redactions = redact_pages(pages)
        chunks = chunk_pages(redacted)
        # Dates are not personal data, so they survive redaction.
        events = extract_events(redacted, request.today or date.today(), request.title)
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
                """
                UPDATE documents
                SET status = 'indexed', error_message = NULL, pii_redactions = %s, updated_at = NOW()
                WHERE id = %s
                """,
                (redactions, request.document_id),
            )
            # Events first: they inherit review decisions from the versions
            # that supersede() is about to retire.
            store_events(cur, request, events)
            supersede(cur, request)

        return IngestResult(
            status="indexed", chunks=len(rows), pii_redactions=redactions, ocr_pages=ocr_pages, events=len(events)
        )
    except Exception as error:
        try:
            set_document_status(request.document_id, "failed", str(error)[:500])
        except Exception:
            pass  # The database itself may be the problem; the caller still gets the error.
        raise


def store_events(cur, request: IngestRequest, events: list[ExtractedEvent]) -> None:
    """Replace the document's events, keeping earlier review decisions.

    A new event whose extracted dates match an event that was already
    confirmed or rejected (in this document or in a version it supersedes)
    inherits that decision, with any corrected title and dates. Everything
    else is pending; dates that are no longer in the text disappear.
    """
    sources = [request.document_id, *[d for d in request.supersedes_document_ids if d != request.document_id]]
    cur.execute(
        """
        SELECT extracted_starts_at, extracted_ends_at, status, title, starts_at, ends_at, confirmed_by, confirmed_at
        FROM document_events
        WHERE document_id = ANY(%s) AND organization_id = %s AND status IN ('confirmed', 'rejected')
        ORDER BY (document_id = %s) DESC, document_id DESC
        """,
        (sources, request.organization_id, request.document_id),
    )
    decisions: dict[tuple, tuple] = {}
    for row in cur.fetchall():
        decisions.setdefault((row[0], row[1]), row)

    cur.execute("DELETE FROM document_events WHERE document_id = %s", (request.document_id,))
    if not events:
        return

    rows = []
    for event in events:
        decided = decisions.get((event.starts_at, event.ends_at))
        if decided:
            _, _, status, title, starts_at, ends_at, confirmed_by, confirmed_at = decided
        else:
            status, title, starts_at, ends_at = "pending", event.title, event.starts_at, event.ends_at
            confirmed_by = confirmed_at = None
        rows.append((
            request.document_id, request.organization_id, request.department_id, request.clearance_level,
            title, event.snippet, event.page_number, starts_at, ends_at,
            event.starts_at, event.ends_at, status, confirmed_by, confirmed_at,
        ))

    execute_values(
        cur,
        """
        INSERT INTO document_events
            (document_id, organization_id, department_id, clearance_level, title, snippet, page_number,
             starts_at, ends_at, extracted_starts_at, extracted_ends_at, status, confirmed_by, confirmed_at,
             created_at, updated_at)
        VALUES %s
        """,
        rows,
        template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())",
    )


def supersede(cur, request: IngestRequest) -> None:
    """Retire earlier versions, inside the same organization only."""
    older = [doc_id for doc_id in request.supersedes_document_ids if doc_id != request.document_id]
    if not older:
        return
    cur.execute(
        "DELETE FROM document_chunks WHERE document_id = ANY(%s) AND organization_id = %s",
        (older, request.organization_id),
    )
    cur.execute(
        "DELETE FROM document_events WHERE document_id = ANY(%s) AND organization_id = %s",
        (older, request.organization_id),
    )
    cur.execute(
        """
        UPDATE documents SET superseded_at = NOW(), superseded_by = %s, updated_at = NOW()
        WHERE id = ANY(%s) AND organization_id = %s AND superseded_at IS NULL
        """,
        (request.document_id, older, request.organization_id),
    )
