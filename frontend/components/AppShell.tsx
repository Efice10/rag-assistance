"use client";

import { FileText, Loader2, LogOut, Menu, MessageSquare, ScrollText, ShieldCheck, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { setSession, useSession } from "@/lib/session";
import type { User } from "@/lib/types";
import { ClearanceBadge } from "./Badges";

const NAV = [
  { href: "/chat", label: "Chat", icon: MessageSquare, adminOnly: false },
  { href: "/documents", label: "Documents", icon: FileText, adminOnly: false },
  { href: "/users", label: "Users", icon: Users, adminOnly: true },
  { href: "/audit-logs", label: "Audit logs", icon: ScrollText, adminOnly: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const token = session?.token;
  const [navOpen, setNavOpen] = useState(false);
  const drawer = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (session === null) {
      router.replace("/login");
    }
  }, [session, router]);

  // Refresh the profile once per sign-in, so a role or clearance change made
  // by an administrator shows up without signing out.
  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    api
      .get<{ user: User }>("/me")
      .then(({ data }) => {
        if (!cancelled) {
          setSession({ token, user: data.user });
        }
      })
      .catch(() => {
        // A 401 is handled by the API client; other failures keep the stored profile.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Escape closes the drawer and hands focus back to the menu button.
  useEffect(() => {
    if (!navOpen) {
      return;
    }
    drawer.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNavOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  if (!session) {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  const { user } = session;

  function logout() {
    // Revoke the token on the server in the background; sign out locally at once.
    api.post("/logout", null, { headers: { Authorization: `Bearer ${session?.token}` } }).catch(() => {});
    setSession(null);
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-2 pb-6 pt-5">
        <Link
          href="/chat"
          onClick={() => setNavOpen(false)}
          className="flex items-center gap-2.5 whitespace-nowrap text-sm font-semibold text-slate-900"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          Compliance Assistant
        </Link>
      </div>

      <nav className="space-y-1" aria-label="Main">
        <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Workspace
        </p>
        {NAV.filter((item) => !item.adminOnly || user.role === "admin").map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setNavOpen(false)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-medium text-slate-900" data-testid="user-name">
          {user.name}
        </p>
        <div className="mt-0.5 text-xs leading-relaxed text-slate-500">
          <p>{user.organization?.name}</p>
          <p>
            {user.department?.name} · <span className="capitalize">{user.role}</span>
          </p>
        </div>
        <div className="mt-2">
          <ClearanceBadge level={user.clearance_level} showIcon />
        </div>
        <button
          type="button"
          onClick={logout}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-1">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setNavOpen(false)} aria-hidden />
          <div
            ref={drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 w-72 border-r border-slate-200 bg-white p-4 outline-none"
          >
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-4 rounded-md p-1 text-slate-500 hover:bg-slate-100"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <button
            ref={menuButton}
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <Link href="/chat" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white">
              <ShieldCheck className="h-4 w-4" aria-hidden />
            </span>
            Compliance Assistant
          </Link>
          <span className="ml-auto">
            <ClearanceBadge level={user.clearance_level} />
          </span>
        </div>

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
