"""
Enhanced RAG evaluation on a real 20-segment meeting.

Uses "Cp Transitionvideo" (AR Fitness Coach EPICS project) — the only meeting
in the DB with enough content to stress-test hybrid search + reranking.

Questions are deliberately paraphrased so they do NOT appear verbatim in the
transcript, which means easy keyword matches won't carry the day — the
system has to rely on semantic retrieval and query rewriting.

Metrics
-------
retrieval_hit   gold segment is in the cited set (checks source_segment_ids too)
retrieval_rank  position (1-indexed) in the cited list, None on miss
keyword_match   answer contains expected keywords
faithfulness    GPT-4o judge: 0.0–1.0, claims grounded in cited text
relevance       GPT-4o judge: 0.0–1.0, answer addresses the question

Also tracks per-arm ablation via result["rewritten_query"] to see how often
the rewriter adds value.

Run:
    PYTHONPATH=.venv/lib/python3.9/site-packages python3.9 eval_rag_v2.py
"""

import datetime, glob, json, os, sys
from typing import List, Optional

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sys.path.insert(0, os.path.dirname(__file__))

from chat import ask_meeting

# ── Target meeting ──────────────────────────────────────────────────────────────
# "Cp Transitionvideo" — 20 segments, 2 chunks
MEETING_ID = "de376dcf-7efd-4dad-a654-5d29c56fd326"
USER_ID    = "eval-runner"

# Raw segment IDs (verified from DB)
SEG_WHO_PARTNER   = "c69adf7d-5e9a-4a1f-ac0a-405742072c05"  # "Who is our community partner?"
SEG_GABE_INTRO    = "ae09c252-f5ea-49e0-95a0-d086aa37688c"  # "Gabe Jebrick is an academic associate"
SEG_INSTRUCT      = "f27ee377-9929-4f2d-80c9-8db5eb46e857"  # "instructional support for EPICS projects"
SEG_PE_BUILDING   = "acfbc1ed-3103-4e97-be27-db76c84b4717"  # "physical education building near SDFC"
SEG_SPORTS_BG     = "3031b1d9-7105-4dba-9cd9-6700e533b35b"  # "sports therapy background"
SEG_PE_EXSCI      = "eb897e53-a0bf-4df4-aeb4-649c72c0f282"  # "physical education and exercise science"
SEG_FEEDBACK      = "d22d0f9b-e9b9-4d2d-89bd-bd4b193cc183"  # wait, let me use the correct one
SEG_FEEDBACK_REAL = "d6d7187b-e9b9-4d2d-89bd-bd4b193cc183"  # "gave us critical feedback"
SEG_BICEP_ANGLE   = "990a8516-71c1-4d25-8568-477ca1fdf61a"  # "bicep curl" specific angle
SEG_SQUATS        = "833d4dab-f45b-4a6f-97af-69709a89ca66"  # "squats or deadlifts"

class TestCase:
    def __init__(
        self,
        question: str,
        gold_segment_id: str,
        expected_keywords: List[str],
        note: str = "",
        is_negative: bool = False,
    ):
        self.question = question
        self.gold_segment_id = gold_segment_id
        self.expected_keywords = expected_keywords
        self.note = note
        self.is_negative = is_negative


# Questions deliberately paraphrased to NOT match verbatim transcript text.
# This forces the pipeline to use semantic retrieval and query rewriting.
TEST_CASES: List[TestCase] = [

    # ── 1. Direct factual — should be trivially hit ─────────────────────────
    TestCase(
        question="What is the name of the community partner?",
        gold_segment_id=SEG_GABE_INTRO,
        expected_keywords=["gabe", "jebrick"],
        note="Literal — tests basic retrieval baseline",
    ),

    # ── 2. Paraphrase — "location" ≠ "works in" ────────────────────────────
    TestCase(
        question="Where is the community partner's office located?",
        gold_segment_id=SEG_PE_BUILDING,
        expected_keywords=["physical education", "sdfc"],
        note="Paraphrase: 'office' ≠ 'building near'; tests semantic arm",
    ),

    # ── 3. Semantic — "expertise" not in transcript ────────────────────────
    TestCase(
        question="What area of expertise does Gabe bring to the project?",
        gold_segment_id=SEG_SPORTS_BG,
        expected_keywords=["sport", "exercise", "physical"],
        note="Semantic: 'expertise' → 'background'; tests query rewrite value",
    ),

    # ── 4. Multi-segment — answer spans two segments ───────────────────────
    TestCase(
        question="What did the community partner say about performing a bicep curl correctly?",
        gold_segment_id=SEG_BICEP_ANGLE,
        expected_keywords=["angle", "bicep", "muscle"],
        note="Multi-segment: answer requires combining two adjacent segments",
    ),

    # ── 5. Inferential — requires understanding "helping" = "giving feedback"
    TestCase(
        question="How did Gabe contribute to improving the app?",
        gold_segment_id=SEG_FEEDBACK_REAL,
        expected_keywords=["feedback", "exercise", "insight"],
        note="Inferential: 'contribute/improve' ≠ 'gave critical feedback'",
    ),

    # ── 6. Paraphrase — "other workouts" ≠ "exercises could include" ───────
    TestCase(
        question="Besides bicep curls, which other workouts were brought up?",
        gold_segment_id=SEG_SQUATS,
        expected_keywords=["squat", "deadlift"],
        note="Paraphrase: 'other workouts' ≠ 'other examples of exercises'; keyword arm should catch deadlift",
    ),

    # ── 7. Role question — tests chunked context ───────────────────────────
    TestCase(
        question="What type of support does the community partner provide for EPICS?",
        gold_segment_id=SEG_INSTRUCT,
        expected_keywords=["instructional", "support"],
        note="Role/function question; answer in middle of first chunk",
    ),

    # ── 8. Negative — info genuinely absent ────────────────────────────────
    TestCase(
        question="What is the projected launch date for the AR Fitness Coach app?",
        gold_segment_id=SEG_GABE_INTRO,  # closest segment; model should still say "not in transcript"
        expected_keywords=["not", "no", "mention", "doesn", "unknown"],
        note="Negative: launch date never discussed",
        is_negative=True,
    ),
]

# ── LLM judge ──────────────────────────────────────────────────────────────────
JUDGE_SYSTEM = """You are an evaluator of RAG chatbot answers about meeting transcripts.

The chatbot is given timestamped transcript segments and uses them to answer questions.
Timestamp references like "At 0:02..." are valid citations, NOT hallucinations.

Rate two dimensions from 0.0 to 1.0:

faithfulness — Every factual claim is supported by the provided segments.
               1.0 = fully grounded. 0.0 = introduces facts not in segments.

relevance    — The answer addresses the question.
               1.0 = fully on-topic and useful. 0.0 = ignores the question.

Respond ONLY with valid JSON:
{"faithfulness": <float>, "relevance": <float>, "reasoning": "<one sentence>"}"""


def judge(client: OpenAI, question: str, cited: List[dict], answer: str) -> dict:
    seg_text = "\n".join(f"  [{s['start_sec']:.0f}s] {s['text']}" for s in cited)
    resp = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": f"Question: {question}\n\nContext:\n{seg_text}\n\nAnswer: {answer}"},
        ],
        response_format={"type": "json_object"},
    )
    return json.loads(resp.choices[0].message.content)


def run() -> None:
    client = OpenAI()
    rows = []

    print(f"\nEvaluating: Cp Transitionvideo ({len(TEST_CASES)} cases)\n{'─'*60}")

    for i, tc in enumerate(TEST_CASES, 1):
        tag = "[NEG]" if tc.is_negative else "     "
        print(f"\n{tag} [{i}/{len(TEST_CASES)}] {tc.question}")
        print(f"  Note: {tc.note}")

        result = ask_meeting(MEETING_ID, USER_ID, tc.question)
        answer    = result["answer"]
        cited     = result["cited_segments"]
        rewritten = result.get("rewritten_query", "")

        # ── Retrieval hit: check direct segment match OR chunk's source_segment_ids
        def _contains_gold(c: dict) -> bool:
            if c["segment_id"] == tc.gold_segment_id:
                return True
            return tc.gold_segment_id in (c.get("source_segment_ids") or [])

        hit_idx: Optional[int] = next(
            (j for j, c in enumerate(cited) if _contains_gold(c)), None
        )
        hit  = hit_idx is not None
        rank: Optional[int] = (hit_idx + 1) if hit else None

        answer_lower = answer.lower()
        keyword_hit  = any(kw.lower() in answer_lower for kw in tc.expected_keywords)

        scores = judge(client, tc.question, cited, answer)

        short = (answer[:120] + "…") if len(answer) > 120 else answer
        print(f"  Rewrite : {rewritten}")
        print(f"  Answer  : {short}")
        print(f"  Gold    : {'#' + str(rank) if hit else 'MISS'}")
        print(f"  Keywords: {'✓' if keyword_hit else '✗'}  {tc.expected_keywords}")
        print(f"  Faith/Rel: {scores['faithfulness']:.2f} / {scores['relevance']:.2f}  — {scores['reasoning']}")

        rows.append({
            "question":        tc.question,
            "note":            tc.note,
            "is_negative":     tc.is_negative,
            "rewritten_query": rewritten,
            "answer":          answer,
            "cited_segments":  cited,
            "retrieval_hit":   hit,
            "retrieval_rank":  rank,
            "keyword_match":   keyword_hit,
            "faithfulness":    scores["faithfulness"],
            "relevance":       scores["relevance"],
            "reasoning":       scores["reasoning"],
        })

    # ── Aggregate ─────────────────────────────────────────────────────────────
    n        = len(rows)
    pos_rows = [r for r in rows if not r["is_negative"]]
    neg_rows = [r for r in rows if     r["is_negative"]]

    hit_rate   = sum(r["retrieval_hit"]  for r in rows)  / n
    kw_rate    = sum(r["keyword_match"]  for r in rows)  / n
    avg_faith  = sum(r["faithfulness"]   for r in rows)  / n
    avg_rel    = sum(r["relevance"]      for r in rows)  / n
    ranks      = [r["retrieval_rank"] for r in rows if r["retrieval_rank"] is not None]
    avg_rank   = sum(ranks) / len(ranks) if ranks else None
    neg_correct = sum(r["keyword_match"] for r in neg_rows)

    # Query-rewrite delta: did rewritten query differ from original?
    rewrite_changed = sum(
        1 for r in rows
        if r["rewritten_query"].lower().strip() != r["question"].lower().strip()
    )

    print(f"\n{'═'*62}")
    print(f"  Cases                : {n}  ({len(pos_rows)} positive, {len(neg_rows)} negative)")
    print(f"  Retrieval Hit Rate   : {hit_rate:.0%}  ({sum(r['retrieval_hit'] for r in rows)}/{n})")
    if avg_rank:
        print(f"  Avg Retrieval Rank  : {avg_rank:.1f}  (lower is better; max=5)")
    print(f"  Keyword Match Rate  : {kw_rate:.0%}")
    print(f"  Avg Faithfulness    : {avg_faith:.2f}  (target ≥ 0.90)")
    print(f"  Avg Relevance       : {avg_rel:.2f}  (target ≥ 0.85)")
    print(f"  Negative correct    : {neg_correct}/{len(neg_rows)}")
    print(f"  Rewrites changed    : {rewrite_changed}/{n}  (query rewriting active)")
    print(f"{'═'*62}")

    summary = {
        "meeting_id":         MEETING_ID,
        "meeting_title":      "Cp Transitionvideo",
        "n":                  n,
        "retrieval_hit_rate": hit_rate,
        "avg_retrieval_rank": avg_rank,
        "keyword_match_rate": kw_rate,
        "avg_faithfulness":   avg_faith,
        "avg_relevance":      avg_rel,
        "neg_correct_rate":   neg_correct / len(neg_rows) if neg_rows else None,
        "rewrites_changed":   rewrite_changed,
    }

    # Save
    os.makedirs("eval_reports", exist_ok=True)
    ts = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    path = f"eval_reports/rag_eval_v2_{ts}.json"
    with open(path, "w") as f:
        json.dump({"run_at": datetime.datetime.utcnow().isoformat()+"Z",
                   "pipeline": "hybrid_rerank_rewrite_v2",
                   "summary": summary, "cases": rows}, f, indent=2)
    print(f"\n  Report → {path}\n")


if __name__ == "__main__":
    run()
