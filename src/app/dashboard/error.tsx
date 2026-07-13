"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="max-w-2xl mx-auto w-full px-6 py-10 flex flex-col gap-4">
      <h1 className="text-lg font-medium">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        {error.message || "An unexpected error occurred."}
      </p>
      <div className="flex gap-4 text-sm">
        <button
          onClick={reset}
          className="underline underline-offset-2 hover:text-foreground text-muted-foreground"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="underline underline-offset-2 hover:text-foreground text-muted-foreground"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
