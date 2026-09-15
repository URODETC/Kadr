import type { Metadata } from "next";
import "./globals.css";
import ActivityTracker from "@/components/activity-tracker";

export const metadata: Metadata = {
  title: "Кадр / anime",
  description: "Закрытый аниме-клуб.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}<ActivityTracker/></body>
    </html>
  );
}
