import { useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ContactRound,
  Github,
  ListTodo,
  Loader2,
  Mail,
  MessageSquare,
  NotebookText,
  Plug,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import type { IntegrationApproval } from "../api/composio.api";
import {
  useComposioApprovals,
  useComposioCatalog,
  useComposioConnections,
  useDecideComposioApproval,
} from "../hooks/use-composio";

function requester(approval: IntegrationApproval) {
  return typeof approval.requestedBy === "string" ? "Workspace member" : approval.requestedBy.name || approval.requestedBy.email || "Workspace member";
}

const TOOLKIT_ICONS: Record<string, LucideIcon> = {
  gmail: Mail,
  slack: MessageSquare,
  googlecalendar: CalendarDays,
  github: Github,
  jira: ListTodo,
  notion: NotebookText,
  hubspot: ContactRound,
};

export function ComposioIntegrations() {
  const catalog = useComposioCatalog();
  const connections = useComposioConnections();
  const approvals = useComposioApprovals();
  const approve = useDecideComposioApproval("approve");
  const reject = useDecideComposioApproval("reject");
  const [decision, setDecision] = useState<{ approval: IntegrationApproval; action: "approve" | "reject" } | null>(null);

  if (catalog.isLoading || connections.isLoading || approvals.isLoading) {
    return <div className="flex min-h-32 items-center justify-center rounded-xl border"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (catalog.error || connections.error || approvals.error) {
    return <Alert variant="destructive"><AlertDescription>{(catalog.error || connections.error || approvals.error)?.message || "Could not load AI integrations."}</AlertDescription></Alert>;
  }

  const pending = approvals.data?.filter((item) => item.status === "pending") || [];
  const decide = () => {
    if (!decision) return;
    const mutation = decision.action === "approve" ? approve : reject;
    mutation.mutate(decision.approval._id, { onSuccess: () => setDecision(null) });
  };

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h2 className="text-base font-semibold">AI tool connections</h2></div>
          <p className="mt-1 text-sm text-muted-foreground">Connections are private to the member who authorizes them. Public widget visitors never receive this access.</p>
        </div>
        {pending.length > 0 && <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">{pending.length} approval{pending.length === 1 ? "" : "s"}</span>}
      </div>

      {!catalog.data?.available && (
        <Alert><AlertDescription>{catalog.data?.enabled ? "Composio is enabled but its API key is not configured." : "Composio is disabled. Set COMPOSIO_ENABLED=true and configure the server-side API key to connect apps."}</AlertDescription></Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {catalog.data?.toolkits.map((toolkit) => {
          const connection = connections.data?.find((item) => item.toolkitSlug === toolkit.slug);
          const enabledToolSlugs = new Set(toolkit.policy.allowedTools.map((tool) => tool.slug));
          const ToolkitIcon = TOOLKIT_ICONS[toolkit.slug] || Plug;
          return (
            <Link
              key={toolkit.slug}
              to={`/dashboard/integrations/composio/${toolkit.slug}`}
              className="group rounded-lg border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3"><div className="rounded-lg border p-2"><ToolkitIcon className="h-5 w-5" /></div><div><h3 className="font-medium">{toolkit.name}</h3><p className="text-xs text-muted-foreground">{connection?.displayLabel || connection?.status || "Not connected"}</p></div></div>
                <span className={`mt-1 h-2.5 w-2.5 rounded-full ${connection?.status === "active" ? "bg-emerald-500" : connection?.status === "pending" ? "bg-amber-500" : "bg-muted-foreground/30"}`} />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{toolkit.description}</p>
              {connection?.lastError && <p className="mt-2 line-clamp-2 text-xs text-destructive">{connection.lastError}</p>}
              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>{enabledToolSlugs.size}/{toolkit.tools.length} tools enabled</span>
                <span className="flex items-center font-medium text-primary">View tools <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Approval inbox</h3>
        {pending.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No actions are waiting for approval.</p> : pending.map((approval) => (
          <div key={approval._id} className="rounded-lg border p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><p className="text-sm font-medium">{approval.toolSlug}</p><p className="mt-0.5 text-xs text-muted-foreground">Requested by {requester(approval)} · expires {new Date(approval.expiresAt).toLocaleString()}</p><pre className="mt-2 max-h-28 overflow-auto rounded bg-muted/40 p-2 text-[11px]">{JSON.stringify(approval.arguments, null, 2)}</pre></div>
              <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={() => setDecision({ approval, action: "reject" })}><XCircle className="mr-1.5 h-3.5 w-3.5" />Reject</Button><Button size="sm" onClick={() => setDecision({ approval, action: "approve" })}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Approve</Button></div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={Boolean(decision)} onOpenChange={(open) => !open && setDecision(null)}><DialogContent><DialogHeader><DialogTitle>{decision?.action === "approve" ? "Approve external action?" : "Reject external action?"}</DialogTitle><DialogDescription>{decision?.action === "approve" ? "This executes the exact arguments shown once. It cannot be replayed." : "The pending action will not be executed."}</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button><Button variant={decision?.action === "reject" ? "destructive" : "default"} disabled={approve.isPending || reject.isPending} onClick={decide}>{(approve.isPending || reject.isPending) && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Confirm</Button></div></DialogContent></Dialog>
    </section>
  );
}
