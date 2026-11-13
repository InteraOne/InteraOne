import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  SearchX,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import {
  useComposioCatalog,
  useComposioConnections,
} from "../hooks/use-composio";

const CATEGORIES: Record<string, string> = {
  gmail: "Communication",
  slack: "Communication",
  googlecalendar: "Productivity",
  github: "Engineering",
  jira: "Project management",
  notion: "Knowledge",
  hubspot: "CRM & sales",
  googledrive: "File storage",
  trello: "Project management",
  asana: "Project management",
  linear: "Project management",
  googlesheets: "Productivity",
  googledocs: "Productivity",
  zendesk: "Customer support",
  outlook: "Communication",
  googlemeet: "Communication",
  zoom: "Communication",
  microsoft_teams: "Communication",
  airtable: "Data & analytics",
  shopify: "Commerce",
};

export function ComposioIntegrations({
  query = "",
  category = "All apps",
  connectedOnly = false,
}: {
  query?: string;
  category?: string;
  connectedOnly?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const catalog = useComposioCatalog({
    page,
    limit: 24,
    search: debouncedQuery,
    category,
  });
  const connections = useComposioConnections();
  const connectionMap = useMemo(
    () =>
      new Map(
        (connections.data || []).map((connection) => [
          connection.toolkitSlug,
          connection,
        ]),
      ),
    [connections.data],
  );

  if (catalog.isLoading || connections.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-36 animate-pulse bg-card p-4">
            <div className="h-9 w-9 rounded-lg bg-muted" />
            <div className="mt-4 h-3 w-28 rounded bg-muted" />
            <div className="mt-2 h-3 w-40 rounded bg-muted/70" />
          </div>
        ))}
      </div>
    );
  }
  if (catalog.error || connections.error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {(catalog.error || connections.error)?.message ||
            "The integration catalog could not be loaded. Try again shortly."}
        </AlertDescription>
      </Alert>
    );
  }

  const toolkits = (catalog.data?.toolkits || []).filter((toolkit) => {
    const connection = connectionMap.get(toolkit.slug);
    return (
      !connectedOnly || (connection && connection.status !== "disconnected")
    );
  });
  const pagination = catalog.data?.pagination;

  return (
    <div className="space-y-4">
      {!catalog.data?.available && (
        <Alert className="border-amber-500/20 bg-amber-500/[0.04]">
          <AlertDescription>
            {catalog.data?.enabled
              ? "The app catalog is available, but connections are paused until a server API key is configured."
              : "Agent app connections are currently disabled by your workspace administrator."}
          </AlertDescription>
        </Alert>
      )}
      {toolkits.length > 0 ? (
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 sm:grid-cols-2 lg:grid-cols-3">
          {toolkits.map((toolkit) => {
            const connection = connectionMap.get(toolkit.slug);
            const categoryLabel =
              toolkit.category || CATEGORIES[toolkit.slug] || "Productivity";
            const active = connection?.status === "active";
            return (
              <Link
                key={toolkit.slug}
                to={`/dashboard/integrations/composio/${toolkit.slug}`}
                className="group relative flex min-h-36 flex-col bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-background p-1.5 shadow-xs">
                    <img
                      src={
                        toolkit.logo ||
                        `https://logos.composio.dev/api/${toolkit.slug}`
                      }
                      alt=""
                      className="h-6 w-6 object-contain"
                    />
                  </div>
                  {connection && (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${active ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-amber-400"}`}
                      />
                      {active ? "Connected" : connection.status}
                    </span>
                  )}
                </div>
                <div className="mt-3 min-w-0">
                  <h3 className="truncate text-sm font-semibold tracking-tight">
                    {toolkit.name}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {categoryLabel}
                  </p>
                </div>
                <div className="mt-auto flex items-end justify-between gap-3 pt-3">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {toolkit.toolsCount} tools
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground opacity-70 transition group-hover:opacity-100">
                    {connection ? "Manage" : "View"}
                    <ExternalLink className="h-3 w-3" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/80 bg-card px-6 py-14 text-center">
          <SearchX className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">
            {connectedOnly
              ? "No connected apps found"
              : "No integrations found"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try another search or choose a different category.
          </p>
        </div>
      )}
      {!connectedOnly && pagination && pagination.totalPages > 1 && (
        <div className="flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-4 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} ·{" "}
            {pagination.total.toLocaleString()} apps
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={pagination.page <= 1 || catalog.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border/70 bg-card px-2.5 text-xs font-medium transition hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </button>
            <button
              type="button"
              disabled={
                pagination.page >= pagination.totalPages || catalog.isFetching
              }
              onClick={() =>
                setPage((current) =>
                  Math.min(pagination.totalPages, current + 1),
                )
              }
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border/70 bg-card px-2.5 text-xs font-medium transition hover:bg-muted disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
