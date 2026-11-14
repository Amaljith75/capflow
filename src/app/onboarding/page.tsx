import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/action-form";
import { Input, Select } from "@/components/ui/input";
import { getSession } from "@/lib/auth/context";
import { TIMEZONES } from "@/lib/dates";
import { CURRENCIES } from "@/lib/money";
import { signOut } from "../(auth)/actions";
import { createOrganisation } from "./actions";

export const metadata: Metadata = { title: "Set up your organisation" };

const COUNTRIES = [
  ["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"], ["AE", "United Arab Emirates"],
  ["SG", "Singapore"], ["AU", "Australia"], ["CA", "Canada"], ["DE", "Germany"], ["FR", "France"], ["NL", "Netherlands"],
];

export default async function OnboardingPage() {
  const { user } = await getSession();
  if (!user) redirect("/login");
  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-10">
      <Logo />
      <div className="mt-10 w-full max-w-lg rounded-2xl border border-line bg-surface p-8 shadow-card">
        <p className="text-xs font-medium tracking-wide text-brand-700 uppercase">Step 1 of 1</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Tell us about your business</h1>
        <p className="mt-1 mb-6 text-sm text-muted">
          This creates your workspace with a default recovery sequence and starts a 14-day trial. You can change everything later.
        </p>
        <ActionForm action={createOrganisation} className="flex flex-col gap-4">
          <FormField name="name" label="Business name">
            <Input id="name" name="name" required placeholder="Acme Traders Pvt Ltd" />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField name="country" label="Country">
              <Select id="country" name="country" defaultValue="IN">
                {COUNTRIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </Select>
            </FormField>
            <FormField name="currency" label="Base currency" hint="Used for dashboards. Invoices can use any currency.">
              <Select id="currency" name="currency" defaultValue="INR">
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </Select>
            </FormField>
          </div>
          <FormField name="timezone" label="Time zone" hint="Due dates and reminder working hours follow this time zone.">
            <Select id="timezone" name="timezone" defaultValue="Asia/Kolkata">
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
            </Select>
          </FormField>
          <SubmitButton size="lg" className="mt-2">Create workspace</SubmitButton>
        </ActionForm>
      </div>
      <form action={signOut} className="mt-6 text-sm text-muted">
        Signed in as {user.email}. <button className="font-medium text-brand-700 hover:underline">Sign out</button>
      </form>
    </div>
  );
}
