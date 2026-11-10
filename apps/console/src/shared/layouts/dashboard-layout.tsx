import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useWidget } from "@/domains/widget/hooks/useWidget";
import {
  Bell,
  BookOpen,
  Bot,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Inbox,
  Crown,
  LogOut,
  Maximize2,
  Minimize2,
  Moon,
  Radio,
  Search,
  QrCode,
  Settings,
  Sun,
  TriangleAlert,
  UserCheck,
  UserCog,
  Users2,
  UserPlus,
  Info,
  Clock,
  Ticket,
  BarChart3,
  type LucideIcon,
  Columns3,
  Building2,
  Plug,
  Flame,
} from "lucide-react";
import { useAuth } from "@/domains/auth/hooks/useAuth";
import { useLogout } from "@/domains/auth/hooks/useLogout";
import { authApi } from "@/domains/auth/api/auth.api";
import { useConversationDetail } from "@/domains/conversation/hooks/useConversationDetail";
import { useTicket } from "@/domains/tickets/hooks/useTicket";
import { useQueryClient } from "@tanstack/react-query";
import {
  useConversations,
  useMyConversations,
} from "@/domains/conversation/hooks";
import io, { Socket } from "socket.io-client";
import { formatDistanceToNow } from "date-fns";
import { getInteraOneMode, isEeEnabledByEnv } from "@/shared/ee";
import { OrgSwitcher } from "@/shared/components/org-switcher";
import { playNotificationSound } from "@/shared/lib/audio";
import { UsageBanner } from "@/shared/components/usage-banner";
import { UpgradeModalRoot } from "@/shared/components/upgrade-modal";
import { useTheme } from "@/shared/theme/theme-context";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Loader } from "@/shared/ui/loader";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { apiClient } from "@/shared/lib/api-client";
import { useDashboardTour } from "@/shared/tours/use-dashboard-tour";

interface DashboardLayoutProps {
  children: ReactNode;
}

type OrgRole = "owner" | "admin" | "agent";

const getBreadcrumbIcon = (path: string, label: string): LucideIcon | null => {
  const normalizedLabel = label.toLowerCase();

  if (path === "/dashboard") return BarChart3;
  if (path.startsWith("/dashboard/conversations")) return Inbox;
  if (path.startsWith("/dashboard/tickets")) return Ticket;
  if (path.startsWith("/dashboard/crm/leads")) return Flame;
  if (path.startsWith("/dashboard/crm/pipeline")) return Columns3;
  if (path.startsWith("/dashboard/crm/organizations")) return Building2;
  if (
    path.startsWith("/dashboard/crm") ||
    path.startsWith("/dashboard/contacts")
  )
    return Users2;
  if (path.startsWith("/dashboard/channels")) return Radio;
  if (path.startsWith("/dashboard/integrations")) return Plug;
  if (path.startsWith("/dashboard/agents")) return UserCog;
  if (path.startsWith("/dashboard/members")) return UserCheck;
  if (path.startsWith("/dashboard/widget/qr") || normalizedLabel === "qr codes")
    return QrCode;
  if (path.startsWith("/dashboard/widget")) return Crown;
  if (
    path.startsWith("/dashboard/knowledge/realtime") ||
    normalizedLabel === "realtime"
  )
    return Bot;
  if (path.startsWith("/dashboard/knowledge")) return BookOpen;
  if (path.startsWith("/dashboard/settings/billing/usage")) return BarChart3;
  if (path.startsWith("/dashboard/settings/billing")) return CreditCard;
  if (path.startsWith("/dashboard/settings/danger-zone")) return TriangleAlert;
  if (path.startsWith("/dashboard/settings")) return Settings;
  if (path.startsWith("/dashboard/organizations")) return Users2;

  return null;
};

const CDN_URL =
  (import.meta.env.VITE_WIDGET_URL as string | undefined) ||
  "http://localhost:9001/interaone-widget/v1/InteraOne.js";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3002";

interface Notification {
  id: string;
  type: "assignment" | "ai_sync" | "administrative" | "system" | "billing";
  title: string;
  description: string;
  timestamp: Date;
}

interface NotificationApiItem {
  _id: string;
  id?: string;
  type: Notification["type"];
  title: string;
  description: string;
  createdAt?: string;
  timestamp?: string;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const logoutMutation = useLogout();
  const { data: widgetData } = useWidget();

  const chatMatch = location.pathname.match(
    /\/dashboard\/conversations\/inbox\/chat\/([a-fA-F0-9]+)/,
  );
  const conversationId = chatMatch ? chatMatch[1] : undefined;

  const ticketMatch = location.pathname.match(
    /\/dashboard\/tickets\/([a-fA-F0-9]+)/,
  );
  const ticketId = ticketMatch ? ticketMatch[1] : undefined;

  const { data: convResponse } = useConversationDetail(conversationId || "");
  const { data: ticketDetail } = useTicket(ticketId);

  const customerName = useMemo(() => {
    if (!convResponse?.data?.conversation) return "Customer";
    const c = convResponse.data.conversation;
    return (
      c.metadata?.customer?.name ||
      c.metadata?.customerName ||
      c.metadata?.senderName ||
      "Anonymous Visitor"
    );
  }, [convResponse]);

  const ticketTitle = useMemo(() => {
    return ticketDetail?.title || "Ticket Details";
  }, [ticketDetail]);

  const orgRole: OrgRole | null = isAuthenticated ? authApi.getOrgRole() : null;
  const activeOrgId = isAuthenticated ? authApi.getActiveOrgId() : null;
  const canAccessContacts = true;
  const billingVisible = getInteraOneMode() === "cloud" && isEeEnabledByEnv();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState<
    "new" | "history"
  >("new");
  const [isContentFullscreen, setIsContentFullscreen] = useState(false);
  const [hasInboxBadge, setHasInboxBadge] = useState(false);

  const queryClient = useQueryClient();

  // Fetch open unassigned conversations and open conversations assigned to the current user
  const { data: unassignedConvs = [] } = useConversations("open", {
    unassigned: true,
  });
  const { data: myConvs = [] } = useMyConversations("open");

  // Merge, filter duplicates, sort by latest activity, and keep top 5
  const escalatedOrUnassigned = useMemo(() => {
    if (!isAuthenticated || !user) return [];

    const merged = [...unassignedConvs, ...myConvs];
    const uniqueMap = new Map<string, any>();

    for (const conv of merged) {
      uniqueMap.set(conv._id, conv);
    }

    return Array.from(uniqueMap.values())
      .sort((a, b) => {
        const timeA = new Date(a.lastMessageAt || a.createdAt).getTime();
        const timeB = new Date(b.lastMessageAt || b.createdAt).getTime();
        return timeB - timeA;
      })
      .slice(0, 5);
  }, [unassignedConvs, myConvs, isAuthenticated, user]);

  const getVisitorName = (conv: any) =>
    conv.metadata?.customer?.name ||
    conv.metadata?.senderName ||
    conv.metadata?.customerName ||
    "Anonymous Visitor";

  // Clear badge when on the inbox page
  useEffect(() => {
    if (location.pathname.startsWith("/dashboard/conversations/inbox")) {
      setHasInboxBadge(false);
    }
  }, [location.pathname]);
  const searchContainerRef = useRef<HTMLFormElement | null>(null);
  // Keep one widget loader alive across route-level DashboardLayout remounts.
  // The router mounts a fresh layout for each dashboard page, so removing and
  // reinjecting the iframe here would blank an open widget during navigation.
  useEffect(() => {
    const widgetId = widgetData?._id;
    if (!widgetId) return;

    const existingScript = document.getElementById(
      "InteraOne-widget-script",
    ) as HTMLScriptElement | null;
    const existingWidgetId = existingScript?.getAttribute(
      "data-InteraOne-public-key",
    );
    const existingDock = document.getElementById("InteraOne-widget-dock");
    const existingIframe = document.getElementById(
      "InteraOne-widget-iframe",
    ) as HTMLIFrameElement | null;
    const hasMountedWidget =
      !!existingDock &&
      !!existingIframe &&
      existingIframe.isConnected &&
      existingDock.contains(existingIframe) &&
      !!existingIframe.getAttribute("src");

    if (existingScript && existingWidgetId === widgetId && hasMountedWidget) {
      return;
    }

    const widgetWindow = window as Window & {
      __InteraOneWidgetLoader?: { destroy: () => void };
    };
    widgetWindow.__InteraOneWidgetLoader?.destroy();

    existingScript?.remove();
    document.getElementById("InteraOne-chat-button")?.remove();
    document.getElementById("InteraOne-outside-chips")?.remove();
    document.getElementById("InteraOne-widget-iframe")?.remove();
    document.getElementById("InteraOne-widget-dock")?.remove();

    const script = document.createElement("script");
    script.src = `${CDN_URL}?v=${Date.now()}`;
    script.setAttribute("data-InteraOne-public-key", widgetId);
    script.id = "InteraOne-widget-script";
    document.body.appendChild(script);
  }, [widgetData?._id]);

  const searchableRoutes = useMemo(() => {
    const base = [
      { label: "Dashboard", to: "/dashboard" },
      { label: "Inbox", to: "/dashboard/conversations/inbox" },
      { label: "Tickets", to: "/dashboard/tickets" },
    ];

    if (canAccessContacts) {
      base.push(
        { label: "CRM Contacts", to: "/dashboard/crm/contacts" },
        { label: "CRM Organizations", to: "/dashboard/crm/organizations" },
        { label: "CRM Leads", to: "/dashboard/crm/leads" },
        { label: "CRM Deals", to: "/dashboard/crm/pipeline" },
      );
    }

    if (orgRole === "admin" || orgRole === "owner") {
      base.push(
        { label: "Agents", to: "/dashboard/agents" },
        { label: "Members", to: "/dashboard/members" },
        { label: "Knowledge Static", to: "/dashboard/knowledge/static" },
        { label: "Knowledge Realtime", to: "/dashboard/knowledge/realtime" },
        { label: "Widget", to: "/dashboard/widget" },
        { label: "Integrations", to: "/dashboard/integrations" },
      );
    }

    if (orgRole === "owner") {
      if (billingVisible) {
        base.push({
          label: "Billing",
          to: "/dashboard/settings/billing/plans",
        });
      }

      base.push(
        { label: "QR Codes", to: "/dashboard/widget/qr" },
        { label: "General Settings", to: "/dashboard/settings/general" },
        { label: "Danger Zone", to: "/dashboard/settings/danger-zone" },
      );
    }

    return base;
  }, [billingVisible, canAccessContacts, orgRole]);

  const breadcrumbs = useMemo(() => {
    const pathname = location.pathname;

    // 1. Dashboard root
    if (pathname === "/dashboard" || pathname === "/dashboard/") {
      return [{ label: "Dashboard", to: "/dashboard" }];
    }

    // 2. Chat detail page
    const chatMatch = pathname.match(
      /\/dashboard\/conversations\/inbox\/chat\/([a-fA-F0-9]+)/,
    );
    if (chatMatch) {
      return [
        { label: "Dashboard", to: "/dashboard" },
        { label: "inbox", to: "/dashboard/conversations/inbox/open" },
        { label: customerName, to: pathname },
      ];
    }

    // 3. Conversations Inbox list views
    const inboxMatch = pathname.match(
      /\/dashboard\/conversations\/inbox\/([a-zA-Z0-9_-]+)/,
    );
    if (inboxMatch) {
      const subpath = inboxMatch[1];
      const subLabel =
        subpath === "open"
          ? "open"
          : subpath === "assigned"
            ? "Assigned"
            : subpath.charAt(0).toUpperCase() + subpath.slice(1);
      return [
        { label: "dashboard", to: "/dashboard" },
        { label: "inbox", to: "/dashboard/conversations/inbox/open" },
        { label: subLabel, to: pathname },
      ];
    }

    // 4. Ticket detail view
    const ticketDetailMatch = pathname.match(
      /\/dashboard\/tickets\/([a-fA-F0-9]+)/,
    );
    if (ticketDetailMatch) {
      return [
        { label: "Dashboard", to: "/dashboard" },
        { label: "Tickets", to: "/dashboard/tickets" },
        { label: ticketTitle, to: pathname },
      ];
    }

    // 5. Ticket root list view
    if (
      pathname === "/dashboard/tickets" ||
      pathname === "/dashboard/tickets/"
    ) {
      return [
        { label: "Dashboard", to: "/dashboard" },
        { label: "Tickets", to: "/dashboard/tickets" },
      ];
    }

    // 6. Fallback/default logic for all other pages
    const parts = pathname.split("/").filter(Boolean);
    const items: Array<{ label: string; to: string }> = [];
    let currentPath = "";

    parts.forEach((part, index) => {
      currentPath += `/${part}`;

      const label =
        index === 0 && part === "dashboard"
          ? "Dashboard"
          : part === "crm"
            ? "CRM"
            : part
                .split("-")
                .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
                .join(" ");

      items.push({ label, to: currentPath });
    });

    return items
      .map((item) =>
        item.to === "/dashboard/conversations"
          ? { ...item, to: "/dashboard/conversations/inbox/open" }
          : item,
      )
      .filter((item, index, list) => item.to !== list[index + 1]?.to);
  }, [location.pathname, customerName, ticketTitle]);

  const searchResults = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    if (!term) return [];
    return searchableRoutes
      .filter((route) => route.label.toLowerCase().includes(term))
      .slice(0, 5);
  }, [searchQuery, searchableRoutes]);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [newNotifications, setNewNotifications] = useState<Notification[]>([]);
  const newNotificationsRef = useRef<Notification[]>([]);
  const socketRef = useRef<Socket | null>(null);

  // Setup Socket listener for notifications
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const token = localStorage.getItem("token");
    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("notification", (newNotif: NotificationApiItem) => {
      playNotificationSound();
      const notification: Notification = {
        id: newNotif.id || newNotif._id,
        type: newNotif.type,
        title: newNotif.title,
        description: newNotif.description,
        timestamp: new Date(newNotif.timestamp || Date.now()),
      };

      newNotificationsRef.current = [
        notification,
        ...newNotificationsRef.current.filter(
          (item) => item.id !== notification.id,
        ),
      ];
      setNewNotifications(newNotificationsRef.current);
      setNotifications((prev) => [
        notification,
        ...prev.filter((item) => item.id !== notification.id),
      ]);
    });

    const handleConversationsUpdate = () => {
      queryClient.invalidateQueries({
        queryKey: ["conversations"],
        exact: false,
      });
    };

    socket.on("conversation_pending", () => {
      playNotificationSound();
      if (
        !window.location.pathname.startsWith("/dashboard/conversations/inbox")
      ) {
        setHasInboxBadge(true);
      }
      handleConversationsUpdate();
    });

    socket.on(
      "conversation_assigned",
      (data: { conversationId: string; agentId: string }) => {
        if (data?.agentId === user?.id) {
          playNotificationSound();
          if (
            !window.location.pathname.startsWith(
              "/dashboard/conversations/inbox",
            )
          ) {
            setHasInboxBadge(true);
          }
        }
        handleConversationsUpdate();
      },
    );

    socket.on("conversation_escalated", handleConversationsUpdate);
    socket.on("status_updated", handleConversationsUpdate);
    socket.on("conversation_removed", handleConversationsUpdate);

    return () => {
      socket.disconnect();
    };
  }, [isAuthenticated, queryClient, user]);

  // Fetch historical notifications
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    let cancelled = false;

    newNotificationsRef.current = [];

    const fetchNotifications = async () => {
      try {
        const res = await apiClient.get<{ data?: NotificationApiItem[] }>(
          `/notifications`,
        );
        if (!cancelled && res?.data) {
          const history = res.data.map(
            (n): Notification => ({
              id: n.id || n._id,
              type: n.type,
              title: n.title,
              description: n.description,
              timestamp: new Date(n.createdAt || n.timestamp || Date.now()),
            }),
          );

          // Keep notifications that arrived over the socket while history loaded.
          const liveNotifications = newNotificationsRef.current;
          const liveIds = new Set(liveNotifications.map((item) => item.id));
          setNewNotifications(liveNotifications);
          setNotifications(
            [
              ...liveNotifications,
              ...history.filter((item) => !liveIds.has(item.id)),
            ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
          );
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load notifications:", err);
          setNewNotifications(newNotificationsRef.current);
          setNotifications(newNotificationsRef.current);
        }
      }
    };
    fetchNotifications();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);

  const newNotificationCount = newNotifications.length;
  const filteredNotifications =
    notificationFilter === "new" ? newNotifications : notifications;

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "assignment":
        return <UserPlus className="h-4 w-4 text-blue-500" />;
      case "ai_sync":
        return <Bot className="h-4 w-4 text-purple-500" />;
      case "administrative":
        return <UserCheck className="h-4 w-4 text-emerald-500" />;
      default:
        return <Info className="h-4 w-4 text-gray-500" />;
    }
  };

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;

      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(target)
      ) {
        setShowSearchResults(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const firstMatch = searchResults[0];
    if (firstMatch) {
      navigate(firstMatch.to);
      setSearchQuery("");
      setShowSearchResults(false);
    }
  };

  const isActive = (path: string, exact = false) => {
    return exact
      ? location.pathname === path
      : location.pathname.startsWith(path);
  };

  const isConversationRoute = location.pathname.startsWith(
    "/dashboard/conversations",
  );
  const isTicketRoute = location.pathname.startsWith("/dashboard/tickets");
  const isTicketDetailRoute = /^\/dashboard\/tickets\/[^/]+\/?$/.test(
    location.pathname,
  );
  const isContactDetailsRoute = /^\/dashboard\/crm\/contacts\/[^/]+\/?$/.test(
    location.pathname,
  );
  const tourIdentity = useMemo(
    () => ({
      orgId: activeOrgId,
      userId: user?.id,
      userEmail: user?.email,
    }),
    [activeOrgId, user?.email, user?.id],
  );
  const { replayTour } = useDashboardTour({
    pathname: location.pathname,
    enabled:
      isAuthenticated &&
      !isLoading &&
      location.pathname.startsWith("/dashboard"),
    identity: tourIdentity,
  });

  const renderSidebar = () => {
    return (
      <>
        <div
          className="p-4 relative z-50"
          data-tour-id="dashboard-org-switcher"
        >
          <OrgSwitcher isMinimized={false} />
        </div>

        <nav className="mt-4 px-3 flex-1 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden space-y-4">
          <div className="space-y-1">
            <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Overview
            </p>
            <Link to="/dashboard">
              <Button
                data-tour-id="sidebar-nav-dashboard"
                variant="ghost"
                className={`w-full flex items-center px-3 py-2 text-sm cursor-pointer font-medium rounded-lg transition-colors justify-start ${
                  isActive("/dashboard", true)
                    ? "bg-primary/10 text-primary border-r-2 border-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <BarChart3 className="h-5 w-5 mr-3" />
                <span className="flex-1 text-left">Dashboard</span>
              </Button>
            </Link>
          </div>

          <div className="space-y-1">
            <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Conversations
            </p>
            {[
              {
                label: "Inbox",
                to: "/dashboard/conversations/inbox",
                icon: Inbox,
              },
              { label: "Tickets", to: "/dashboard/tickets", icon: Ticket },
            ].map((item) => (
              <Link key={item.to} to={item.to}>
                <Button
                  data-tour-id={
                    item.label === "Inbox"
                      ? "sidebar-nav-inbox"
                      : "sidebar-nav-tickets"
                  }
                  variant="ghost"
                  className={`w-full flex items-center px-3 py-2 text-sm cursor-pointer rounded-lg justify-start ${
                    isActive(item.to, true)
                      ? "text-primary bg-primary/5 font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  <item.icon className="h-4 w-4 mr-3" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.label === "Inbox" && hasInboxBadge && (
                    <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse mr-1" />
                  )}
                </Button>
              </Link>
            ))}
          </div>

          {canAccessContacts && (
            <div className="space-y-1">
              <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                CRM
              </p>
              {[
                {
                  label: "Organizations",
                  to: "/dashboard/crm/organizations",
                  icon: Building2,
                },
                {
                  label: "Contacts",
                  to: "/dashboard/crm/contacts",
                  icon: Users2,
                },
                {
                  label: "Leads",
                  to: "/dashboard/crm/leads",
                  icon: Flame,
                },
                {
                  label: "Deals",
                  to: "/dashboard/crm/pipeline",
                  icon: Columns3,
                },
              ].map((item) => (
                <Link key={item.to} to={item.to}>
                  <Button
                    data-tour-id={`sidebar-nav-${item.label.toLowerCase()}`}
                    variant="ghost"
                    className={`w-full flex items-center px-3 py-2 text-sm cursor-pointer rounded-lg justify-start ${
                      isActive(item.to, true)
                        ? "text-primary bg-primary/5 font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    <item.icon className="h-4 w-4 mr-3" />
                    <span>{item.label}</span>
                  </Button>
                </Link>
              ))}
            </div>
          )}

          {(orgRole === "admin" || orgRole === "owner") && (
            <div className="space-y-1">
              <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Channels
              </p>
              <Link to="/dashboard/channels">
                <Button
                  data-tour-id="sidebar-nav-channels"
                  variant="ghost"
                  className={`w-full flex items-center px-3 py-2 text-sm cursor-pointer font-medium rounded-lg transition-colors justify-start ${
                    isActive("/dashboard/channels")
                      ? "bg-primary/10 text-primary border-r-2 border-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <Radio className="h-5 w-5 mr-3" />
                  <span className="flex-1 text-left">Channels</span>
                </Button>
              </Link>
            </div>
          )}

          {(orgRole === "admin" || orgRole === "owner") && (
            <div className="space-y-1">
              <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Operations
              </p>

              <Link to="/dashboard/agents">
                <Button
                  data-tour-id="sidebar-nav-agents"
                  variant="ghost"
                  className={`w-full flex items-center px-3 py-2 text-sm cursor-pointer font-medium rounded-lg transition-colors justify-start ${
                    isActive("/dashboard/agents")
                      ? "bg-primary/10 text-primary border-r-2 border-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <UserCog className="h-5 w-5 mr-3" />
                  <span className="flex-1 text-left">Agents</span>
                </Button>
              </Link>

              <Link to="/dashboard/members">
                <Button
                  data-tour-id="sidebar-nav-members"
                  variant="ghost"
                  className={`w-full flex items-center px-3 py-2 text-sm cursor-pointer font-medium rounded-lg transition-colors justify-start ${
                    isActive("/dashboard/members")
                      ? "bg-primary/10 text-primary border-r-2 border-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <UserCheck className="h-5 w-5 mr-3" />
                  <span className="flex-1 text-left">Members</span>
                </Button>
              </Link>
            </div>
          )}

          {(orgRole === "admin" || orgRole === "owner") && (
            <div className="space-y-1">
              <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                AI and Widget
              </p>

              {[
                {
                  label: "Knowledge Static",
                  to: "/dashboard/knowledge/static",
                  icon: BookOpen,
                },
                {
                  label: "Knowledge Realtime",
                  to: "/dashboard/knowledge/realtime",
                  icon: Bot,
                },
              ].map((item) => (
                <Link key={item.to} to={item.to}>
                  <Button
                    data-tour-id={
                      item.label === "Knowledge Static"
                        ? "sidebar-nav-knowledge-static"
                        : "sidebar-nav-knowledge-realtime"
                    }
                    variant="ghost"
                    className={`w-full flex items-center px-3 py-2 text-sm cursor-pointer rounded-lg justify-start ${
                      isActive(item.to, true)
                        ? "text-primary bg-primary/5 font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    <item.icon className="h-4 w-4 mr-3" />
                    <span>{item.label}</span>
                  </Button>
                </Link>
              ))}

              <Link to="/dashboard/widget">
                <Button
                  data-tour-id="sidebar-nav-widget"
                  variant="ghost"
                  className={`w-full flex items-center px-3 py-2 text-sm cursor-pointer font-medium rounded-lg transition-colors justify-start ${
                    isActive("/dashboard/widget", true)
                      ? "bg-primary/10 text-primary border-r-2 border-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <Crown className="h-5 w-5 mr-3" />
                  <span className="flex-1 text-left">Widget</span>
                </Button>
              </Link>

              <Link to="/dashboard/integrations">
                <Button
                  data-tour-id="sidebar-nav-integrations"
                  variant="ghost"
                  className={`w-full flex items-center px-3 py-2 text-sm cursor-pointer font-medium rounded-lg transition-colors justify-start ${
                    isActive("/dashboard/integrations", true)
                      ? "bg-primary/10 text-primary border-r-2 border-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <Plug className="h-5 w-5 mr-3" />
                  <span className="flex-1 text-left">Integrations</span>
                </Button>
              </Link>

              {orgRole === "owner" && (
                <Link to="/dashboard/widget/qr">
                  <Button
                    data-tour-id="sidebar-nav-qr-codes"
                    variant="ghost"
                    className={`w-full flex items-center px-3 py-2 text-sm cursor-pointer font-medium rounded-lg transition-colors justify-start ${
                      isActive("/dashboard/widget/qr", true)
                        ? "bg-primary/10 text-primary border-r-2 border-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <QrCode className="h-5 w-5 mr-3" />
                    <span className="flex-1 text-left">QR Codes</span>
                  </Button>
                </Link>
              )}
            </div>
          )}

          {orgRole === "owner" && billingVisible && (
            <div className="space-y-1">
              <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Billing &amp; Usage
              </p>
              {[
                {
                  label: "Plans & Pricing",
                  to: "/dashboard/settings/billing/plans",
                  icon: CreditCard,
                },
                {
                  label: "Resource Usage",
                  to: "/dashboard/settings/billing/usage",
                  icon: BarChart3,
                },
              ].map((item) => (
                <Link key={item.to} to={item.to}>
                  <Button
                    variant="ghost"
                    className={`w-full flex items-center px-3 py-2 text-sm cursor-pointer rounded-lg justify-start ${
                      isActive(item.to, true)
                        ? "text-primary bg-primary/5 font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    <item.icon className="h-4 w-4 mr-3" />
                    <span>{item.label}</span>
                  </Button>
                </Link>
              ))}
            </div>
          )}

          {orgRole === "owner" && (
            <div className="space-y-1">
              <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Settings
              </p>
              {[
                {
                  label: "General",
                  to: "/dashboard/settings/general",
                  icon: Settings,
                  visible: true,
                },
                {
                  label: "Danger Zone",
                  to: "/dashboard/settings/danger-zone",
                  icon: TriangleAlert,
                  visible: true,
                },
              ]
                .filter((item) => item.visible)
                .map((item) => (
                  <Link key={item.to} to={item.to}>
                    <Button
                      data-tour-id={
                        item.label === "General"
                          ? "sidebar-nav-general"
                          : "sidebar-nav-danger-zone"
                      }
                      variant="ghost"
                      className={`w-full flex items-center px-3 py-2 text-sm cursor-pointer rounded-lg justify-start ${
                        isActive(item.to, true)
                          ? "text-primary bg-primary/5 font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                    >
                      <item.icon className="h-4 w-4 mr-3" />
                      <span>{item.label}</span>
                    </Button>
                  </Link>
                ))}
            </div>
          )}
        </nav>

        <div className="p-4 mt-auto">
          <div
            className="flex items-center mb-4 mt-2 space-x-3"
            data-tour-id="dashboard-user-profile"
          >
            <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-primary-foreground">
                {user?.name?.charAt(0).toUpperCase() || "A"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {user?.name}
              </p>
              <p className="text-xs text-muted-foreground truncate capitalize">
                {orgRole}
              </p>
            </div>
          </div>

          <Button
            onClick={() => setShowLogoutDialog(true)}
            variant="outline"
            size="sm"
            className="w-full cursor-pointer"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign out
          </Button>
        </div>
      </>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-destructive">Access denied. Please log in.</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <div className="flex h-screen overflow-hidden">
        {!isContentFullscreen && (
          <aside
            className="hidden lg:flex bg-background flex-col lg:fixed lg:top-4 lg:left-4 lg:h-[calc(100vh-2rem)] w-72"
            data-tour-id="dashboard-sidebar"
          >
            {renderSidebar()}
          </aside>
        )}

        <div
          className={`flex min-w-0 flex-1 flex-col bg-background ${isContentFullscreen ? "lg:ml-0" : "lg:ml-76"}`}
        >
          <main
            className={`flex-1 bg-background ${isConversationRoute ? "overflow-hidden" : "overflow-auto"}`}
          >
            <div
              className={`mx-auto w-full ${isConversationRoute ? "h-full p-4 sm:p-6 lg:p-8 flex flex-col min-h-0" : isContentFullscreen ? "max-w-none p-4 sm:p-6 lg:p-8" : "max-w-384 p-4 sm:p-6 lg:p-8"}`}
            >
              <div className="mb-4 rounded-2xl border border-border bg-card/90 p-3 shadow-sm backdrop-blur">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div
                    className="flex items-center gap-1 text-sm text-muted-foreground overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                    data-tour-id="dashboard-breadcrumbs"
                  >
                    {breadcrumbs.map((crumb, index) => {
                      const BreadcrumbIcon = getBreadcrumbIcon(
                        crumb.to,
                        crumb.label,
                      );

                      return (
                        <div
                          key={`${crumb.to}-${index}`}
                          className="flex items-center gap-1 shrink-0"
                        >
                          {index > 0 && (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          {index === breadcrumbs.length - 1 ? (
                            <span className="flex items-center gap-1.5 font-medium text-foreground">
                              {BreadcrumbIcon && (
                                <BreadcrumbIcon
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5"
                                  strokeWidth={1.8}
                                />
                              )}
                              {crumb.label}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => navigate(crumb.to)}
                              className="flex cursor-pointer items-center gap-1.5 transition-colors hover:text-foreground"
                            >
                              {BreadcrumbIcon && (
                                <BreadcrumbIcon
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5"
                                  strokeWidth={1.8}
                                />
                              )}
                              {crumb.label}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 lg:gap-3">
                    {/* Escalated/Unassigned Avatars stack */}
                    {escalatedOrUnassigned.length > 0 && (
                      <div className="flex items-center -space-x-2 mr-1">
                        {escalatedOrUnassigned.map((conv) => {
                          const name = getVisitorName(conv);
                          const initials = name
                            .split(" ")
                            .map((w: string) => w[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase();
                          const hasAgent = !!conv.assignedTo;

                          return (
                            <button
                              key={conv._id}
                              type="button"
                              onClick={() =>
                                navigate(
                                  `/dashboard/conversations/inbox/chat/${conv._id}`,
                                )
                              }
                              className="group relative cursor-pointer focus:outline-none transition-all duration-300 hover:z-10 hover:-translate-y-0.5"
                              aria-label={`Conversation with ${name}`}
                            >
                              {/* Avatar circle using InteraOne primary brand color */}
                              <div className="w-8 h-8 rounded-full border-2 border-background flex items-center justify-center text-[10px] font-semibold bg-primary text-primary-foreground shadow-sm transition-all duration-300 group-hover:shadow-md">
                                {initials}
                              </div>

                              {/* Status dot */}
                              <span
                                className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-background shadow-sm ${
                                  hasAgent ? "bg-red-500" : "bg-amber-500"
                                }`}
                              />

                              {/* Premium designed tooltip showing the contact name */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg bg-zinc-900/95 dark:bg-zinc-100/95 text-zinc-50 dark:text-zinc-950 border border-zinc-800/30 dark:border-zinc-200/30 shadow-md text-[11px] font-semibold tracking-wide whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all duration-200 transform translate-y-1 group-hover:translate-y-0 pointer-events-none z-50">
                                {name}
                                {/* Pointer arrow */}
                                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-0.5 border-4 border-transparent border-t-zinc-900/95 dark:border-t-zinc-100/95" />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <form
                      ref={searchContainerRef}
                      className="relative w-full max-w-xs"
                      onSubmit={handleSearchSubmit}
                      data-tour-id="dashboard-search"
                    >
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setShowSearchResults(true);
                        }}
                        onFocus={() => setShowSearchResults(true)}
                        placeholder="Search anywhere..."
                        className="pl-9 cursor-text"
                      />
                      {showSearchResults && searchResults.length > 0 && (
                        <div className="absolute mt-2 w-full rounded-lg border border-border bg-popover shadow-lg z-50 overflow-hidden">
                          {searchResults.map((result) => (
                            <button
                              key={result.to}
                              type="button"
                              onClick={() => {
                                navigate(result.to);
                                setSearchQuery("");
                                setShowSearchResults(false);
                              }}
                              className="w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                            >
                              {result.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </form>

                    <Dialog
                      open={notificationsOpen}
                      onOpenChange={setNotificationsOpen}
                    >
                      <DialogTrigger asChild>
                        <Button
                          data-tour-id="dashboard-notifications"
                          type="button"
                          variant="outline"
                          size="sm"
                          className="cursor-pointer relative"
                          aria-label="Notifications"
                        >
                          <Bell className="h-4 w-4" />
                          {newNotificationCount > 0 && (
                            <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground border-2 border-background">
                              {newNotificationCount > 9
                                ? "9+"
                                : newNotificationCount}
                            </span>
                          )}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden bg-card/95 backdrop-blur-xl border-border">
                        <DialogHeader className="px-6 py-4 border-b border-border/50 bg-muted/30 shrink-0">
                          <div className="flex items-center justify-between">
                            <div>
                              <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-3">
                                Notifications
                                <div className="flex bg-background/50 border border-border/50 p-0.5 rounded-lg">
                                  <Button
                                    variant={
                                      notificationFilter === "new"
                                        ? "secondary"
                                        : "ghost"
                                    }
                                    size="sm"
                                    onClick={() => setNotificationFilter("new")}
                                    className="h-7 cursor-pointer text-xs px-3"
                                  >
                                    New
                                  </Button>
                                  <Button
                                    variant={
                                      notificationFilter === "history"
                                        ? "secondary"
                                        : "ghost"
                                    }
                                    size="sm"
                                    onClick={() =>
                                      setNotificationFilter("history")
                                    }
                                    className="h-7 cursor-pointer text-xs px-3"
                                  >
                                    Complete History
                                  </Button>
                                </div>
                              </DialogTitle>
                              <p className="text-xs text-muted-foreground mt-2 font-medium">
                                {newNotificationCount} New Notifications
                              </p>
                            </div>
                          </div>
                        </DialogHeader>

                        <div className="flex-1 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden p-2">
                          {filteredNotifications.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                                <Bell className="h-8 w-8 text-muted-foreground/50" />
                              </div>
                              <p className="text-base font-medium text-foreground">
                                {notificationFilter === "new"
                                  ? "No new notifications"
                                  : "No notification history"}
                              </p>
                              <p className="text-sm text-muted-foreground mt-1">
                                {notificationFilter === "new"
                                  ? "New updates will appear here as they arrive."
                                  : "Your notification history will appear here."}
                              </p>
                            </div>
                          ) : (
                            <div className="divide-y divide-border/40 space-y-1">
                              {filteredNotifications.map((item) => (
                                <div
                                  key={item.id}
                                  className={`group flex items-start gap-4 p-4 rounded-xl hover:bg-accent/50 transition-all relative ${notificationFilter === "new" ? "bg-primary/5" : ""}`}
                                >
                                  {notificationFilter === "new" && (
                                    <div className="absolute left-0 top-3 bottom-3 w-1 bg-primary rounded-r-md" />
                                  )}

                                  <div className="mt-1 shrink-0">
                                    <div className="h-10 w-10 rounded-full bg-background border border-border/50 flex items-center justify-center shadow-sm">
                                      {getNotificationIcon(item.type)}
                                    </div>
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-3 mb-1">
                                      <p
                                        className={`text-base truncate ${notificationFilter === "new" ? "font-bold text-foreground" : "font-medium text-foreground/80"}`}
                                      >
                                        {item.title}
                                      </p>
                                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                                        <Clock className="h-3.5 w-3.5" />
                                        {formatDistanceToNow(item.timestamp, {
                                          addSuffix: true,
                                        })}
                                      </div>
                                    </div>
                                    <p className="text-sm text-muted-foreground leading-relaxed">
                                      {item.description}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Button
                      data-tour-id="dashboard-tour-help"
                      type="button"
                      onClick={replayTour}
                      variant="outline"
                      size="sm"
                      className="cursor-pointer"
                      aria-label="Replay page tour"
                      title="Replay page tour"
                    >
                      <CircleHelp className="h-4 w-4" />
                    </Button>

                    <Button
                      data-tour-id="dashboard-theme-toggle"
                      onClick={toggleTheme}
                      variant="outline"
                      size="sm"
                      className="cursor-pointer"
                    >
                      {theme === "dark" ? (
                        <Sun className="h-4 w-4 mr-2" />
                      ) : (
                        <Moon className="h-4 w-4 mr-2" />
                      )}
                      {theme === "dark" ? "Light mode" : "Dark mode"}
                    </Button>

                    <Button
                      data-tour-id="dashboard-fullscreen-toggle"
                      type="button"
                      onClick={() => setIsContentFullscreen((prev) => !prev)}
                      variant="outline"
                      size="sm"
                      className="cursor-pointer"
                      aria-label={
                        isContentFullscreen
                          ? "Exit fullscreen content"
                          : "Fullscreen content"
                      }
                    >
                      {isContentFullscreen ? (
                        <Minimize2 className="h-4 w-4" />
                      ) : (
                        <Maximize2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {isConversationRoute ? (
                <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
              ) : isTicketDetailRoute ? (
                <>
                  <UsageBanner />
                  {children}
                </>
              ) : (
                <div
                  className={`min-h-[calc(100vh-4rem)] rounded-2xl border border-border bg-card ${
                    isContactDetailsRoute
                      ? "p-2 sm:p-3 lg:p-4"
                      : "p-4 sm:p-6 lg:p-8"
                  } ${isTicketRoute ? "" : "shadow-sm"}`}
                >
                  <UsageBanner />
                  {children}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>

      {showLogoutDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-lg shadow-xl border border-border max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-2">Sign Out</h3>
            <p className="text-muted-foreground mb-6">
              Are you sure you want to sign out?
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowLogoutDialog(false)}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleLogout}
                className="cursor-pointer"
              >
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Global upgrade modal — triggered by 429 responses or socket limit events */}
      <UpgradeModalRoot />
    </div>
  );
}
