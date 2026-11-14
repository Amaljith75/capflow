"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/result";
import { Button, type ButtonProps } from "./button";
import { Dialog, DialogContent, DialogTrigger } from "./dialog";

type FormAction = (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;

const FieldErrors = React.createContext<Record<string, string[]>>({});
const Pending = React.createContext(false);

export function useFieldError(name: string): string | undefined {
  return React.useContext(FieldErrors)[name]?.[0];
}

/**
 * Form wired to a server action that returns an ActionResult. Shows the error
 * inline, toasts on success, and exposes field errors + pending state.
 */
export function ActionForm({ action, onSuccess, redirectTo, className, children, resetOnSuccess }: {
  action: FormAction;
  onSuccess?: (result: ActionResult<unknown> & { ok: true }) => void;
  redirectTo?: string;
  className?: string;
  resetOnSuccess?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = React.useActionState(action, null);
  const handled = React.useRef<ActionResult<unknown> | null>(null);

  React.useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) {
      if (state.message) toast.success(state.message);
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state);
      if (redirectTo) router.push(redirectTo);
    }
  }, [state, onSuccess, redirectTo, router, resetOnSuccess]);

  return (
    <form ref={formRef} action={formAction} className={className} noValidate={false}>
      <FieldErrors.Provider value={state && !state.ok ? (state.fieldErrors ?? {}) : {}}>
        <Pending.Provider value={pending}>
          {state && !state.ok ? (
            <p role="alert" className="mb-4 rounded-xl border border-danger-100 bg-danger-50 px-3 py-2.5 text-sm text-danger-700">
              {state.error}
            </p>
          ) : null}
          {children}
        </Pending.Provider>
      </FieldErrors.Provider>
    </form>
  );
}

export function SubmitButton({ children, ...props }: ButtonProps) {
  const pending = React.useContext(Pending);
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

/** Button that runs a server action (optionally after confirmation) and reports the outcome. */
export function ActionButton({
  action, confirm, children, onDone, redirectTo, ...props
}: ButtonProps & {
  redirectTo?: string;
  action: () => Promise<ActionResult<unknown>>;
  confirm?: { title: string; description: string; confirmLabel: string; danger?: boolean };
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);

  const run = () =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        if (result.message) toast.success(result.message);
        setOpen(false);
        onDone?.();
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  if (!confirm) {
    return (
      <Button type="button" onClick={run} disabled={pending || props.disabled} aria-busy={pending} {...props}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {children}
      </Button>
    );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" {...props}>{children}</Button>
      </DialogTrigger>
      <DialogContent title={confirm.title} description={confirm.description} className="max-w-md">
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" variant={confirm.danger ? "danger" : "primary"} onClick={run} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {confirm.confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog containing an ActionForm that closes itself and refreshes data on success. */
export function FormDialog({ trigger, title, description, action, children, submitLabel, className }: {
  trigger: React.ReactNode; title: string; description?: string; action: FormAction;
  children: React.ReactNode; submitLabel: string; className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description} className={className}>
        <ActionForm
          action={action}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        >
          <div className="flex flex-col gap-4">{children}</div>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton>{submitLabel}</SubmitButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

/** Field wrapper that reads its error from the surrounding ActionForm. */
export function FormField({ name, label, hint, className, children }: {
  name: string; label: string; hint?: string; className?: string; children: React.ReactNode;
}) {
  const error = useFieldError(name);
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={name} className="text-[13px] font-medium text-ink-soft">{label}</label>
      {children}
      {error ? <p role="alert" className="text-xs text-danger-700">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
