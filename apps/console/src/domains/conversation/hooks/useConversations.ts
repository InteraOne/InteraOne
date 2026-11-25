import { useQuery } from "@tanstack/react-query";
import { conversationsApi } from "../api/conversations.api";
export const useConversations = (status: string, options?: { unassigned?: boolean; channel?: "threads" }) => {
  return useQuery({
    queryKey: ["conversations", status, options],
    queryFn: () => conversationsApi.getConversations(status, options),
    select: (response) => response.data.conversations || [],
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
};
