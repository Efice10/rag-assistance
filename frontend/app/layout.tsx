import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { FeedbackHost } from "@/components/FeedbackHost";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
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
  title: "Compliance Assistant",
  description: "Ask questions about your organization's policies, within your clearance.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script sets a class and color-scheme on <html> before hydration.
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        {children}
        <FeedbackHost />
      </body>
    </html>
  );
}
