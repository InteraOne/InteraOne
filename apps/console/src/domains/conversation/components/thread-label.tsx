import { Globe2, LockKeyhole, MessagesSquare, Sparkles } from "lucide-react";
import type { ConversationThread } from "../types/types";

export function ThreadLabel({ thread }: { thread?: ConversationThread }) {
  const Icon = !thread
    ? MessagesSquare
    : !thread.public
      ? LockKeyhole
      : thread.category === "feature"
        ? Sparkles
        : Globe2;
  const label = !thread
    ? "Threads"
    : thread.category === "support"
      ? "Private support"
      : thread.category === "feature"
        ? "Feature request"
        : "Discussion";

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/8 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-primary">
      <Icon className="size-3" aria-hidden="true" />
      {label}
      {thread && thread.category !== "support" && (
        <span className="text-muted-foreground">
          · {thread.public ? "Public" : "Hidden"}
        </span>
      )}
    </span>
  );
}
