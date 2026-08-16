"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

export default function WorkspaceIdRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = params.id as string;

  React.useEffect(() => {
    if (sessionId) {
      const initialPrompt = searchParams.get("initialPrompt");
      const target = initialPrompt
        ? `/workspace/session/${sessionId}?initialPrompt=${encodeURIComponent(initialPrompt)}`
        : `/workspace/session/${sessionId}`;
      router.replace(target);
    } else {
      router.replace("/workspace");
    }
  }, [sessionId, searchParams, router]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-zinc-400 font-mono text-xs">
      Redirecting to Workspace Session...
    </div>
  );
}
