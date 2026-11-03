import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  FacebookLogo,
  GoogleCalendarLogo,
  GoogleFormsLogo,
  GoogleTasksLogo,
} from "@/shared/ui/integration-icon";
import { DeleteConfirmDialog } from "@/shared/components/delete-confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  useConnectFacebookLeadAds,
  useConnectGoogleCalendar,
  useConnectGoogleForms,
  useConnectGoogleTasks,
  useDeleteLeadSource,
  useLeadSources,
  useSyncFacebookLeadForms,
  useSyncGoogleCalendars,
  useSyncGoogleTaskLists,
  useUpdateLeadSourceForm,
} from "@/domains/channels/hooks/use-channels";
import type { LeadSourceConnection } from "@/domains/channels/types/types";
import { ComposioIntegrations } from "../components/composio-integrations";

type Provider =
  | "facebook_lead_ads"
  | "google_forms"
  | "google_calendar"
  | "google_tasks";

const providers = [
  {
    id: "facebook_lead_ads" as const,
    name: "Facebook Lead Ads",
    brand: "Meta",
    description:
      "Send instant-form submissions directly into your CRM as qualified contacts.",
    benefit: "Capture leads automatically",
    icon: FacebookLogo,
  },
  {
    id: "google_forms" as const,
    name: "Google Forms",
    brand: "Google Workspace",
    description:
      "Turn every new form response into a structured lead without manual data entry.",
    benefit: "Import responses instantly",
    icon: GoogleFormsLogo,
  },
  {
    id: "google_calendar" as const,
    name: "Google Calendar",
    brand: "Google Workspace",
    description:
      "Connect team calendars and keep meeting availability visible in InteraOne.",
    benefit: "Sync calendars securely",
    icon: GoogleCalendarLogo,
  },
  {
    id: "google_tasks" as const,
    name: "Google Tasks",
    brand: "Google Workspace",
    description:
      "Connect Google Tasks lists so work and follow-ups stay visible in InteraOne.",
    benefit: "Sync task lists securely",
    icon: GoogleTasksLogo,
  },
];

const featuredIntegrations = [
  { slug: "github", name: "GitHub" },
  { slug: "linear", name: "Linear" },
  { slug: "jira", name: "Jira" },
  { slug: "gmail", name: "Gmail" },
  { slug: "slack", name: "Slack" },
  { slug: "googlecalendar", name: "Google Calendar" },
  { slug: "googledrive", name: "Google Drive" },
  { slug: "googlesheets", name: "Google Sheets" },
  { slug: "googledocs", name: "Google Docs" },
  { slug: "notion", name: "Notion" },
  { slug: "hubspot", name: "HubSpot" },
  { slug: "zendesk", name: "Zendesk" },
  { slug: "outlook", name: "Outlook" },
  { slug: "googlemeet", name: "Google Meet" },
  { slug: "zoom", name: "Zoom" },
  { slug: "microsoft_teams", name: "Microsoft Teams" },
  { slug: "airtable", name: "Airtable" },
  { slug: "trello", name: "Trello" },
  { slug: "shopify", name: "Shopify" },
];

function ResultBanner({ success, text }: { success: boolean; text: string }) {
  const Icon = success ? CheckCircle2 : XCircle;
  return (
    <div
      className={`flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm ${
        success
          ? "border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-300"
          : "border-destructive/20 bg-destructive/[0.06] text-destructive"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {text}
    </div>
  );
}

function ConnectedSource({
  source,
  provider,
  syncing,
  updating,
  deleting,
  onSync,
  onDelete,
  onUpdate,
}: {
  source: LeadSourceConnection;
  provider: Provider;
  syncing: boolean;
  updating: boolean;
  deleting: boolean;
  onSync: () => void;
  onDelete: () => void;
  onUpdate: (
    formId: string,
    payload: {
      status?: "active" | "paused";
      defaults?: { createOpportunity: boolean };
    },
  ) => void;
}) {
  const calendars = source.metadata?.calendars || [];
  const taskLists = source.metadata?.taskLists || [];
  const resourceCount =
    provider === "google_calendar"
      ? calendars.length
      : provider === "google_tasks"
        ? taskLists.length
        : source.forms.length;
  const resourceLabel =
    provider === "google_calendar"
      ? "calendar"
      : provider === "google_tasks"
        ? "task list"
        : "form";
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <p className="truncate text-sm font-semibold leading-5">
              {source.name}
            </p>
            <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
              {resourceCount} {resourceLabel}
              {resourceCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2.5 text-xs"
            disabled={syncing}
            onClick={onSync}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
            />
            Sync
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            disabled={deleting}
            onClick={onDelete}
            aria-label={`Disconnect ${source.name}`}
            title="Disconnect account"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="divide-y border-t bg-muted/[0.08]">
        {provider === "google_calendar" && calendars.length ? (
          calendars.map((calendar) => (
            <div
              key={calendar.id}
              className="flex items-center justify-between gap-3 px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: calendar.backgroundColor || "#4285F4",
                    }}
                  />
                  {calendar.summary}
                </p>
                <p className="mt-0.5 pl-4 text-[11px] text-muted-foreground">
                  {calendar.primary ? "Primary calendar" : calendar.accessRole}
                  {calendar.timeZone ? ` · ${calendar.timeZone}` : ""}
                </p>
              </div>
              {calendar.primary && (
                <span className="rounded border bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Primary
                </span>
              )}
            </div>
          ))
        ) : provider === "google_tasks" && taskLists.length ? (
          taskLists.map((taskList) => (
            <div
              key={taskList.id}
              className="flex items-center justify-between gap-3 px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                  {taskList.title}
                </p>
                <p className="mt-0.5 pl-4 text-[11px] text-muted-foreground">
                  Google Tasks list
                  {taskList.updated
                    ? ` · Updated ${new Date(taskList.updated).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
            </div>
          ))
        ) : source.forms.length ? (
          source.forms.map((form) => (
            <div
              key={form.id}
              className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/25 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${form.status === "active" ? "bg-emerald-500" : "bg-amber-500"}`}
                  />
                  {form.externalFormName}
                </p>
                <p className="mt-0.5 pl-3.5 text-[11px] text-muted-foreground">
                  {form.status === "active"
                    ? "Importing responses"
                    : "Import paused"}
                  {form.defaults.createOpportunity ? " · Creates deals" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {provider === "facebook_lead_ads" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-md px-2.5 text-xs"
                    disabled={updating}
                    onClick={() =>
                      onUpdate(form.id, {
                        defaults: {
                          createOpportunity: !form.defaults.createOpportunity,
                        },
                      })
                    }
                  >
                    {form.defaults.createOpportunity
                      ? "Contact + deal"
                      : "Contact only"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 rounded-md px-2.5 text-xs"
                  disabled={updating}
                  onClick={() =>
                    onUpdate(form.id, {
                      status: form.status === "active" ? "paused" : "active",
                    })
                  }
                >
                  {form.status === "active" ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  {form.status === "active" ? "Pause" : "Resume"}
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="px-4 py-7 text-center">
            <p className="text-sm font-medium">Nothing to sync yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              No{" "}
              {provider === "google_calendar"
                ? "calendars"
                : provider === "google_tasks"
                  ? "task lists"
                  : "forms"}{" "}
              found for this connection.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export function IntegrationsPage() {
  const { data: leadSources = [] } = useLeadSources();
  const connectFacebook = useConnectFacebookLeadAds();
  const connectGoogle = useConnectGoogleForms();
  const connectGoogleCalendar = useConnectGoogleCalendar();
  const connectGoogleTasks = useConnectGoogleTasks();
  const syncForms = useSyncFacebookLeadForms();
  const syncCalendars = useSyncGoogleCalendars();
  const syncTaskLists = useSyncGoogleTaskLists();
  const updateForm = useUpdateLeadSourceForm();
  const deleteSource = useDeleteLeadSource();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"all" | "data" | "ai">("all");
  const [sourceToDelete, setSourceToDelete] =
    useState<LeadSourceConnection | null>(null);
  const [activeProvider, setActiveProvider] = useState<Provider | null>(null);

  const params = new URLSearchParams(window.location.search);
  const facebookResult = params.get("facebook");
  const googleResult = params.get("google");
  const googleCalendarResult = params.get("googleCalendar");
  const googleTasksResult = params.get("googleTasks");
  const oauthError = params.get("message");
  const shownProviders = useMemo(() => {
    const search = query.trim().toLowerCase();
    return search
      ? providers.filter((item) =>
          `${item.name} ${item.brand} ${item.description}`
            .toLowerCase()
            .includes(search),
        )
      : providers;
  }, [query]);
  const connectedCount = new Set(leadSources.map((source) => source.provider))
    .size;

  const connect = (provider: Provider) => {
    if (provider === "facebook_lead_ads") return connectFacebook.mutate();
    if (provider === "google_forms") return connectGoogle.mutate();
    if (provider === "google_calendar") return connectGoogleCalendar.mutate();
    return connectGoogleTasks.mutate();
  };
  const isConnecting = (provider: Provider) => {
    if (provider === "facebook_lead_ads") return connectFacebook.isPending;
    if (provider === "google_forms") return connectGoogle.isPending;
    if (provider === "google_calendar") return connectGoogleCalendar.isPending;
    return connectGoogleTasks.isPending;
  };
  const connectionError = (provider: Provider) => {
    if (provider === "facebook_lead_ads") return connectFacebook.error;
    if (provider === "google_forms") return connectGoogle.error;
    if (provider === "google_calendar") return connectGoogleCalendar.error;
    return connectGoogleTasks.error;
  };
  const selectedProvider = providers.find(
    (provider) => provider.id === activeProvider,
  );
  const selectedSources = activeProvider
    ? leadSources.filter((source) => source.provider === activeProvider)
    : [];
  const SelectedProviderIcon = selectedProvider?.icon;
  const selectedResourceName =
    activeProvider === "google_calendar"
      ? "calendars"
      : activeProvider === "google_tasks"
        ? "task lists"
        : "forms";
  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <section className="space-y-5" data-tour-id="page-integrations-heading">
        <div className="relative isolate overflow-hidden px-4 py-8 sm:py-12">
          <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-72 w-[44rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.09] blur-3xl" />
          <div className="pointer-events-none absolute left-[18%] top-24 -z-10 h-40 w-40 rounded-full bg-violet-400/10 blur-3xl" />
          <div className="pointer-events-none absolute bottom-16 right-[18%] -z-10 h-40 w-40 rounded-full bg-sky-400/10 blur-3xl" />

          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary/[0.08] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Integration marketplace
            </div>
            <h1 className="text-3xl font-bold tracking-[-0.035em] sm:text-5xl">
              Connect every tool your team loves.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Bring your workspace together and let InteraOne safely turn
              everyday apps into one connected AI workflow.
            </p>

            <div className="relative mt-8 w-full py-5">
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-36 w-[85%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-background/80 blur-2xl" />
              <p className="relative z-10 mb-5 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Works with your favorite tools
              </p>
              <div className="relative z-10 mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-3">
                {featuredIntegrations.map((integration, index) => (
                  <div
                    key={integration.slug}
                    title={integration.name}
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-background/80 p-2.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.45)] ring-1 ring-border/40 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg ${index % 4 === 1 ? "sm:-translate-y-1" : index % 4 === 3 ? "sm:translate-y-1" : ""}`}
                  >
                    <img
                      src={`/integration-logos/${integration.slug}.png`}
                      alt={integration.name}
                      className="h-7 w-7 object-contain drop-shadow-sm"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 w-full max-w-2xl">
              <div className="mb-2 flex items-center justify-between px-1 text-xs">
                <span className="font-medium">Find an integration</span>
                <span className="text-muted-foreground">
                  {connectedCount} direct connections
                </span>
              </div>
              <label className="relative block w-full">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search thousands of integrations..."
                  className="h-12 w-full rounded-2xl border border-border/70 bg-background/85 pl-11 pr-4 text-sm shadow-[0_12px_35px_-18px_rgba(0,0,0,0.45)] outline-none backdrop-blur-xl transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 pb-4">
          {(
            [
              { id: "all", label: "All integrations" },
              { id: "data", label: "Data & lead sync" },
              { id: "ai", label: "AI action apps" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${view === item.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {facebookResult === "connected" && (
          <ResultBanner
            success
            text="Facebook Lead Ads connected successfully."
          />
        )}
        {facebookResult === "error" && (
          <ResultBanner
            success={false}
            text={`Facebook could not be connected.${oauthError ? ` ${oauthError}` : ""}`}
          />
        )}
        {googleResult === "connected" && (
          <ResultBanner success text="Google Forms connected successfully." />
        )}
        {googleResult === "error" && (
          <ResultBanner
            success={false}
            text={`Google Forms could not be connected.${oauthError ? ` ${oauthError}` : ""}`}
          />
        )}
        {googleCalendarResult === "connected" && (
          <ResultBanner
            success
            text="Google Calendar connected successfully."
          />
        )}
        {googleCalendarResult === "error" && (
          <ResultBanner
            success={false}
            text={`Google Calendar could not be connected.${oauthError ? ` ${oauthError}` : ""}`}
          />
        )}
        {googleTasksResult === "connected" && (
          <ResultBanner success text="Google Tasks connected successfully." />
        )}
        {googleTasksResult === "error" && (
          <ResultBanner
            success={false}
            text={`Google Tasks could not be connected.${oauthError ? ` ${oauthError}` : ""}`}
          />
        )}

        {view !== "ai" && (shownProviders.length > 0 || view === "data") && (
          <div className="space-y-4 pt-2">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="font-semibold tracking-tight">
                  Native connections
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Direct provider connections managed by InteraOne for syncing
                  leads, calendars, and tasks.
                </p>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Native connections
              </span>
            </div>
            {shownProviders.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {shownProviders.map((provider) => {
                  const sources = leadSources.filter(
                    (source) => source.provider === provider.id,
                  );
                  const connected = sources.length > 0;
                  const pending = isConnecting(provider.id);
                  const error = connectionError(provider.id);
                  const Icon = provider.icon;
                  return (
                    <article
                      key={provider.id}
                      data-tour-id={`page-integrations-${
                        provider.id === "facebook_lead_ads"
                          ? "facebook"
                          : "google-forms"
                      }`}
                      className={`group overflow-hidden rounded-xl border bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${connected ? "border-emerald-500/25" : "border-border/70 hover:border-primary/30"}`}
                    >
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border/60 bg-background p-2 shadow-xs">
                            <Icon className="h-full w-full" />
                          </div>
                          <div
                            className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${connected ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground/35"}`}
                            />
                            <span>
                              {connected ? "Connected" : "Not connected"}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3.5">
                          <p className="text-[11px] font-medium text-muted-foreground">
                            {provider.brand}
                          </p>
                          <h3 className="mt-0.5 text-sm font-semibold tracking-tight">
                            {provider.name}
                          </h3>
                          <p className="mt-1.5 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">
                            {provider.description}
                          </p>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
                          <span className="truncate text-[11px] text-muted-foreground">
                            {sources.length
                              ? `${sources.length} account${sources.length === 1 ? "" : "s"}`
                              : provider.benefit}
                          </span>
                          <Button
                            size="sm"
                            className="min-w-20 gap-1.5"
                            variant={connected ? "outline" : "default"}
                            disabled={pending}
                            onClick={() =>
                              connected
                                ? setActiveProvider(provider.id)
                                : connect(provider.id)
                            }
                          >
                            {pending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Settings2 className="h-3.5 w-3.5" />
                            )}
                            {connected ? "Manage" : "Connect"}
                          </Button>
                        </div>
                        {error && (
                          <p className="mt-3 text-xs font-medium text-destructive">
                            {error instanceof Error
                              ? error.message
                              : `Could not connect ${provider.name}`}
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed bg-muted/20 px-6 py-12 text-center">
                <Search className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-3 font-medium">No integrations found</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try a different app or provider name.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {view !== "data" && <ComposioIntegrations query={query} />}

      <Dialog
        open={Boolean(activeProvider)}
        onOpenChange={(open) => !open && setActiveProvider(null)}
      >
        <DialogContent className="max-h-[88vh] overflow-hidden rounded-xl p-0 sm:max-w-2xl">
          {activeProvider && selectedProvider && SelectedProviderIcon && (
            <>
              <DialogHeader className="border-b px-6 py-5 pr-12 text-left">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-card p-1.5 shadow-sm">
                    <SelectedProviderIcon className="h-full w-full" />
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="text-base">
                      {selectedProvider.name}
                    </DialogTitle>
                    <DialogDescription className="mt-1 text-xs sm:text-sm">
                      Manage connected accounts and synced{" "}
                      {selectedResourceName}.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="max-h-[60vh] space-y-3 overflow-y-auto bg-muted/[0.16] px-6 py-5">
                {selectedSources.map((source) => (
                  <ConnectedSource
                    key={source.id}
                    source={source}
                    provider={activeProvider}
                    syncing={
                      activeProvider === "google_calendar"
                        ? syncCalendars.isPending
                        : activeProvider === "google_tasks"
                          ? syncTaskLists.isPending
                          : syncForms.isPending
                    }
                    updating={updateForm.isPending}
                    deleting={deleteSource.isPending}
                    onSync={() =>
                      activeProvider === "google_calendar"
                        ? syncCalendars.mutate(source.id)
                        : activeProvider === "google_tasks"
                          ? syncTaskLists.mutate(source.id)
                          : syncForms.mutate(source.id)
                    }
                    onDelete={() => setSourceToDelete(source)}
                    onUpdate={(formId, payload) =>
                      updateForm.mutate({ formId, payload })
                    }
                  />
                ))}
              </div>
              <div className="flex items-center justify-between gap-3 border-t bg-background px-6 py-4">
                <div>
                  <p className="text-sm font-medium">
                    {selectedSources.length} connected account
                    {selectedSources.length === 1 ? "" : "s"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Accounts sync independently.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-2"
                  disabled={isConnecting(activeProvider)}
                  onClick={() => connect(activeProvider)}
                >
                  {isConnecting(activeProvider) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add account
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        isOpen={Boolean(sourceToDelete)}
        onClose={() => setSourceToDelete(null)}
        onConfirm={() => {
          if (!sourceToDelete) return;
          deleteSource.mutate(sourceToDelete.id, {
            onSuccess: () => setSourceToDelete(null),
          });
        }}
        title="Disconnect integration?"
        description={`Disconnect “${sourceToDelete?.name || "this integration"}”? New responses will stop importing until it is connected again.`}
        isDeleting={deleteSource.isPending}
      />
    </div>
  );
}
