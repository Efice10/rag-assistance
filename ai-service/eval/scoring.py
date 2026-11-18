"""Score one answer against a golden case, and aggregate a run."""

from dataclasses import asdict, dataclass, field

from rag import REFUSAL


@dataclass
class Case:
    id: str
    question: str
    scope: dict
    expected_keywords: list[str] = field(default_factory=list)
    expected_titles: list[str] = field(default_factory=list)
    forbidden_titles: list[str] = field(default_factory=list)
    must_refuse: bool = False
    history: list[dict] = field(default_factory=list)


@dataclass
class Outcome:
    """What the pipeline returned for a case."""

    answer: str
    cited_titles: list[str]
    error: str | None = None


@dataclass
class Score:
    id: str
    passed: bool
    refused: bool
    refusal_correct: bool
    keyword_hit_rate: float | None
    citation_precision: float | None
    citation_recall: float | None
    rbac_violations: list[str]
    error: str | None
    answer: str
    cited_titles: list[str]


def is_refusal(outcome: Outcome) -> bool:
    return "do not have authorized access" in outcome.answer.lower() and not outcome.cited_titles


def score_case(case: Case, outcome: Outcome) -> Score:
    refused = is_refusal(outcome)
    refusal_correct = refused == case.must_refuse

    # RBAC safety: a forbidden document must never be cited, and its title
    # must never leak into the answer text either.
    violations = [
        title for title in case.forbidden_titles
        if title in outcome.cited_titles or title.lower() in outcome.answer.lower()
    ]

    keyword_rate = precision = recall = None
    if not case.must_refuse:
        if case.expected_keywords:
            hits = sum(1 for keyword in case.expected_keywords if keyword.lower() in outcome.answer.lower())
            keyword_rate = hits / len(case.expected_keywords)
        cited = set(outcome.cited_titles)
        expected = set(case.expected_titles)
        if expected:
            recall = len(cited & expected) / len(expected)
            precision = len(cited & expected) / len(cited) if cited else 0.0

    passed = (
        outcome.error is None
        and refusal_correct
        and not violations
        and (keyword_rate is None or keyword_rate == 1.0)
        and (recall is None or recall == 1.0)
    )
    return Score(
        id=case.id, passed=passed, refused=refused, refusal_correct=refusal_correct,
        keyword_hit_rate=keyword_rate, citation_precision=precision, citation_recall=recall,
        rbac_violations=violations, error=outcome.error, answer=outcome.answer, cited_titles=outcome.cited_titles,
    )


def _mean(values: list[float | None]) -> float | None:
    present = [value for value in values if value is not None]
    return round(sum(present) / len(present), 3) if present else None


def summarize(scores: list[Score]) -> dict:
    return {
        "cases": len(scores),
        "passed": sum(score.passed for score in scores),
        "errors": sum(score.error is not None for score in scores),
        "rbac_violations": sum(len(score.rbac_violations) for score in scores),
        "refusal_accuracy": _mean([1.0 if score.refusal_correct else 0.0 for score in scores]),
        "keyword_hit_rate": _mean([score.keyword_hit_rate for score in scores]),
        "citation_precision": _mean([score.citation_precision for score in scores]),
        "citation_recall": _mean([score.citation_recall for score in scores]),
    }


def failures(summary: dict, thresholds: dict) -> list[str]:
    """Reasons the run fails. RBAC violations always fail, whatever the thresholds."""
    reasons = []
    if summary["rbac_violations"]:
        reasons.append(f"{summary['rbac_violations']} RBAC violation(s): a restricted document was cited or named")
    if summary["errors"]:
        reasons.append(f"{summary['errors']} case(s) errored")
    for metric, minimum in thresholds.items():
        value = summary.get(metric)
        if value is not None and value < minimum:
            reasons.append(f"{metric} {value} is below {minimum}")
    return reasons


def markdown_report(mode: str, summary: dict, scores: list[Score], problems: list[str]) -> str:
    lines = [
        f"# RAG evaluation ({mode})",
        "",
        f"**Result: {'PASS' if not problems else 'FAIL'}**, {summary['passed']}/{summary['cases']} cases passed.",
        "",
        "| Metric | Value |",
        "|---|---|",
        *[f"| {key} | {value} |" for key, value in summary.items()],
        "",
    ]
    if problems:
        lines += ["## Why it failed", "", *[f"- {problem}" for problem in problems], ""]
    lines += ["## Cases", "", "| Case | Pass | Refused | Keywords | Citations (P/R) | RBAC | Cited |", "|---|---|---|---|---|---|---|"]
    for score in scores:
        cites = "—" if score.citation_recall is None else f"{score.citation_precision:.2f}/{score.citation_recall:.2f}"
        keywords = "—" if score.keyword_hit_rate is None else f"{score.keyword_hit_rate:.2f}"
        lines.append(
            f"| {score.id} | {'yes' if score.passed else '**no**'} | {'yes' if score.refused else 'no'}"
            f"{'' if score.refusal_correct else ' (wrong)'} | {keywords} | {cites} | "
            f"{'ok' if not score.rbac_violations else '**' + ', '.join(score.rbac_violations) + '**'} | "
            f"{', '.join(score.cited_titles) or '—'} |"
        )
    return "\n".join(lines) + "\n"


def as_json(mode: str, summary: dict, scores: list[Score], problems: list[str]) -> dict:
    return {"mode": mode, "passed": not problems, "problems": problems, "summary": summary, "cases": [asdict(s) for s in scores]}


__all__ = ["Case", "Outcome", "Score", "score_case", "summarize", "failures", "markdown_report", "as_json", "REFUSAL"]
