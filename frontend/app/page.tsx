"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";

export default function Home() {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session !== undefined) {
      router.replace(session ? "/chat" : "/login");
    }
  }, [session, router]);

  return (
    <div className="flex flex-1 items-center justify-center text-slate-500">
      <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" />
    </div>
  );
}
