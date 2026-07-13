import Link from "next/link";
import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { LandingChat } from "./_components/landing-chat";
import { StickyFeatures } from "./_components/sticky-features";

export default async function Home() {
  const session = await auth();

  return (
    <div className="flex flex-col flex-1">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="flex-1 max-w-6xl mx-auto w-full px-6 py-16 lg:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">

          {/* Left — headline + CTA */}
          <div className="flex flex-col gap-6 lg:pt-4">
            <div className="flex flex-col gap-4">
              <h1 className="text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1]">
                Your meetings,<br />
                <span className="text-muted-foreground">actually searchable.</span>
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed max-w-md">
                Upload a recording. Get a full transcript, extract key decisions, ask questions,
                and catch contradictions — all in one place.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              {session ? (
                <Button asChild size="lg" className="w-fit">
                  <Link href="/dashboard">Go to dashboard →</Link>
                </Button>
              ) : (
                <form
                  action={async () => {
                    "use server";
                    await signIn("google", { redirectTo: "/dashboard" });
                  }}
                >
                  <Button type="submit" size="lg">
                    Get started free →
                  </Button>
                </form>
              )}
            </div>

            <div className="flex flex-col gap-2 pt-2">
              {[
                "Transcription in minutes, not hours",
                "Ask questions, get cited answers",
                "Contradictions flagged automatically",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="text-foreground">✓</span>
                  {item}
                </div>
              ))}
            </div>
          </div>

          {/* Right — live demo chatbot */}
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">
              Try it — no sign-in needed
            </p>
            <LandingChat />
          </div>
        </div>
      </section>

      <Separator />

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto w-full px-6">
        <div className="py-16 lg:py-20">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest mb-2">
            How it works
          </p>
          <h2 className="text-3xl font-bold tracking-tight">
            Everything your team needs<br className="hidden lg:block" /> from a meeting.
          </h2>
        </div>
        <StickyFeatures />
      </section>

      <Separator />

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto w-full px-6 py-24 flex flex-col items-center text-center gap-6">
        <h2 className="text-3xl lg:text-4xl font-bold tracking-tight">
          So, what are we building?
        </h2>
        <p className="text-muted-foreground text-lg max-w-md">
          Sign in with Google and upload your first meeting. It takes about 30 seconds.
        </p>
        {session ? (
          <Button asChild size="lg">
            <Link href="/dashboard">Open dashboard →</Link>
          </Button>
        ) : (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/dashboard" });
            }}
          >
            <Button type="submit" size="lg">
              Get started free →
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
