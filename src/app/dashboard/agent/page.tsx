"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

type Step =
  | { type: "step"; agent: string }
  | { type: "tool_call"; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool: string; result: string }
  | { type: "done"; answer: string }
  | { type: "error"; message: string };

const AGENT_LABELS: Record<string, string> = {
  meeting_agent: "Meeting Intelligence",
  conflict_agent: "Conflict Detection",
  web_agent: "Web Research",
  github_agent: "GitHub",
};

const TOOL_LABELS: Record<string, string> = {
  search_meetings: "Searching meetings",
  get_decisions: "Fetching decisions",
  ask_meeting: "Asking meeting",
  get_conflicts: "Fetching conflicts",
  search_web: "Searching web",
  github_list_repos: "Listing GitHub repos",
  github_read_file: "Reading file",
  github_create_issue: "Creating issue",
  github_create_pr: "Creating pull request",
};

const SUGGESTED_TASKS = [
  "Summarise the key decisions from my last 3 meetings",
  "Find any conflicts between decisions across meetings",
  "Search my meetings for anything about the API design",
  "Create a GitHub issue with action items from recent meetings",
];

function ToolCallStep({ step }: { step: Extract<Step, { type: "tool_call" }> }) {
  const [open, setOpen] = useState(false);
  const label = TOOL_LABELS[step.tool] ?? step.tool;
  const firstArg = Object.values(step.input)[0];
  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 text-left w-full"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
        <span className="text-sm text-foreground">{label}</span>
        {firstArg !== undefined && (
          <span className="text-xs text-muted-foreground truncate flex-1">
            {String(firstArg).slice(0, 60)}
          </span>
        )}
        <span className="text-xs text-muted-foreground shrink-0">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <pre className="text-xs bg-muted rounded-lg px-3 py-2.5 overflow-x-auto ml-4 leading-relaxed">
          {JSON.stringify(step.input, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ToolResultStep({ step }: { step: Extract<Step, { type: "tool_result" }> }) {
  const [open, setOpen] = useState(false);
  const preview = step.result.slice(0, 90).replace(/\n/g, " ");
  return (
    <div className="flex flex-col gap-1.5 ml-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 text-left w-full"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
        <span className="text-xs text-muted-foreground flex-1 truncate">
          {preview}{step.result.length > 90 ? "…" : ""}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <pre className="text-xs bg-muted rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre-wrap ml-4 leading-relaxed">
          {step.result}
        </pre>
      )}
    </div>
  );
}

function AgentStepHeader({ agent }: { agent: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <Separator className="flex-1" />
      <Badge variant="secondary" className="text-xs font-medium shrink-0">
        {AGENT_LABELS[agent] ?? agent}
      </Badge>
      <Separator className="flex-1" />
    </div>
  );
}

export default function AgentPage() {
  const [task, setTask] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function runAgent(taskOverride?: string) {
    const input = taskOverride ?? task;
    if (!input.trim() || running) return;
    if (taskOverride) setTask(taskOverride);

    setSteps([]);
    setRunning(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: input }),
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
            // malformed line
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

  const answer = steps.find((s) => s.type === "done") as Extract<Step, { type: "done" }> | undefined;
  const errorStep = steps.find((s) => s.type === "error") as Extract<Step, { type: "error" }> | undefined;
  const traceSteps = steps.filter(
    (s) => s.type === "step" || s.type === "tool_call" || s.type === "tool_result"
  );

  return (
    <main className="px-8 py-8 flex flex-col gap-8 max-w-4xl">
      <div>
        <h1 className="text-xl font-medium">Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe a task. The agent routes across your meetings, GitHub, and the
          web to get it done.
        </p>
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <Input
          placeholder="e.g. Create a GitHub issue summarising last week's decisions"
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
          <Button onClick={() => runAgent()} disabled={!task.trim()} className="shrink-0">
            Run
          </Button>
        )}
      </div>

      {/* Suggested tasks — only when idle and no results yet */}
      {!running && steps.length === 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            Try asking
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SUGGESTED_TASKS.map((t) => (
              <button
                key={t}
                onClick={() => runAgent(t)}
                className="text-left text-sm text-muted-foreground hover:text-foreground border border-dashed rounded-lg px-4 py-3 transition-colors hover:border-zinc-400 dark:hover:border-zinc-600"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Trace */}
      {(traceSteps.length > 0 || running) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {running ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                  Working…
                </span>
              ) : (
                "Trace"
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {traceSteps.map((step, i) => {
              if (step.type === "step") return <AgentStepHeader key={i} agent={step.agent} />;
              if (step.type === "tool_call") return <ToolCallStep key={i} step={step} />;
              if (step.type === "tool_result") return <ToolResultStep key={i} step={step} />;
              return null;
            })}
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {errorStep && (
        <Card className="border-destructive/50">
          <CardContent className="py-4 text-sm text-destructive">
            {errorStep.message}
          </CardContent>
        </Card>
      )}

      {/* Answer */}
      {answer && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Answer</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{answer.answer}</p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
