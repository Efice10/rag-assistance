"""Run the golden question set and score it.

Run from ai-service/:

    .\\venv\\Scripts\\python.exe -m eval.run_eval --structural
    .\\venv\\Scripts\\python.exe -m eval.run_eval --live

--structural (the default, used in CI) runs the real answer pipeline
(rag.answer_stream: history handling, retrieval text, exact-term detection,
refusal and citation logic) in-process over eval/corpus.jsonl, with an
in-memory retriever that applies the same scope rule and a deterministic
extractive "model". No database or Ollama is needed. The SQL itself is
covered by the pytest suite.

--live posts every case to the running AI service's /query (with the internal
secret, never through Laravel), against the real Supabase data and Ollama.
Scopes are written as organization slug + department name and resolved to ids
in the database, so the golden file works on any seeded install.

Reports go to eval/reports/<mode>-latest.{md,json}. The exit code is non-zero
when any RBAC violation occurs or a metric is below its threshold.
"""

import argparse
import json
import math
import re
import sys
import urllib.request
from pathlib import Path

import rag
from config import settings
from rag import REFUSAL, Chunk, HistoryTurn, QueryRequest, exact_terms, retrieval_text

from .scoring import Case, Outcome, as_json, failures, markdown_report, score_case, summarize

HERE = Path(__file__).parent
THRESHOLDS = {
    "structural": {"refusal_accuracy": 1.0, "keyword_hit_rate": 0.9, "citation_recall": 0.9},
    # A real model words answers its own way; keep the live bar a little lower.
    "live": {"refusal_accuracy": 0.9, "keyword_hit_rate": 0.7, "citation_recall": 0.8},
}

STOPWORDS = set(
    "a an and are as at be by can do does for from how i in is it many may much must of on or "
    "our the their them they this to under up what when where which who whom why will with".split()
)


def load_cases(path: Path) -> list[Case]:
    cases = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            cases.append(Case(**json.loads(line)))
    return cases


def words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9][a-z0-9.,]*[a-z0-9]|[a-z0-9]", text.lower()) if w not in STOPWORDS]


def cosine(a: list[str], b: list[str]) -> float:
    if not a or not b:
        return 0.0
    sa, sb = set(a), set(b)
    return len(sa & sb) / math.sqrt(len(sa) * len(sb))


# --- structural tier -----------------------------------------------------------

class Structural:
    """In-memory stand-ins for the database and the model."""

    MIN_SIMILARITY = 0.2

    def __init__(self, corpus_path: Path):
        self.chunks = [json.loads(line) for line in corpus_path.read_text(encoding="utf-8").splitlines() if line.strip()]
        orgs = sorted({c["organization"] for c in self.chunks} | {"acme", "globex"})
        self.org_ids = {slug: index + 1 for index, slug in enumerate(orgs)}
        departments = sorted({(c["organization"], c["department"]) for c in self.chunks})
        self.department_ids = {key: index + 1 for index, key in enumerate(departments)}

    def request_for(self, case: Case) -> QueryRequest:
        scope = case.scope
        return QueryRequest(
            prompt=case.question,
            organization_id=self.org_ids[scope["organization"]],
            # An unknown department (e.g. Compliance) gets an id no chunk has.
            department_id=self.department_ids.get((scope["organization"], scope["department"]), 999),
            clearance_level=scope["clearance_level"],
            is_admin=scope.get("is_admin", False),
            history=[HistoryTurn(**turn) for turn in case.history],
        )

    def in_scope(self, chunk: dict, request: QueryRequest) -> bool:
        """The same rule as rag.scope_filter / Document::scopeVisibleTo."""
        return (
            self.org_ids[chunk["organization"]] == request.organization_id
            and chunk["clearance_level"] <= request.clearance_level
            and (request.is_admin or self.department_ids[(chunk["organization"], chunk["department"])] == request.department_id)
        )

    def retrieve(self, request: QueryRequest) -> list[Chunk]:
        query = words(retrieval_text(request))
        terms = [t.lower() for t in exact_terms(request.prompt)]
        found = []
        for index, chunk in enumerate(self.chunks):
            if not self.in_scope(chunk, request):
                continue
            haystack = f"{chunk['title']} {chunk['content']}".lower()
            keyword = bool(terms) and all(term in haystack for term in terms)
            found.append(Chunk(index, chunk["title"], chunk["page"], chunk["content"], cosine(query, words(haystack)), keyword))
        found.sort(key=lambda c: (c.keyword_match, c.similarity), reverse=True)
        return [c for c in found[: settings.top_k] if c.similarity >= self.MIN_SIMILARITY or c.keyword_match]

    @staticmethod
    def stream_chat(messages: list[dict]):
        """An extractive 'model': the excerpt sentence that best overlaps the
        question (plus the previous user turn), with its citation."""
        final = messages[-1]["content"]
        question = final.rsplit("Question:", 1)[-1]
        earlier = " ".join(m["content"] for m in messages[1:-1] if m["role"] == "user")
        wanted = set(words(f"{earlier} {question}"))
        best, best_overlap = None, 0
        for title, page, body in re.findall(r'<document title="([^"]*)" page="(\d+)">\n(.*?)\n</document>', final, re.S):
            for sentence in re.split(r"(?<=[.!?])\s+", body):
                overlap = len(wanted & set(words(sentence)))
                if overlap > best_overlap:
                    best, best_overlap = (sentence.strip(), title, page), overlap
        if best is None or best_overlap < 2:
            yield REFUSAL
            return
        sentence, title, page = best
        yield f"{sentence} [{title}, Page {page}]"

    def run(self, case: Case) -> Outcome:
        original = rag.retrieve, rag.stream_chat
        rag.retrieve, rag.stream_chat = self.retrieve, self.stream_chat
        try:
            return parse_stream("".join(rag.answer_stream(self.request_for(case))))
        finally:
            rag.retrieve, rag.stream_chat = original


# --- live tier -----------------------------------------------------------------

class Live:
    def __init__(self, base_url: str):
        from database import get_connection

        self.base_url = base_url.rstrip("/")
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT id, slug FROM organizations")
            self.org_ids = {slug: id_ for id_, slug in cur.fetchall()}
            cur.execute("SELECT d.id, o.slug, d.name FROM departments d JOIN organizations o ON o.id = d.organization_id")
            self.department_ids = {(slug, name): id_ for id_, slug, name in cur.fetchall()}

    def run(self, case: Case) -> Outcome:
        scope = case.scope
        body = {
            "prompt": case.question,
            "organization_id": self.org_ids[scope["organization"]],
            "department_id": self.department_ids.get((scope["organization"], scope["department"]), 0),
            "clearance_level": scope["clearance_level"],
            "is_admin": scope.get("is_admin", False),
            "history": case.history,
        }
        request = urllib.request.Request(
            f"{self.base_url}/query",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "X-Internal-Secret": settings.internal_api_secret},
        )
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                return parse_stream(response.read().decode("utf-8"))
        except Exception as error:  # noqa: BLE001 - reported per case
            return Outcome(answer="", cited_titles=[], error=repr(error))


# --- shared --------------------------------------------------------------------

def parse_stream(raw: str) -> Outcome:
    answer, titles, error = "", [], None
    for block in raw.replace("\r\n", "\n").split("\n\n"):
        event = re.search(r"^event:\s*(\S+)", block, re.M)
        data = re.search(r"^data:\s*(.*)$", block, re.M)
        if not event or not data:
            continue
        payload = json.loads(data.group(1) or "{}")
        if event.group(1) == "token":
            answer += payload.get("text", "")
        elif event.group(1) == "sources":
            titles = list(dict.fromkeys(source["document_title"] for source in payload.get("sources", [])))
        elif event.group(1) == "error":
            error = payload.get("message", "error")
    return Outcome(answer=answer, cited_titles=titles, error=error)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--structural", action="store_true", help="in-process, no database or Ollama (default)")
    mode.add_argument("--live", action="store_true", help="against the running AI service")
    parser.add_argument("--base-url", default="http://127.0.0.1:8001")
    parser.add_argument("--golden", type=Path, default=HERE / "golden.jsonl")
    parser.add_argument("--corpus", type=Path, default=HERE / "corpus.jsonl")
    parser.add_argument("--reports", type=Path, default=HERE / "reports")
    args = parser.parse_args(argv)

    name = "live" if args.live else "structural"
    runner = Live(args.base_url) if args.live else Structural(args.corpus)
    cases = load_cases(args.golden)
    scores = [score_case(case, runner.run(case)) for case in cases]
    summary = summarize(scores)
    problems = failures(summary, THRESHOLDS[name])

    args.reports.mkdir(parents=True, exist_ok=True)
    report = markdown_report(name, summary, scores, problems)
    (args.reports / f"{name}-latest.md").write_text(report, encoding="utf-8")
    (args.reports / f"{name}-latest.json").write_text(json.dumps(as_json(name, summary, scores, problems), indent=2), encoding="utf-8")

    print(report)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
