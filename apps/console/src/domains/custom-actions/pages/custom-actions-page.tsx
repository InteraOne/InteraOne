import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ChevronRight, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Input } from "@/shared/ui/input";
import { useCustomActions, useDeleteCustomAction } from "../hooks/use-custom-actions";

export function CustomActionsPage() {
  const actions = useCustomActions();
  const remove = useDeleteCustomAction();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "draft">("all");
  const allActions = useMemo(() => actions.data || [], [actions.data]);
  const visibleActions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return allActions.filter((action) => {
      const matchesFilter = filter === "all" || (filter === "enabled" ? action.enabled : !action.enabled);
      return matchesFilter && (!normalized || `${action.name} ${action.description} ${action.slug} ${action.request.url}`.toLowerCase().includes(normalized));
    });
  }, [allActions, filter, query]);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.025em]">Custom actions</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Create and manage reusable HTTP requests.</p>
        </div>
        <Button asChild><Link to="/dashboard/custom-actions/new"><Plus className="mr-2 h-4 w-4" />Create action</Link></Button>
      </header>

      <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs">
        <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">All actions</h2>
            <p className="mt-1 text-xs text-muted-foreground">{allActions.length} {allActions.length === 1 ? "action" : "actions"}</p>
          </div>
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1 sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 pl-9" placeholder="Search" /></label>
            <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All statuses</option><option value="enabled">Enabled</option><option value="draft">Disabled</option></select>
          </div>
        </div>

        {actions.isLoading ? <div className="flex min-h-56 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          : actions.error ? <div className="p-4"><Alert variant="destructive"><AlertDescription>{actions.error.message}</AlertDescription></Alert></div>
          : !allActions.length ? <div className="p-12 text-center"><h2 className="text-sm font-semibold">No actions created</h2><p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">Add an HTTPS endpoint and define the request it accepts.</p><Button asChild size="sm" className="mt-5"><Link to="/dashboard/custom-actions/new">Create action</Link></Button></div>
          : !visibleActions.length ? <div className="p-10 text-center"><p className="text-sm font-medium">No matching actions</p><button type="button" onClick={() => { setQuery(""); setFilter("all"); }} className="mt-2 text-xs text-primary hover:underline">Clear filters</button></div>
          : <>
            <div className="hidden grid-cols-[minmax(220px,1.4fr)_100px_minmax(180px,1fr)_150px_110px_80px] gap-4 border-b border-border/70 bg-muted/20 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
              <span>Action</span><span>Method</span><span>Endpoint</span><span>Authentication</span><span>Status</span><span />
            </div>
            <div className="divide-y divide-border/70">{visibleActions.map((action) => {
              let hostname = action.request.url;
              try { hostname = new URL(action.request.url.replace(/\{\{.*?\}\}/g, "value")).hostname; } catch { /* Keep incomplete draft URL visible. */ }
              return <article key={action._id} className="group grid gap-4 px-4 py-4 transition-colors hover:bg-muted/20 lg:grid-cols-[minmax(220px,1.4fr)_100px_minmax(180px,1fr)_150px_110px_80px] lg:items-center">
                <div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${action.enabled ? "bg-emerald-500" : "bg-muted-foreground/35"}`} /><h3 className="truncate text-sm font-medium">{action.name}</h3></div><p className="mt-1 truncate pl-4 text-xs text-muted-foreground">{action.description}</p></div>
                <div><span className="mr-2 text-[10px] font-semibold uppercase text-muted-foreground lg:hidden">Method</span><span className="font-mono text-xs">{action.request.method}</span></div>
                <div className="min-w-0"><span className="mr-2 text-[10px] font-semibold uppercase text-muted-foreground lg:hidden">Endpoint</span><span className="text-xs text-foreground">{hostname}</span></div>
                <div><span className="mr-2 text-[10px] font-semibold uppercase text-muted-foreground lg:hidden">Authentication</span><span className="text-xs capitalize">{action.authentication.type === "none" ? "None" : action.authentication.type.replace("_", " ")}</span></div>
                <div><span className="mr-2 text-[10px] font-semibold uppercase text-muted-foreground lg:hidden">Status</span><span className="text-xs">{action.enabled ? "Enabled" : "Disabled"}</span></div>
                <div className="flex items-center justify-end"><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground opacity-100 lg:opacity-0 lg:group-hover:opacity-100" aria-label={`Delete ${action.name}`} disabled={remove.isPending} onClick={() => window.confirm(`Delete ${action.name}?`) && remove.mutate(action._id)}><Trash2 className="h-3.5 w-3.5" /></Button><Button asChild variant="ghost" size="icon" className="h-8 w-8"><Link to={`/dashboard/custom-actions/${action._id}`} aria-label={`Open ${action.name}`}><ChevronRight className="h-4 w-4" /></Link></Button></div>
              </article>;
            })}</div>
          </>}
      </section>
    </div>
  );
}
