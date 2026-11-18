# Next.js Frontend Dashboard — Design & Architecture Blueprint

## 1. Core Pages, Components & UX Patterns

| Category | Component / Page | Key Features & UX Best Practices | Recommended Tools |
| :--- | :--- | :--- | :--- |
| **Layout & Navigation** | Collapsible Sidebar | Icon-only collapse state, active route highlight (`usePathname`), grouped sections (*Main*, *Analytics*, *Settings*). | Tailwind CSS, Lucide Icons |
| **Layout & Navigation** | Sticky Top Navbar | Breadcrumbs, global search (`Cmd + K`), theme toggle, notification bell with badge, user profile menu. | shadcn/ui (`Command`, `DropdownMenu`) |
| **Layout & Navigation** | Mobile Drawer | Slide-over navigation drawer replacing the sidebar on smaller viewports. | shadcn/ui (`Sheet`) |
| **Overview / Home** | KPI Stat Cards | 3–4 top-level metrics with current value, percentage trend badge (green/red), and subtle sparkline. | Tailwind CSS, Recharts |
| **Overview / Home** | Global Date Filter | Date range picker (*Last 7d*, *This Month*, *Custom*) synced with URL query params (`?from=&to=`). | React Day Picker, `next/navigation` |
| **Overview / Home** | Recent Activity Feed | Compact timeline showing user actions, system events, avatars, and relative timestamps. | Tailwind CSS |
| **Data Tables** | Interactive Data Table | Server/client pagination, multi-column sorting, debounced search input, column visibility toggle. | TanStack Table v8 |
| **Data Tables** | Bulk & Row Actions | Row checkboxes with floating bulk-action bar (*Delete*, *Export CSV*) + 3-dot row action menu. | shadcn/ui (`Table`, `Checkbox`) |
| **Visualizations** | Charts & Graphs | Responsive SVG charts with custom hover tooltips: Area/Line (trends), Bar (comparisons), Donut (ratios). | Recharts / Tremor |
| **States & Feedback** | Loading Skeletons | Dimension-matched pulsing placeholders in `loading.tsx` to prevent layout shift (CLS). | Next.js `loading.tsx`, `Skeleton` |
| **States & Feedback** | Empty & Error States | Friendly icon + message + CTA button for empty arrays; `error.tsx` boundary with `reset()` retry button. | Next.js `error.tsx` |
| **States & Feedback** | Toasts & Dialogs | Non-intrusive bottom-right toast alerts + confirmation modals for destructive actions. | Sonner, shadcn/ui (`AlertDialog`) |
| **Messaging** | Real-Time Chat Page | Split-pane layout: searchable conversation sidebar (unread badges, online dots) + auto-scrolling chat stream. | Tailwind CSS, WebSockets / Pusher |
| **Messaging** | Rich Chat Input | Auto-expanding textarea (`Enter` to send, `Shift+Enter` for newline), file dropzone, emoji picker. | React Textarea Autosize |
| **Forms & Settings** | Tabbed Settings & Modals | Sub-tabs (*Profile*, *Security*, *Billing*), inline Zod validation, and slide-over drawers for quick edits. | React Hook Form, Zod, `Sheet` |

---

## 2. Background & Surface Hierarchy (Light & Dark Mode)

| Surface Layer | Purpose | Light Mode (Tailwind) | Dark Mode (Tailwind) | Design Rule |
| :--- | :--- | :--- | :--- | :--- |
| **Level 0: Page Canvas** | Base app background behind all cards | `bg-slate-50` or `bg-zinc-50/50` | `bg-zinc-950` or `bg-slate-950` | Avoid pure `#000` in dark mode to prevent eye strain. |
| **Level 1: Elevated Cards** | KPI cards, charts, tables, main panels | `bg-white border-slate-200 shadow-xs` | `bg-zinc-900 border-zinc-800` | Stick to 1px subtle borders and minimal shadows. |
| **Level 2: Sidebar & Muted** | Sidebars, table headers, skeleton bases | `bg-slate-100/70` | `bg-zinc-900/60` | Creates gentle separation without heavy divider lines. |
| **Level 3: Popovers & Hover** | Dropdowns, tooltips, active row hover | `bg-white shadow-md` / `hover:bg-slate-100` | `bg-zinc-800` / `hover:bg-zinc-800/80` | Highest elevation level for interactive overlays. |
| **Sticky Glass Surfaces** | Top navbar, floating bulk-action bars | `bg-white/80 backdrop-blur-md` | `bg-zinc-950/80 backdrop-blur-md` | Lets scrolling content blur cleanly underneath. |
| **Ambient Accents** | Auth pages, empty states, hero headers | Faint CSS dot/grid pattern + soft radial glow (`blur-3xl opacity-15`) | Same with subtle indigo/cyan glow | Keep patterns subtle so data & text stay readable. |

---

## 3. Recommended Tech Stack

- **Framework:** Next.js (App Router + React Server Components)
- **Styling & UI Primitives:** Tailwind CSS + shadcn/ui (Radix UI)
- **Icons:** Lucide React
- **Tables:** TanStack Table v8
- **Charts:** Recharts or Tremor
- **Forms & Validation:** React Hook Form + Zod
- **Data Fetching & Caching:** TanStack Query (React Query) or SWR
- **Notifications:** Sonner