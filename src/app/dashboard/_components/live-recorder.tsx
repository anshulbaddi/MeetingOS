"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type LiveSegment = { text: string; start_sec: number };
type Status = "idle" | "recording" | "finishing";

const WS_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(
  /^http/,
  "ws",
);

const CHUNK_MS = 5000;

function fmt(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LiveRecorder() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meetingIdRef = useRef<string | null>(null);
  const activeRef = useRef(false);

  // Records one 5-second chunk, sends it, then either starts another cycle
  // (still recording) or finalises (stopped).
  function startCycle(stream: MediaStream, ws: WebSocket, mimeType: string) {
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      if (chunks.length && ws.readyState === WebSocket.OPEN) {
        const buf = await new Blob(chunks, { type: mimeType }).arrayBuffer();
        ws.send(buf);
      }

      if (activeRef.current) {
        startCycle(stream, ws, mimeType);
      } else {
        // Final chunk sent — signal the server we are done then navigate
        stream.getTracks().forEach((t) => t.stop());
        if (ws.readyState === WebSocket.OPEN) ws.send("done");
        ws.close();
        router.push(`/dashboard/meetings/${meetingIdRef.current!}`);
      }
    };

    recorder.start();
    timerRef.current = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, CHUNK_MS);
  }

  async function start() {
    setError(null);
    setSegments([]);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access denied.");
      return;
    }
    streamRef.current = stream;

    let meetingId: string;
    try {
      const r = await fetch("/api/meetings/live", { method: "POST" });
      if (!r.ok) throw new Error();
      meetingId = (await r.json()).id;
      meetingIdRef.current = meetingId;
    } catch {
      setError("Could not create meeting.");
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    let token: string;
    try {
      const r = await fetch("/api/ws-token");
      if (!r.ok) throw new Error();
      token = (await r.json()).token;
    } catch {
      setError("Auth failed.");
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const ws = new WebSocket(
      `${WS_BASE}/ws/meetings/${meetingId}/live?token=${token}`,
    );
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as {
        type: string;
        text?: string;
        start_sec?: number;
        message?: string;
      };
      if (msg.type === "segment" && msg.text) {
        setSegments((prev) => [
          ...prev,
          { text: msg.text!, start_sec: msg.start_sec ?? 0 },
        ]);
      }
      if (msg.type === "error") {
        setError(`Transcription error: ${msg.message}`);
      }
    };

    ws.onerror = () => setError("WebSocket connection lost.");

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    ws.onopen = () => {
      activeRef.current = true;
      setStatus("recording");
      startCycle(stream, ws, mimeType);
    };
  }

  function stop() {
    activeRef.current = false;
    setStatus("finishing");
    if (timerRef.current) clearTimeout(timerRef.current);
    // Stopping the recorder triggers onstop, which sends the final chunk
    // and navigates when activeRef is false.
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  if (status === "idle") {
    return (
      <div className="flex flex-col gap-2">
        <Button variant="outline" onClick={start} className="w-fit gap-2">
          <span className="text-red-500">●</span>
          Record live
        </Button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border rounded-md p-4">
      <div className="flex items-center gap-3">
        <Badge variant="destructive" className="animate-pulse gap-1">
          ● Live
        </Badge>
        {status === "recording" ? (
          <Button variant="outline" size="sm" onClick={stop}>
            Stop recording
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">
            Finishing up…
          </span>
        )}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
        {segments.length === 0 ? (
          <p className="text-xs text-muted-foreground">Listening…</p>
        ) : (
          segments.map((seg, i) => (
            <div key={i} className="flex gap-2 text-sm">
              <span className="text-xs text-muted-foreground tabular-nums shrink-0 pt-0.5">
                {fmt(seg.start_sec)}
              </span>
              <span>{seg.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
