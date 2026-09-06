// Root layout for the Next.js App Router tree.
//
// Server Component by default (per `conventions-web`). It imports the global
// Tailwind v4 stylesheet and wraps the whole tree in the TanStack Query
// provider so every route can consume the API through TanStack Query. The
// provider itself is the only Client Component; mounting it here keeps the rest
// of the tree as Server Components.

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { QueryProvider } from "@/lib/query-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Avyo",
  description: "Bird breeding management system",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
