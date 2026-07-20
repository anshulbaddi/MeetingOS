"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileName(e.target.files?.[0]?.name ?? null);
    setError(null);
    setUploadProgress(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    setError(null);
    setUploadProgress(0);

    const fd = new FormData();
    fd.append("file", file);

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };

    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText);
      if (xhr.status >= 400) {
        setError(data.error ?? "Upload failed");
        setUploadProgress(null);
        return;
      }
      router.push(`/dashboard/meetings/${data.id}`);
      router.refresh();
    };

    xhr.onerror = () => {
      setError("Upload failed. Check your connection and try again.");
      setUploadProgress(null);
    };

    xhr.open("POST", "/api/meetings/upload");
    xhr.send(fd);
  }

  const isUploading = uploadProgress !== null;

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
          disabled={isUploading}
          className="cursor-pointer"
        />
        <p className="text-xs text-muted-foreground">
          mp3 · mp4 · wav · m4a · webm · ogg · mov — up to 500 MB
        </p>
      </div>

      {fileName && !isUploading && (
        <p className="text-xs text-muted-foreground truncate">
          Selected: <span className="text-foreground">{fileName}</span>
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {isUploading && (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Uploading…</span>
            <span>{uploadProgress}%</span>
          </div>
          <Progress value={uploadProgress} className="h-1.5" />
        </div>
      )}

      <Button
        type="submit"
        disabled={!fileName || isUploading}
        className="w-full bg-zinc-200 hover:bg-zinc-300 text-zinc-700 border-0 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200"
      >
        {isUploading ? "Uploading…" : "Upload & transcribe"}
      </Button>
    </form>
  );
}
