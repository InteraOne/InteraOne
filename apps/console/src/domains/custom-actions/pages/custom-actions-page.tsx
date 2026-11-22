import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ChevronDown, ChevronRight, FolderClosed, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Input } from "@/shared/ui/input";
import { DeleteConfirmDialog } from "@/shared/components/delete-confirm-dialog";
import { useCustomActions, useDeleteCustomActions, useSetCustomActionsEnabled } from "../hooks/use-custom-actions";
import { ImportActionsDialog } from "./import-actions-dialog";

function actionCategory(action: { category?: string; request: { url: string } }) {
  const category = action.category?.trim();
  if (category) return category;
  try {
    const path = new URL(action.request.url.replace(/\{\{.*?\}\}/g, "value")).pathname;
    const segments = path.split("/").filter(Boolean);
    const segment = segments.find((value) => !/^(api|v\d+(?:\.\d+)?)$/i.test(value)) || "other";
    return segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return "Other";
  }
}

export function CustomActionsPage() {
  const actions = useCustomActions();
  const remove = useDeleteCustomActions();
  const setEnabled = useSetCustomActionsEnabled();
  const [deleteTarget, setDeleteTarget] = useState<{ label: string; actionIds: string[] } | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "draft">("all");
  const [category, setCategory] = useState("all");
  const allActions = useMemo(() => actions.data || [], [actions.data]);
  const categories = useMemo(() => Array.from(new Set(allActions.map(actionCategory))).sort(), [allActions]);
  const visibleActions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return allActions.filter((action) => {
      const matchesFilter = filter === "all" || (filter === "enabled" ? action.enabled : !action.enabled);
      const matchesCategory = category === "all" || actionCategory(action) === category;
      return matchesFilter && matchesCategory && (!normalized || `${action.name} ${action.description} ${action.slug} ${actionCategory(action)} ${action.request.url}`.toLowerCase().includes(normalized));
    });
  }, [allActions, category, filter, query]);
  const groupedActions = useMemo(() => {
    const groups = new Map<string, typeof visibleActions>();
    for (const action of visibleActions) {
      const key = actionCategory(action);
      groups.set(key, [...(groups.get(key) || []), action]);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [visibleActions]);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.025em]">Custom actions</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Create and manage reusable HTTP requests.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportActionsDialog />
          <Button asChild><Link to="/dashboard/custom-actions/new"><Plus className="mr-2 h-4 w-4" />Create action</Link></Button>
        </div>
      </header>

      <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs">
        <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">All actions</h2>
            <p className="mt-1 text-xs text-muted-foreground">{allActions.length} {allActions.length === 1 ? "action" : "actions"}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <label className="relative min-w-0 flex-1 sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 pl-9" placeholder="Search" /></label>
            <select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All categories</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All statuses</option><option value="enabled">Enabled</option><option value="draft">Disabled</option></select>
          </div>
        </div>

        {actions.isLoading ? <div className="flex min-h-56 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          : actions.error ? <div className="p-4"><Alert variant="destructive"><AlertDescription>{actions.error.message}</AlertDescription></Alert></div>
          : !allActions.length ? <div className="p-12 text-center"><h2 className="text-sm font-semibold">No actions created</h2><p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">Add an HTTPS endpoint and define the request it accepts.</p><Button asChild size="sm" className="mt-5"><Link to="/dashboard/custom-actions/new">Create action</Link></Button></div>
          : !visibleActions.length ? <div className="p-10 text-center"><p className="text-sm font-medium">No matching actions</p><button type="button" onClick={() => { setQuery(""); setFilter("all"); setCategory("all"); }} className="mt-2 text-xs text-primary hover:underline">Clear filters</button></div>
          : <>
            <div className="hidden grid-cols-[minmax(220px,1.4fr)_100px_minmax(180px,1fr)_150px_110px_80px] gap-4 border-b border-border/70 bg-muted/20 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
              <span>Action</span><span>Method</span><span>Endpoint</span><span>Authentication</span><span>Status</span><span />
            </div>
            <div className="divide-y divide-border/70">{groupedActions.map(([group, groupActions]) => <details key={`${group}-${query ? "search" : "browse"}`} className="group/category" open={query ? true : undefined}>
              <summary className="flex cursor-pointer list-none items-center gap-3 bg-muted/30 px-4 py-3 hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open/category:rotate-180" />
                <FolderClosed className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{group}</span>
                <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">{groupActions.length} {groupActions.length === 1 ? "action" : "actions"}</span>
                <span className="ml-auto text-xs text-muted-foreground">{groupActions.filter((action) => action.enabled).length} enabled</span>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label={`Delete ${group} category`} onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDeleteTarget({ label: `${group} category`, actionIds: allActions.filter((action) => actionCategory(action) === group).map((action) => action._id) });
                }}><Trash2 className="h-4 w-4" /></Button>
              </summary>
              <div className="divide-y divide-border/70 border-t border-border/70">{groupActions.map((action) => {
              let endpoint = action.request.url;
              try { endpoint = decodeURIComponent(new URL(action.request.url).pathname); } catch { /* Keep incomplete draft URL visible. */ }
              const statusPending = setEnabled.isPending && setEnabled.variables?.actionIds.includes(action._id);
              const toggleStatus = () => {
                if (!statusPending) setEnabled.mutate({ actionIds: [action._id], enabled: !action.enabled });
              };
              return <article key={action._id} role="switch" aria-checked={action.enabled} aria-label={`${action.enabled ? "Disable" : "Enable"} ${action.name}`} tabIndex={0} onClick={toggleStatus} onKeyDown={(event) => {
                if (event.currentTarget !== event.target || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                toggleStatus();
              }} className={`group grid cursor-pointer gap-4 px-4 py-4 transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${statusPending ? "opacity-60" : ""} lg:grid-cols-[minmax(220px,1.4fr)_100px_minmax(180px,1fr)_150px_110px_80px] lg:items-center`}>
                <div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${action.enabled ? "bg-emerald-500" : "bg-muted-foreground/35"}`} /><h3 className="truncate text-sm font-medium">{action.name}</h3></div><p className="mt-1 truncate pl-4 text-xs text-muted-foreground">{action.description}</p></div>
                <div><span className="mr-2 text-[10px] font-semibold uppercase text-muted-foreground lg:hidden">Method</span><span className="font-mono text-xs">{action.request.method}</span></div>
                <div className="min-w-0"><span className="mr-2 text-[10px] font-semibold uppercase text-muted-foreground lg:hidden">Endpoint</span><span className="block truncate font-mono text-xs text-foreground" title={action.request.url}>{endpoint}</span></div>
                <div><span className="mr-2 text-[10px] font-semibold uppercase text-muted-foreground lg:hidden">Authentication</span><span className="text-xs capitalize">{action.authentication.type === "none" ? "None" : action.authentication.type.replace("_", " ")}</span></div>
                <div><span className="mr-2 text-[10px] font-semibold uppercase text-muted-foreground lg:hidden">Status</span><span className={`text-xs font-medium ${action.enabled ? "text-emerald-600" : "text-muted-foreground"}`}>{action.enabled ? "Enabled" : "Disabled"}</span></div>
                <div className="flex items-center justify-end"><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground opacity-100 lg:opacity-0 lg:group-hover:opacity-100" aria-label={`Delete ${action.name}`} disabled={remove.isPending} onClick={(event) => { event.stopPropagation(); setDeleteTarget({ label: action.name, actionIds: [action._id] }); }}><Trash2 className="h-3.5 w-3.5" /></Button><Button asChild variant="ghost" size="icon" className="h-8 w-8"><Link to={`/dashboard/custom-actions/${action._id}`} aria-label={`Open ${action.name}`} onClick={(event) => event.stopPropagation()}><ChevronRight className="h-4 w-4" /></Link></Button></div>
              </article>;
            })}</div>
            </details>)}</div>
          </>}
      </section>
      <DeleteConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => { if (!remove.isPending) setDeleteTarget(null); }}
        onConfirm={() => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.actionIds, { onSuccess: () => setDeleteTarget(null) });
        }}
        title={deleteTarget && deleteTarget.actionIds.length > 1 ? "Delete category?" : "Delete action?"}
        description={deleteTarget ? `Delete “${deleteTarget.label}” and ${deleteTarget.actionIds.length === 1 ? "its action" : `all ${deleteTarget.actionIds.length} actions`}? This cannot be undone.` : undefined}
        isDeleting={remove.isPending}
      />
    </div>
  );
}
