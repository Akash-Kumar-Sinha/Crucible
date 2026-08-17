"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function WorkspaceRedirectPage() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace("/workspace/session");
  }, [router]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-zinc-400 font-mono text-xs">
      Redirecting to Workspace Session...
    </div>
  );
}
