"use client";

import { useState } from "react";
import { getOrCreateShareToken } from "../actions";

export function ShareButton({ meetingId }: { meetingId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "copied">("idle");

  async function handleShare() {
    setState("loading");
    try {
      const token = await getOrCreateShareToken(meetingId);
      const url = `${window.location.origin}/share/${token}`;
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("idle");
    }
  }

  return (
    <button
      onClick={handleShare}
      disabled={state === "loading"}
      className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-md px-3 py-1.5 transition-colors disabled:opacity-50"
    >
      {state === "copied" ? "Link copied!" : state === "loading" ? "…" : "Share"}
    </button>
  );
}
