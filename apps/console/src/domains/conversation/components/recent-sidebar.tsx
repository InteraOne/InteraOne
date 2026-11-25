import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Clock, ChevronLeft, ChevronRight, Ticket } from "lucide-react";
import { conversationsApi } from "../api/conversations.api";
import { ChannelIcon } from "@/shared/ui/channel-icon";

interface RecentConversation {
  _id: string;
  subject: string;
  visitorName: string;
  channel: string;
  lastMessage?: string;
  openedAt: number;
  status?: string;
  ticketId?: string;
  ticketNumber?: string;
}

export function RecentConversationsSidebar() {
  const navigate = useNavigate();
  const { conversationId: activeId } = useParams();
  const [recents, setRecents] = useState<RecentConversation[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const loadRecents = async () => {
    try {
      const res = await conversationsApi.getRecentConversations();
      if (res?.success && Array.isArray(res.data)) {
        setRecents(res.data);
      } else {
        setRecents([]);
      }
    } catch (err) {
      console.error("Failed to load recent conversations:", err);
    }
  };

  useEffect(() => {
    loadRecents();
    window.addEventListener("interaone_recents_updated", loadRecents);
    return () => {
      window.removeEventListener("interaone_recents_updated", loadRecents);
    };
  }, []);

  const getChannelIcon = (channel: string) => {
    return <ChannelIcon channel={channel} className="h-2.5 w-2.5 shrink-0" />;
  };

  const getStatusBadge = (status?: string) => {
    if (!status) return null;
    const meta: Record<string, { label: string; style: string }> = {
      open: {
        label: "Open",
        style: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
      },
      pending: {
        label: "Pending",
        style: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25",
      },
      resolved: {
        label: "Resolved",
        style: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25",
      },
      closed: {
        label: "Closed",
        style: "bg-muted text-muted-foreground border-border",
      },
    };

    const current = meta[status.toLowerCase()] || { label: status, style: "bg-muted text-muted-foreground border-border" };

    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold border leading-none shrink-0 ${current.style}`}>
        {current.label}
      </span>
    );
  };

  const getChannelBadge = (channel: string) => {
    const label = channel?.toLowerCase() === "widget" ? "web" : channel;
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80 capitalize leading-none shrink-0">
        {getChannelIcon(channel)}
        <span>{label}</span>
      </span>
    );
  };

  const formatRecentTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  if (isCollapsed) {
    return (
      <div className="h-full w-14 flex flex-col rounded-lg border border-border bg-card shadow-sm items-center pt-3 pb-3 transition-all duration-300 overflow-hidden">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-1.5 hover:bg-muted rounded-lg cursor-pointer mb-5 text-muted-foreground hover:text-foreground transition-all duration-200 shadow-sm border border-transparent hover:border-border"
          title="Expand Sidebar"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        
        <div className="flex-1 flex flex-col gap-3.5 items-center w-full overflow-y-auto px-2 scrollbar-none">
          {recents.map((conv) => {
            const initials = conv.visitorName
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            const isActive = conv._id === activeId;
            const conversationUrl = conv.ticketId
              ? `/dashboard/conversations/inbox/chat/${conv._id}?ticketId=${conv.ticketId}`
              : `/dashboard/conversations/inbox/chat/${conv._id}`;
            return (
              <div key={conv._id} className="relative shrink-0 group">
                <button
                  onClick={() => navigate(conversationUrl)}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold cursor-pointer border relative transition-all duration-200 hover:scale-105 active:scale-95 ${
                    isActive
                      ? "bg-primary text-primary-foreground border-primary shadow-md ring-2 ring-primary/20"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                  }`}
                  title={`${conv.visitorName} (${conv.status || "open"})`}
                >
                  {initials}
                </button>
                {/* Status Dot */}
                <div 
                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-background shadow-xs ${
                    conv.status === "open"
                      ? "bg-emerald-500"
                      : conv.status === "pending"
                      ? "bg-amber-500"
                      : conv.status === "resolved"
                      ? "bg-blue-500"
                      : "bg-zinc-400"
                  }`} 
                  title={`Status: ${conv.status || "open"}`}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-[260px] flex flex-col rounded-lg border border-border bg-card shadow-sm transition-all duration-300 overflow-hidden">
      {/* Header */}
      <div className="h-14 px-4 border-b border-border flex items-center justify-between shrink-0 bg-card">
        <h3 className="text-sm font-semibold text-foreground select-none">Recent Chats</h3>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg cursor-pointer transition-all duration-200 border border-transparent hover:border-border"
            title="Collapse Sidebar"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {recents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-9 h-9 rounded-full bg-muted/40 flex items-center justify-center mb-3">
              <Clock className="h-4.5 w-4.5 text-muted-foreground/60" />
            </div>
            <p className="text-xs text-muted-foreground font-semibold">No recent chats</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">Chats you view will show up here.</p>
          </div>
        ) : (
          recents.map((conv) => {
            const isActive = conv._id === activeId;
            const initials = conv.visitorName
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            const conversationUrl = conv.ticketId
              ? `/dashboard/conversations/inbox/chat/${conv._id}?ticketId=${conv.ticketId}`
              : `/dashboard/conversations/inbox/chat/${conv._id}`;

            return (
              <button
                key={conv._id}
                onClick={() => navigate(conversationUrl)}
                className={`w-full text-left flex items-start gap-3 p-3.5 transition-all border-b border-border/40 select-none cursor-pointer duration-200 relative ${
                  isActive
                    ? "bg-primary/[0.04] text-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-muted/20"
                }`}
              >
                {/* Active Indicator Line */}
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary" />
                )}

                 {/* Avatar */}
                <div className="relative shrink-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold border transition-all duration-150 ${
                    isActive 
                      ? "bg-primary text-primary-foreground border-primary" 
                      : "bg-muted text-muted-foreground border-border"
                  }`}>
                    {initials}
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <p className="text-xs font-bold truncate text-foreground">
                      {conv.channel === "threads" ? conv.subject : conv.visitorName}
                    </p>
                    <span className="text-[9px] text-muted-foreground/75 whitespace-nowrap">
                      {formatRecentTime(conv.openedAt)}
                    </span>
                  </div>
                  
                  {/* Source, Ticket and Status Row */}
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    {getChannelBadge(conv.channel)}
                    {conv.ticketId && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25 leading-none shrink-0">
                        <Ticket className="h-2.5 w-2.5" />
                        {conv.ticketNumber || "Ticket"}
                      </span>
                    )}
                    {getStatusBadge(conv.status)}
                  </div>

                  <p className="text-[11px] text-muted-foreground truncate leading-normal">
                    {conv.lastMessage || "No messages yet"}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
