"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";

type SearchResult = {
  id: string;
  text: string;
  headline?: string;
  start_sec: number;
  meeting_id: string;
  meeting_title: string;
};

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);

    if (!val.trim()) {
      setResults(null);
      return;
    }

    startTransition(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(val)}`);
      if (!res.ok) return;
      const data = await res.json();
      setResults(data);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Search across all meetings..."
        value={query}
        onChange={handleChange}
        className="text-sm focus-visible:ring-[#2D8CFF]/25 focus-visible:border-[#2D8CFF]"
      />

      {isPending && (
        <p className="text-xs text-muted-foreground">Searching...</p>
      )}

      {!isPending && results !== null && results.length === 0 && (
        <p className="text-xs text-muted-foreground">No results for &ldquo;{query}&rdquo;</p>
      )}

      {!isPending && results && results.length > 0 && (
        <div className="border rounded-md divide-y text-sm">
          {results.map((r) => (
            <Link
              key={r.id}
              href={`/dashboard/meetings/${r.meeting_id}`}
              className="flex gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
            >
              <span className="text-xs text-muted-foreground tabular-nums shrink-0 pt-0.5 w-10">
                {formatTime(r.start_sec)}
              </span>
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <p className="text-xs text-muted-foreground truncate">{r.meeting_title}</p>
                {r.headline && (
                  <p className="text-xs font-medium text-foreground truncate">{r.headline}</p>
                )}
                <p className="leading-relaxed text-muted-foreground line-clamp-2">{r.text}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
