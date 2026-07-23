"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Meeting = {
  id: string;
  title: string;
  status: "processing" | "complete" | "failed";
  duration_seconds: number | null;
  created_at: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(secs: number | null) {
  if (!secs) return null;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "complete") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

export function MeetingCard({ meeting }: { meeting: Meeting }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(meeting.title);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    const next = title.trim();
    if (!next || next === meeting.title) {
      setTitle(meeting.title);
      setRenaming(false);
      return;
    }
    setBusy(true);
    await fetch(`/api/meetings/${meeting.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
    setBusy(false);
    setRenaming(false);
    router.refresh();
  }

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm(`Delete "${meeting.title}"? This cannot be undone.`)) return;
    setBusy(true);
    await fetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <Card className={`transition-all ${!renaming && !busy ? "hover:ring-1 hover:ring-foreground/20 hover:bg-zinc-50 dark:hover:bg-zinc-900/40" : ""}`}>
      <CardContent className="flex items-center gap-4 py-4">
        {/* Clickable area → meeting detail */}
        {renaming ? (
          <form onSubmit={handleRename} className="flex-1 min-w-0">
            <input
              ref={inputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleRename as unknown as React.FocusEventHandler}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setTitle(meeting.title);
                  setRenaming(false);
                }
              }}
              disabled={busy}
              autoFocus
              className="w-full text-sm font-medium bg-transparent border-b border-[#2D8CFF] outline-none pb-0.5"
            />
          </form>
        ) : (
          <Link
            href={`/dashboard/meetings/${meeting.id}`}
            className="flex-1 min-w-0 flex flex-col gap-0.5"
          >
            <p className="text-sm font-medium truncate">{title}</p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{formatDate(meeting.created_at)}</span>
              {formatDuration(meeting.duration_seconds) && (
                <>
                  <span>·</span>
                  <span>{formatDuration(meeting.duration_seconds)}</span>
                </>
              )}
            </div>
          </Link>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant={statusVariant(meeting.status)}
            className={`text-xs ${meeting.status === "complete" ? "bg-[#2D8CFF]/10 text-[#2D8CFF] border-[#2D8CFF]/20" : ""}`}
          >
            {meeting.status}
          </Badge>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                aria-label="Meeting options"
                onClick={(e) => e.preventDefault()}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <circle cx="2" cy="7" r="1.2" />
                  <circle cx="7" cy="7" r="1.2" />
                  <circle cx="12" cy="7" r="1.2" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  setRenaming(true);
                  setTimeout(() => inputRef.current?.select(), 0);
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleDelete}
                className="text-red-500 focus:text-red-500"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
