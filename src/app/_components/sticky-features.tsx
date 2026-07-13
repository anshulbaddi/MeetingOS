"use client";

import { useEffect, useRef, useState } from "react";

// ── Visual mockups ────────────────────────────────────────────────────────────

function TranscriptMockup() {
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <span className="text-xs text-muted-foreground font-medium">Engineering Standup · 24 min</span>
      </div>
      <div className="p-4 flex flex-col gap-3">
        {[
          { time: "0:08", speaker: "Alex", text: "Alright, let's kick things off. Sarah, you're up first." },
          { time: "0:19", speaker: "Sarah", text: "We shipped the auth refactor yesterday. No issues in prod so far." },
          { time: "0:34", speaker: "Marcus", text: "I'll need the API spec before I can unblock the mobile team." },
          { time: "0:51", speaker: "Alex", text: "The deadline for the v2 launch is still Friday, right?" },
          { time: "1:02", speaker: "Sarah", text: "Yes. We're on track unless the infra work slips." },
        ].map((s, i) => (
          <div key={i} className="flex gap-3 text-sm">
            <span className="text-muted-foreground tabular-nums shrink-0 text-xs mt-0.5 w-8">{s.time}</span>
            <div>
              <span className="font-medium text-xs mr-1.5">{s.speaker}</span>
              <span className="text-foreground/80">{s.text}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatMockup() {
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b">
        <span className="text-xs font-medium text-muted-foreground">Engineering Standup · Ask anything</span>
      </div>
      <div className="p-4 flex flex-col gap-4">
        <div className="flex justify-end">
          <div className="bg-primary text-primary-foreground text-sm px-3 py-2 rounded-2xl rounded-tr-sm max-w-[80%] leading-relaxed">
            Who is blocking the mobile team?
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm leading-relaxed max-w-[88%]">
            At 0:34, Marcus mentioned that the mobile team is blocked waiting for the API spec.
          </p>
          <div className="flex gap-1">
            <span className="text-xs border rounded-full px-2 py-0.5 text-muted-foreground tabular-nums">0:34</span>
          </div>
        </div>
        <div className="flex justify-end">
          <div className="bg-primary text-primary-foreground text-sm px-3 py-2 rounded-2xl rounded-tr-sm max-w-[80%] leading-relaxed">
            When is the v2 launch?
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm leading-relaxed max-w-[88%]">
            The deadline is Friday, as confirmed at 0:51 by Alex. Sarah noted they're on track barring infrastructure delays.
          </p>
          <div className="flex gap-1">
            <span className="text-xs border rounded-full px-2 py-0.5 text-muted-foreground tabular-nums">0:51</span>
            <span className="text-xs border rounded-full px-2 py-0.5 text-muted-foreground tabular-nums">1:02</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConflictMockup() {
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">2 conflicts detected</span>
        <span className="text-xs bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full">Needs review</span>
      </div>
      <div className="p-4 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Conflict #1 · Pricing timeline</div>
          <div className="flex flex-col gap-1.5">
            <div className="text-sm border-l-2 border-muted pl-3 py-1.5 rounded-r">
              <div className="text-xs text-muted-foreground mb-0.5">Q3 Planning · Jun 3</div>
              &ldquo;We&apos;ll launch the new pricing model in Q4.&rdquo;
            </div>
            <div className="text-sm border-l-2 border-destructive pl-3 py-1.5 rounded-r">
              <div className="text-xs text-muted-foreground mb-0.5">Executive Review · Jun 17</div>
              &ldquo;Pricing changes are on hold until next year.&rdquo;
            </div>
          </div>
          <div className="flex gap-2 mt-1">
            <button className="text-xs border rounded-lg px-2.5 py-1 text-muted-foreground hover:text-foreground transition-colors">
              Dismiss
            </button>
            <button className="text-xs rounded-lg px-2.5 py-1 bg-primary text-primary-foreground">
              Mark confirmed
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Feature list ──────────────────────────────────────────────────────────────

const FEATURES = [
  {
    num: "01",
    title: "Instant transcription",
    description:
      "Upload any recording — mp3, mp4, wav, m4a. Whisper AI produces a full transcript with per-second timestamps and speaker detection in minutes.",
    visual: <TranscriptMockup />,
  },
  {
    num: "02",
    title: "Ask your meetings",
    description:
      "Type a question in plain English. A hybrid RAG pipeline — vector search, keyword search, query rewriting, and LLM re-ranking — retrieves the most relevant moments and gives you a cited, grounded answer.",
    visual: <ChatMockup />,
  },
  {
    num: "03",
    title: "Spot contradictions",
    description:
      "MeetingOS compares decisions across all your meetings. When two decisions conflict — like a deadline moved in one meeting and confirmed in another — it surfaces the pair for your review.",
    visual: <ConflictMockup />,
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function StickyFeatures() {
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute("data-index"));
            if (!isNaN(index)) setActiveIndex(index);
          }
        });
      },
      { rootMargin: "-35% 0px -35% 0px", threshold: 0 },
    );

    itemRefs.current.forEach((ref) => ref && observer.observe(ref));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
      {/* Left — scrollable feature items */}
      <div className="flex flex-col">
        {FEATURES.map((f, i) => (
          <div
            key={i}
            ref={(el) => { itemRefs.current[i] = el; }}
            data-index={i}
            className={`py-16 lg:py-24 border-b last:border-b-0 transition-opacity duration-300 ${
              i === activeIndex ? "opacity-100" : "opacity-35"
            }`}
          >
            <span className="text-xs font-mono text-muted-foreground tracking-widest">{f.num}</span>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight">{f.title}</h3>
            <p className="mt-3 text-muted-foreground leading-relaxed">{f.description}</p>

            {/* Mobile-only visual */}
            <div className="lg:hidden mt-6">{f.visual}</div>
          </div>
        ))}
      </div>

      {/* Right — sticky visual panel (desktop only) */}
      <div className="hidden lg:block">
        <div className="sticky top-28">
          <div className="relative">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                className={`transition-opacity duration-400 ${
                  i === activeIndex
                    ? "opacity-100"
                    : "opacity-0 absolute inset-0 pointer-events-none"
                }`}
              >
                {f.visual}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
