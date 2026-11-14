"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession, ORG_COOKIE } from "@/lib/auth/context";
import { CURRENCY_CODES } from "@/lib/money";
import { dbErrorMessage, fail, zodFail, type ActionResult } from "@/lib/result";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your business name.").max(120),
  country: z.string().trim().length(2, "Choose a country."),
  currency: z.enum(CURRENCY_CODES as [string, ...string[]], "Choose a currency."),
  timezone: z.string().min(1, "Choose a time zone."),
});

export async function createOrganisation(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await getSession();
  if (!user) redirect("/login");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFail(parsed.error.issues);

  const { data, error } = await supabase.rpc("create_organisation", {
    p_name: parsed.data.name, p_currency: parsed.data.currency, p_timezone: parsed.data.timezone, p_country: parsed.data.country,
  });
  if (error) return fail(dbErrorMessage(error));
  (await cookies()).set(ORG_COOKIE, String(data), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}
