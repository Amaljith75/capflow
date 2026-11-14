"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
      <TriangleAlert className="mx-auto size-8 text-danger-600" />
      <h1 className="mt-4 text-lg font-semibold">This page couldn&apos;t load</h1>
      <p className="mt-1 text-sm text-muted">
        Nothing was changed. Try again, and if the problem continues contact support{error.digest ? ` with reference ${error.digest}` : ""}.
      </p>
      <Button className="mt-6" onClick={reset}>Try again</Button>
    </div>
  );
}
