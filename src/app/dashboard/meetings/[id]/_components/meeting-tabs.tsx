"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatPanel } from "./chat-panel";
import { ConflictCard } from "./conflict-card";

type Segment = {
  id: string;
  text: string;
  start_sec: number;
  end_sec: number;
  speaker: string | null;
};

type SlideTransition = {
  start_sec: number;
};

type Meta = {
  summary: string;
  action_items: string[];
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

export function MeetingTabs({ meetingId, segments, meta, decisions, conflicts, initialMessages }: Props) {
  const hasOverview = meta !== null;

  return (
    <Tabs defaultValue={hasOverview ? "overview" : "transcript"}>
      <TabsList>
        {hasOverview && <TabsTrigger value="overview">Overview</TabsTrigger>}
        <TabsTrigger value="transcript">Transcript</TabsTrigger>
        <TabsTrigger value="chat">Chat</TabsTrigger>
      </TabsList>

      {hasOverview && meta && (
        <TabsContent value="overview" className="flex flex-col gap-6 mt-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Summary</p>
            <p className="text-sm leading-relaxed">{meta.summary}</p>
          </div>

          {meta.participants.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Participants</p>
              <p className="text-sm">{meta.participants.join(", ")}</p>
            </div>
          )}

          {meta.action_items.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Action items</p>
              <ul className="flex flex-col gap-1">
                {meta.action_items.map((item, i) => (
                  <li key={i} className="text-sm flex gap-2">
                    <span className="text-muted-foreground shrink-0">·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {conflicts.filter((c) => c.status !== "dismissed").length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">
                Conflicts with past meetings
              </p>
              <div className="flex flex-col gap-2">
                {conflicts.map((c) => (
                  <ConflictCard key={c.id} conflict={c} />
                ))}
              </div>
            </div>
          )}

          {decisions.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Decisions</p>
              <div className="border rounded-md divide-y text-sm">
                {decisions.map((d) => (
                  <div key={d.id} className="px-4 py-3 flex flex-col gap-1">
                    <p>{d.text}</p>
                    <p className="text-xs text-muted-foreground italic">&ldquo;{d.context}&rdquo;</p>
                    {d.start_sec !== null && (
                      <p className="text-xs text-muted-foreground">{formatTime(d.start_sec)}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {meta.slide_transitions && meta.slide_transitions.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">
                Slide transitions ({meta.slide_transitions.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {meta.slide_transitions.map((t, i) => (
                  <span
                    key={i}
                    className="text-xs border rounded px-2 py-0.5 text-muted-foreground tabular-nums"
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
                    <span className="text-xs text-muted-foreground">{seg.speaker}</span>
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
