import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { getCurrentUser, signIn, signUp } from "@/functions/auth.functions";

// ---------------------------------------------------------------
// Local account sign-in and registration.
// ---------------------------------------------------------------
export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — LinkForge" },
      {
        name: "description",
        content: "Sign in to your guest post outreach and link building dashboard.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("linkforge_last_email");
    if (saved) setEmail(saved);
  }, []);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const user = await getCurrentUser();
        if (user) {
          await router.navigate({ to: "/dashboard" });
          return;
        }
      } catch (error) {
        console.error("[auth] Could not restore local session", error);
      } finally {
        setCheckingSession(false);
      }
    };
    checkSession();
  }, [router]);

  const cleanEmail = email.trim().toLowerCase();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    localStorage.setItem("linkforge_last_email", cleanEmail);
    try {
      if (mode === "signup") {
        await signUp({ data: { email: cleanEmail, password, fullName } });
        toast.success("Account created!");
      } else {
        await signIn({ data: { email: cleanEmail, password } });
        toast.success("Signed in!");
      }
      await router.navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const togglePasswordVisibility = () => setShowPassword((v) => !v);

  if (checkingSession) {
    return (
      <Shell>
        <div className="flex justify-center items-center h-48">
          <span className="text-muted-foreground">Loading…</span>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6">
        <Brand />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-secondary/50 p-1">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md py-2 text-xs font-semibold transition-colors ${
              mode === m
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === "signup" && (
          <div className="space-y-1.5">
            <Label htmlFor="fullName" className="text-xs">
              Full name
            </Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Aiza Khan"
              autoComplete="name"
              className="text-xs h-9"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs">
            Email address
          </Label>
          <Input
            ref={emailRef}
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@gmail.com"
            autoComplete="email"
            className="text-xs h-9 font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-xs">
              Password
            </Label>
            {mode === "signin" && (
              <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                Forgot password?
              </Link>
            )}
          </div>
          <div className="relative">
            <Input
              ref={passwordRef}
              id="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              className="text-xs h-9 pr-10"
            />
            <button
              type="button"
              onClick={togglePasswordVisibility}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>
        </div>
        <Button type="submit" className="w-full font-semibold" size="default" disabled={busy}>
          {busy
            ? "Processing…"
            : mode === "signup"
              ? "Create Account & Enter"
              : "Sign In to Dashboard"}
        </Button>
      </form>
    </Shell>
  );
}

function Brand() {
  return (
    <div className="flex items-center justify-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <svg
          width="18"
          height="18"
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
      <span className="text-lg font-semibold tracking-tight">LinkForge</span>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl sm:p-8">
        {children}
      </div>
    </div>
  );
}
