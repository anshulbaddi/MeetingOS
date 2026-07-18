"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileName(e.target.files?.[0]?.name ?? null);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/meetings/upload", { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Upload failed");
        return;
      }

      router.push(`/dashboard/meetings/${data.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="meeting-file">Audio or video file</Label>
        <Input
          id="meeting-file"
          type="file"
          accept=".mp3,.mp4,.wav,.m4a,.webm,.ogg,.mov"
          ref={inputRef}
          onChange={handleFileChange}
          disabled={isPending}
          className="cursor-pointer"
        />
        <p className="text-xs text-muted-foreground">
          mp3 · mp4 · wav · m4a · webm · ogg · mov — up to 500 MB
        </p>
      </div>

      {fileName && (
        <p className="text-xs text-muted-foreground truncate">
          Selected: <span className="text-foreground">{fileName}</span>
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={!fileName || isPending} className="w-full">
        {isPending ? "Uploading…" : "Upload & transcribe"}
      </Button>
    </form>
  );
}
