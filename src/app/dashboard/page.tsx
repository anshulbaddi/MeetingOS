import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { UploadForm } from "./_components/upload-form";
import { LiveRecorder } from "./_components/live-recorder";
import { SearchBar } from "./_components/search-bar";

type Meeting = {
  id: string;
  title: string;
  status: "processing" | "complete" | "failed";
  duration_seconds: number | null;
  created_at: string;
};

async function getMeetings(): Promise<Meeting[]> {
  try {
    return await apiFetch("/meetings");
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

export default async function DashboardPage() {
  const meetings = await getMeetings();

  return (
    <main className="max-w-2xl mx-auto w-full px-6 py-10 flex flex-col gap-10">
      <div>
        <h1 className="text-xl font-medium">Upload a meeting</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop a recording and we&apos;ll transcribe it, extract key moments, and let you ask questions about it.
        </p>
      </div>

      <UploadForm />

      <div>
        <p className="text-sm font-medium mb-2">Or record directly</p>
        <LiveRecorder />
      </div>

      {meetings.some((m) => m.status === "complete") && (
        <>
          <SearchBar />
          <div className="flex gap-4 -mt-6">
            <Link
              href="/dashboard/decisions"
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              View all decisions →
            </Link>
            <Link
              href="/dashboard/conflicts"
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              View conflicts →
            </Link>
            <Link
              href="/dashboard/agent"
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Agent →
            </Link>
          </div>
        </>
      )}

      {meetings.length > 0 && (
        <div>
          <p className="text-sm mb-2 text-muted-foreground">Past meetings</p>
          <div className="border rounded-md divide-y text-sm">
            {meetings.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="text-muted-foreground shrink-0 text-xs w-28">
                  {formatDate(m.created_at)}
                </span>
                <span className="truncate flex-1">{m.title}</span>
                {formatDuration(m.duration_seconds) && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatDuration(m.duration_seconds)}
                  </span>
                )}
                <Badge variant={statusVariant(m.status)} className="shrink-0 text-xs">
                  {m.status}
                </Badge>
                <Link
                  href={`/dashboard/meetings/${m.id}`}
                  className="shrink-0 underline underline-offset-2 hover:text-foreground text-muted-foreground"
                >
                  view
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
