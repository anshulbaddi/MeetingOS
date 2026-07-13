"use client";

import { useEffect } from "react";

export default function GlobalError({
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
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-medium">Something went wrong</h1>
      <p className="text-sm text-muted-foreground max-w-sm">{error.message}</p>
      <button
        onClick={reset}
        className="text-sm underline underline-offset-2 hover:text-foreground text-muted-foreground"
      >
        Try again
      </button>
    </div>
  );
}
