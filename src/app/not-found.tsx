import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-medium">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        This page doesn&apos;t exist.
      </p>
      <Link
        href="/dashboard"
        className="text-sm underline underline-offset-2 hover:text-foreground text-muted-foreground"
      >
        Go to dashboard
      </Link>
    </main>
  );
}
