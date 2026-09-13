import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Кадр — ваш личный кинозал",
  description: "Фильмы и сериалы. Прямое потоковое воспроизведение.",
  other: {
    "codex-preview": "development",
  },
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
