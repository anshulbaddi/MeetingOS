import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

const SECTIONS = [
  {
    id: "transcription",
    num: "01",
    title: "Transcription",
    badge: "Whisper AI",
    summary: "Upload any audio or video file. MeetingOS extracts the audio track, sends it to OpenAI Whisper, and stores the full transcript with per-second timestamps and speaker labels.",
    steps: [
      {
        name: "Upload",
        detail: "Files are accepted as mp3, mp4, wav, or m4a. The raw file is stored in object storage (Cloudflare R2). A background worker (Celery + Redis) picks up the job immediately.",
      },
      {
        name: "Transcription",
        detail: "The worker calls the Whisper API. The response includes word-level timestamps and, where available, speaker diarization. The full transcript is stored in Postgres.",
      },
      {
        name: "Chunking",
        detail: "The transcript is split into overlapping chunks of ~200 tokens. Each chunk is enriched by GPT-4o-mini: a one-line headline and 2–3 sentence summary are generated per chunk and stored alongside the raw text.",
      },
      {
        name: "Embeddings",
        detail: "Each enriched chunk is embedded using text-embedding-3-small and stored as a vector in pgvector. Embeddings are computed once and reused for all future searches.",
      },
    ],
  },
  {
    id: "search",
    num: "02",
    title: "AI search",
    badge: "Hybrid RAG",
    summary: "When you ask a question, MeetingOS runs a multi-stage pipeline to find the most relevant moments — combining vector similarity, keyword matching, and LLM re-ranking.",
    steps: [
      {
        name: "Query rewriting",
        detail: "Your question is rewritten by GPT-4o-mini into 2–3 semantically diverse variants. This improves recall by covering synonyms and alternative phrasings the original query might miss.",
      },
      {
        name: "Dual retrieval",
        detail: "Each query variant runs in parallel through two arms: (1) vector search using cosine similarity on pgvector, and (2) keyword search using Postgres full-text search with ts_rank. Both arms return the top-k candidates.",
      },
      {
        name: "RRF merge",
        detail: "Results from both arms are merged using Reciprocal Rank Fusion (RRF). RRF rewards candidates that rank highly in multiple arms, producing a single unified ranking without requiring score normalization.",
      },
      {
        name: "LLM re-ranking",
        detail: "The top 10 merged candidates are re-ranked by GPT-4o-mini, which scores each chunk for relevance to the original question. The highest-scored chunks are passed to the answer step.",
      },
      {
        name: "Cited answer",
        detail: "GPT-4o generates a grounded answer using only the retrieved chunks. Every claim is tied to a specific timestamp so you can verify the source in the transcript.",
      },
    ],
  },
  {
    id: "decisions",
    num: "03",
    title: "Decision extraction",
    badge: "GPT-4o",
    summary: "After transcription, MeetingOS automatically extracts every decision, commitment, and action item mentioned in the meeting — no manual summarization needed.",
    steps: [
      {
        name: "Extraction",
        detail: "The full transcript is passed to GPT-4o with a structured prompt that identifies decisions (things agreed upon), commitments (things promised by a specific person), and action items (tasks with an owner or deadline).",
      },
      {
        name: "Storage",
        detail: "Each extracted decision is stored with its source timestamp, the speaker who made it, and a short description. Decisions are queryable independently from the full transcript.",
      },
      {
        name: "Embeddings",
        detail: "Each decision is embedded and stored in pgvector alongside transcript chunks, making them searchable through the same RAG pipeline.",
      },
    ],
  },
  {
    id: "conflicts",
    num: "04",
    title: "Conflict detection",
    badge: "Cross-meeting",
    summary: "MeetingOS compares decisions across all your meetings. When two decisions contradict each other — a deadline moved, a commitment reversed — it surfaces the pair for review.",
    steps: [
      {
        name: "Vector comparison",
        detail: "When a new decision is stored, it's compared by cosine similarity against all existing decisions using pgvector. Pairs with similarity above a threshold are flagged as candidates.",
      },
      {
        name: "LLM classification",
        detail: "Candidate pairs are passed to GPT-4o-mini, which classifies each pair as a genuine conflict, a complement, or a duplicate. Only genuine conflicts are surfaced.",
      },
      {
        name: "Review queue",
        detail: "Conflicts appear in the Conflicts dashboard with both source quotes, meeting dates, and a dismiss / confirm action. Resolved conflicts are hidden from the queue but remain in the database.",
      },
    ],
  },
  {
    id: "self-hosting",
    num: "05",
    title: "Self-hosting",
    badge: "Open source",
    summary: "MeetingOS is fully open-source. You can run your own instance with your own API keys — no dependency on the hosted version.",
    steps: [
      {
        name: "Requirements",
        detail: "Postgres with the pgvector extension, Redis (for Celery), an OpenAI API key, and object storage (any S3-compatible provider). The backend is a FastAPI app; the frontend is Next.js.",
      },
      {
        name: "Backend",
        detail: "cd backend && pip install -r requirements.txt. Copy .env.example to .env and fill in DATABASE_URL, REDIS_URL, OPENAI_API_KEY, and your storage credentials. Run uvicorn main:app and celery -A worker worker.",
      },
      {
        name: "Frontend",
        detail: "npm install at the project root. Copy .env.local.example to .env.local and set API_URL, AUTH_SECRET, and Google OAuth credentials. Run npm run dev or npm run build && npm start.",
      },
    ],
  },
];

export default function DocsPage() {
  return (
    <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-16 lg:py-24">
      <div className="flex flex-col gap-12">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Documentation</p>
          <h1 className="text-4xl font-bold tracking-tight">How it works.</h1>
          <p className="text-muted-foreground leading-relaxed max-w-xl">
            A technical walkthrough of the MeetingOS pipeline — from raw audio file to cited answer.
          </p>
        </div>

        {/* Jump links */}
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="text-xs border rounded-full px-3 py-1.5 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
            >
              {s.num} {s.title}
            </a>
          ))}
        </div>

        <Separator />

        {/* Sections */}
        <div className="flex flex-col gap-16">
          {SECTIONS.map((section) => (
            <div key={section.id} id={section.id} className="flex flex-col gap-6 scroll-mt-24">
              {/* Section header */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground tracking-widest">{section.num}</span>
                  <h2 className="text-2xl font-semibold tracking-tight">{section.title}</h2>
                  <Badge variant="secondary">{section.badge}</Badge>
                </div>
                <p className="text-muted-foreground leading-relaxed max-w-2xl">{section.summary}</p>
              </div>

              {/* Steps */}
              <div className="flex flex-col gap-0">
                {section.steps.map((step, i) => (
                  <div key={step.name} className="flex gap-6 group">
                    {/* Timeline */}
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 rounded-full border-2 border-muted bg-background flex items-center justify-center shrink-0 mt-0.5">
                        <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                      </div>
                      {i < section.steps.length - 1 && (
                        <div className="w-px flex-1 bg-border mt-1 mb-1" />
                      )}
                    </div>
                    {/* Content */}
                    <div className={`flex flex-col gap-1 ${i < section.steps.length - 1 ? "pb-6" : ""}`}>
                      <p className="text-sm font-medium">{step.name}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
