"""Treat uploaded documents as untrusted input.

- scan_for_injection: heuristics for text written to steer the model rather
  than inform the reader. A hit holds the document for administrator review.
- redact_pii: masks personal data in chunk text before it is embedded or shown
  to the model. The stored original file is never modified.
- neutralize: stops excerpt text from closing the <document> data wrapper the
  prompt puts around it.
"""

import re

INJECTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "asks the model to ignore its instructions",
        re.compile(r"\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|directions)\b", re.I),
    ),
    ("tries to give the model a new role", re.compile(r"\byou are now\b|\bfrom now on,? you (are|will|must)\b|\bpretend (to be|you are)\b|\bact as (an?|the) (ai|assistant|system|admin)", re.I)),
    ("asks for the system prompt", re.compile(r"\b(reveal|print|show|repeat|output|leak)\b[^.\n]{0,30}\b(system prompt|hidden instructions|your instructions)\b", re.I)),
    ("contains chat-role markup", re.compile(r"<\s*/?\s*(system|assistant|im_start|im_end)\s*>|\[/?INST\]|<<\s*SYS\s*>>", re.I)),
    ("mentions jailbreaking", re.compile(r"\bjailbreak\w*\b|\bDAN mode\b|\bdeveloper mode\b", re.I)),
    ("tries to change citation or refusal behaviour", re.compile(r"\b(do not|don't|never)\s+(cite|mention|refuse)\b[^.\n]{0,40}\b(sources?|documents?|this)\b", re.I)),
]


def scan_for_injection(text: str) -> list[str]:
    """Return a reason for every pattern found; empty means clean."""
    return [reason for reason, pattern in INJECTION_PATTERNS if pattern.search(text)]


EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
# Malaysian NRIC (YYMMDD-PB-NNNN), with or without dashes.
NRIC = re.compile(r"\b\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])-?\d{2}-?\d{4}\b")
# Malaysian mobiles (01X-XXX XXXX) and any number written in +country form.
PHONE = re.compile(r"(?<![\w-])(\+?60|0)1\d[- ]?\d{3,4}[- ]?\d{4}\b|\+\d{1,3}[- ]?\(?\d{1,4}\)?[- ]?\d{3,4}[- ]?\d{3,4}\b")
CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")


def _luhn(number: str) -> bool:
    digits = [int(d) for d in number if d.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    checksum = 0
    for index, digit in enumerate(reversed(digits)):
        if index % 2:
            digit *= 2
            digit -= 9 if digit > 9 else 0
        checksum += digit
    return checksum % 10 == 0


def redact_pii(text: str) -> tuple[str, int]:
    """Mask emails, NRIC numbers, phone numbers and card numbers."""
    count = 0

    def replace(label: str):
        def _sub(match: re.Match[str]) -> str:
            nonlocal count
            count += 1
            return f"[REDACTED {label}]"
        return _sub

    def card(match: re.Match[str]) -> str:
        nonlocal count
        if not _luhn(match.group(0)):
            return match.group(0)
        count += 1
        return "[REDACTED CARD]"

    text = EMAIL.sub(replace("EMAIL"), text)
    text = CARD.sub(card, text)
    text = NRIC.sub(replace("ID NUMBER"), text)
    text = PHONE.sub(replace("PHONE"), text)
    return text, count


def neutralize(text: str) -> str:
    """Excerpts sit inside <document> tags; make sure they cannot close them."""
    return re.sub(r"<\s*/?\s*document\b[^>]*>", "[tag removed]", text, flags=re.I)
