import { auth, signIn, signOut } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import Link from "next/link";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MeetingOS",
  description: "Transcribe, search, and ask questions about your meetings.",
};

const themeScript = `
(function() {
  var theme = localStorage.getItem('theme');
  if (theme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script id="theme-init" strategy="beforeInteractive">{themeScript}</Script>
      </head>
      <body className="min-h-full flex flex-col">
        <header className="flex items-center justify-between gap-3 px-8 py-4 border-b-2 border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-8">
            <Link href="/" className="font-bold text-xl tracking-tight">MeetingOS</Link>
            <nav className="hidden md:flex items-center gap-6">
              <Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Docs</Link>
              <Link href="/donate" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Donate</Link>
              <Link href="/contact" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Contact</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {session ? (
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <span className="text-sm text-muted-foreground">
                  {session.user?.name}
                </span>
                <button type="submit" className="ml-3 text-sm underline">
                  Sign out
                </button>
              </form>
            ) : (
              <form
                action={async () => {
                  "use server";
                  await signIn("google");
                }}
              >
                <button type="submit" className="text-sm underline">
                  Sign in with Google
                </button>
              </form>
            )}
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
