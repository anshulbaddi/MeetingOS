import { notFound } from "next/navigation";
import Link from "next/link";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

type ActionItem = string | { text: string; assignee: string | null; due: string | null };

type SharedMeeting = {
  title: string;
  created_at: string;
  summary: string;
  participants: string[];
  action_items: ActionItem[];
  decisions: { text: string; context: string }[];
};

async function getSharedMeeting(token: string): Promise<SharedMeeting> {
  const res = await fetch(`${API_URL}/share/${token}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Not found");
  return res.json();
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
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

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let meeting: SharedMeeting;
  try {
    meeting = await getSharedMeeting(token);
  } catch {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12 flex flex-col gap-8">
        <div>
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
            MeetingOS
          </Link>
          <h1 className="mt-4 text-2xl font-semibold">{meeting.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatDate(meeting.created_at)}</p>
        </div>

        {meeting.summary && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Summary
            </p>
            <p className="text-sm leading-relaxed">{meeting.summary}</p>
          </div>
        )}

        {meeting.participants.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Participants
            </p>
            <div className="flex flex-wrap gap-1.5">
              {meeting.participants.map((p) => (
                <span
                  key={p}
                  className="text-xs border border-border rounded-full px-3 py-1"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}

        {meeting.action_items.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Action Items
            </p>
            <div className="flex flex-col gap-2">
              {meeting.action_items.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 py-2 border-b border-border last:border-0"
                >
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

        {meeting.decisions.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Decisions
            </p>
            <div className="flex flex-col gap-2">
              {meeting.decisions.map((d, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-border px-4 py-3 flex flex-col gap-1"
                >
                  <p className="text-sm font-medium">{d.text}</p>
                  {d.context && (
                    <p className="text-xs text-muted-foreground italic leading-relaxed">
                      &ldquo;{d.context}&rdquo;
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Shared via{" "}
            <Link href="/" className="text-[#2D8CFF] hover:underline">
              MeetingOS
            </Link>{" "}
            — AI-powered meeting intelligence
          </p>
        </div>
      </div>
    </div>
  );
}
