import React, { useMemo, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useAuth } from "@/domains/auth/hooks";
import { useQueryClient } from "@tanstack/react-query";
import io from "socket.io-client";
import { useConversations, useMyConversations } from "../hooks";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { ThreadLabel } from "../components/thread-label";
import { Loader } from "@/shared/ui/loader";
import {
  ChevronRight,
  MessageCircle,
  MessagesSquare,
  Search,
  Inbox,
  User2,
} from "lucide-react";
import {
  AllChannelsIcon,
  EmailIcon,
  TelegramIcon,
  WebIcon,
  WhatsAppIcon,
} from "@/shared/ui/channel-icon";
import type { ConversationListItem } from "../types/types";

const BASE_PATH = "/dashboard/conversations/inbox";
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3002";

type Tab = "all" | "mine";

const TABS: { id: Tab; label: string; icon: typeof Inbox }[] = [
  { id: "all", label: "Unassigned", icon: Inbox },
  { id: "mine", label: "Assigned to Me", icon: User2 },
];

const CHANNEL_FILTERS: {
  id: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  activeClass: string;
  inactiveClass: string;
}[] = [
  {
    id: "all",
    label: "All",
    icon: AllChannelsIcon,
    activeClass: "bg-primary/10 ring-1 ring-primary/30",
    inactiveClass: "hover:bg-muted/60",
  },
  {
    id: "web",
    label: "Web",
    icon: WebIcon,
    activeClass:
      "bg-indigo-100 dark:bg-indigo-900/40 ring-1 ring-indigo-300 dark:ring-indigo-700",
    inactiveClass: "hover:bg-indigo-50 dark:hover:bg-indigo-900/20",
  },
  {
    id: "threads",
    label: "Threads",
    icon: MessagesSquare,
    activeClass: "bg-primary/10 ring-1 ring-primary/30",
    inactiveClass: "hover:bg-muted/60",
  },
  {
    id: "email",
    label: "Email",
    icon: EmailIcon,
    activeClass:
      "bg-red-100 dark:bg-red-900/40 ring-1 ring-red-300 dark:ring-red-700",
    inactiveClass: "hover:bg-red-50 dark:hover:bg-red-900/20",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: WhatsAppIcon,
    activeClass:
      "bg-emerald-100 dark:bg-emerald-900/40 ring-1 ring-emerald-300 dark:ring-emerald-700",
    inactiveClass: "hover:bg-emerald-50 dark:hover:bg-emerald-900/20",
  },
  {
    id: "telegram",
    label: "Telegram",
    icon: TelegramIcon,
    activeClass:
      "bg-sky-100 dark:bg-sky-900/40 ring-1 ring-sky-300 dark:ring-sky-700",
    inactiveClass: "hover:bg-sky-50 dark:hover:bg-sky-900/20",
  },
];

const getChannelValue = (conv: ConversationListItem) =>
  (conv.channel || conv.metadata?.source || "web")
    .toLowerCase()
    .replace(/_channel$/, "");

const channelMatches = (channel: string, filter: string) => {
  if (filter === "all") return true;
  if (filter === "web")
    return channel.includes("web") || channel.includes("widget");
  return channel.includes(filter);
};

const getChannelDisplay = (channel: string) => {
  if (channel.includes("email")) {
    return {
      label: "Email",
      Icon: EmailIcon,
      className: "text-red-500 dark:text-red-400",
    };
  }
  if (channel.includes("whatsapp")) {
    return {
      label: "WhatsApp",
      Icon: WhatsAppIcon,
      className: "text-emerald-500 dark:text-emerald-400",
    };
  }
  if (channel.includes("telegram")) {
    return {
      label: "Telegram",
      Icon: TelegramIcon,
      className: "text-sky-500 dark:text-sky-400",
    };
  }

  return {
    label: "Web",
    Icon: WebIcon,
    className: "text-indigo-500 dark:text-indigo-400",
  };
};

export function ConversationsInboxPage({ mode = "all" }: { mode?: Tab }) {
  const [filters, setFilters] = useSearchParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const tab = mode;
  const search = filters.get("q") || "";
  const statusFilter = filters.get("status") || "open";
  const channelFilter = filters.get("channel") || "all";
  const priorityFilter = filters.get("priority") || "all";
  const isThreads = channelFilter === "threads";
  const [now, setNow] = useState(Date.now);
  const channel = isThreads ? "threads" : undefined;
  const queue = useConversations(statusFilter, { unassigned: true, channel });
  const assigned = useMyConversations(statusFilter, channel);
  const activeQuery = tab === "all" ? queue : assigned;

  function setFilter(key: string, value: string, defaultValue: string) {
    const next = new URLSearchParams(filters);
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    setFilters(next, { replace: key === "q" });
  }

  function inboxUrl(path: "open" | "assigned") {
    const query = filters.toString();
    return `${BASE_PATH}/${path}${query ? `?${query}` : ""}`;
  }

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(clock);
  }, []);

  // Socket: invalidate lists on new or escalated conversations
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket", "polling"],
    });

    const handleUpdate = () => {
      // Invalidates all queries whose key starts with "conversations"
      // (covers ["conversations", status, opts] and ["conversations", "mine"])
      queryClient.invalidateQueries({
        queryKey: ["conversations"],
        exact: false,
      });
    };

    socket.on("thread_activity", handleUpdate);
    socket.on("conversation_pending", handleUpdate);
    socket.on("conversation_assigned", handleUpdate);
    socket.on("conversation_escalated", handleUpdate);
    socket.on("status_updated", handleUpdate);
    socket.on("conversation_removed", handleUpdate);

    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  const rawList = activeQuery.data;

  const list = useMemo(() => {
    let filtered = rawList ?? [];

    // Filter by search query
    const q = search.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((conv) => {
        const name = (
          conv.metadata?.customer?.name ||
          conv.metadata?.senderName ||
          conv.metadata?.customerName ||
          ""
        ).toLowerCase();
        const email = (
          conv.metadata?.customer?.email ||
          conv.metadata?.senderEmail ||
          ""
        ).toLowerCase();
        const msg = (conv.lastMessage?.content || "").toLowerCase();
        const subject = (conv.subject || "").toLowerCase();
        return (
          subject.includes(q) ||
          name.includes(q) ||
          email.includes(q) ||
          msg.includes(q)
        );
      });
    }

    // Filter by channel
    if (channelFilter !== "all") {
      filtered = filtered.filter((conv) => {
        const chan = getChannelValue(conv);
        return channelMatches(chan, channelFilter);
      });
    }

    // Filter by priority
    if (priorityFilter !== "all") {
      filtered = filtered.filter((conv) =>
        priorityFilter === "high_urgent"
          ? conv.priority === "high" || conv.priority === "urgent"
          : conv.priority === priorityFilter,
      );
    }

    return filtered;
  }, [rawList, search, channelFilter, priorityFilter]);

  const getVisitorName = (conv: ConversationListItem) =>
    conv.metadata?.customer?.name ||
    conv.metadata?.senderName ||
    conv.metadata?.customerName ||
    "Anonymous User";

  const getRelativeTime = (iso?: string) => {
    if (!iso) return "";
    const diff = now - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const isEscalated = (conv: ConversationListItem) =>
    !!conv.metadata?.escalatedAt;

  // Render
  return (
    <div className="flex flex-col h-full">
      <header
        className="border-b bg-card px-4 py-4 sm:px-6"
        data-tour-id="page-inbox-heading"
      >
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            {isThreads ? (
              <MessagesSquare className="size-5" />
            ) : (
              <Inbox className="size-5" />
            )}
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {isThreads ? "Threads inbox" : "Inbox"}
            </h1>
            {isThreads && (
              <p className="text-sm text-muted-foreground">
                Support requests, community discussions, and feature requests.
              </p>
            )}
          </div>
        </div>
        <nav
          aria-label="Inbox assignment"
          className="mt-4 flex flex-wrap gap-1"
          data-tour-id="page-inbox-tabs"
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <Link
              key={id}
              to={inboxUrl(id === "all" ? "open" : "assigned")}
              aria-current={tab === id ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <Icon className="size-4" aria-hidden="true" /> {label}
            </Link>
          ))}
        </nav>
      </header>

      <div
        className="space-y-3 border-b bg-background px-4 py-3 sm:px-6"
        data-tour-id="page-inbox-search"
      >
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Channel"
        >
          {CHANNEL_FILTERS.map(
            ({ id, label, icon: Icon, activeClass, inactiveClass }) => (
              <button
                key={id}
                type="button"
                aria-pressed={channelFilter === id}
                onClick={() => setFilter("channel", id, "all")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${channelFilter === id ? activeClass : inactiveClass}`}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                {label}
              </button>
            ),
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label={isThreads ? "Search threads" : "Search conversations"}
              placeholder={
                isThreads
                  ? "Search by thread title or customer"
                  : "Search conversations"
              }
              value={search}
              onChange={(event) => setFilter("q", event.target.value, "")}
              className="h-9 pl-9"
            />
          </div>
          <select
            aria-label="Status"
            value={statusFilter}
            onChange={(event) =>
              setFilter("status", event.target.value, "open")
            }
            className="h-9 rounded-md border border-input bg-background px-2.5 text-xs font-medium"
          >
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
            <option value="all">All statuses</option>
          </select>
          <select
            aria-label="Priority"
            value={priorityFilter}
            onChange={(event) =>
              setFilter("priority", event.target.value, "all")
            }
            className="h-9 rounded-md border border-input bg-background px-2.5 text-xs font-medium"
          >
            <option value="all">All priorities</option>
            <option value="low">Low priority</option>
            <option value="medium">Medium priority</option>
            <option value="high_urgent">High or urgent</option>
          </select>
        </div>
      </div>

      {/* Conversation list */}
      <div
        className="flex-1 overflow-y-auto divide-y divide-border bg-background"
        data-tour-id="page-inbox-list"
      >
        {activeQuery.isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader size="sm" />
          </div>
        ) : activeQuery.isError ? (
          <div
            className="grid justify-items-center gap-3 p-10 text-center"
            role="alert"
          >
            <p className="text-sm font-medium">The inbox couldn’t load.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void activeQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : list.length === 0 ? (
          <div className="grid justify-items-center gap-2 p-10 text-center">
            <div className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
              {isThreads ? (
                <MessagesSquare className="size-5" />
              ) : (
                <MessageCircle className="size-5" />
              )}
            </div>
            <p className="text-sm font-medium">
              {isThreads ? "No threads to show" : "No conversations to show"}
            </p>
            {(search ||
              statusFilter !== "open" ||
              priorityFilter !== "all") && (
              <Button
                variant="link"
                size="sm"
                onClick={() =>
                  setFilters(
                    channelFilter === "all" ? {} : { channel: channelFilter },
                  )
                }
              >
                Clear search and filters
              </Button>
            )}
          </div>
        ) : (
          list.map((conv) => {
            const name = getVisitorName(conv);
            const initials = name
              .split(" ")
              .map((w: string) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            const escalated = isEscalated(conv);
            const assignedToMe = conv.assignedTo?._id === user?.id;
            const isUnread = conv.unreadCount > 0;
            const channel = getChannelValue(conv);
            const channelDisplay = getChannelDisplay(channel);
            const title =
              channel === "threads" && conv.subject ? conv.subject : name;

            return (
              <Link
                key={conv._id}
                to={`${BASE_PATH}/chat/${conv._id}`}
                state={{ from: inboxUrl(tab === "mine" ? "assigned" : "open") }}
                className="group flex w-full items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted/45 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-6"
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-xl bg-muted text-muted-foreground flex items-center justify-center text-sm font-semibold border border-border/20">
                    {initials}
                  </div>
                  {escalated && (
                    <span
                      className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-background bg-red-500"
                      title="Escalated to human"
                    />
                  )}
                </div>

                {/* Content Area */}
                <div className="flex-1 min-w-0 py-0.5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                      {title}
                    </span>
                    <span
                      className={`shrink-0 text-[11px] font-medium ${isUnread ? "text-emerald-500 font-semibold" : "text-muted-foreground/80"}`}
                    >
                      {getRelativeTime(conv.lastMessageAt || conv.createdAt)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <p
                      className={`text-[13px] truncate ${isUnread ? "text-foreground font-medium" : "text-muted-foreground/90"}`}
                    >
                      {conv.lastMessage?.content || "No messages yet"}
                    </p>
                    {isUnread && (
                      <span className="shrink-0 flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold shadow-sm">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>

                  {/* Channel & Assignment row */}
                  <div className="flex items-center gap-2.5 mt-2 flex-wrap">
                    {channel === "threads" ? (
                      <ThreadLabel thread={conv.metadata?.thread} />
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        <channelDisplay.Icon
                          className={`size-3.5 ${channelDisplay.className}`}
                        />
                        {channelDisplay.label}
                      </span>
                    )}

                    {title !== name && (
                      <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                        {name}
                      </span>
                    )}

                    {conv.assignedTo && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground/75 font-medium">
                        <span>•</span>
                        <User2 className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {assignedToMe ? "You" : conv.assignedTo.name}
                        </span>
                      </span>
                    )}

                    {/* Status dot */}
                    <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-muted-foreground/85">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          conv.status === "open"
                            ? "bg-emerald-500"
                            : conv.status === "resolved"
                              ? "bg-blue-400"
                              : "bg-zinc-400"
                        }`}
                      />
                      <span className="capitalize">{conv.status}</span>
                    </span>
                  </div>
                </div>
                <ChevronRight
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground/60 group-hover:text-foreground"
                  aria-hidden="true"
                />
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
