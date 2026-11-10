import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Boxes, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Loader } from "@/shared/ui/loader";
import {
  useComposioCatalog,
  useComposioConnections,
} from "../hooks/use-composio";

const TOOLKIT_CATEGORIES: Record<string, string> = {
  gmail: "Communication",
  slack: "Communication",
  googlecalendar: "Productivity",
  github: "Engineering",
  jira: "Project management",
  notion: "Knowledge",
  hubspot: "CRM",
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
  airtable: "Database",
  shopify: "Commerce",
};

export function ComposioIntegrations({ query = "" }: { query?: string }) {
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
  });
  const connections = useComposioConnections();

  if (catalog.isLoading || connections.isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Loader size="md" />
      </div>
    );
  }
  if (catalog.error || connections.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {(catalog.error || connections.error)?.message ||
            "Could not load AI integrations."}
        </AlertDescription>
      </Alert>
    );
  }

  const shownToolkits = catalog.data?.toolkits || [];
  const pagination = catalog.data?.pagination;

  return (
    <section className="space-y-5">
      {!catalog.data?.available && (
        <Alert>
          <AlertDescription>
            {catalog.data?.enabled
              ? "Composio is enabled but its API key is not configured."
              : "Composio is disabled. Set COMPOSIO_ENABLED=true and configure the server-side API key to connect apps."}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-end justify-between gap-4 border-b border-border/70 pb-3 pt-1">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-primary" />
            <h3 className="font-semibold tracking-tight">Agent tool catalog</h3>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Connect an app, then grant only the actions your agents may use.
          </p>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {pagination?.total ?? shownToolkits.length} app
          {(pagination?.total ?? shownToolkits.length) === 1 ? "" : "s"}
        </span>
      </div>

      {shownToolkits.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shownToolkits.map((toolkit) => {
            const connection = connections.data?.find(
              (item) => item.toolkitSlug === toolkit.slug,
            );
            return (
              <Link
                key={toolkit.slug}
                to={`/dashboard/integrations/composio/${toolkit.slug}`}
                className={`group relative overflow-hidden rounded-lg border bg-card p-4 transition-colors hover:bg-muted/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${connection?.status === "active" ? "border-emerald-500/30" : "border-border/70 hover:border-primary/30"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/60 bg-background p-2 shadow-xs">
                      <img
                        src={
                          toolkit.logo ||
                          `https://logos.composio.dev/api/${toolkit.slug}`
                        }
                        alt=""
                        className="h-7 w-7 object-contain"
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold tracking-tight">
                        {toolkit.name}
                      </h3>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {toolkit.category ||
                          TOOLKIT_CATEGORIES[toolkit.slug] ||
                          "Productivity"}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold ${connection?.status === "active" ? "border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-300" : connection?.status === "pending" ? "border-amber-500/20 bg-amber-500/[0.07] text-amber-700 dark:text-amber-300" : "border-border/70 bg-muted/30 text-muted-foreground"}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${connection?.status === "active" ? "bg-emerald-500" : connection?.status === "pending" ? "bg-amber-500" : "bg-muted-foreground/40"}`}
                    />
                    {connection?.status === "active"
                      ? "Connected"
                      : connection?.status === "pending"
                        ? "Pending"
                        : "Not connected"}
                  </span>
                </div>
                <p className="mt-4 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">
                  {toolkit.description}
                </p>
                {connection?.lastError && (
                  <p className="mt-2 line-clamp-2 text-xs text-destructive">
                    {connection.lastError}
                  </p>
                )}
                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {toolkit.toolsCount} tools
                  </span>
                  <span className="flex items-center font-semibold text-foreground">
                    {connection?.status === "active" ? "Manage" : "Connect"}
                    <ChevronRight className="ml-0.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border/80 bg-muted/10 px-6 py-12 text-center">
          <p className="text-sm font-medium">No AI apps found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try a different app or category name.
          </p>
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} ·{" "}
            {pagination.total} integrations
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pagination.page <= 1 || catalog.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="inline-flex h-9 items-center rounded-lg border border-border/70 bg-background px-3 text-xs font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
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
              className="inline-flex h-9 items-center rounded-lg border border-border/70 bg-background px-3 text-xs font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
