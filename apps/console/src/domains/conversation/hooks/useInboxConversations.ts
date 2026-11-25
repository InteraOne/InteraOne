import { useQuery } from "@tanstack/react-query";
import { conversationsApi } from "../api/conversations.api";

export const useMyConversations = (status?: string, channel?: "threads") => {
  return useQuery({
    queryKey: ["conversations", "mine", status, channel],
    queryFn: () =>
      conversationsApi.getConversations(status, { assignedToMe: true, channel }),
    select: (res) => res.data?.conversations ?? [],
    refetchOnWindowFocus: true,
  });
};
