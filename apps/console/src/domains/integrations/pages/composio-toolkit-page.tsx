import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  CalendarDays,
  ContactRound,
  Github,
  ListTodo,
  Loader2,
  Mail,
  MessageSquare,
  NotebookText,
  Plug,
  RefreshCw,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  useComposioCatalog,
  useComposioConnections,
  useConnectComposio,
  useDisconnectComposio,
  useRefreshComposioStatus,
  useUpdateComposioPolicy,
} from "../hooks/use-composio";

const TOOLKIT_ICONS: Record<string, LucideIcon> = {
  gmail: Mail,
  slack: MessageSquare,
  googlecalendar: CalendarDays,
  github: Github,
  jira: ListTodo,
  notion: NotebookText,
  hubspot: ContactRound,
};

export function ComposioToolkitPage() {
  const { toolkitSlug = "" } = useParams();
  const catalog = useComposioCatalog();
  const connections = useComposioConnections();
  const connect = useConnectComposio();
  const refresh = useRefreshComposioStatus();
  const disconnect = useDisconnectComposio();
  const updatePolicy = useUpdateComposioPolicy();
  const reconciled = useRef(new Set<string>());

  const toolkit = catalog.data?.toolkits.find((item) => item.slug === toolkitSlug);
  const connection = connections.data?.find((item) => item.toolkitSlug === toolkitSlug);

  useEffect(() => {
    if (connection?.status === "pending" && !reconciled.current.has(connection._id)) {
      reconciled.current.add(connection._id);
      refresh.mutate(toolkitSlug);
    }
  }, [connection, refresh, toolkitSlug]);

  if (catalog.isLoading || connections.isLoading) {
    return <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (catalog.error || connections.error) {
    return <Alert variant="destructive"><AlertDescription>{(catalog.error || connections.error)?.message || "Could not load this integration."}</AlertDescription></Alert>;
  }

  if (!toolkit) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm"><Link to="/dashboard/integrations"><ArrowLeft className="mr-2 h-4 w-4" />Back to integrations</Link></Button>
        <Alert variant="destructive"><AlertDescription>This integration is not in the server allowlist.</AlertDescription></Alert>
      </div>
    );
  }

  const ToolkitIcon = TOOLKIT_ICONS[toolkit.slug] || Plug;
  const enabledToolSlugs = new Set(toolkit.policy.allowedTools.map((tool) => tool.slug));
  const updateTool = (slug: string, enabled: boolean) => {
    const allowedTools = toolkit.tools
      .filter((tool) => tool.slug === slug ? enabled : enabledToolSlugs.has(tool.slug))
      .map(({ slug: toolSlug, risk }) => ({ slug: toolSlug, risk }));
    updatePolicy.mutate({
      toolkit: toolkit.slug,
      input: { enabled: allowedTools.length > 0, allowedTools },
    });
  };

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/dashboard/integrations"><ArrowLeft className="mr-2 h-4 w-4" />Back to integrations</Link>
      </Button>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border bg-background p-3"><ToolkitIcon className="h-6 w-6" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold">{toolkit.name}</h1>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${connection?.status === "active" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : connection?.status === "pending" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
                  {connection?.status || "Not connected"}
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{toolkit.description}</p>
              {connection?.displayLabel && <p className="mt-1 text-xs text-muted-foreground">Connected as {connection.displayLabel}</p>}
            </div>
          </div>

          <div className="flex shrink-0 gap-2">
            {connection && (
              <Button variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate(toolkit.slug)}>
                <RefreshCw className={`mr-2 h-4 w-4 ${refresh.isPending ? "animate-spin" : ""}`} />Refresh
              </Button>
            )}
            {connection ? (
              <Button variant="outline" disabled={disconnect.isPending} onClick={() => disconnect.mutate(connection._id)}>
                <Trash2 className="mr-2 h-4 w-4" />Disconnect
              </Button>
            ) : (
              <Button disabled={!catalog.data?.available || connect.isPending || enabledToolSlugs.size === 0} onClick={() => connect.mutate(toolkit.slug)}>
                {connect.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Connect {toolkit.name}
              </Button>
            )}
          </div>
        </div>

        {!catalog.data?.available && (
          <Alert className="mt-4"><AlertDescription>{catalog.data?.enabled ? "Composio is enabled but its server API key is not configured." : "Composio is disabled on the server."}</AlertDescription></Alert>
        )}
        {connection?.lastError && <Alert variant="destructive" className="mt-4"><AlertDescription>{connection.lastError}</AlertDescription></Alert>}
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <div className="flex flex-col gap-2 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h2 className="font-semibold">Allowed tools</h2></div>
            <p className="mt-1 text-sm text-muted-foreground">Select the exact Composio tool slugs InteraOne may use for this connection.</p>
          </div>
          <span className="text-sm text-muted-foreground">{enabledToolSlugs.size}/{toolkit.tools.length} enabled</span>
        </div>

        <div className="divide-y">
          {toolkit.tools.map((tool) => (
            <label key={tool.slug} className="flex cursor-pointer items-start gap-3 p-5 transition-colors hover:bg-muted/20">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={enabledToolSlugs.has(tool.slug)}
                disabled={!catalog.data?.available || updatePolicy.isPending}
                onChange={(event) => updateTool(tool.slug, event.target.checked)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{tool.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tool.risk === "read" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
                    {tool.risk === "read" ? "Read" : "Human approval required"}
                  </span>
                </span>
                <code className="mt-1 block break-all text-xs text-primary">{tool.slug}</code>
                <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">{tool.description}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {connection?.status === "active" && (
        <p className="text-xs text-muted-foreground">Reconnect this integration if newly enabled tools require additional provider OAuth scopes.</p>
      )}
    </div>
  );
}
