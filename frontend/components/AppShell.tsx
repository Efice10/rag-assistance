"use client";

import {
  Activity,
  BarChart3,
  FileText,
  LogOut,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { setSession, useSession } from "@/lib/session";
import type { User } from "@/lib/types";
import { ClearanceBadge } from "./Badges";
import { ThemeToggle } from "./ThemeToggle";

const NAV_GROUPS = [
  {
    label: "Workspace",
    adminOnly: false,
    items: [
      { href: "/chat", label: "Chat", icon: MessageSquare },
      { href: "/documents", label: "Documents", icon: FileText },
    ],
  },
  {
    label: "Administration",
    adminOnly: true,
    items: [
      { href: "/users", label: "Users", icon: Users },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/processing", label: "Processing", icon: Activity },
      { href: "/audit-logs", label: "Audit logs", icon: ScrollText },
    ],
  },
];

const COLLAPSED_KEY = "sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const token = session?.token;
  const [navOpen, setNavOpen] = useState(false);
  // The shell renders nothing but a spinner until the session is read in the
  // browser, so reading localStorage here cannot cause a hydration mismatch.
  const [collapsed, setCollapsed] = useState(readCollapsed);

  function toggleCollapsed(next: boolean) {
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // A per-browser convenience only.
    }
  }
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
    // A skeleton in the shape of the app (sidebar, header, card) while the
    // session is read, so the page does not jump when it appears.
    return (
      <div className="flex min-h-screen flex-1 animate-pulse" aria-busy="true" aria-label="Loading">
        <div className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
          <div className="h-9 w-40 rounded-lg bg-slate-100" />
          <div className="mt-8 space-y-3">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="h-7 rounded-md bg-slate-100" />
            ))}
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          <div className="h-6 w-48 rounded bg-slate-200" />
          <div className="mt-2 h-4 w-80 max-w-full rounded bg-slate-100" />
          <div className="mt-6 h-64 rounded-xl border border-slate-200 bg-white" />
        </div>
      </div>
    );
  }

  const { user } = session;

  function logout() {
    // Revoke the token on the server in the background; sign out locally at once.
    api.post("/logout", null, { headers: { Authorization: `Bearer ${session?.token}` } }).catch(() => {});
    setSession(null);
  }

  const groups = NAV_GROUPS.filter((group) => !group.adminOnly || user.role === "admin");

  const sidebar = (compact: boolean) => (
    <div className="flex h-full flex-col">
      <div className={`pb-6 pt-5 ${compact ? "flex justify-center" : "px-2"}`}>
        <Link
          href="/chat"
          onClick={() => setNavOpen(false)}
          title={compact ? "Compliance Assistant" : undefined}
          className="flex items-center gap-2.5 whitespace-nowrap text-sm font-semibold text-slate-900"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-on-accent">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <span className={compact ? "sr-only" : ""}>Compliance Assistant</span>
        </Link>
      </div>

      <nav className="space-y-5" aria-label="Main">
        {groups.map((group) => (
          <div key={group.label} className="space-y-1">
            <p
              className={`px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 ${
                compact ? "sr-only" : ""
              }`}
            >
              {group.label}
            </p>
            {compact && group !== groups[0] && <div className="mx-2 border-t border-slate-200" aria-hidden />}
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setNavOpen(false)}
                  aria-current={active ? "page" : undefined}
                  title={compact ? label : undefined}
                  className={`flex items-center gap-2.5 rounded-md py-2 text-sm font-medium transition-colors ${
                    compact ? "justify-center px-0" : "px-3"
                  } ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className={compact ? "sr-only" : ""}>{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex-1" />

      {compact ? (
        <div className="flex flex-col items-center gap-2">
          <ThemeToggle compact />
          <button
            type="button"
            onClick={logout}
            title="Sign out"
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            <span className="sr-only">Sign out</span>
          </button>
        </div>
      ) : (
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
          <div className="mt-3">
            <ThemeToggle />
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => toggleCollapsed(!compact)}
        aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
        title={compact ? "Expand sidebar" : "Collapse sidebar"}
        className={`mt-3 hidden items-center gap-2 rounded-md py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:flex ${
          compact ? "justify-center" : "px-3"
        }`}
      >
        {compact ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
        {!compact && "Collapse"}
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-1">
      {/* Desktop sidebar */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-slate-200 bg-white md:block ${
          collapsed ? "w-16 px-2 py-4" : "w-64 p-4"
        }`}
      >
        {sidebar(collapsed)}
      </aside>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setNavOpen(false)} aria-hidden />
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
            {sidebar(false)}
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
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-on-accent">
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
