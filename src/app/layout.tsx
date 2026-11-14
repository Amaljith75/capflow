import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Capflow — Get paid. Without chasing.", template: "%s · Capflow" },
  description: "Accounts receivable automation that recovers the money your business is already owed.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full`}>
      <body className="min-h-full">
        {children}
        <Toaster position="bottom-right" toastOptions={{ className: "!rounded-xl !border-line !text-sm" }} />
      </body>
    </html>
  );
}
