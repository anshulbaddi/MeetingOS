import Link from "next/link";
import { apiFetch } from "@/lib/api";

type Decision = {
  id: string;
  text: string;
  context: string;
  start_sec: number;
  meeting_id: string;
  meeting_title: string;
  meeting_date: string;
};

async function getDecisions(): Promise<Decision[]> {
  try {
    return await apiFetch("/decisions");
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

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function DecisionsPage() {
  const decisions = await getDecisions();

  // Group by meeting_id, preserving order (backend returns newest meeting first)
  const groups = new Map<string, { title: string; date: string; meeting_id: string; items: Decision[] }>();
  for (const d of decisions) {
    if (!groups.has(d.meeting_id)) {
      groups.set(d.meeting_id, {
        title: d.meeting_title,
        date: d.meeting_date,
        meeting_id: d.meeting_id,
        items: [],
      });
    }
    groups.get(d.meeting_id)!.items.push(d);
  }

  const grouped = Array.from(groups.values());

  return (
    <main className="max-w-2xl mx-auto w-full px-6 py-10 flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-medium">Decisions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every decision extracted from your meetings, newest first.
        </p>
      </div>

      {decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No decisions yet.{" "}
          <Link href="/dashboard" className="underline underline-offset-2">
            Upload a meeting
          </Link>{" "}
          to get started.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {grouped.map((group) => (
            <div key={group.meeting_id} className="flex flex-col gap-3">
              {/* Meeting header */}
              <div className="flex items-baseline gap-2">
                <Link
                  href={`/dashboard/meetings/${group.meeting_id}`}
                  className="text-sm font-medium hover:underline underline-offset-2"
                >
                  {group.title}
                </Link>
                <span className="text-xs text-muted-foreground">{formatDate(group.date)}</span>
              </div>

              {/* Decision cards */}
              <div className="border rounded-md divide-y">
                {group.items.map((d) => (
                  <div key={d.id} className="px-4 py-3 flex gap-3">
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0 pt-0.5 w-10">
                      {formatTime(d.start_sec)}
                    </span>
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                      <p className="text-sm">{d.text}</p>
                      {d.context && d.context !== d.text && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{d.context}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Link href="/dashboard" className="text-xs text-muted-foreground hover:text-foreground">
        ← Back to dashboard
      </Link>
    </main>
  );
}
