import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { ProcessingPoller } from "./_components/processing-poller";
import { MeetingTabs } from "./_components/meeting-tabs";

type Segment = {
  id: string;
  text: string;
  start_sec: number;
  end_sec: number;
  speaker: string | null;
};

type Meta = {
  summary: string;
  action_items: string[];
  participants: string[];
  slide_transitions: { start_sec: number }[] | null;
};

type Decision = {
  id: string;
  text: string;
  context: string;
  start_sec: number | null;
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

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  cited_segments: { segment_id: string; start_sec: number; text: string }[];
};

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm"]);

function recordingMediaType(url: string): "video" | "audio" {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTS.has(`.${ext}`) ? "video" : "audio";
}

type Meeting = {
  id: string;
  title: string;
  status: "processing" | "complete" | "failed";
  duration_seconds: number | null;
  created_at: string;
  recording_url: string | null;
  segments: Segment[];
  meta: Meta | null;
  decisions: Decision[];
  conflicts: Conflict[];
};

async function getMeeting(id: string): Promise<Meeting> {
  return apiFetch(`/meetings/${id}`);
}

async function getChatHistory(id: string): Promise<ChatMessage[]> {
  try {
    return await apiFetch(`/meetings/${id}/chat`);
  } catch {
    return [];
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let meeting: Meeting;
  try {
    meeting = await getMeeting(id);
  } catch {
    notFound();
  }

  const chatHistory = await getChatHistory(id);

  return (
    <main className="px-8 py-8 max-w-4xl flex flex-col gap-8">
      <div>
        <Link
          href="/dashboard"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Meetings
        </Link>
        <div className="mt-4 flex items-center gap-3">
          <h1 className="text-xl font-medium truncate">{meeting.title}</h1>
          <Badge
            variant={
              meeting.status === "complete"
                ? "default"
                : meeting.status === "failed"
                  ? "destructive"
                  : "secondary"
            }
            className="shrink-0 text-xs"
          >
            {meeting.status}
          </Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {formatDate(meeting.created_at)}
          {meeting.duration_seconds
            ? ` · ${Math.floor(meeting.duration_seconds / 60)}m ${meeting.duration_seconds % 60}s`
            : ""}
        </p>
      </div>

      {meeting.recording_url && meeting.status === "complete" && (
        recordingMediaType(meeting.recording_url) === "video" ? (
          <video
            controls
            src={meeting.recording_url}
            className="w-full rounded-md"
            preload="metadata"
          />
        ) : (
          <audio
            controls
            src={meeting.recording_url}
            className="w-full"
            preload="metadata"
          />
        )
      )}

      {meeting.status === "processing" && <ProcessingPoller meetingId={id} />}

      {meeting.status === "failed" && (
        <p className="text-sm text-red-500">
          Transcription failed. Try uploading the file again.
        </p>
      )}

      {meeting.status === "complete" && (
        <MeetingTabs
          meetingId={id}
          segments={meeting.segments}
          meta={meeting.meta}
          decisions={meeting.decisions}
          conflicts={meeting.conflicts}
          initialMessages={chatHistory}
        />
      )}
    </main>
  );
}
