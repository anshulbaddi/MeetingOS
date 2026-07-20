"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Stage = "transcribing" | "analyzing" | "done";

type Props = { meetingId: string };

const STAGES: { key: Stage; label: string }[] = [
  { key: "transcribing", label: "Transcribing audio" },
  { key: "analyzing", label: "Extracting insights" },
  { key: "done", label: "Complete" },
];

function inferStage(data: { status: string; segments: unknown[]; meta: unknown }): Stage {
  if (data.status !== "processing") return "done";
  if (data.segments?.length > 0) return "analyzing";
  return "transcribing";
}

export function ProcessingPoller({ meetingId }: Props) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("transcribing");

  useEffect(() => {
    const poll = setInterval(async () => {
      const res = await fetch(`/api/meetings/${meetingId}`);
      if (!res.ok) return;
      const data = await res.json();

      const current = inferStage(data);
      setStage(current);

      if (data.status === "complete" || data.status === "failed") {
        clearInterval(poll);
        router.refresh();
      }
    }, 3000);

    return () => clearInterval(poll);
  }, [meetingId, router]);

  const currentIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {STAGES.slice(0, -1).map((s, i) => {
          const isDone = i < currentIndex;
          const isActive = i === currentIndex;
          return (
            <div key={s.key} className="flex items-center gap-3">
              <div
                className={[
                  "h-2 w-2 rounded-full shrink-0",
                  isDone
                    ? "bg-[#2D8CFF]"
                    : isActive
                      ? "bg-[#2D8CFF] animate-pulse"
                      : "bg-zinc-200 dark:bg-zinc-700",
                ].join(" ")}
              />
              <span
                className={[
                  "text-sm",
                  isActive ? "text-foreground" : isDone ? "text-muted-foreground" : "text-zinc-300 dark:text-zinc-600",
                ].join(" ")}
              >
                {s.label}
              </span>
              {isDone && (
                <span className="text-xs text-[#2D8CFF] ml-auto">done</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        This usually takes 1–2 minutes. The page will update automatically.
      </p>
    </div>
  );
}
