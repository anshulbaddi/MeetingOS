"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

type Message = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What can MeetingOS do?",
  "How does the AI search work?",
  "What is conflict detection?",
  "Can I record live meetings?",
];

const GREETING: Message = {
  role: "assistant",
  content:
    "Hey! I'm the MeetingOS assistant. Ask me anything about how the product works — transcription, search, conflict detection, or anything else.",
};

export function LandingChat() {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send(text: string) {
    const question = text.trim();
    if (!question || isPending) return;

    const userMsg: Message = { role: "user", content: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    startTransition(async () => {
      const history = messages.filter((m) => m.role !== "assistant" || messages.indexOf(m) > 0);
      const res = await fetch("/api/chat/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, history }),
      });
      const data = await res.json();
      const reply = res.ok ? data.reply : "Sorry, something went wrong. Try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    });

    inputRef.current?.focus();
  }

  const showSuggestions = messages.length === 1;

  return (
    <div className="flex flex-col rounded-2xl border bg-card shadow-sm overflow-hidden h-[440px]">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b bg-muted/40">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <span className="text-sm font-medium">MeetingOS Assistant</span>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-3">
        <div className="flex flex-col gap-3">
          {messages.map((msg, i) => (
            <div key={i} className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground text-sm px-3 py-2 rounded-2xl rounded-tr-sm max-w-[85%] leading-relaxed"
                    : "text-sm max-w-[90%] leading-relaxed text-foreground"
                }
              >
                {msg.content}
              </div>
            </div>
          ))}

          {isPending && (
            <div className="flex justify-start">
              <div className="text-sm text-muted-foreground flex gap-1 items-center">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse delay-75">●</span>
                <span className="animate-pulse delay-150">●</span>
              </div>
            </div>
          )}

          {showSuggestions && !isPending && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs border rounded-full px-3 py-1.5 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t px-3 py-2.5 flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send(input)}
          placeholder="Ask anything about MeetingOS…"
          disabled={isPending}
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <Button
          size="sm"
          onClick={() => send(input)}
          disabled={!input.trim() || isPending}
          className="shrink-0 h-7 px-3 text-xs"
        >
          Send
        </Button>
      </div>
    </div>
  );
}
