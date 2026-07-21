"use server";
import { apiFetch } from "@/lib/api";

export async function getOrCreateShareToken(meetingId: string): Promise<string> {
  const data = await apiFetch(`/meetings/${meetingId}/share`, { method: "POST" });
  return data.share_token;
}
