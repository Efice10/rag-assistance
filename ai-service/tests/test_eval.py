"""Tests for the evaluation scorer and the structural run (no database or Ollama)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from eval import run_eval
from eval.scoring import Case, Outcome, failures, score_case, summarize
from rag import REFUSAL

SCOPE = {"organization": "acme", "department": "Procurement", "clearance_level": 1}


def test_a_correct_cited_answer_passes():
    case = Case(id="c", question="q", scope=SCOPE, expected_keywords=["economy"], expected_titles=["Travel Policy"])

    score = score_case(case, Outcome("Book economy [Travel Policy, Page 1].", ["Travel Policy"]))

    assert score.passed and score.citation_precision == 1.0 and score.keyword_hit_rate == 1.0


def test_citing_a_forbidden_document_is_an_rbac_violation_even_if_the_answer_is_right():
    case = Case(id="c", question="q", scope=SCOPE, expected_titles=["Travel Policy"], forbidden_titles=["Procurement SOP"])

    score = score_case(case, Outcome("Economy.", ["Travel Policy", "Procurement SOP"]))

    assert not score.passed and score.rbac_violations == ["Procurement SOP"]


def test_naming_a_forbidden_document_in_the_text_is_also_a_violation():
    case = Case(id="c", question="q", scope=SCOPE, must_refuse=True, forbidden_titles=["Procurement SOP"])

    score = score_case(case, Outcome("I cannot share the Procurement SOP.", []))

    assert score.rbac_violations == ["Procurement SOP"]


def test_refusal_is_scored_both_ways():
    refuse = Case(id="r", question="q", scope=SCOPE, must_refuse=True)
    answer = Case(id="a", question="q", scope=SCOPE, expected_titles=["Travel Policy"])

    assert score_case(refuse, Outcome(REFUSAL, [])).passed
    assert not score_case(refuse, Outcome("Economy.", ["Travel Policy"])).passed
    assert not score_case(answer, Outcome(REFUSAL, [])).passed


def test_any_rbac_violation_fails_the_run_regardless_of_thresholds():
    case = Case(id="c", question="q", scope=SCOPE, forbidden_titles=["X"])
    summary = summarize([score_case(case, Outcome("ok", ["X"]))])

    assert failures(summary, {}) and "RBAC" in failures(summary, {})[0]


def test_low_metrics_fail_the_run():
    case = Case(id="c", question="q", scope=SCOPE, expected_keywords=["three"], expected_titles=["SOP"])
    summary = summarize([score_case(case, Outcome("Two.", ["SOP"]))])

    assert any("keyword_hit_rate" in reason for reason in failures(summary, {"keyword_hit_rate": 0.9}))


def test_the_structural_run_over_the_golden_set_passes(tmp_path):
    assert run_eval.main(["--structural", "--reports", str(tmp_path)]) == 0
    assert (tmp_path / "structural-latest.md").read_text(encoding="utf-8").count("| yes |") >= 1
    assert '"rbac_violations": 0' in (tmp_path / "structural-latest.json").read_text(encoding="utf-8")


def test_the_structural_run_catches_a_scope_leak(tmp_path, monkeypatch):
    # Break the in-memory scope rule: everything becomes visible.
    monkeypatch.setattr(run_eval.Structural, "in_scope", lambda self, chunk, request: True)

    assert run_eval.main(["--structural", "--reports", str(tmp_path)]) == 1
    assert "RBAC violation" in (tmp_path / "structural-latest.md").read_text(encoding="utf-8")
