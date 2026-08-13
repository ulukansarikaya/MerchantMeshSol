"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { platformApi } from "./platformApi";

export const IS_MOCK = process.env.NEXT_PUBLIC_MOCK === "true";

/** Real (non-mock) session state, backed by platform-api's cookie session. */
export function useSession() {
  const query = useQuery({
    queryKey: ["me"],
    queryFn: () => platformApi.me().then((r) => r.account),
    enabled: !IS_MOCK,
    retry: false,
  });
  const queryClient = useQueryClient();
  return {
    account: query.data ?? null,
    loading: !IS_MOCK && query.isLoading,
    refresh: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  };
}
