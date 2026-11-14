"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ title, description, className, children, side }: {
  title: string; description?: string; className?: string; children: React.ReactNode; side?: "center" | "left";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 bg-surface shadow-pop focus:outline-none",
          side === "left"
            ? "inset-y-0 left-0 w-72 overflow-y-auto border-r border-line"
            : "top-1/2 left-1/2 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line",
          className,
        )}
      >
        {side === "left" ? (
          <>
            <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
            {children}
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
              <div>
                <DialogPrimitive.Title className="text-base font-semibold text-ink">{title}</DialogPrimitive.Title>
                {description ? (
                  <DialogPrimitive.Description className="mt-0.5 text-[13px] text-muted">{description}</DialogPrimitive.Description>
                ) : null}
              </div>
              <DialogPrimitive.Close className="rounded-lg p-1 text-muted hover:bg-subtle hover:text-ink" aria-label="Close">
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
            <div className="px-6 py-5">{children}</div>
          </>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
