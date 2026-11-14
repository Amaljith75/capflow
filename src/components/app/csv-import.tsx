"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Upload } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/result";

interface Report {
  imported: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

/** Upload dialog shared by customer, invoice and payment CSV imports. Always shows a per-row report. */
export function CsvImportDialog({ title, description, columns, sample, action, label = "Import CSV" }: {
  title: string;
  description: string;
  columns: { name: string; required?: boolean; note?: string }[];
  sample: string;
  action: (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [report, setReport] = React.useState<Report | null>(null);

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setReport(null); }}>
      <DialogTrigger asChild>
        <Button variant="secondary"><Upload />{label}</Button>
      </DialogTrigger>
      <DialogContent title={title} description={description} className="max-w-xl">
        {report ? (
          <div>
            <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
              <CheckCircle2 className="size-5 text-brand-700" />
              <p className="text-sm">
                <strong>{report.imported}</strong> imported · <strong>{report.skipped}</strong> skipped as already present ·{" "}
                <strong>{report.errors.length}</strong> rejected
              </p>
            </div>
            {report.errors.length > 0 ? (
              <ul className="mt-4 max-h-56 overflow-y-auto rounded-xl border border-line text-[13px]">
                {report.errors.map((e, i) => (
                  <li key={i} className="flex gap-3 border-b border-line px-3 py-2 last:border-b-0">
                    <span className="w-16 shrink-0 text-muted tabular">Row {e.row}</span>
                    <span className="text-danger-700">{e.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-6 flex justify-end"><Button onClick={() => setOpen(false)}>Done</Button></div>
          </div>
        ) : (
          <ActionForm action={action} onSuccess={(r) => { setReport(r.data as Report); router.refresh(); }}>
            <input type="file" name="file" accept=".csv,text/csv" required
              className="block w-full rounded-xl border border-dashed border-line-strong bg-subtle p-4 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-white" />
            <div className="mt-4 rounded-xl border border-line p-4">
              <p className="text-[13px] font-medium">Columns</p>
              <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
                {columns.map((c) => (
                  <li key={c.name}>
                    <code className="font-mono text-xs">{c.name}</code>
                    {c.required ? <span className="text-danger-700"> *</span> : null}
                    {c.note ? <span className="text-muted"> — {c.note}</span> : null}
                  </li>
                ))}
              </ul>
              <a
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(sample)}`}
                download="capflow-sample.csv"
                className="mt-3 inline-block text-[13px] font-medium text-brand-700 hover:underline"
              >
                Download a sample file
              </a>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <SubmitButton>Import</SubmitButton>
            </div>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}
