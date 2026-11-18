"use client";

import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { setSession, useSession } from "@/lib/session";
import type { Session } from "@/lib/types";

export default function LoginPage() {
  const session = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      router.replace("/chat");
    }
  }, [session, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<Session>("/login", { email, password });
      setSession({ token: data.token, user: data.user });
    } catch (err) {
      setError(errorMessage(err, "Sign-in failed. Try again."));
      setSubmitting(false);
    }
  }

  async function startSso() {
    if (!email) {
      setError("Enter your work email first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<{ authorization_url: string }>("/sso/start", { email });
      window.location.assign(data.authorization_url);
    } catch (err) {
      setError(errorMessage(err, "Single sign-on could not start."));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-on-accent">
            <ShieldCheck className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">Compliance Assistant</h1>
          <p className="mt-1 text-sm text-slate-600">
            Sign in to ask questions about the policies you are cleared to see.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-medium text-slate-700">
            Work email
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-on-accent hover:bg-indigo-500 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? "Signing in…" : "Sign in"}
          </button>

          <div className="flex items-center gap-3 text-xs text-slate-400" aria-hidden>
            <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
          </div>

          <button
            type="button"
            onClick={startSso}
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            <KeyRound className="h-4 w-4" aria-hidden />
            Sign in with single sign-on
          </button>
          <p className="text-center text-xs text-slate-500">Uses your work email&apos;s identity provider, if your organization set one up.</p>
        </form>
      </div>
    </div>
  );
}
