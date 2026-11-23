import type { ComponentType, ReactNode } from "react";
import {
  CalendarDays,
  ChevronDown,
  FileText,
  Mail,
  Paperclip,
  Phone,
  StickyNote,
} from "lucide-react";
import { WhatsAppIcon } from "@/shared/ui/channel-icon";
import { Card, CardContent } from "@/shared/ui/card";

export type ActivityWorkspaceTab =
  | "activity"
  | "notes"
  | "call"
  | "whatsapp"
  | "email"
  | "files"
  | "documents";

export interface ActivityWorkspaceTabItem {
  id: ActivityWorkspaceTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
  iconClass: string;
}

export const ACTIVITY_WORKSPACE_TABS: readonly ActivityWorkspaceTabItem[] = [
  {
    id: "activity",
    label: "Activity",
    icon: CalendarDays,
    iconClass: "text-blue-600",
  },
  {
    id: "notes",
    label: "Notes",
    icon: StickyNote,
    iconClass: "text-amber-500",
  },
  { id: "call", label: "Call", icon: Phone, iconClass: "text-sky-600" },
  { id: "whatsapp", label: "WhatsApp", icon: WhatsAppIcon, iconClass: "" },
  { id: "email", label: "Email", icon: Mail, iconClass: "text-rose-500" },
  {
    id: "files",
    label: "Files",
    icon: Paperclip,
    iconClass: "text-violet-600",
  },
  {
    id: "documents",
    label: "Documents",
    icon: FileText,
    iconClass: "text-indigo-600",
  },
] as const;

export function ActivityWorkspaceComposer({
  tab,
  onTabChange,
  flushContent = false,
  tabs = ACTIVITY_WORKSPACE_TABS,
  children,
}: {
  tab: ActivityWorkspaceTab;
  onTabChange: (tab: ActivityWorkspaceTab) => void;
  flushContent?: boolean;
  tabs?: readonly ActivityWorkspaceTabItem[];
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-hidden rounded-2xl border border-border/70 bg-card py-0 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_36px_rgba(0,0,0,0.035)] ring-0">
      <div className="flex gap-1 overflow-x-auto border-b border-border/60 bg-foreground/[0.012] px-3 py-2.5">
        {tabs.map(({ id, label, icon: Icon, iconClass }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === id
                ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground"
            }`}
          >
            <Icon className={`h-4 w-4 ${iconClass}`} />
            {label}
          </button>
        ))}
      </div>
      <CardContent className={flushContent ? "p-0" : "p-5 sm:p-6"}>
        {children}
      </CardContent>
    </Card>
  );
}

export function ActivityWorkspaceSectionHeader({
  title,
  expanded,
  onExpandedChange,
}: {
  title: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title} <ChevronDown className="h-4 w-4" />
      </h2>
      {typeof expanded === "boolean" && onExpandedChange ? (
        <button
          type="button"
          role="switch"
          aria-checked={expanded}
          onClick={() => onExpandedChange(!expanded)}
          className="flex items-center gap-2 rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span
            aria-hidden="true"
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              expanded ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          >
            <span
              className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                expanded ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </span>
          <span>Expand all items</span>
        </button>
      ) : null}
    </div>
  );
}

export function ActivityWorkspaceHistoryCard({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-visible rounded-2xl border border-border/70 bg-card py-0 shadow-[0_1px_2px_rgba(0,0,0,0.025)] ring-0">
      <div className="border-b border-border/60 px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          History
        </h2>
      </div>
      <CardContent className="px-5 py-5">{children}</CardContent>
    </Card>
  );
}

export function ActivityWorkspaceHistoryFilters<T extends string>({
  filters,
  active,
  onChange,
}: {
  filters: ReadonlyArray<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (filter: T) => void;
}) {
  return (
    <div className="mb-5 flex gap-1.5 overflow-x-auto pb-2">
      {filters.map((filter) => (
        <button
          key={filter.id}
          type="button"
          onClick={() => onChange(filter.id)}
          className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            active === filter.id
              ? "bg-foreground text-background"
              : "bg-foreground/[0.035] text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
          }`}
        >
          {filter.label}
          {typeof filter.count === "number" ? ` (${filter.count})` : ""}
        </button>
      ))}
    </div>
  );
}

export function ActivityWorkspaceEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
