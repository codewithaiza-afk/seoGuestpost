import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { getCurrentUser, resetPassword } from "@/functions/auth.functions";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — LinkForge" },
      { name: "description", content: "Set a new password for your account." },
      { property: "og:title", content: "Set a new password — LinkForge" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState("");

  useEffect(() => {
    const resetToken = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(resetToken);
    setReady(Boolean(resetToken));
    getCurrentUser().then((user) => {
      if (user && !resetToken) void router.navigate({ to: "/dashboard" });
    });
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await resetPassword({ data: { token, password } });
      toast.success("Password updated");
      await router.navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-xl">
        {!ready ? (
          <p className="text-center text-sm text-muted-foreground">
            This link is invalid or has expired.{" "}
            <Link to="/forgot-password" className="text-primary hover:underline">
              Request a new one
            </Link>
            .
          </p>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Set a new password</h1>
            <p className="mt-1 mb-6 text-sm text-muted-foreground">
              Choose a strong password for your account.
            </p>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={12}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={busy}>
                {busy ? "Saving…" : "Update password"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
