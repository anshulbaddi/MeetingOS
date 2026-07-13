import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { z } from "zod";

const schema = z.object({
  amount: z.number().int().min(100).max(1000000),
  mode: z.enum(["payment", "subscription"]).default("payment"),
});

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { amount, mode } = parsed.data;
  const origin = req.headers.get("origin") ?? "http://localhost:3000";

  const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
    currency: "usd",
    product_data: {
      name: "MeetingOS Donation",
      description: "Support open-source meeting intelligence",
    },
    unit_amount: amount,
    ...(mode === "subscription" ? { recurring: { interval: "month" } } : {}),
  };

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [{ price_data: priceData, quantity: 1 }],
    mode: mode === "subscription" ? "subscription" : "payment",
    success_url: `${origin}/donate?success=true`,
    cancel_url: `${origin}/donate?canceled=true`,
  });

  return NextResponse.json({ url: session.url });
}
