import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Family Travel Command Center",
  description:
    "Fictional reference data in a field-tested travel coordination implementation. No built-in authentication or encryption.",
  applicationName: "Family Travel Command Center",
  manifest: "/manifest.webmanifest?v=2",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Family Travel",
  },
  formatDetection: {
    telephone: true,
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
