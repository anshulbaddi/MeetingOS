"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Props = { meetingId: string };

export function ProcessingPoller({ meetingId }: Props) {
  const router = useRouter();
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const dotTimer = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "." : d + "."));
    }, 500);

    const poll = setInterval(async () => {
      const res = await fetch(`/api/meetings/${meetingId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === "complete" || data.status === "failed") {
        clearInterval(poll);
        clearInterval(dotTimer);
        router.refresh();
      }
    }, 3000);

    return () => {
      clearInterval(poll);
      clearInterval(dotTimer);
    };
  }, [meetingId, router]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">Transcribing{dots}</p>
      <p className="text-xs text-muted-foreground">
        This usually takes 1–2 minutes. The page will update automatically.
      </p>
    </div>
  );
}
