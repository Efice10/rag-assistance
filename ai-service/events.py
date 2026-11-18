"""Find dated events (meetings, deadlines, trainings) in document text.

Deterministic and dependency-free: a small set of date patterns, accepted
only in sentences that contain an event word and only for dates from
1 January of the current year on. Upcoming events wait for a person to
confirm them; events already over are history and are stored as confirmed
(module 29), so the aim is high precision with a short, reviewable list.
"""

import os
import re
from dataclasses import dataclass
from datetime import date

EVENTS_MAX_PER_DOC = int(os.getenv("EVENTS_MAX_PER_DOC", "50"))
TITLE_MAX = 80
SNIPPET_MAX = 300

# A date becomes an event only when its sentence contains one of these.
EVENT_WORDS = re.compile(
    r"\b(meeting|meet|briefing|training|workshop|session|deadline|due|submit|submission|audit|inspection|"
    r"review|town\s*hall|conference|seminar|webinar|orientation|interview|exam|examination|assessment|"
    r"launch|ceremony|drill|course|retreat|forum|visit)\b",
    re.I,
)
# Dates in these sentences are not commitments yet.
NON_COMMITTAL = re.compile(r"\b(TBC|TBA|TBD|to be (confirmed|announced|determined))\b", re.I)

_MONTHS = {
    name: number
    for number, names in enumerate(
        [
            ("january", "jan"), ("february", "feb"), ("march", "mar"), ("april", "apr"),
            ("may",), ("june", "jun"), ("july", "jul"), ("august", "aug"),
            ("september", "sep", "sept"), ("october", "oct"), ("november", "nov"), ("december", "dec"),
        ],
        start=1,
    )
    for name in names
}
# The lookahead stops "mar" matching inside "market".
_MONTH = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])\.?"
_DAY = r"(\d{1,2})(?:st|nd|rd|th)?"
_YEAR = r"(20\d{2})"
_TO = r"\s*(?:-|–|—|to|until|till)\s*"

# Most specific first; a later pattern never matches inside an earlier match.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # 30 November - 2 December 2026
    ("dm-dm-y", re.compile(rf"\b{_DAY}\s+{_MONTH}{_TO}{_DAY}\s+{_MONTH},?\s*{_YEAR}?", re.I)),
    # 1-2 December 2026, 1st to 3rd Dec
    ("d-dm-y", re.compile(rf"\b{_DAY}{_TO}{_DAY}\s+{_MONTH},?\s*{_YEAR}?", re.I)),
    # December 1-2, 2026
    ("md-d-y", re.compile(rf"\b{_MONTH}\s+{_DAY}{_TO}{_DAY},?\s*{_YEAR}?", re.I)),
    # 3 December 2026, 5th Dec
    ("dm-y", re.compile(rf"\b{_DAY}\s+{_MONTH},?\s*{_YEAR}?", re.I)),
    # December 5, 2026
    ("md-y", re.compile(rf"\b{_MONTH}\s+{_DAY}\b,?\s*{_YEAR}?", re.I)),
    # 2026-12-05
    ("iso", re.compile(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b")),
    # 05/12/2026 or 05.12.2026 (day first, as written in Malaysia)
    ("dmy-num", re.compile(r"\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b")),
]


@dataclass(frozen=True)
class ExtractedEvent:
    title: str
    snippet: str
    page_number: int
    starts_at: date
    ends_at: date | None


def _month(token: str) -> int:
    return _MONTHS[token.lower().rstrip(".")]


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _resolve_year(month: int, day: int, year: str | None, today: date) -> int:
    """A date written without a year is the next one on or after today."""
    if year:
        return int(year)
    candidate = _safe_date(today.year, month, day)
    return today.year + 1 if candidate is not None and candidate < today else today.year


def _parse(kind: str, groups: tuple, today: date) -> tuple[date, date | None] | None:
    is_range = kind in ("dm-dm-y", "d-dm-y", "md-d-y")
    if kind == "dm-dm-y":
        d1, m1, d2, m2, year = groups
        m1, m2 = _month(m1), _month(m2)
        y2 = _resolve_year(m2, int(d2), year, today)
        y1 = y2 - 1 if m1 > m2 else y2  # 30 December - 2 January
        start, end = _safe_date(y1, m1, int(d1)), _safe_date(y2, m2, int(d2))
    elif kind == "d-dm-y":
        d1, d2, month, year = groups
        m = _month(month)
        y = _resolve_year(m, int(d2), year, today)
        start, end = _safe_date(y, m, int(d1)), _safe_date(y, m, int(d2))
    elif kind == "md-d-y":
        month, d1, d2, year = groups
        m = _month(month)
        y = _resolve_year(m, int(d2), year, today)
        start, end = _safe_date(y, m, int(d1)), _safe_date(y, m, int(d2))
    elif kind == "dm-y":
        day, month, year = groups
        m = _month(month)
        start, end = _safe_date(_resolve_year(m, int(day), year, today), m, int(day)), None
    elif kind == "md-y":
        month, day, year = groups
        m = _month(month)
        start, end = _safe_date(_resolve_year(m, int(day), year, today), m, int(day)), None
    elif kind == "iso":
        y, m, d = groups
        start, end = _safe_date(int(y), int(m), int(d)), None
    else:  # dmy-num
        d, m, y = groups
        start, end = _safe_date(int(y), int(m), int(d)), None

    # An impossible date (31 February) or a backwards range is not an event.
    if start is None or (is_range and (end is None or end < start)):
        return None
    if end == start:
        end = None
    return start, end


def find_dates(sentence: str, today: date) -> list[tuple[date, date | None, tuple[int, int]]]:
    """Every date or date range in the sentence, with its character span."""
    found: list[tuple[date, date | None, tuple[int, int]]] = []
    taken: list[tuple[int, int]] = []
    for kind, pattern in _PATTERNS:
        for match in pattern.finditer(sentence):
            span = match.span()
            if any(span[0] < end and start < span[1] for start, end in taken):
                continue
            # Claim the text even when it does not parse, so "5-2 December"
            # (backwards) is not re-read by a shorter pattern as "2 December".
            taken.append(span)
            parsed = _parse(kind, match.groups(), today)
            if parsed:
                found.append((parsed[0], parsed[1], span))
    return sorted(found, key=lambda item: item[2][0])


_SENTENCES = re.compile(r"(?<=[.!?])\s+|\n+")
_LEFTOVER = re.compile(r"\b(on|from|at|by|to|between|and|until|till|starting|dated?)\s*$", re.I)


def _title(sentence: str, spans: list[tuple[int, int]], fallback: str) -> str:
    text = sentence
    for start, end in sorted(spans, reverse=True):
        # Drop the date and the little word that introduced it ("on 3 May").
        before = _LEFTOVER.sub("", text[:start].rstrip())
        text = before + " " + text[end:]
    text = re.sub(r"\(\s*\)", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" ,;:-–—.")
    for _ in range(3):
        text = _LEFTOVER.sub("", text).strip(" ,;:-–—.")
    if len(text.split()) < 2:
        return fallback[:TITLE_MAX]
    return text if len(text) <= TITLE_MAX else text[: TITLE_MAX - 1].rstrip() + "…"


def earliest_date(today: date) -> date:
    """Events are kept from 1 January of the current year (owner decision);
    older history in a document stays off the calendar."""
    return date(today.year, 1, 1)


def extract_events(pages: list[tuple[int, str]], today: date, document_title: str) -> list[ExtractedEvent]:
    """Events from 1 January of this year on, each from a sentence with an
    event word. Past ones are kept too: the calendar shows them as history.

    The same date range appears once per document (its first mention).
    """
    earliest = earliest_date(today)
    events: list[ExtractedEvent] = []
    seen: set[tuple[date, date | None]] = set()

    for page_number, text in pages:
        for raw in _SENTENCES.split(text):
            sentence = " ".join(raw.split())
            if not sentence or not EVENT_WORDS.search(sentence) or NON_COMMITTAL.search(sentence):
                continue
            dates = find_dates(sentence, today)
            spans = [span for _, _, span in dates]
            for starts_at, ends_at, _span in dates:
                if (ends_at or starts_at) < earliest or (starts_at, ends_at) in seen:
                    continue
                seen.add((starts_at, ends_at))
                events.append(
                    ExtractedEvent(
                        title=_title(sentence, spans, document_title),
                        snippet=sentence[:SNIPPET_MAX],
                        page_number=page_number,
                        starts_at=starts_at,
                        ends_at=ends_at,
                    )
                )
                if len(events) >= EVENTS_MAX_PER_DOC:
                    print(f"[events] cap of {EVENTS_MAX_PER_DOC} reached; check the document for mis-parsed dates", flush=True)
                    return events
    return events
