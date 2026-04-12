import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import PostHogProvider from "@/components/PostHogProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DataChat | AI Data Analysis",
  description: "Chat with your spreadsheet and get instant AI-powered insights.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen bg-neutral-50`}>
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
