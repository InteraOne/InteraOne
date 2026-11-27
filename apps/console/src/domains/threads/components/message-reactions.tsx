import { SmilePlus } from "lucide-react";
import { Popover } from "radix-ui";

import type { Reaction } from "../types/types";

const emojis = [
  "👍",
  "❤️",
  "😀",
  "😂",
  "😢",
  "🙏",
  "👎",
  "😡",
  "🎉",
  "🔥",
  "👏",
  "🤔",
  "😍",
  "🚀",
  "👀",
  "💯",
] as const;

export function MessageReactions({
  reactions = [],
  disabled,
  onToggle,
}: {
  reactions?: Reaction[];
  disabled?: boolean;
  onToggle: (emoji: string, reacted: boolean) => void;
}) {
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-1.5"
      aria-label="Message reactions"
    >
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          disabled={disabled}
          aria-pressed={reaction.reacted}
          aria-label={`${reaction.reacted ? "Remove" : "Add"} ${reaction.emoji} reaction`}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-medium transition-colors disabled:opacity-60 ${reaction.reacted ? "border-[var(--threads-primary)] bg-[color-mix(in_srgb,var(--threads-primary)_10%,transparent)] text-[var(--threads-primary)]" : "border-border/70 bg-muted/35 hover:border-[var(--threads-primary)] hover:bg-muted"}`}
          onClick={() => onToggle(reaction.emoji, !reaction.reacted)}
        >
          <span className="text-sm leading-none">{reaction.emoji}</span>
          <span>{reaction.count}</span>
        </button>
      ))}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Add emoji reaction"
            className="grid size-8 place-items-center rounded-full border border-border/70 bg-muted/25 text-muted-foreground transition-colors hover:border-[var(--threads-primary)] hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            <SmilePlus className="size-4" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={8}
            className="z-[70] w-72 rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          >
            <p className="mb-2 px-1 text-[13px] font-semibold">
              React to this message
            </p>
            <div className="grid grid-cols-8 gap-1">
              {emojis.map((emoji) => {
                const selected =
                  reactions.find((reaction) => reaction.emoji === emoji)
                    ?.reacted ?? false;
                return (
                  <Popover.Close asChild key={emoji}>
                    <button
                      type="button"
                      aria-label={`React with ${emoji}`}
                      className={`grid size-8 place-items-center rounded-lg text-lg transition-transform hover:scale-110 hover:bg-muted ${selected ? "bg-muted ring-1 ring-[var(--threads-primary)]" : ""}`}
                      onClick={() => onToggle(emoji, !selected)}
                    >
                      {emoji}
                    </button>
                  </Popover.Close>
                );
              })}
            </div>
            <Popover.Arrow className="fill-border" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
