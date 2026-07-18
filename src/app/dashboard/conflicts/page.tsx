import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { ConflictCard } from "@/app/dashboard/meetings/[id]/_components/conflict-card";

type Conflict = {
  id: string;
  status: "unreviewed" | "confirmed" | "dismissed";
  similarity_score: number;
  new_decision_text: string;
  new_meeting_id: string;
  new_meeting_title: string;
  past_decision_text: string;
  past_meeting_id: string;
  past_meeting_title: string;
  created_at: string;
};

async function getConflicts(): Promise<Conflict[]> {
  try {
    return await apiFetch("/conflicts");
  } catch {
    return [];
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function ConflictsPage() {
  const conflicts = await getConflicts();

  const unreviewed = conflicts.filter((c) => c.status === "unreviewed");
  const reviewed = conflicts.filter((c) => c.status !== "unreviewed");

  // Group unreviewed by the meeting that introduced the conflict
  const groups = new Map<
    string,
    { meeting_id: string; meeting_title: string; items: Conflict[] }
  >();
  for (const c of unreviewed) {
    if (!groups.has(c.new_meeting_id)) {
      groups.set(c.new_meeting_id, {
        meeting_id: c.new_meeting_id,
        meeting_title: c.new_meeting_title,
        items: [],
      });
    }
    groups.get(c.new_meeting_id)!.items.push(c);
  }

  return (
    <main className="px-8 py-8 max-w-4xl flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-medium">Conflicts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Decisions that contradict something said in a previous meeting.
        </p>
      </div>

      {conflicts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No conflicts detected yet. They appear automatically when a new meeting
          contradicts an earlier decision.
        </p>
      ) : unreviewed.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          All {conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""} reviewed —
          nothing left to action.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {Array.from(groups.values()).map((group) => (
            <div key={group.meeting_id} className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <Link
                  href={`/dashboard/meetings/${group.meeting_id}`}
                  className="text-sm font-medium hover:underline underline-offset-2"
                >
                  {group.meeting_title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {group.items.length} conflict{group.items.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {group.items.map((c) => (
                  <ConflictCard key={c.id} conflict={c} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {reviewed.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {reviewed.length} already reviewed (confirmed or dismissed) are hidden.
        </p>
      )}

    </main>
  );
}
