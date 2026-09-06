"use client";

// TanStack Query provider for the App Router tree.
//
// Per `conventions-web`: TanStack Query v5 handles all API consumption. This
// Client Component instantiates a single `QueryClient` (memoized so it survives
// re-renders but is unique per browser tab) and exposes it via
// `QueryClientProvider`. Mounted in the root layout so the whole tree can use it.

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface QueryProviderProps {
  children: ReactNode;
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function QueryProvider({ children }: QueryProviderProps) {
  // useState initializer runs once per component instance, keeping the same
  // client across re-renders (a new one per SSR pass / browser tab).
  const [queryClient] = useState(makeQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export default QueryProvider;
