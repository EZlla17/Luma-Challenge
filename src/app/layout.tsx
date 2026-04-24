import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Visual Generation Board",
  description: "A clone of an AI visual generation board interface",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="antialiased">
      <body className="m-0 p-0 overflow-hidden">{children}</body>
    </html>
  );
}