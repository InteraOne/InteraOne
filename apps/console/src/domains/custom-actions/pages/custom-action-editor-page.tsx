import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Bolt, CheckCircle2, FlaskConical, Globe2, KeyRound, Loader2, Power, Save, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { useCustomAction, useSaveCustomAction, useTestCustomAction } from "../hooks/use-custom-actions";
import type { CustomActionAuthType, CustomActionMethod, CustomActionPayload } from "../types/types";

const DEFAULT_SCHEMA = { type: "object", properties: {}, required: [] };
const stringify = (value: unknown) => JSON.stringify(value, null, 2);

interface FormState {
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  method: CustomActionMethod;
  url: string;
  headers: string;
  query: string;
  body: string;
  authType: CustomActionAuthType;
  authPlacement: "header" | "query";
  authKeyName: string;
  token: string;
  username: string;
  password: string;
  apiKey: string;
  credentialHint?: string;
  inputSchema: string;
  confirmation: "never" | "always";
  timeoutMs: number;
  maxResponseBytes: number;
  testInput: string;
}

const initialState: FormState = {
  name: "", slug: "", description: "", enabled: false,
  method: "POST", url: "", headers: "{}", query: "{}", body: "{}",
  authType: "none", authPlacement: "header", authKeyName: "X-API-Key",
  token: "", username: "", password: "", apiKey: "",
  inputSchema: stringify(DEFAULT_SCHEMA), confirmation: "never",
  timeoutMs: 10000, maxResponseBytes: 32768, testInput: "{}",
};

function JsonEditor({ label, value, onChange, description, rows = 7 }: { label: string; value: string; onChange: (value: string) => void; description?: string; rows?: number }) {
  return <div className="space-y-2"><Label>{label}</Label>{description && <p className="text-xs text-muted-foreground">{description}</p>}<Textarea className="font-mono text-xs" rows={rows} value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} /></div>;
}

export function CustomActionEditorPage() {
  const { actionId } = useParams();
  const editing = Boolean(actionId);
  const navigate = useNavigate();
  const action = useCustomAction(actionId);
  const save = useSaveCustomAction(actionId);
  const test = useTestCustomAction(actionId);
  const [form, setForm] = useState<FormState>(initialState);
  const [hydratedId, setHydratedId] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!action.data || hydratedId === action.data._id) return;
    const value = action.data;
    setForm({
      ...initialState,
      name: value.name, slug: value.slug, description: value.description, enabled: value.enabled,
      method: value.request.method, url: value.request.url,
      headers: stringify(value.request.headers || {}), query: stringify(value.request.query || {}),
      body: value.request.bodyTemplate === undefined ? "" : stringify(value.request.bodyTemplate),
      authType: value.authentication.type, authPlacement: value.authentication.placement || "header",
      authKeyName: value.authentication.keyName || "X-API-Key", credentialHint: value.authentication.credentialHint,
      inputSchema: stringify(value.inputSchema), confirmation: value.confirmation.mode,
      timeoutMs: value.execution.timeoutMs, maxResponseBytes: value.execution.maxResponseBytes,
    });
    setHydratedId(value._id);
  }, [action.data, hydratedId]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const parseObject = (label: string, value: string) => {
    try {
      const parsed = JSON.parse(value || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, unknown>;
    } catch { throw new Error(`${label} must contain a JSON object.`); }
  };

  const payload = (): CustomActionPayload => {
    const authentication: CustomActionPayload["authentication"] = { type: form.authType };
    if (form.authType === "api_key") {
      authentication.placement = form.authPlacement;
      authentication.keyName = form.authKeyName.trim();
      if (form.apiKey) authentication.credentials = { value: form.apiKey };
    } else if (form.authType === "bearer" && form.token) authentication.credentials = { token: form.token };
    else if (form.authType === "basic" && (form.username || form.password)) authentication.credentials = { username: form.username, password: form.password };
    const authChanged = Boolean(action.data && action.data.authentication.type !== form.authType);
    if (form.authType !== "none" && !authentication.credentials && (!form.credentialHint || authChanged)) {
      throw new Error("Enter credentials for the selected authentication type.");
    }
    if (form.authType === "basic" && authentication.credentials && (!form.username || !form.password)) {
      throw new Error("Basic authentication requires both username and password.");
    }
    let bodyTemplate: unknown = undefined;
    if (form.body.trim()) {
      try { bodyTemplate = JSON.parse(form.body); } catch { throw new Error("JSON body template is invalid."); }
    }
    return {
      name: form.name.trim(), slug: form.slug.trim(), description: form.description.trim(), enabled: form.enabled,
      request: { method: form.method, url: form.url.trim(), headers: parseObject("Headers", form.headers) as Record<string, string>, query: parseObject("Query parameters", form.query) as Record<string, string>, ...(bodyTemplate !== undefined ? { bodyTemplate } : {}) },
      authentication, inputSchema: parseObject("Input schema", form.inputSchema),
      confirmation: { mode: form.confirmation }, execution: { timeoutMs: Number(form.timeoutMs), maxResponseBytes: Number(form.maxResponseBytes) },
    };
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(undefined);
    try {
      const saved = await save.mutateAsync(payload());
      if (!editing) navigate(`/dashboard/custom-actions/${saved._id}`, { replace: true });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save this action."); }
  };

  const runTest = async () => {
    setError(undefined);
    try { await test.mutateAsync(parseObject("Test input", form.testInput)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Action test failed."); }
  };

  if (editing && action.isLoading) return <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <form onSubmit={submit} className="mx-auto max-w-7xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2"><Link to="/dashboard/custom-actions"><ArrowLeft className="mr-2 h-4 w-4" />Back to actions</Link></Button>

      <header className="border-b border-border/70 pb-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-xs"><Bolt className="h-5 w-5" /></span>
            <div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${form.enabled ? "bg-emerald-500" : "bg-muted-foreground/35"}`} /><h1 className="truncate text-2xl font-semibold tracking-tight">{editing ? form.name || "Untitled action" : "Create custom action"}</h1></div><p className="mt-1.5 text-sm text-muted-foreground">Configure the endpoint, inputs, authentication, and execution controls.</p></div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Button type="button" variant="outline" onClick={() => update("enabled", !form.enabled)} aria-pressed={form.enabled} className={form.enabled ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}><Power className="mr-2 h-4 w-4" />{form.enabled ? "Enabled" : "Disabled"}</Button>
            <Button type="submit" size="lg" disabled={save.isPending} className="shadow-sm"><Save className="mr-2 h-4 w-4" />{save.isPending ? "Saving…" : "Save action"}</Button>
          </div>
        </div>
      </header>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {save.isSuccess && <Alert variant="success"><CheckCircle2 className="h-4 w-4" /><AlertDescription>Action saved successfully.</AlertDescription></Alert>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
      <Tabs defaultValue="basics" className="min-w-0">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg border bg-card p-1 shadow-xs"><TabsTrigger value="basics">Basics</TabsTrigger><TabsTrigger value="request">Request</TabsTrigger><TabsTrigger value="authentication">Authentication</TabsTrigger><TabsTrigger value="inputs">Inputs</TabsTrigger><TabsTrigger value="safety">Safety</TabsTrigger><TabsTrigger value="test" disabled={!editing}>Test</TabsTrigger></TabsList>
        <div className="mt-4 rounded-xl border bg-card p-5 shadow-xs sm:p-6">
          <TabsContent value="basics" className="mt-0 space-y-5">
            <div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" value={form.name} required onChange={(event) => { update("name", event.target.value); if (!editing && !form.slug) update("slug", event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")); }} placeholder="Look up an order" /></div><div className="space-y-2"><Label htmlFor="slug">Action slug</Label><Input id="slug" className="font-mono" value={form.slug} required onChange={(event) => update("slug", event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="lookup_order" /></div></div>
            <div className="space-y-2"><Label htmlFor="description">Description</Label><Textarea id="description" value={form.description} required onChange={(event) => update("description", event.target.value)} placeholder="Find an order by its public order ID." /></div>
          </TabsContent>

          <TabsContent value="request" className="mt-0 space-y-5">
            <div className="grid gap-4 sm:grid-cols-[140px_1fr]"><div className="space-y-2"><Label>Method</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.method} onChange={(event) => update("method", event.target.value as CustomActionMethod)}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => <option key={method}>{method}</option>)}</select></div><div className="space-y-2"><Label htmlFor="url">HTTPS endpoint</Label><Input id="url" value={form.url} required onChange={(event) => update("url", event.target.value)} placeholder="https://api.example.com/orders/{{orderId}}" /></div></div>
            <div className="grid gap-5 lg:grid-cols-2"><JsonEditor label="Headers" value={form.headers} onChange={(value) => update("headers", value)} description='JSON object, for example {"X-Workspace":"support"}.'/><JsonEditor label="Query parameters" value={form.query} onChange={(value) => update("query", value)} description='JSON object, for example {"customer":"{{email}}"}.'/></div>
            {!(["GET", "DELETE"] as string[]).includes(form.method) && <JsonEditor label="JSON body template" value={form.body} onChange={(value) => update("body", value)} description='An exact placeholder such as "{{amount}}" preserves its number or boolean type.' />}
          </TabsContent>

          <TabsContent value="authentication" className="mt-0 space-y-5">
            <div className="space-y-2"><Label>Authentication type</Label><select className="h-9 w-full max-w-sm rounded-md border bg-background px-3 text-sm" value={form.authType} onChange={(event) => update("authType", event.target.value as CustomActionAuthType)}><option value="none">No authentication</option><option value="bearer">Bearer token</option><option value="basic">Basic authentication</option><option value="api_key">API key</option></select></div>
            {form.credentialHint && form.authType !== "none" && <div className="rounded-lg border bg-muted/30 p-3 text-sm">A credential is configured ({form.credentialHint}). Leave the fields blank to keep it.</div>}
            {form.authType === "bearer" && <div className="space-y-2"><Label>Bearer token</Label><Input type="password" value={form.token} onChange={(event) => update("token", event.target.value)} placeholder={form.credentialHint ? "Leave blank to keep existing token" : "Token"} /></div>}
            {form.authType === "basic" && <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Username</Label><Input value={form.username} onChange={(event) => update("username", event.target.value)} /></div><div className="space-y-2"><Label>Password</Label><Input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} /></div></div>}
            {form.authType === "api_key" && <div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label>Placement</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.authPlacement} onChange={(event) => update("authPlacement", event.target.value as "header" | "query")}><option value="header">Header</option><option value="query">Query parameter</option></select></div><div className="space-y-2"><Label>Key name</Label><Input value={form.authKeyName} onChange={(event) => update("authKeyName", event.target.value)} /></div><div className="space-y-2"><Label>API key</Label><Input type="password" value={form.apiKey} onChange={(event) => update("apiKey", event.target.value)} /></div></div>}
          </TabsContent>

          <TabsContent value="inputs" className="mt-0"><JsonEditor label="Input schema" value={form.inputSchema} onChange={(value) => update("inputSchema", value)} rows={10} description="Restricted JSON Schema. The root value must be an object." /></TabsContent>

          <TabsContent value="safety" className="mt-0 space-y-5">
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-4"><ShieldAlert className="mt-0.5 h-5 w-5 text-amber-500" /><div><p className="text-sm font-medium">Execution confirmation</p><p className="mt-1 text-xs text-muted-foreground">Console tests run immediately. Runtime requests can require confirmation before execution.</p></div></div>
            <div className="space-y-2"><Label>Require confirmation</Label><select className="h-9 w-full max-w-sm rounded-md border bg-background px-3 text-sm" value={form.confirmation} onChange={(event) => update("confirmation", event.target.value as "never" | "always")}><option value="never">Never</option><option value="always">Before every execution</option></select></div>
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Timeout (ms)</Label><Input type="number" min={1000} max={15000} value={form.timeoutMs} onChange={(event) => update("timeoutMs", Number(event.target.value))} /></div><div className="space-y-2"><Label>Maximum response bytes</Label><Input type="number" min={1024} max={131072} value={form.maxResponseBytes} onChange={(event) => update("maxResponseBytes", Number(event.target.value))} /></div></div>
          </TabsContent>

          <TabsContent value="test" className="mt-0 space-y-5">
            <JsonEditor label="Test input" value={form.testInput} onChange={(value) => update("testInput", value)} description="Save configuration changes before running a test." />
            <Button type="button" variant="outline" onClick={runTest} disabled={test.isPending || save.isPending}><FlaskConical className="mr-2 h-4 w-4" />{test.isPending ? "Running…" : "Run test"}</Button>
            {test.data && <div className={`rounded-lg border p-4 ${test.data.ok ? "border-emerald-500/30" : "border-destructive/30"}`}><div className="flex flex-wrap gap-3 text-sm"><span className="font-semibold">HTTP {test.data.status}</span><span className="text-muted-foreground">{test.data.durationMs} ms</span>{test.data.truncated && <span className="text-amber-500">Response truncated</span>}</div><pre className="mt-3 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{stringify(test.data.body)}</pre></div>}
          </TabsContent>
        </div>
      </Tabs>
      <aside className="space-y-3 lg:sticky lg:top-5">
        <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="border-b bg-muted/20 px-4 py-3"><h2 className="text-sm font-semibold">Configuration</h2></div>
          <div className="divide-y px-4">
            <div className="flex items-center justify-between gap-3 py-3"><span className="text-xs text-muted-foreground">Status</span><span className="flex items-center gap-1.5 text-xs"><span className={`h-2 w-2 rounded-full ${form.enabled ? "bg-emerald-500" : "bg-muted-foreground/35"}`} />{form.enabled ? "Enabled" : "Disabled"}</span></div>
            <div className="py-3"><p className="text-xs text-muted-foreground">Action slug</p><p className="mt-1 truncate font-mono text-xs">{form.slug || "your_action_slug"}</p></div>
            <div className="py-3"><p className="text-xs text-muted-foreground">Request</p><div className="mt-1 flex items-center gap-2"><span className="font-mono text-xs font-medium">{form.method}</span><Globe2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate text-xs">{form.url || "Not configured"}</span></div></div>
            <div className="flex items-center justify-between gap-3 py-3"><span className="text-xs text-muted-foreground">Authentication</span><span className="flex items-center gap-1.5 text-xs capitalize"><KeyRound className="h-3.5 w-3.5 text-muted-foreground" />{form.authType === "none" ? "None" : form.authType.replace("_", " ")}</span></div>
            <div className="flex items-center justify-between gap-3 py-3"><span className="text-xs text-muted-foreground">Confirmation</span><span className="text-xs">{form.confirmation === "always" ? "Required" : "Not required"}</span></div>
            <div className="flex items-center justify-between gap-3 py-3"><span className="text-xs text-muted-foreground">Timeout</span><span className="text-xs">{form.timeoutMs / 1000}s</span></div>
          </div>
        </section>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs font-medium">Template variables</p><p className="mt-1.5 text-xs leading-5 text-muted-foreground">Use <code className="rounded bg-muted px-1 py-0.5">{"{{fieldName}}"}</code> in request fields. Values are read from the input schema.</p></div>
      </aside>
      </div>
    </form>
  );
}
