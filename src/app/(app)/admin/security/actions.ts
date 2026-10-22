"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { grantMoreExports } from "@/lib/security/exports";
import { dismissAlert, grantMoreFiles } from "@/lib/security/files";

// Every action re-checks the caller: a server action is a public endpoint.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lets one user open another batch of candidate files today. */
export async function grantFiles(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const email = String(form.get("email") ?? "").trim();
  if (!EMAIL_RE.test(email)) throw new Error("invalid email");
  await grantMoreFiles(admin.email, email);
  revalidatePath("/admin/security");
}

/** Lets one user export another batch of people's contact details today (copy buttons and MCP). */
export async function grantExports(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const email = String(form.get("email") ?? "").trim();
  if (!EMAIL_RE.test(email)) throw new Error("invalid email");
  await grantMoreExports(admin.email, email);
  revalidatePath("/admin/security");
}

/** Marks an alert as seen, without granting anything. */
export async function handleAlert(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const id = Number(form.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("invalid id");
  await dismissAlert(admin.email, id);
  revalidatePath("/admin/security");
}
