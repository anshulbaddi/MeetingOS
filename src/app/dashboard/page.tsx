import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
  const hasMeetings = meetings.length > 0;
  const hasComplete = meetings.some((m) => m.status === "complete");

  return (
    <main className="px-8 py-8 flex flex-col gap-8">

      {hasComplete && (
        <SearchBar />
      )}

      <div className="grid gap-8 lg:grid-cols-[360px_1fr] items-start">

        {/* Left column — upload & record */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Upload a recording</CardTitle>
              <CardDescription>
                We&apos;ll transcribe it, extract key moments, and let you ask
                questions about it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UploadForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Record live</CardTitle>
              <CardDescription>
                Transcribe a meeting as it happens in real time.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LiveRecorder />
            </CardContent>
          </Card>
        </div>

        {/* Right column — meetings list */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {hasMeetings
                ? `${meetings.length} meeting${meetings.length !== 1 ? "s" : ""}`
                : "No meetings yet"}
            </p>
          </div>

          {!hasMeetings ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  Upload your first recording to get started.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {meetings.map((m) => (
                <Link key={m.id} href={`/dashboard/meetings/${m.id}`}>
                  <Card className="hover:ring-foreground/20 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-all cursor-pointer">
                    <CardContent className="flex items-center justify-between gap-4 py-4">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <p className="text-sm font-medium truncate">{m.title}</p>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{formatDate(m.created_at)}</span>
                          {formatDuration(m.duration_seconds) && (
                            <>
                              <span>·</span>
                              <span>{formatDuration(m.duration_seconds)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <Badge
                        variant={statusVariant(m.status)}
                        className={`shrink-0 text-xs ${m.status === "complete" ? "bg-[#2D8CFF]/10 text-[#2D8CFF] border-[#2D8CFF]/20" : ""}`}
                      >
                        {m.status}
                      </Badge>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
