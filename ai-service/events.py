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

# A date becomes an event only when its sentence (or, for a schedule table,
# the page heading) contains one of these. English and Malay.
EVENT_WORDS = re.compile(
    r"\b(meeting|meet|briefing|training|workshop|session|deadline|due|submit|submission|audit|inspection|"
    r"review|town\s*hall|conference|seminar|webinar|orientation|interview|exam|examination|assessment|"
    r"launch|ceremony|drill|course|retreat|forum|visit|duty|roster|"
    # Malay
    r"mesyuarat|taklimat|latihan|bengkel|kursus|persidangan|sidang|bertugas|tugasan|tarikh\s+akhir|"
    r"tarikh\s+tutup|lawatan|majlis|pemeriksaan|temu\s*duga|peperiksaan|penilaian|sesi|jadual\s+tugas)\b",
    re.I,
)
# Dates in these sentences are not commitments yet.
NON_COMMITTAL = re.compile(
    r"\b(TBC|TBA|TBD|to be (confirmed|announced|determined)|akan dimaklumkan|belum (disahkan|dimuktamadkan))\b",
    re.I,
)

_MONTHS = {
    name: number
    for number, names in enumerate(
        [
            ("january", "jan", "januari"), ("february", "feb", "februari"), ("march", "mar", "mac"),
            ("april", "apr"), ("may", "mei"), ("june", "jun"), ("july", "jul", "julai"),
            ("august", "aug", "ogos", "ogo"), ("september", "sep", "sept"), ("october", "oct", "oktober", "okt"),
            ("november", "nov"), ("december", "dec", "disember", "dis"),
        ],
        start=1,
    )
    for name in names
}
# English and Malay month names. The lookahead stops "mar" matching inside "market".
_MONTH = (
    r"(januari|january|jan|februari|february|feb|march|mar|mac|april|apr|may|mei|june|jun|julai|july|jul|"
    r"august|aug|ogos|ogo|september|sept|sep|oktober|october|oct|okt|november|nov|disember|december|dec|dis)"
    r"(?![a-z])\.?"
)
_DAY = r"(\d{1,2})(?:st|nd|rd|th|hb)?"
_YEAR = r"(20\d{2})"
_TO = r"\s*(?:-|–|—|to|until|till|hingga|sehingga|sampai)\s*"
_WEEKDAY = re.compile(
    r"^\(?\s*(isnin|selasa|rabu|khamis|jumaat|sabtu|ahad|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*\)?\.?$",
    re.I,
)

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
_LEFTOVER = re.compile(
    r"\b(on|from|at|by|to|between|and|until|till|starting|dated?|pada|dari|daripada|hingga|sehingga|sebelum|bertarikh|mulai)\s*$",
    re.I,
)


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


# --- schedule tables (rosters, timetables) -------------------------------------

# A line that starts a dated row: optional numbering ("1." or "12)"), then the date.
_ROW_PREFIX = re.compile(r"^\s*(?:\d{1,3}\s*[.)]\s*)?")
# Lines that carry no title value inside a row.
_NOISE_LINE = re.compile(r"^(\[REDACTED [A-Z ]+\]|\(?[A-Z]{0,3}/?\d[\d/ ]*\)?|\d+)$")
MIN_SCHEDULE_ROWS = 3


@dataclass(frozen=True)
class _Row:
    line_index: int
    starts_at: date
    ends_at: date | None


def _row_dates(lines: list[str], today: date) -> list[_Row]:
    """Lines that begin with a date (after optional numbering)."""
    rows = []
    for index, line in enumerate(lines):
        prefix = _ROW_PREFIX.match(line).end()
        rest = line[prefix:]
        found = find_dates(rest, today)
        if found and found[0][2][0] == 0:
            rows.append(_Row(index, found[0][0], found[0][1]))
    return rows


def _heading(lines: list[str]) -> str:
    """The heading line that names the event (with its continuation line),
    from the text above the table. Uppercase headings become title case."""
    for index, line in enumerate(lines):
        if EVENT_WORDS.search(line):
            parts = [line.strip()]
            following = lines[index + 1].strip() if index + 1 < len(lines) else ""
            if following and following.isupper() and not re.search(r"\b(BIL|TARIKH|DATE|NO)\b", following):
                parts.append(following)
            text = " ".join(" ".join(parts).split())
            return text.title() if text.isupper() else text
    return ""


def _label(heading: str) -> str:
    """Short prefix for row titles: "Pegawai bertugas", or the event word."""
    if re.search(r"pegawai\s+bertugas", heading, re.I):
        return "Pegawai bertugas"
    if re.search(r"on\s+duty|duty\s+officer", heading, re.I):
        return "Duty officer"
    word = EVENT_WORDS.search(heading)
    return word.group(0).capitalize() if word else ""


def _row_title(block: list[str], label: str, fallback: str) -> str:
    """Label plus the first meaningful line of the row (for a roster, the
    person on duty), skipping the weekday, numbers and masked details."""
    for line in block[1:]:
        text = line.strip()
        if not text or _WEEKDAY.match(text) or _NOISE_LINE.match(text):
            continue
        title = f"{label}: {text}" if label else text
        return title if len(title) <= TITLE_MAX else title[: TITLE_MAX - 1].rstrip() + "…"
    return (label or fallback)[:TITLE_MAX]


def _schedule_events(
    pages: list[tuple[int, str]], today: date, document_title: str
) -> tuple[list[ExtractedEvent], set[int]]:
    """Events from schedule tables: one per dated row, plus one spanning the
    whole schedule (owner decision). A page counts as a schedule when at
    least three lines start with a date and the page heading, or the first
    page's heading, contains an event word. Returns the events and the page
    numbers handled this way, which skip sentence extraction."""
    document_heading = ""
    events: list[ExtractedEvent] = []
    handled: set[int] = set()

    for page_number, text in pages:
        lines = [line for line in text.splitlines() if line.strip()]
        rows = _row_dates(lines, today)
        above = lines[: rows[0].line_index] if rows else lines
        heading = _heading(above) or ""
        document_heading = document_heading or heading
        # Column headers like "BIL TARIKH / HARI PEGAWAI BERTUGAS" count too.
        heading = heading or document_heading
        if len(rows) < MIN_SCHEDULE_ROWS or not heading or NON_COMMITTAL.search(" ".join(above)):
            continue

        handled.add(page_number)
        label = _label(heading)
        for position, row in enumerate(rows):
            end = rows[position + 1].line_index if position + 1 < len(rows) else len(lines)
            block = lines[row.line_index:end]
            events.append(
                ExtractedEvent(
                    title=_row_title(block, label, document_title),
                    snippet=" ".join(" ".join(block).split())[:SNIPPET_MAX],
                    page_number=page_number,
                    starts_at=row.starts_at,
                    ends_at=row.ends_at,
                )
            )

    if len(events) >= 2:
        first = min(event.starts_at for event in events)
        last = max(event.ends_at or event.starts_at for event in events)
        if last > first:
            whole_title = document_heading or document_title
            events.insert(
                0,
                ExtractedEvent(
                    title=whole_title if len(whole_title) <= TITLE_MAX else whole_title[: TITLE_MAX - 1].rstrip() + "…",
                    snippet=f"{document_heading or document_title}: {len(events)} scheduled dates."[:SNIPPET_MAX],
                    page_number=min(handled),
                    starts_at=first,
                    ends_at=last,
                ),
            )
    return events, handled


# --- extraction -------------------------------------------------------------------

def extract_events(pages: list[tuple[int, str]], today: date, document_title: str) -> list[ExtractedEvent]:
    """Events from 1 January of this year on. Past ones are kept too: the
    calendar shows them as history.

    Schedule tables give one event per dated row plus one for the whole
    schedule; everywhere else an event comes from a sentence with an event
    word, and the same date range appears once per document.
    """
    earliest = earliest_date(today)
    schedule, schedule_pages = _schedule_events(pages, today, document_title)
    events = [event for event in schedule if (event.ends_at or event.starts_at) >= earliest]
    seen: set[tuple[date, date | None]] = {(event.starts_at, event.ends_at) for event in events}

    for page_number, text in pages:
        if page_number in schedule_pages:
            continue
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

    if len(events) > EVENTS_MAX_PER_DOC:
        print(f"[events] cap of {EVENTS_MAX_PER_DOC} reached; check the document for mis-parsed dates", flush=True)
    return events[:EVENTS_MAX_PER_DOC]
