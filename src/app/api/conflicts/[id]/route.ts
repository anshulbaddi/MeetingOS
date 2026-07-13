import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiFetch } from "@/lib/api";

const schema = z.object({ status: z.enum(["confirmed", "dismissed"]) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const result = await apiFetch(`/conflicts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(parsed.data),
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
