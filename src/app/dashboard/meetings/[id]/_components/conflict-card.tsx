"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

type Conflict = {
  id: string;
  status: "unreviewed" | "confirmed" | "dismissed";
  similarity_score: number;
  new_decision_text: string;
  past_decision_text: string;
  past_meeting_title: string;
  past_meeting_id: string;
};

export function ConflictCard({ conflict }: { conflict: Conflict }) {
  const [status, setStatus] = useState(conflict.status);
  const [isPending, startTransition] = useTransition();

  function handleAction(next: "confirmed" | "dismissed") {
    startTransition(async () => {
      const res = await fetch(`/api/conflicts/${conflict.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) setStatus(next);
    });
  }

  if (status === "dismissed") return null;

  return (
    <div className="border rounded-md px-4 py-3 flex flex-col gap-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Conflicts with decision from{" "}
          <span className="font-medium text-foreground">
            {conflict.past_meeting_title}
          </span>
        </p>
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
          {Math.round(conflict.similarity_score * 100)}% similar
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <span className="text-xs text-muted-foreground shrink-0 pt-0.5 w-8">Now</span>
          <p>{conflict.new_decision_text}</p>
        </div>
        <div className="flex gap-2">
          <span className="text-xs text-muted-foreground shrink-0 pt-0.5 w-8">Then</span>
          <p className="text-muted-foreground">{conflict.past_decision_text}</p>
        </div>
      </div>

      {status === "unreviewed" && (
        <div className="flex gap-2 mt-1">
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() => handleAction("confirmed")}
          >
            Real conflict
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => handleAction("dismissed")}
          >
            Dismiss
          </Button>
        </div>
      )}

      {status === "confirmed" && (
        <p className="text-xs text-red-500">Marked as a real conflict</p>
      )}
    </div>
  );
}
