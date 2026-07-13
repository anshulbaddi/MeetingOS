import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

const schema = z.object({
  message: z.string().min(1).max(500),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(20)
    .default([]),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const clientIp =
    req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";

  let res: Response;
  try {
    res = await fetch(`${API_URL}/chat/public`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": clientIp },
      body: JSON.stringify(parsed.data),
    });
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "Request failed");
    return NextResponse.json({ error: text }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}
