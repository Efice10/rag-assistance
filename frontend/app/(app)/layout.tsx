import { AppShell } from "@/components/AppShell";

// Every page under this layout is hidden until the browser session has been
// read, so there is no static shell of the page itself to navigate to instantly.
export const instant = false;

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
