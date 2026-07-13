"use client";

import { useState, useRef, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Step =
  | { type: "tool_call"; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool: string; result: string }
  | { type: "done"; answer: string }
  | { type: "error"; message: string };

const TOOL_LABELS: Record<string, string> = {
  search_meetings: "Searching meetings",
  get_decisions: "Fetching decisions",
  ask_meeting: "Asking meeting",
  get_conflicts: "Fetching conflicts",
  search_web: "Searching web",
  github_list_repos: "Listing GitHub repos",
  github_read_file: "Reading file",
  github_create_issue: "Creating GitHub issue",
  github_create_pr: "Creating GitHub PR",
};

function ToolCallStep({ step }: { step: Extract<Step, { type: "tool_call" }> }) {
  const [open, setOpen] = useState(false);
  const label = TOOL_LABELS[step.tool] ?? step.tool;
  const inputStr = JSON.stringify(step.input, null, 2);
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-left"
      >
        <span className="text-blue-500 shrink-0">→</span>
        <span className="text-sm font-medium">{label}</span>
        {Object.keys(step.input).length > 0 && (
          <span className="text-xs text-muted-foreground">
            {Object.values(step.input)[0]
              ? String(Object.values(step.input)[0]).slice(0, 50)
              : ""}
            {open ? " ▲" : " ▼"}
          </span>
        )}
      </button>
      {open && (
        <pre className="text-xs bg-muted rounded px-3 py-2 overflow-x-auto ml-5">
          {inputStr}
        </pre>
      )}
    </div>
  );
}

function ToolResultStep({ step }: { step: Extract<Step, { type: "tool_result" }> }) {
  const [open, setOpen] = useState(false);
  const preview = step.result.slice(0, 80).replace(/\n/g, " ");
  return (
    <div className="flex flex-col gap-1 ml-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-left"
      >
        <span className="text-green-500 shrink-0">✓</span>
        <span className="text-xs text-muted-foreground">
          {preview}{step.result.length > 80 ? "…" : ""}
          {" "}{open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <pre className="text-xs bg-muted rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap ml-4">
          {step.result}
        </pre>
      )}
    </div>
  );
}

export default function AgentPage() {
  const [task, setTask] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function runAgent() {
    if (!task.trim() || running) return;

    setSteps([]);
    setRunning(true);

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        setSteps([{ type: "error", message: `Server error: ${res.status}` }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as Step;
            setSteps((prev) => [...prev, event]);
          } catch {
            // malformed line, skip
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setSteps((prev) => [
          ...prev,
          { type: "error", message: (err as Error).message },
        ]);
      }
    } finally {
      setRunning(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
  }

  const answer = steps.find((s) => s.type === "done") as
    | Extract<Step, { type: "done" }>
    | undefined;
  const errorStep = steps.find((s) => s.type === "error") as
    | Extract<Step, { type: "error" }>
    | undefined;

  return (
    <main className="max-w-2xl mx-auto w-full px-6 py-10 flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-medium">Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe a task. The agent searches your meetings, GitHub, and the web
          to get it done.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="e.g. Create a GitHub issue summarising the decisions from last week's meetings"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runAgent()}
          disabled={running}
          className="text-sm"
        />
        {running ? (
          <Button variant="outline" onClick={stop} className="shrink-0">
            Stop
          </Button>
        ) : (
          <Button onClick={runAgent} disabled={!task.trim()} className="shrink-0">
            Run
          </Button>
        )}
      </div>

      {steps.length > 0 && (
        <div className="flex flex-col gap-3">
          {running && (
            <p className="text-xs text-muted-foreground animate-pulse">
              Agent is working…
            </p>
          )}

          {steps
            .filter((s) => s.type === "tool_call" || s.type === "tool_result")
            .map((step, i) =>
              step.type === "tool_call" ? (
                <ToolCallStep key={i} step={step} />
              ) : step.type === "tool_result" ? (
                <ToolResultStep key={i} step={step} />
              ) : null
            )}

          {errorStep && (
            <div className="border border-destructive rounded-md px-4 py-3 text-sm text-destructive">
              {errorStep.message}
            </div>
          )}

          {answer && (
            <div className="border rounded-md px-4 py-4 flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Answer
              </p>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {answer.answer}
              </p>
            </div>
          )}
        </div>
      )}

      <Link
        href="/dashboard"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to dashboard
      </Link>
    </main>
  );
}
