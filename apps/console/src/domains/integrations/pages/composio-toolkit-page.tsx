import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Eye,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  useComposioConnections,
  useComposioToolkit,
  useConnectComposio,
  useDisconnectComposio,
  useRefreshComposioStatus,
  useUpdateComposioPolicy,
} from "../hooks/use-composio";

export function ComposioToolkitPage() {
  const { toolkitSlug = "" } = useParams();
  const toolkitQuery = useComposioToolkit(toolkitSlug);
  const connections = useComposioConnections();
  const connect = useConnectComposio();
  const refresh = useRefreshComposioStatus();
  const disconnect = useDisconnectComposio();
  const updatePolicy = useUpdateComposioPolicy();
  const reconciled = useRef(new Set<string>());
  const [toolQuery, setToolQuery] = useState("");
  const [toolFilter, setToolFilter] = useState<"all" | "read" | "protected">(
    "all",
  );

  const toolkit = toolkitQuery.data?.toolkit;
  const connection = connections.data?.find(
    (item) => item.toolkitSlug === toolkitSlug,
  );
  const normalizedToolQuery = toolQuery.trim().toLowerCase();
  const visibleTools = (toolkit?.tools ?? []).filter((tool) => {
    const matchesFilter =
      toolFilter === "all" ||
      (toolFilter === "read" ? tool.risk === "read" : tool.risk !== "read");
    const matchesQuery =
      !normalizedToolQuery ||
      `${tool.name} ${tool.description} ${tool.slug}`
        .toLowerCase()
        .includes(normalizedToolQuery);
    return matchesFilter && matchesQuery;
  });

  useEffect(() => {
    if (
      connection?.status === "pending" &&
      !reconciled.current.has(connection._id)
    ) {
      reconciled.current.add(connection._id);
      refresh.mutate(toolkitSlug);
    }
  }, [connection, refresh, toolkitSlug]);

  if (toolkitQuery.isLoading || connections.isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (toolkitQuery.error || connections.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {(toolkitQuery.error || connections.error)?.message ||
            "Could not load this integration."}
        </AlertDescription>
      </Alert>
    );
  }

  if (!toolkit) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/dashboard/integrations">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to integrations
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>
            This integration is not in the server allowlist.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const enabledToolSlugs = new Set(
    toolkit.policy.allowedTools.map((tool) => tool.slug),
  );
  const updateTool = (slug: string, enabled: boolean) => {
    const allowedTools = toolkit.tools
      .filter((tool) =>
        tool.slug === slug ? enabled : enabledToolSlugs.has(tool.slug),
      )
      .map(({ slug: toolSlug, risk }) => ({ slug: toolSlug, risk }));
    updatePolicy.mutate({
      toolkit: toolkit.slug,
      input: { enabled: allowedTools.length > 0, allowedTools },
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/dashboard/integrations">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to integrations
        </Link>
      </Button>

      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-background p-2.5 shadow-sm">
              <img
                src={
                  toolkit.logo ||
                  `https://logos.composio.dev/api/${toolkit.slug}`
                }
                alt=""
                className="h-9 w-9 object-contain"
              />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {toolkit.name}
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${connection?.status === "active" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : connection?.status === "pending" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${connection?.status === "active" ? "bg-emerald-500" : connection?.status === "pending" ? "bg-amber-500" : "bg-muted-foreground/40"}`}
                  />
                  {connection?.status || "Not connected"}
                </span>
              </div>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                {toolkit.description}
              </p>
              {connection?.displayLabel && (
                <p className="mt-2 inline-flex rounded-lg border border-border/60 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
                  Connected as{" "}
                  <span className="ml-1 font-medium text-foreground">
                    {connection.displayLabel}
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {connection && (
              <Button
                size="lg"
                variant="outline"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate(toolkit.slug)}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${refresh.isPending ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            )}
            {connection ? (
              <Button
                size="lg"
                variant="destructive"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate(connection._id)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Disconnect
              </Button>
            ) : (
              <Button
                size="lg"
                disabled={
                  !toolkitQuery.data?.available ||
                  connect.isPending ||
                  enabledToolSlugs.size === 0
                }
                onClick={() => connect.mutate(toolkit.slug)}
              >
                {connect.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Connect {toolkit.name}
              </Button>
            )}
          </div>
        </div>

        {!toolkitQuery.data?.available && (
          <Alert className="mt-4">
            <AlertDescription>
              {toolkitQuery.data?.enabled
                ? "Composio is enabled but its server API key is not configured."
                : "Composio is disabled on the server."}
            </AlertDescription>
          </Alert>
        )}
        {connection?.lastError && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{connection.lastError}</AlertDescription>
          </Alert>
        )}
      </section>

      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
        <div className="border-r border-border/70 p-4">
          <p className="text-xl font-semibold">{enabledToolSlugs.size}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Tools enabled</p>
        </div>
        <div className="border-r border-border/70 p-4">
          <p className="text-xl font-semibold">
            {toolkit.tools.filter((tool) => tool.risk === "read").length}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Read actions</p>
        </div>
        <div className="p-4">
          <p className="text-xl font-semibold">
            {toolkit.tools.filter((tool) => tool.risk !== "read").length}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Protected actions
          </p>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b border-border/70 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="font-semibold">Tool permissions</h2>
                  <p className="text-xs text-muted-foreground">
                    Control exactly what InteraOne can do in {toolkit.name}.
                  </p>
                </div>
              </div>
            </div>
            <span className="w-fit rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              {enabledToolSlugs.size} of {toolkit.tools.length} enabled
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={toolQuery}
                onChange={(event) => setToolQuery(event.target.value)}
                placeholder={`Search ${toolkit.tools.length} tools...`}
                className="h-10 w-full rounded-lg border border-border/70 bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <div className="flex w-fit rounded-lg bg-muted/60 p-1">
              {(["all", "read", "protected"] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setToolFilter(filter)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${toolFilter === filter ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {visibleTools.length} of {toolkit.tools.length} actions
            synced from Composio.
          </p>
        </div>

        <div className="grid gap-3 p-4 sm:p-5 lg:grid-cols-2">
          {visibleTools.map((tool) => (
            <label
              key={tool.slug}
              className={`group flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${enabledToolSlugs.has(tool.slug) ? "border-primary/25 bg-primary/[0.035]" : "border-border/70 bg-background hover:border-border"}`}
            >
              <input
                type="checkbox"
                className="peer sr-only"
                checked={enabledToolSlugs.has(tool.slug)}
                disabled={
                  !toolkitQuery.data?.available || updatePolicy.isPending
                }
                onChange={(event) =>
                  updateTool(tool.slug, event.target.checked)
                }
              />
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-background text-transparent transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50">
                <Check className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{tool.name}</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${tool.risk === "read" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}
                  >
                    {tool.risk === "read" ? (
                      <Eye className="h-3 w-3" />
                    ) : (
                      <CircleAlert className="h-3 w-3" />
                    )}
                    {tool.risk === "read" ? "Read only" : "Approval required"}
                  </span>
                </span>
                <span className="mt-2 block line-clamp-3 text-xs leading-5 text-muted-foreground">
                  {tool.description}
                </span>
                <code className="mt-3 flex max-w-full w-fit items-center gap-1 overflow-hidden rounded bg-muted/60 px-2 py-1 text-[10px] text-muted-foreground">
                  <Wrench className="h-3 w-3 shrink-0" />
                  <span className="truncate">{tool.slug}</span>
                </code>
              </span>
            </label>
          ))}
          {visibleTools.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
              No tools match this search and filter.
            </div>
          )}
        </div>
      </section>

      {connection?.status === "active" && (
        <div className="flex items-start gap-2 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p>
            Reconnect this integration if newly enabled tools require additional
            provider OAuth scopes.
          </p>
        </div>
      )}
    </div>
  );
}
