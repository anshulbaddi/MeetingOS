import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/api";

export async function POST() {
  try {
    const meeting = await apiFetch("/meetings/live", { method: "POST" });
    return NextResponse.json(meeting);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
