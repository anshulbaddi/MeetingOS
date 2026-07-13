import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiFetch } from "@/lib/api";

const schema = z.object({
  type: z.enum(["chat_quality", "conflict_relevance", "summary_quality"]),
  reference_id: z.string().uuid(),
  rating: z.union([z.literal(1), z.literal(-1)]),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const result = await apiFetch("/feedback", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
