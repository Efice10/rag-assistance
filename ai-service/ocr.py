"""OCR for scanned PDF pages, when the optional tools are installed.

Needs, in ai-service/venv:  pip install pytesseract pypdfium2
and the Tesseract program for Windows (winget install UB-Mannheim.TesseractOCR).
Without them, scanned pages are skipped and a document with no text layer
fails with a message saying what to install.
"""

import os
import shutil
from pathlib import Path

# A page with less extractable text than this is treated as a scan.
MIN_TEXT_CHARS = 20
# Bound the runtime: OCR is slow (a few seconds per page).
MAX_OCR_PAGES = int(os.getenv("OCR_MAX_PAGES", "50"))
DEFAULT_TESSERACT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


def tesseract_path() -> str | None:
    configured = os.getenv("TESSERACT_CMD", "")
    for candidate in (configured, shutil.which("tesseract"), DEFAULT_TESSERACT):
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def available() -> bool:
    try:
        import pypdfium2  # noqa: F401
        import pytesseract  # noqa: F401
    except ImportError:
        return False
    return tesseract_path() is not None


def ocr_page(path: Path, page_number: int) -> str:
    import pypdfium2
    import pytesseract

    pytesseract.pytesseract.tesseract_cmd = tesseract_path()
    pdf = pypdfium2.PdfDocument(str(path))
    try:
        image = pdf[page_number - 1].render(scale=2).to_pil()
        return pytesseract.image_to_string(image, lang=os.getenv("OCR_LANG", "eng"))
    finally:
        pdf.close()


def fill_scanned_pages(path: Path, pages: list[tuple[int, str]]) -> tuple[list[tuple[int, str]], int]:
    """Replace near-empty pages with OCR text. Returns the pages and how many were OCR'd."""
    scanned = [number for number, text in pages if len(text.strip()) < MIN_TEXT_CHARS]
    if not scanned or not available():
        return pages, 0

    recognised: dict[int, str] = {}
    for number in scanned[:MAX_OCR_PAGES]:
        recognised[number] = ocr_page(path, number)

    return [(number, recognised.get(number, text)) for number, text in pages], len(recognised)


def no_text_message() -> str:
    if available():
        return "No text was found, even with OCR. The file may be blank or an image of very low quality."
    return (
        "No extractable text was found. This looks like a scanned PDF: install OCR support "
        "(Tesseract, plus 'pip install pytesseract pypdfium2' in ai-service) and reindex it."
    )
