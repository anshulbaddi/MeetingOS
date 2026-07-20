"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ChatPanel } from "./chat-panel";
import { ConflictCard } from "./conflict-card";

type Segment = {
  id: string;
  text: string;
  start_sec: number;
  end_sec: number;
  speaker: string | null;
};

type SlideTransition = { start_sec: number };

type ActionItem =
  | string
  | { text: string; assignee: string | null; due: string | null };

type Meta = {
  summary: string;
  action_items: ActionItem[];
  participants: string[];
  slide_transitions: SlideTransition[] | null;
};

type Decision = {
  id: string;
  text: string;
  context: string;
  start_sec: number | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  cited_segments: { segment_id: string; start_sec: number; text: string }[];
};

type Conflict = {
  id: string;
  status: "unreviewed" | "confirmed" | "dismissed";
  similarity_score: number;
  new_decision_text: string;
  past_decision_text: string;
  past_meeting_title: string;
  past_meeting_id: string;
};

type Props = {
  meetingId: string;
  segments: Segment[];
  meta: Meta | null;
  decisions: Decision[];
  conflicts: Conflict[];
  initialMessages: ChatMessage[];
};

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getActionText(item: ActionItem): string {
  return typeof item === "string" ? item : item.text;
}

function getAssignee(item: ActionItem): string | null {
  return typeof item === "string" ? null : item.assignee;
}

function getDue(item: ActionItem): string | null {
  return typeof item === "string" ? null : item.due;
}

export function MeetingTabs({ meetingId, segments, meta, decisions, conflicts, initialMessages }: Props) {
  const hasOverview = meta !== null;
  const activeConflicts = conflicts.filter((c) => c.status !== "dismissed");

  return (
    <Tabs defaultValue={hasOverview ? "overview" : "transcript"}>
      <TabsList>
        {hasOverview && <TabsTrigger value="overview">Overview</TabsTrigger>}
        <TabsTrigger value="transcript">Transcript</TabsTrigger>
        <TabsTrigger value="chat">Chat</TabsTrigger>
      </TabsList>

      {hasOverview && meta && (
        <TabsContent value="overview" className="mt-6 flex flex-col gap-8">

          {/* Summary — full width */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Summary</p>
            <p className="text-sm leading-relaxed">{meta.summary}</p>
          </div>

          {/* 2-column grid: action items left, decisions right */}
          <div className="grid gap-8 lg:grid-cols-[1fr_300px] items-start">

            {/* Left: participants + action items */}
            <div className="flex flex-col gap-6">
              {meta.participants.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Participants
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {meta.participants.map((p) => (
                      <Badge key={p} variant="secondary" className="text-xs font-normal">
                        {p}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {meta.action_items.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    Action items
                  </p>
                  <div className="flex flex-col gap-2">
                    {meta.action_items.map((item, i) => (
                      <div key={i} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                        <div className="mt-0.5 h-4 w-4 rounded border border-zinc-300 dark:border-zinc-600 shrink-0" />
                        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                          <p className="text-sm">{getActionText(item)}</p>
                          <div className="flex items-center gap-2">
                            {getAssignee(item) && (
                              <span className="text-xs text-[#2D8CFF]">@{getAssignee(item)}</span>
                            )}
                            {getDue(item) && (
                              <span className="text-xs text-muted-foreground">· {getDue(item)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right: decisions */}
            {decisions.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Decisions
                </p>
                <div className="flex flex-col gap-2">
                  {decisions.map((d) => (
                    <div key={d.id} className="rounded-lg border border-border px-4 py-3 flex flex-col gap-1">
                      <p className="text-sm font-medium">{d.text}</p>
                      <p className="text-xs text-muted-foreground italic leading-relaxed">&ldquo;{d.context}&rdquo;</p>
                      {d.start_sec !== null && (
                        <p className="text-xs text-[#2D8CFF] tabular-nums">{formatTime(d.start_sec)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Conflicts — full width */}
          {activeConflicts.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Conflicts with past meetings
              </p>
              <div className="flex flex-col gap-2">
                {activeConflicts.map((c) => (
                  <ConflictCard key={c.id} conflict={c} />
                ))}
              </div>
            </div>
          )}

          {/* Slide transitions — full width */}
          {meta.slide_transitions && meta.slide_transitions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Slide transitions · {meta.slide_transitions.length}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {meta.slide_transitions.map((t, i) => (
                  <span
                    key={i}
                    className="text-xs border rounded-md px-2 py-1 text-muted-foreground tabular-nums hover:border-[#2D8CFF] hover:text-[#2D8CFF] transition-colors"
                  >
                    {formatTime(t.start_sec)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      )}

      <TabsContent value="chat" className="mt-4">
        <ChatPanel meetingId={meetingId} initialMessages={initialMessages} />
      </TabsContent>

      <TabsContent value="transcript" className="mt-4">
        {segments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No speech detected.</p>
        ) : (
          <div className="border rounded-md divide-y text-sm">
            {segments.map((seg) => (
              <div key={seg.id} className="flex gap-4 px-4 py-3">
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums pt-0.5 w-12">
                  {formatTime(seg.start_sec)}
                </span>
                <div className="flex flex-col gap-0.5 flex-1">
                  {seg.speaker && (
                    <span className="text-xs text-[#2D8CFF]">{seg.speaker}</span>
                  )}
                  <p className="leading-relaxed">{seg.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
