"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CitedSegment = {
  segment_id: string;
  start_sec: number;
  text: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  cited_segments: CitedSegment[];
};

type Props = {
  meetingId: string;
  initialMessages: Message[];
};

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function FeedbackButtons({ messageId }: { messageId: string }) {
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRate(value: 1 | -1) {
    if (rating !== null) return;
    startTransition(async () => {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "chat_quality",
          reference_id: messageId,
          rating: value,
        }),
      });
      if (res.ok) setRating(value);
    });
  }

  if (rating !== null) {
    return (
      <span className="text-xs text-muted-foreground">
        {rating === 1 ? "👍" : "👎"}
      </span>
    );
  }

  return (
    <div className="flex gap-1">
      <button
        onClick={() => handleRate(1)}
        disabled={isPending}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Good answer"
      >
        👍
      </button>
      <button
        onClick={() => handleRate(-1)}
        disabled={isPending}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Bad answer"
      >
        👎
      </button>
    </div>
  );
}

export function ChatPanel({ meetingId, initialMessages }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question) return;

    const optimisticUser: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      cited_segments: [],
    };

    setMessages((prev) => [...prev, optimisticUser]);
    setInput("");
    setError(null);

    startTransition(async () => {
      const res = await fetch(`/api/meetings/${meetingId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
        return;
      }

      const assistantMsg: Message = {
        id: data.message_id,
        role: "assistant",
        content: data.answer,
        cited_segments: data.cited_segments ?? [],
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask anything about this meeting.
          </p>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === "user" ? "flex justify-end" : ""}>
            <div
              className={
                msg.role === "user"
                  ? "bg-primary text-primary-foreground text-sm px-3 py-2 rounded-lg max-w-[80%]"
                  : "text-sm flex flex-col gap-1.5 max-w-full"
              }
            >
              <p className="leading-relaxed">{msg.content}</p>

              {msg.role === "assistant" && (
                <div className="flex items-center gap-3 mt-1">
                  {msg.cited_segments.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {msg.cited_segments.slice(0, 3).map((seg) => (
                        <span
                          key={seg.segment_id}
                          className="text-xs border rounded px-1.5 py-0.5 text-muted-foreground tabular-nums"
                          title={seg.text}
                        >
                          {formatTime(seg.start_sec)}
                        </span>
                      ))}
                    </div>
                  )}
                  <FeedbackButtons messageId={msg.id} />
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          disabled={isPending}
          className="text-sm"
        />
        <Button type="submit" size="sm" disabled={!input.trim() || isPending}>
          {isPending ? "..." : "Ask"}
        </Button>
      </form>
    </div>
  );
}
