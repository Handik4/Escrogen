"""Shared fixtures / mock helpers for Escrogen direct-mode tests."""

import json

CONTRACT = "contracts/escrogen.py"

# One GEN, in wei.
ONE_GEN = 1_000_000_000_000_000_000

# Any evidence URL used by the leader fetch in tests.
EVIDENCE_URL = "https://proof.example.com/deliverable/42"


def mock_evidence_page(direct_vm, html: str):
    """Mock the evidence page fetched via gl.nondet.web.render()."""
    direct_vm.mock_web(
        r".*proof\.example\.com.*",
        {"status": 200, "body": html},
    )


def mock_verdict(direct_vm, verdict: str, reasoning: str = "ok"):
    """Mock the arbiter LLM to return a well-formed canonical verdict."""
    direct_vm.mock_llm(
        r".*impartial.*escrow arbiter.*",
        json.dumps({"verdict": verdict, "reasoning": reasoning}),
    )


def mock_raw_llm(direct_vm, raw: str):
    """Mock the arbiter LLM to return an arbitrary (possibly bad) payload."""
    direct_vm.mock_llm(r".*impartial.*escrow arbiter.*", raw)
