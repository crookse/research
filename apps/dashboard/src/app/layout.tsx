import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";

import { AccountSwitcher } from "@/components/account-switcher";
import { getCurrentAccount } from "@/lib/session";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Dashboard" },
  description: "API key management dashboard",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
            <span className="font-semibold">Key manager</span>
            {/* Reads a cookie, so it streams in; the rest of the shell is static. */}
            <Suspense fallback={<div className="h-8 w-56" />}>
              <CurrentAccountSwitcher />
            </Suspense>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}

async function CurrentAccountSwitcher() {
  const account = await getCurrentAccount();
  return <AccountSwitcher currentId={account.id} />;
}
