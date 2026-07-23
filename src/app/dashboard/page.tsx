import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { UploadForm } from "./_components/upload-form";
import { LiveRecorder } from "./_components/live-recorder";
import { SearchBar } from "./_components/search-bar";
import { MeetingCard } from "./_components/meeting-card";

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
                <MeetingCard key={m.id} meeting={m} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
