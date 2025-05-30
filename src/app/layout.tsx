import type { Metadata } from "next";
import "./globals.css";
import { AudioProvider } from "@/components/AudioProvider";
import { MuteButton } from "@/components/MuteButton";

export const metadata: Metadata = {
  title: "VibeFighter",
  description: "Generative AI Fighting game",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AudioProvider>
          {children}
          <MuteButton />
        </AudioProvider>
      </body>
    </html>
  );
}
