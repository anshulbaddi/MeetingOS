import { NextRequest, NextResponse } from "next/server";
import { apiFetch } from "@/lib/api";

const ALLOWED = new Set([".mp3", ".mp4", ".wav", ".m4a", ".webm", ".ogg", ".mov"]);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED.has(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type '${ext}'` },
        { status: 400 },
      );
    }

    const fd = new FormData();
    fd.append("file", file, file.name);

    const meeting = await apiFetch("/meetings/upload", { method: "POST", body: fd });
    return NextResponse.json(meeting);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
