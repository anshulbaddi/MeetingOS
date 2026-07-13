"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

const CONTACT_OPTIONS = [
  { icon: "✉️", label: "Email", value: "hello@meetingos.app", href: "mailto:hello@meetingos.app" },
  { icon: "🐙", label: "GitHub", value: "github.com/anshulbaddi", href: "https://github.com/anshulbaddi" },
  { icon: "🐦", label: "Twitter / X", value: "@meetingos", href: "https://twitter.com/meetingos" },
];

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      setSent(true);
    });
  }

  return (
    <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-16 lg:py-24">
      <div className="flex flex-col gap-10">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Get in touch</p>
          <h1 className="text-4xl font-bold tracking-tight">Contact us.</h1>
          <p className="text-muted-foreground leading-relaxed max-w-lg">
            Have a question, bug report, or feature idea? We read every message and usually reply within 24 hours.
          </p>
        </div>

        <Separator />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">
          {/* Left — contact details */}
          <div className="lg:col-span-2 flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              {CONTACT_OPTIONS.map((opt) => (
                <div key={opt.label} className="flex flex-col gap-0.5">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">{opt.label}</p>
                  <a
                    href={opt.href}
                    target={opt.href.startsWith("http") ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    className="text-sm hover:text-foreground text-muted-foreground transition-colors underline underline-offset-2"
                  >
                    {opt.value}
                  </a>
                </div>
              ))}
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Response time</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                We aim to reply within 24 hours on weekdays. For urgent bugs, open a GitHub issue for faster triage.
              </p>
            </div>
          </div>

          {/* Right — form */}
          <div className="lg:col-span-3">
            {sent ? (
              <Card>
                <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
                  <div className="text-3xl">✓</div>
                  <h2 className="text-lg font-semibold">Message sent</h2>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Thanks for reaching out. We&apos;ll get back to you at {form.email}.
                  </p>
                  <Button variant="outline" onClick={() => { setSent(false); setForm({ name: "", email: "", subject: "", message: "" }); }}>
                    Send another
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Send a message</CardTitle>
                  <CardDescription>We&apos;ll reply to the email address you provide.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                          id="name"
                          placeholder="Your name"
                          value={form.name}
                          onChange={(e) => update("name", e.target.value)}
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="you@example.com"
                          value={form.email}
                          onChange={(e) => update("email", e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label htmlFor="subject">Subject</Label>
                      <Input
                        id="subject"
                        placeholder="What's this about?"
                        value={form.subject}
                        onChange={(e) => update("subject", e.target.value)}
                        required
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label htmlFor="message">Message</Label>
                      <Textarea
                        id="message"
                        placeholder="Describe your question, bug, or idea in detail…"
                        rows={6}
                        value={form.message}
                        onChange={(e) => update("message", e.target.value)}
                        required
                        minLength={10}
                      />
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    <Button type="submit" disabled={isPending} className="w-full sm:w-fit">
                      {isPending ? "Sending…" : "Send message →"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
