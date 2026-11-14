import Link from "next/link";
import { Logo } from "@/components/brand";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <Logo />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-1 text-sm text-muted">The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
      <Link href="/dashboard" className="mt-6 text-sm font-medium text-brand-700 hover:underline">Back to overview</Link>
    </div>
  );
}
