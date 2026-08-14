import type { Metadata } from "next";
import "./globals.css";
import { ErrorBoundary } from "../error-boundary";

export const metadata: Metadata = {
  title: "Crucible | AI Agent Execution Harness",
  description:
    "High-performance reasoning orchestrator and agent execution harness",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <ErrorBoundary componentName="RootLayout">{children}</ErrorBoundary>
      </body>
    </html>
  );
}
