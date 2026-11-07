import { createFileRoute, Link, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getCurrentUser, signOut as signOutUser } from "@/functions/auth.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/auth" });
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    getCurrentUser().then((user) => setEmail(user?.email ?? null));
  }, []);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await signOutUser();
      await router.navigate({ to: "/auth" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out.");
      setSigningOut(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <span className="font-semibold tracking-tight">LinkForge</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          <Link
            to="/dashboard"
            className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground active:!text-foreground [&.active]:bg-secondary/80 [&.active]:text-foreground"
          >
            Dashboard
          </Link>
          <Link
            to="/campaigns"
            className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground [&.active]:bg-secondary/80 [&.active]:text-foreground"
          >
            Campaigns
          </Link>
        </nav>
        <div className="border-t border-border p-4">
          <p className="truncate text-xs text-muted-foreground">{email ?? "…"}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start"
            onClick={signOut}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </aside>
      <header className="border-b border-border bg-surface px-4 py-3 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <Link to="/dashboard" className="flex min-w-0 items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </span>
            <span className="truncate">LinkForge</span>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 px-2 text-xs"
            onClick={signOut}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
        <nav aria-label="Main navigation" className="mt-3 grid grid-cols-2 gap-2">
          <Link
            to="/dashboard"
            className="rounded-lg px-3 py-2 text-center text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground [&.active]:bg-secondary/80 [&.active]:text-foreground"
          >
            Dashboard
          </Link>
          <Link
            to="/campaigns"
            className="rounded-lg px-3 py-2 text-center text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground [&.active]:bg-secondary/80 [&.active]:text-foreground"
          >
            Campaigns
          </Link>
        </nav>
      </header>
      <main className="min-w-0 flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
