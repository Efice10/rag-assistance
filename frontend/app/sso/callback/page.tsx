"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { setSession } from "@/lib/session";
import type { Session } from "@/lib/types";

/**
 * The identity provider sends the browser here with ?code&state. The code is
 * handed to Laravel, which exchanges it with the provider and signs the user in.
 */
export default function SsoCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Codes are single-use: never send one twice (React strict mode runs effects twice).
    if (started.current) {
      return;
    }
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const providerError = params.get("error_description") ?? params.get("error");

    // Drop the code from the address bar and history.
    window.history.replaceState(null, "", "/sso/callback");

    if (providerError || !code || !state) {
      // Deferred so the state update happens after the effect.
      window.setTimeout(() => setError(providerError ?? "The sign-in response was incomplete. Start again."), 0);
      return;
    }

    api
      .post<Session>("/sso/callback", { code, state })
      .then(({ data }) => {
        setSession({ token: data.token, user: data.user });
        router.replace("/chat");
      })
      .catch((err) => setError(errorMessage(err, "Single sign-on failed. Start again.")));
  }, [router]);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      {error ? (
        <div className="max-w-sm text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-rose-300" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold text-slate-900">Sign-in did not complete</h1>
          <p role="alert" className="mt-1 text-sm text-slate-600">
            {error}
          </p>
          <Link href="/login" className="mt-4 inline-block text-sm font-medium text-indigo-700 hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Signing you in…
        </p>
      )}
    </div>
  );
}
