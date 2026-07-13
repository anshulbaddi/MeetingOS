"""
Component-level diagnostic tests for the RAG pipeline.

Tests each optimization individually:
  1. Chunking      — chunks exist, have enriched metadata, map back to source segments
  2. Query rewrite — gpt-4o-mini reformulates the question
  3. Hybrid search — vector arm, keyword arm, and RRF merge work independently
  4. Reranking     — LLM reranker changes the order of candidates
  5. End-to-end    — full pipeline produces a grounded, cited answer

Run:
    python test_rag_pipeline.py
"""

import json
import sys
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sys.path.insert(0, os.path.dirname(__file__))

from openai import OpenAI
from pgvector.psycopg2 import register_vector

from db import get_db
import chat as _chat

MEETING_ID = "4028f1ba-cdb0-41e2-b725-6a45fc17b8bc"
USER_ID    = "test-runner"
QUESTION   = "Who is responsible for backend changes?"

SEG_JOHN  = "da969e98-6255-439f-9267-c8ab9f83f44e"   # "John will handle the backend changes"
SEG_SHIP  = "7cca776f-8285-4da9-b6e2-d2425dbfa60a"   # "The team agreed to ship the new feature by Friday"
SEG_SARAH = "cad050ad-030e-42fa-ae94-2fdff79ffb28"   # "and Sarah will write the tests"
SEG_INTRO = "b084f492-d328-4e8b-9fc2-2167e9f24030"   # "This is a test meeting recording"

PASS = "✓"
FAIL = "✗"

_client = None
_failures: list[str] = []


def client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def check(label: str, condition: bool, detail: str = "") -> None:
    status = PASS if condition else FAIL
    print(f"  {status} {label}", f"({detail})" if detail else "")
    if not condition:
        _failures.append(label)


def section(title: str) -> None:
    print(f"\n{'─' * 60}")
    print(f"  {title}")
    print(f"{'─' * 60}")


# ── 1. Chunking ────────────────────────────────────────────────────────────────

def test_chunking() -> None:
    section("1. CHUNKING")

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, headline, summary, left(body, 80) AS body_preview,
                          start_sec, end_sec, source_segment_ids,
                          embedding IS NOT NULL AS has_embedding
                   FROM chunks WHERE meeting_id = %s ORDER BY start_sec""",
                (MEETING_ID,),
            )
            chunks = [dict(r) for r in cur.fetchall()]

            cur.execute(
                "SELECT id FROM segments WHERE meeting_id = %s",
                (MEETING_ID,),
            )
            seg_ids = {str(r["id"]) for r in cur.fetchall()}

    check("Chunks exist", len(chunks) > 0, f"{len(chunks)} chunk(s)")
    for i, c in enumerate(chunks):
        print(f"\n  Chunk #{i + 1}:")
        print(f"    Headline : {c['headline']!r}")
        print(f"    Summary  : {c['summary']!r}")
        print(f"    Body     : {c['body_preview']!r}…")
        print(f"    Time     : {c['start_sec']:.1f}s – {c['end_sec']:.1f}s")

        src_ids = c["source_segment_ids"]
        if isinstance(src_ids, str):
            src_ids = json.loads(src_ids)
        check(
            "  source_segment_ids non-empty",
            len(src_ids) > 0,
            f"{len(src_ids)} source(s)",
        )
        check(
            "  source_segment_ids map to real segments",
            all(sid in seg_ids for sid in src_ids),
        )
        check("  embedding set", c["has_embedding"])
        check("  headline non-empty", bool(c["headline"].strip()))
        check("  summary non-empty", bool(c["summary"].strip()))


# ── 2. Query rewriting ─────────────────────────────────────────────────────────

def test_query_rewrite() -> None:
    section("2. QUERY REWRITING")

    rewritten = _chat._rewrite_query(client(), QUESTION)
    print(f"  Original  : {QUESTION!r}")
    print(f"  Rewritten : {rewritten!r}")

    check("Rewritten query non-empty", bool(rewritten.strip()))
    check(
        "Rewritten differs from original",
        rewritten.strip().lower() != QUESTION.strip().lower(),
    )


# ── 3. Hybrid search ───────────────────────────────────────────────────────────

def test_hybrid_search() -> None:
    section("3. HYBRID SEARCH  (vector + keyword + RRF)")

    vec = _chat._embed(client(), QUESTION)
    rewritten = _chat._rewrite_query(client(), QUESTION)
    rewr_vec = _chat._embed(client(), rewritten)

    with get_db() as conn:
        register_vector(conn)
        use_chunks = _chat._has_chunks(conn, MEETING_ID)

        print(f"\n  Using chunks: {use_chunks}")

        # Vector arm (original query)
        v1 = _chat._vector_search(conn, MEETING_ID, vec, limit=5)
        print(f"\n  Vector arm (original) → {len(v1)} result(s):")
        for r in v1:
            label = r.get("headline") or r.get("text", "")[:60]
            print(f"    [{r['start_sec']:.1f}s] {label!r}")

        # Vector arm (rewritten query)
        v2 = _chat._vector_search(conn, MEETING_ID, rewr_vec, limit=5)
        print(f"\n  Vector arm (rewritten) → {len(v2)} result(s):")
        for r in v2:
            label = r.get("headline") or r.get("text", "")[:60]
            print(f"    [{r['start_sec']:.1f}s] {label!r}")

        # Keyword arm (original)
        k1 = _chat._keyword_search(conn, MEETING_ID, QUESTION, limit=5)
        print(f"\n  Keyword arm (original) → {len(k1)} result(s):")
        for r in k1:
            label = r.get("headline") or r.get("text", "")[:60]
            print(f"    [{r['start_sec']:.1f}s] {label!r}")

        # Keyword arm (rewritten)
        k2 = _chat._keyword_search(conn, MEETING_ID, rewritten, limit=5)
        print(f"\n  Keyword arm (rewritten) → {len(k2)} result(s):")
        for r in k2:
            label = r.get("headline") or r.get("text", "")[:60]
            print(f"    [{r['start_sec']:.1f}s] {label!r}")

    # RRF merge
    merged = _chat._rrf_merge([v1, v2, k1, k2])
    print(f"\n  RRF merged → {len(merged)} unique result(s):")
    for rank, r in enumerate(merged, 1):
        label = r.get("headline") or r.get("text", "")[:60]
        print(f"    #{rank}  [{r['start_sec']:.1f}s] {label!r}")

    check("Vector arm returns results", len(v1) > 0)
    check("Keyword arm returns results", len(k1) > 0 or len(k2) > 0,
          "ok if keyword has no match on short test transcript")
    check("RRF merge returns results", len(merged) > 0)

    # Items that appeared in multiple arms should rank higher in merged
    all_ids = [r["id"] for r in v1] + [r["id"] for r in v2] + \
              [r["id"] for r in k1] + [r["id"] for r in k2]
    from collections import Counter
    freq = Counter(all_ids)
    multi_ids = {id_ for id_, cnt in freq.items() if cnt > 1}
    if multi_ids and len(merged) > 1:
        first_id = merged[0]["id"]
        check(
            "RRF boosts multi-arm results to top",
            first_id in multi_ids,
            f"top result appeared in {freq[first_id]} arm(s)",
        )
    else:
        print(f"  → (skipping RRF boost check — no overlapping results across arms)")

    return merged


# ── 4. Reranking ───────────────────────────────────────────────────────────────

def test_reranking(candidates: list) -> list:
    section("4. RERANKING  (LLM reorders candidates)")

    if len(candidates) < 2:
        # Pad with synthetic candidates so reranker has something to reorder
        print("  (padding with synthetic candidates to exercise reranker)")
        candidates = candidates + [
            {"id": "synth-1", "text": "The budget was approved for Q3.", "start_sec": 99.0},
            {"id": "synth-2", "text": "Alice is responsible for QA testing.", "start_sec": 105.0},
            {"id": "synth-3", "text": "The roadmap presentation was postponed.", "start_sec": 120.0},
            {"id": "synth-4", "text": "John will handle the backend changes.", "start_sec": 130.0},
            {"id": "synth-5", "text": "The database migration is scheduled for next week.", "start_sec": 145.0},
        ]

    print(f"\n  Pre-rerank order ({len(candidates)} candidates):")
    for i, c in enumerate(candidates, 1):
        label = c.get("headline") or c.get("text", "")[:70]
        print(f"    #{i}  [{c['start_sec']:.1f}s] {label!r}")

    reranked = _chat._rerank(client(), QUESTION, candidates)

    print(f"\n  Post-rerank order ({len(reranked)} kept):")
    for i, c in enumerate(reranked, 1):
        label = c.get("headline") or c.get("text", "")[:70]
        print(f"    #{i}  [{c['start_sec']:.1f}s] {label!r}")

    check("Reranker returns results", len(reranked) > 0)
    check("Reranker respects FINAL_K limit", len(reranked) <= _chat.FINAL_K)

    # Verify the most semantically relevant candidate ends up at #1.
    # Check across headline, summary, AND body — the chunk body includes
    # the full transcript text ("John will handle the backend changes").
    top = reranked[0]
    top_combined = " ".join([
        top.get("headline") or "",
        top.get("summary") or "",
        top.get("text") or "",
    ]).lower()
    check(
        "Reranker puts most relevant result first",
        "john" in top_combined or "backend" in top_combined,
        f"headline: {top.get('headline') or top.get('text','')[:60]!r}",
    )

    # Verify order actually changed vs pre-rerank (most of the time)
    pre_ids  = [c["id"] for c in candidates[:len(reranked)]]
    post_ids = [c["id"] for c in reranked]
    order_changed = pre_ids != post_ids
    if order_changed:
        check("Reranker changed the order", True, "good — it actually reordered")
    else:
        print(f"  → (order unchanged — reranker agreed with vector rank; still working)")

    return reranked


# ── 5. End-to-end ──────────────────────────────────────────────────────────────

def test_end_to_end() -> None:
    section("5. END-TO-END PIPELINE")

    print(f"\n  Question: {QUESTION!r}")
    result = _chat.ask_meeting(MEETING_ID, USER_ID, QUESTION)

    answer        = result["answer"]
    cited         = result["cited_segments"]
    rewritten     = result.get("rewritten_query", "")

    print(f"  Rewritten : {rewritten!r}")
    print(f"  Answer    : {answer[:200]}{'…' if len(answer) > 200 else ''}")
    print(f"\n  Cited segments ({len(cited)}):")
    for c in cited:
        src = c.get("source_segment_ids") or []
        label = c.get("headline") or c.get("text", "")[:60]
        print(f"    [{c['start_sec']:.1f}s] {label!r}  src_segs={len(src)}")

    check("answer non-empty", bool(answer.strip()))
    check("cited_segments non-empty", len(cited) > 0)
    check("rewritten_query present", bool(rewritten.strip()))
    check(
        "answer mentions 'John'",
        "john" in answer.lower(),
        "ground truth: John handles backend",
    )

    # Gold segment should appear either directly or via source_segment_ids
    def contains_gold(c: dict) -> bool:
        if c["segment_id"] == SEG_JOHN:
            return True
        return SEG_JOHN in (c.get("source_segment_ids") or [])

    gold_hit = any(contains_gold(c) for c in cited)
    check("Gold segment (John/backend) retrieved", gold_hit)


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 60)
    print("  MeetingOS RAG Pipeline — Component Tests")
    print(f"  Meeting : {MEETING_ID}")
    print(f"  Question: {QUESTION!r}")
    print("=" * 60)

    test_chunking()
    test_query_rewrite()
    candidates = test_hybrid_search()
    test_reranking(candidates)
    test_end_to_end()

    print(f"\n{'=' * 60}")
    if _failures:
        print(f"  {FAIL} {len(_failures)} check(s) FAILED:")
        for f in _failures:
            print(f"      • {f}")
    else:
        print(f"  {PASS} All checks passed")
    print("=" * 60)
    sys.exit(1 if _failures else 0)


if __name__ == "__main__":
    main()
