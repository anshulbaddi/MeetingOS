"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

const PRESET_AMOUNTS = [5, 10, 25, 50];

export default function DonatePage() {
  const params = useSearchParams();
  const success = params.get("success") === "true";
  const canceled = params.get("canceled") === "true";

  const [mode, setMode] = useState<"payment" | "subscription">("payment");
  const [selected, setSelected] = useState<number | null>(10);
  const [custom, setCustom] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const displayAmount = custom ? parseFloat(custom) : selected;

  function handleCustomChange(val: string) {
    setCustom(val.replace(/[^0-9.]/g, ""));
    setSelected(null);
  }

  function handlePreset(amount: number) {
    setSelected(amount);
    setCustom("");
  }

  function handleDonate() {
    if (!displayAmount || displayAmount <= 0) return;
    setError(null);

    startTransition(async () => {
      const res = await fetch("/api/donate/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Math.round(displayAmount * 100), mode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      window.location.href = data.url;
    });
  }

  if (success) {
    return (
      <main className="flex-1 flex items-center justify-center px-6 py-24">
        <div className="text-center flex flex-col gap-4 max-w-md">
          <div className="text-4xl">🎉</div>
          <h1 className="text-2xl font-bold tracking-tight">Thank you!</h1>
          <p className="text-muted-foreground leading-relaxed">
            Your donation helps keep MeetingOS free and open-source. We genuinely appreciate it.
          </p>
          <Button variant="outline" onClick={() => window.history.replaceState({}, "", "/donate")}>
            Donate again
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-16 lg:py-24">
      <div className="flex flex-col gap-10">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Support MeetingOS</p>
          <h1 className="text-4xl font-bold tracking-tight">Keep it free.</h1>
          <p className="text-muted-foreground leading-relaxed max-w-lg">
            MeetingOS is open-source and free to use. Donations pay for compute, storage, and the time
            spent building new features. Every dollar goes directly to the product.
          </p>
        </div>

        <Separator />

        {/* Donation card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Choose an amount</CardTitle>
            <CardDescription>One-time or monthly — cancel anytime.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {/* Frequency */}
            <Tabs value={mode} onValueChange={(v) => setMode(v as "payment" | "subscription")}>
              <TabsList className="w-full">
                <TabsTrigger value="payment" className="flex-1">One-time</TabsTrigger>
                <TabsTrigger value="subscription" className="flex-1">Monthly</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Preset amounts */}
            <div className="grid grid-cols-4 gap-2">
              {PRESET_AMOUNTS.map((amount) => (
                <Button
                  key={amount}
                  variant={selected === amount ? "default" : "outline"}
                  onClick={() => handlePreset(amount)}
                >
                  ${amount}
                </Button>
              ))}
            </div>

            {/* Custom amount */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm shrink-0">Custom ($)</span>
              <Input
                type="number"
                min="1"
                placeholder="Other amount"
                value={custom}
                onChange={(e) => handleCustomChange(e.target.value)}
                onFocus={() => setSelected(null)}
              />
            </div>

            {canceled && (
              <p className="text-sm text-muted-foreground">Payment was canceled — no charge was made.</p>
            )}

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button
              size="lg"
              onClick={handleDonate}
              disabled={isPending || !displayAmount || displayAmount <= 0}
              className="w-full"
            >
              {isPending
                ? "Redirecting to Stripe…"
                : `Donate ${displayAmount ? `$${displayAmount}` : ""}${mode === "subscription" ? "/mo" : ""} →`}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Payments are processed securely by Stripe. MeetingOS never stores your card details.
            </p>
          </CardContent>
        </Card>

        {/* What it funds */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { label: "Transcription compute", detail: "Whisper AI processing costs money per minute of audio." },
            { label: "Vector database", detail: "Embeddings and semantic search require persistent storage." },
            { label: "LLM calls", detail: "RAG queries and conflict detection use GPT-4o on every search." },
          ].map((item) => (
            <div key={item.label} className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
