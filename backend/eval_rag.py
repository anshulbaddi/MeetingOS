"""
RAG evaluation for the MeetingOS chat endpoint.

Four metrics per question:
  retrieval_hit    gold segment is present in the top-5 cited (binary)
  retrieval_rank   position of the gold segment (1–5, or None on miss)
  faithfulness     LLM judge: every claim in the answer is grounded in the cited
                   segments — not hallucinated (0.0–1.0)
  relevance        LLM judge: the answer actually addresses the question (0.0–1.0)

Run:
    python eval_rag.py
"""

import datetime
import json
import os
import sys
from typing import List, Optional

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sys.path.insert(0, os.path.dirname(__file__))

from chat import ask_meeting  # the function under evaluation

# ── Eval corpus ────────────────────────────────────────────────────────────────
# "End To End Test" meeting — 4 segments with known ground-truth content.
MEETING_ID = "4028f1ba-cdb0-41e2-b725-6a45fc17b8bc"
USER_ID = "eval-runner"

# Segment IDs from the DB (verified before writing this file)
SEG_INTRO  = "b084f492-d328-4e8b-9fc2-2167e9f24030"  # "This is a test meeting recording."
SEG_SHIP   = "7cca776f-8285-4da9-b6e2-d2425dbfa60a"  # "The team agreed to ship the new feature by Friday."
SEG_JOHN   = "da969e98-6255-439f-9267-c8ab9f83f44e"  # "John will handle the backend changes,"
SEG_SARAH  = "cad050ad-030e-42fa-ae94-2fdff79ffb28"  # "and Sarah will write the tests."

# ── Test cases ─────────────────────────────────────────────────────────────────
class TestCase:
    def __init__(
        self,
        question: str,
        gold_segment_id: str,
        expected_keywords: List[str],
        is_negative: bool = False,
    ):
        self.question = question
        self.gold_segment_id = gold_segment_id
        self.expected_keywords = expected_keywords
        # negative = the answer should admit the info isn't in the transcript
        self.is_negative = is_negative


TEST_CASES: List[TestCase] = [
    # ── Positive cases: the answer IS in the transcript ──────────────────────
    TestCase(
        question="When is the feature being shipped?",
        gold_segment_id=SEG_SHIP,
        expected_keywords=["Friday"],
    ),
    TestCase(
        question="Who is handling the backend changes?",
        gold_segment_id=SEG_JOHN,
        expected_keywords=["John"],
    ),
    TestCase(
        question="What is Sarah's responsibility?",
        gold_segment_id=SEG_SARAH,
        expected_keywords=["test"],
    ),
    TestCase(
        question="What decisions were made in the meeting?",
        gold_segment_id=SEG_SHIP,
        expected_keywords=["Friday", "feature"],
    ),
    # ── Negative case: the answer is NOT in the transcript ───────────────────
    # A well-behaved RAG system should say "not mentioned" rather than hallucinate.
    TestCase(
        question="Was a database migration discussed?",
        gold_segment_id=SEG_INTRO,  # closest match; the system should still say "no"
        expected_keywords=["not", "no", "mention"],
        is_negative=True,
    ),
]

# ── LLM-as-judge ───────────────────────────────────────────────────────────────
JUDGE_SYSTEM = """You are an evaluator of RAG chatbot answers about meeting transcripts.

The chatbot receives timestamped transcript segments such as "[0:02] The team decided..."
and uses them to answer questions. When the answer says "At 0:02, ..." that IS a citation
to a provided segment — it is NOT a hallucination. Timestamp references are valid as long
as a segment at approximately that time appears in the context.

Rate two dimensions from 0.0 to 1.0:

faithfulness — Every factual claim in the answer is directly supported by the provided
               segments (timestamps count as valid citations, not hallucinations).
               Score 1.0 = fully grounded. Score 0.0 = introduces facts not in segments.

relevance    — The answer actually addresses the question being asked.
               Score 1.0 = fully on-topic and useful. Score 0.0 = ignores the question.

Respond ONLY with valid JSON:
{"faithfulness": <float>, "relevance": <float>, "reasoning": "<one sentence>"}"""


def judge(
    client: OpenAI,
    question: str,
    cited_segments: List[dict],
    answer: str,
) -> dict:
    seg_text = "\n".join(
        f"  [{s['start_sec']:.1f}s] {s['text']}" for s in cited_segments
    )
    user_msg = (
        f"Question: {question}\n\n"
        f"Context segments:\n{seg_text}\n\n"
        f"Answer: {answer}"
    )
    resp = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        response_format={"type": "json_object"},
    )
    return json.loads(resp.choices[0].message.content)


# ── Runner ─────────────────────────────────────────────────────────────────────
def run() -> None:
    client = OpenAI()
    rows = []

    for i, tc in enumerate(TEST_CASES, 1):
        label = "[NEG]" if tc.is_negative else "     "
        print(f"\n{label} [{i}/{len(TEST_CASES)}] {tc.question}")

        result = ask_meeting(MEETING_ID, USER_ID, tc.question)
        answer    = result["answer"]
        cited     = result["cited_segments"]
        cited_ids = [s["segment_id"] for s in cited]
        rewritten = result.get("rewritten_query", "")

        # ── Retrieval metrics ───────────────────────────────────────────────
        # A hit is when the gold segment ID appears either as a direct citation
        # (segment-based fallback) or inside a chunk's source_segment_ids list.
        def _contains_gold(c: dict) -> bool:
            if c["segment_id"] == tc.gold_segment_id:
                return True
            return tc.gold_segment_id in (c.get("source_segment_ids") or [])

        hit_idx: Optional[int] = next(
            (i for i, c in enumerate(cited) if _contains_gold(c)), None
        )
        hit  = hit_idx is not None
        rank: Optional[int] = (hit_idx + 1) if hit else None

        # ── Keyword match ───────────────────────────────────────────────────
        answer_lower = answer.lower()
        keyword_hit  = any(kw.lower() in answer_lower for kw in tc.expected_keywords)

        # ── LLM judge ──────────────────────────────────────────────────────
        scores = judge(client, tc.question, cited, answer)

        short_answer = (answer[:110] + "…") if len(answer) > 110 else answer
        print(f"  Rewrite    : {rewritten}")
        print(f"  Answer     : {short_answer}")
        print(f"  Gold rank  : {'#' + str(rank) if hit else 'MISS'}")
        print(f"  Keywords   : {'✓' if keyword_hit else '✗'}  ({', '.join(tc.expected_keywords)})")
        print(f"  Faith/Rel  : {scores['faithfulness']:.2f} / {scores['relevance']:.2f}")
        print(f"  Judge note : {scores['reasoning']}")

        rows.append({
            "question":        tc.question,
            "is_negative":     tc.is_negative,
            "rewritten_query": rewritten,
            "answer":          answer,
            "cited_segments":  cited,        # saved so timestamps can be verified
            "retrieval_hit":   hit,
            "retrieval_rank":  rank,
            "keyword_match":   keyword_hit,
            "faithfulness":    scores["faithfulness"],
            "relevance":       scores["relevance"],
            "reasoning":       scores["reasoning"],
        })

    # ── Aggregate metrics ───────────────────────────────────────────────────────
    n        = len(rows)
    pos_rows = [r for r in rows if not TEST_CASES[rows.index(r)].is_negative]
    neg_rows = [r for r in rows if TEST_CASES[rows.index(r)].is_negative]

    hit_rate   = sum(r["retrieval_hit"]  for r in rows) / n
    kw_rate    = sum(r["keyword_match"]  for r in rows) / n
    avg_faith  = sum(r["faithfulness"]   for r in rows) / n
    avg_rel    = sum(r["relevance"]      for r in rows) / n

    # Ranks for hits only (lower = better retrieval)
    ranks = [r["retrieval_rank"] for r in rows if r["retrieval_rank"] is not None]
    avg_rank = sum(ranks) / len(ranks) if ranks else None

    # Negative case: did the model correctly admit ignorance? (keyword "not/no/mention")
    neg_correct = sum(r["keyword_match"] for r in neg_rows)

    print(f"\n{'═' * 58}")
    print(f"  Cases              : {n}  ({len(pos_rows)} positive, {len(neg_rows)} negative)")
    print(f"  Retrieval Hit Rate : {hit_rate:.0%}  ({sum(r['retrieval_hit'] for r in rows)}/{n})")
    print(f"  Avg Retrieval Rank : {avg_rank:.1f}" if avg_rank else "  Avg Retrieval Rank : n/a")
    print(f"  Keyword Match Rate : {kw_rate:.0%}")
    print(f"  Avg Faithfulness   : {avg_faith:.2f}  (target ≥ 0.90)")
    print(f"  Avg Relevance      : {avg_rel:.2f}  (target ≥ 0.85)")
    print(f"  Negative correct   : {neg_correct}/{len(neg_rows)}")
    print(f"{'═' * 58}")

    summary = {
        "n":                  n,
        "retrieval_hit_rate": hit_rate,
        "avg_retrieval_rank": avg_rank,
        "keyword_match_rate": kw_rate,
        "avg_faithfulness":   avg_faith,
        "avg_relevance":      avg_rel,
        "neg_correct_rate":   neg_correct / len(neg_rows) if neg_rows else None,
    }

    # Compare against the most recent previous report
    import glob, os
    reports_dir = os.path.join(os.path.dirname(__file__), "eval_reports")
    previous = sorted(glob.glob(os.path.join(reports_dir, "rag_eval_*.json")))
    if previous:
        with open(previous[-1]) as f:
            baseline = json.load(f)["summary"]
        print(f"\n  vs baseline ({os.path.basename(previous[-1])}):")
        for key in ("retrieval_hit_rate", "avg_retrieval_rank", "avg_faithfulness", "avg_relevance"):
            old = baseline.get(key)
            new = summary[key]
            if old is not None and new is not None:
                delta = new - old
                arrow = "↑" if delta > 0 else ("↓" if delta < 0 else "→")
                # Lower rank is better; flip arrow for rank
                if key == "avg_retrieval_rank":
                    arrow = "↓" if delta < 0 else ("↑" if delta > 0 else "→")
                print(f"    {key:<25} {old:.2f} → {new:.2f}  {arrow} {abs(delta):.2f}")

    # Save report
    os.makedirs(reports_dir, exist_ok=True)
    ts = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    report_path = os.path.join(reports_dir, f"rag_eval_{ts}.json")
    report = {
        "run_at":     datetime.datetime.utcnow().isoformat() + "Z",
        "meeting_id": MEETING_ID,
        "pipeline":   "hybrid_rerank_rewrite",
        "summary":    summary,
        "cases":      rows,
    }
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n  Report → {report_path}")


if __name__ == "__main__":
    run()
