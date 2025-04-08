import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VibeFighter",
  description: "Create your 90s vibe fighter!",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
