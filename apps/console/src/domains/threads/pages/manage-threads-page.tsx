import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  ImagePlus,
  Inbox,
  LayoutDashboard,
  LockKeyhole,
  MessageSquare,
  MessagesSquare,
  Palette,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { storageApi } from "@/shared/lib/storage.api";
import { useManageThreads, useUpdateManageThreads } from "../hooks";
import type {
  ManageThreadsSection as Section,
  Thread,
  ThreadDnsRecord as DnsRecord,
  ThreadDomain as Domain,
  ThreadManagement as Management,
  ThreadProgress,
  ThreadSettings as Settings,
} from "../types/types";
const sections = [
  ["overview", "Overview", LayoutDashboard],
  ["discussions", "Discussions", MessageSquare],
  ["moderation", "Moderation", ShieldCheck],
  ["branding", "Branding", Palette],
  ["domains", "Domains", Globe2],
  ["settings", "Settings", Settings2],
] as const;
const labels = {
  support: "Private support",
  discussion: "Discussion",
  feature: "Feature request",
};

export function ManageThreads() {
  const token = localStorage.getItem("token") || "";
  const [params, setParams] = useSearchParams();
  const requested = params.get("section") as Section | null;
  const active: Section = sections.some(([key]) => key === requested)
    ? requested!
    : "overview";
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState("");
  const [draft, setDraft] = useState<Settings | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const data = useManageThreads(token, {
    section: active,
    page,
    search,
    category,
    status,
    visibility,
  });
  const edit = useUpdateManageThreads(token);
  const portal = data.data;
  const settings =
    draft ??
    (portal && {
      enabled: portal.enabled,
      aiEnabled: portal.aiEnabled,
      title: portal.title,
      logoUrl: portal.logoUrl,
      logoKey: portal.logoKey,
      accent: portal.accent,
    });
  const change = (patch: Partial<Settings>) =>
    settings && setDraft({ ...settings, ...patch });
  const section = (value: Section) => {
    setPage(0);
    setSearch("");
    setCategory("");
    setStatus("");
    setVisibility("");
    setParams(value === "overview" ? {} : { section: value });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (settings) {
      edit.mutate(
        { path: "", body: settings },
        {
          onSuccess: () => {
            setDraft(null);
            toast.success("Threads settings saved");
          },
        },
      );
    }
  };
  async function copy(value: string, label = "Copied") {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(label);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }
  async function uploadLogo(file?: File) {
    if (!file) return;
    if (!file.type.match(/^image\/(png|jpeg)$/) || file.size > 2_000_000) {
      toast.error("Choose a PNG or JPEG smaller than 2 MB");
      return;
    }
    setUploading(true);
    try {
      const uploaded = await storageApi.generatePresignedUploadUrl(
        file.name,
        file.type,
        900,
      );
      await storageApi.uploadFileWithPresignedUrl(
        uploaded.data.uploadUrl,
        file,
      );
      change({
        logoKey: uploaded.data.fileKey,
        logoUrl: storageApi.getProxyFileUrl(uploaded.data.fileKey),
      });
      toast.success("Logo uploaded. Save branding to publish it.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Logo upload failed",
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <MessagesSquare className="size-3.5" /> Customer experience
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">Threads</h1>
              {portal && <PortalState enabled={portal.enabled} />}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Support conversations, community discussions, and product
              feedback.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/dashboard/conversations/inbox/open?channel=threads">
                <Inbox /> Open inbox
              </Link>
            </Button>
            {portal?.enabled && (
              <Button asChild>
                <a href={portal.hostedUrl} target="_blank" rel="noreferrer">
                  View portal <ArrowUpRight />
                </a>
              </Button>
            )}
          </div>
        </header>
        <nav
          aria-label="Threads workspace"
          className="flex gap-1 overflow-x-auto border-b py-2"
        >
          {sections.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              aria-current={active === key ? "page" : undefined}
              onClick={() => section(key)}
              className={
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors " +
                (active === key
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
              }
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </nav>
        {(data.error || edit.error) && (
          <div
            role="alert"
            className="mt-5 flex gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {(data.error || edit.error)?.message}
          </div>
        )}
        {data.isPending && <WorkspaceSkeleton />}
        {portal && settings && (
          <main className="py-6">
            {active === "overview" && (
              <Overview portal={portal} navigate={section} copy={copy} />
            )}
            {(active === "discussions" || active === "moderation") && (
              <ThreadTable
                mode={active}
                portal={portal}
                page={page}
                search={search}
                category={category}
                status={status}
                visibility={visibility}
                busy={edit.isPending}
                setPage={setPage}
                setSearch={(v) => {
                  setPage(0);
                  setSearch(v);
                }}
                setCategory={(v) => {
                  setPage(0);
                  setCategory(v);
                }}
                setStatus={(v) => {
                  setPage(0);
                  setStatus(v);
                }}
                setVisibility={(v) => {
                  setPage(0);
                  setVisibility(v);
                }}
                update={(thread, body) =>
                  edit.mutate(
                    { path: "/" + thread.id, body },
                    { onSuccess: () => toast.success("Thread updated") },
                  )
                }
              />
            )}
            {active === "branding" && (
              <section>
                <SectionHeader
                  title="Branding"
                  description="Shape the customer portal while keeping the InteraOne interface clear and accessible."
                />
                <form
                  onSubmit={submit}
                  className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]"
                >
                  <div className="border bg-card">
                    <FormSection
                      title="Portal identity"
                      description="Shown in the portal header and welcome area."
                    >
                      <Field
                        label="Portal heading"
                        hint="A short welcome message for customers."
                      >
                        <Input
                          maxLength={80}
                          placeholder="Support & community"
                          value={settings.title}
                          onChange={(e) => change({ title: e.target.value })}
                        />
                      </Field>
                      <div>
                        <p className="text-sm font-medium">Portal logo</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          PNG or JPEG, up to 2 MB.
                        </p>
                        <div className="mt-3 flex items-center gap-4 border bg-muted/20 p-4">
                          <div className="grid size-16 shrink-0 place-items-center overflow-hidden border bg-background">
                            {settings.logoUrl || portal.organizationLogoUrl ? (
                              <img
                                src={
                                  settings.logoUrl || portal.organizationLogoUrl
                                }
                                alt="Portal logo preview"
                                className="size-full object-contain"
                              />
                            ) : (
                              <ImagePlus className="size-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <input
                              ref={fileRef}
                              className="hidden"
                              type="file"
                              accept="image/png,image/jpeg"
                              onChange={(e) =>
                                void uploadLogo(e.target.files?.[0])
                              }
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={uploading}
                              onClick={() => fileRef.current?.click()}
                            >
                              <ImagePlus />{" "}
                              {uploading ? "Uploading…" : "Upload logo"}
                            </Button>
                            {settings.logoUrl && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  change({ logoUrl: "", logoKey: "" })
                                }
                              >
                                Remove
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </FormSection>
                    <FormSection
                      title="Accent"
                      description="Used for key portal actions and selected states."
                    >
                      <Field
                        label="Accent color"
                        hint="Use a color with enough contrast against white text."
                      >
                        <div className="flex items-center gap-3">
                          <input
                            aria-label="Accent color"
                            className="size-10 cursor-pointer border bg-background p-1"
                            type="color"
                            value={settings.accent}
                            onChange={(e) => change({ accent: e.target.value })}
                          />
                          <Input
                            className="max-w-36 font-mono"
                            value={settings.accent}
                            onChange={(e) => change({ accent: e.target.value })}
                          />
                        </div>
                      </Field>
                    </FormSection>
                    <div className="flex items-center justify-end gap-3 border-t px-5 py-4">
                      {draft && (
                        <span className="text-xs text-muted-foreground">
                          Unsaved changes
                        </span>
                      )}
                      <Button disabled={!draft || edit.isPending}>
                        {edit.isPending ? "Saving…" : "Save branding"}
                      </Button>
                    </div>
                  </div>
                  <PortalPreview portal={portal} settings={settings} />
                </form>
              </section>
            )}
            {active === "domains" && (
              <Domains
                portal={portal}
                value={domainInput}
                setValue={setDomainInput}
                busy={edit.isPending}
                copy={copy}
                add={() =>
                  edit.mutate(
                    {
                      path: "/domains",
                      method: "POST",
                      body: { hostname: domainInput },
                    },
                    {
                      onSuccess: () => {
                        setDomainInput("");
                        toast.success(
                          "Domain added. Add the DNS records to continue.",
                        );
                      },
                    },
                  )
                }
                verify={(id) =>
                  edit.mutate(
                    { path: `/domains/${id}/verify`, method: "POST" },
                    { onSuccess: () => toast.success("Domain check complete") },
                  )
                }
                remove={(id) =>
                  edit.mutate(
                    { path: `/domains/${id}`, method: "DELETE" },
                    { onSuccess: () => toast.success("Domain removed") },
                  )
                }
              />
            )}
            {active === "settings" && (
              <section>
                <SectionHeader
                  title="Settings"
                  description="Control portal availability and the support handoff experience."
                />
                <form onSubmit={submit} className="max-w-3xl border bg-card">
                  {!portal.emailAvailable && (
                    <Notice
                      title="Customer sign-in is unavailable"
                      description="Configure platform email before customers can receive sign-in codes."
                    />
                  )}
                  <Toggle
                    checked={settings.enabled}
                    onChange={(enabled) => change({ enabled })}
                    title="Publish customer portal"
                    description="Make the hosted URL and verified custom domains available to customers."
                    icon={Globe2}
                  />
                  <Toggle
                    checked={settings.aiEnabled}
                    onChange={(aiEnabled) => change({ aiEnabled })}
                    title="AI-first private support"
                    description="Let the AI assistant respond first and preserve context when a teammate takes over."
                    icon={Bot}
                  />
                  <div className="flex items-center justify-between gap-4 border-t px-5 py-4">
                    <p className="text-xs text-muted-foreground">
                      Changes apply immediately.
                    </p>
                    <Button disabled={!draft || edit.isPending}>
                      {edit.isPending ? "Saving…" : "Save settings"}
                    </Button>
                  </div>
                </form>
              </section>
            )}
          </main>
        )}
      </div>
    </div>
  );
}

function Overview({
  portal,
  navigate,
  copy,
}: {
  portal: Management;
  navigate: (s: Section) => void;
  copy: (v: string, l?: string) => Promise<void>;
}) {
  const issues = [
    portal.overview.escalations > 0 && [
      `${portal.overview.escalations} support requests need attention`,
      "Open inbox",
      "inbox",
    ],
    portal.overview.hidden > 0 && [
      `${portal.overview.hidden} community posts are hidden`,
      "Review moderation",
      "moderation",
    ],
    !portal.enabled && ["Portal is unpublished", "Open settings", "settings"],
    !portal.emailAvailable && [
      "Customer email sign-in needs setup",
      "Review settings",
      "settings",
    ],
  ].filter(Boolean) as string[][];
  return (
    <section>
      <SectionHeader
        title="Overview"
        description="Live activity and the work that needs attention across your Threads workspace."
      />
      <div className="grid border sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={MessageSquare}
          label="Open threads"
          value={portal.overview.open}
          detail={`${portal.overview.total} total`}
        />
        <Metric
          icon={LockKeyhole}
          label="Unresolved support"
          value={portal.overview.openSupport}
          detail={`${portal.overview.resolved} resolved`}
        />
        <Metric
          icon={UsersRound}
          label="Community activity"
          value={portal.overview.communityActivity}
          detail="Published posts"
        />
        <Metric
          icon={Sparkles}
          label="Feature votes"
          value={portal.overview.featureVotes}
          detail="Across all requests"
        />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="border bg-card">
          <PanelHeader
            title="Recent activity"
            subtitle="Latest customer and community conversations."
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate("discussions")}
              >
                View all <ArrowRight />
              </Button>
            }
          />
          <div className="divide-y">
            {portal.recentThreads.map((t) => (
              <ThreadRow key={t.id} thread={t} />
            ))}
            {!portal.recentThreads.length && (
              <Empty
                icon={MessageSquare}
                title="No activity yet"
                text="New support requests and discussions will appear here."
              />
            )}
          </div>
        </div>
        <div className="border bg-card">
          <PanelHeader
            title="Needs attention"
            subtitle="Recommended next actions."
          />
          {issues.length ? (
            <div className="divide-y">
              {issues.map(([title, action, target]) => (
                <div key={title} className="flex gap-3 p-4">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    {target === "inbox" ? (
                      <Button
                        className="mt-1 h-auto p-0"
                        variant="link"
                        asChild
                      >
                        <Link to="/dashboard/conversations/inbox/open?channel=threads">
                          {action} <ArrowRight />
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        className="mt-1 h-auto p-0"
                        variant="link"
                        onClick={() => navigate(target as Section)}
                      >
                        {action} <ArrowRight />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-3 p-5">
              <CheckCircle2 className="mt-0.5 size-4 text-success" />
              <div>
                <p className="text-sm font-medium">
                  Everything is in good shape
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No setup or moderation issues require action.
                </p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 border-t bg-muted/20">
            <SmallMetric
              label="AI escalations"
              value={portal.overview.escalations}
            />
            <SmallMetric label="Resolved" value={portal.overview.resolved} />
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border bg-card p-5">
        <div>
          <p className="text-sm font-medium">Customer portal</p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {portal.hostedUrl}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void copy(portal.hostedUrl, "Portal URL copied")}
          >
            <Copy /> Copy URL
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={portal.hostedUrl} target="_blank" rel="noreferrer">
              Open <ExternalLink />
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}

function ThreadTable(p: {
  mode: "discussions" | "moderation";
  portal: Management;
  page: number;
  search: string;
  category: string;
  status: string;
  visibility: string;
  busy: boolean;
  setPage: (v: number) => void;
  setSearch: (v: string) => void;
  setCategory: (v: string) => void;
  setStatus: (v: string) => void;
  setVisibility: (v: string) => void;
  update: (
    t: Thread,
    b: { public?: boolean; status?: string; progress?: ThreadProgress },
  ) => void;
}) {
  const start = p.portal.resultCount ? p.page * 30 + 1 : 0,
    end = Math.min((p.page + 1) * 30, p.portal.resultCount);
  return (
    <section>
      <SectionHeader
        title={p.mode === "discussions" ? "Discussions" : "Moderation"}
        description={
          p.mode === "discussions"
            ? "Search, filter, and manage every support and community thread."
            : "Review public visibility for discussions and feature requests."
        }
        action={
          <Button size="sm" variant="outline" asChild>
            <Link to="/dashboard/conversations/inbox/open?channel=threads">
              <Inbox /> Open inbox
            </Link>
          </Button>
        }
      />
      {p.mode === "moderation" && (
        <div className="mb-4 grid border sm:grid-cols-3">
          <SmallMetric
            label="Published"
            value={p.portal.overview.communityActivity}
          />
          <SmallMetric label="Hidden" value={p.portal.overview.hidden} />
          <SmallMetric
            label="Feature votes"
            value={p.portal.overview.featureVotes}
          />
        </div>
      )}
      <div className="border bg-card">
        <div className="flex flex-wrap gap-2 border-b p-3">
          <div className="relative min-w-[240px] flex-1 lg:max-w-md">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-9"
              placeholder="Search by thread title"
              value={p.search}
              onChange={(e) => p.setSearch(e.target.value)}
            />
          </div>
          <Filter label="Category" value={p.category} change={p.setCategory}>
            <option value="">All categories</option>
            {p.mode === "discussions" && (
              <option value="support">Private support</option>
            )}
            <option value="discussion">Discussions</option>
            <option value="feature">Feature requests</option>
          </Filter>
          <Filter label="Status" value={p.status} change={p.setStatus}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </Filter>
          <Filter
            label="Visibility"
            value={p.visibility}
            change={p.setVisibility}
          >
            <option value="">All visibility</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </Filter>
        </div>
        <div className="hidden grid-cols-[minmax(240px,1fr)_130px_105px_130px_105px_120px_110px] gap-4 border-b bg-muted/25 px-4 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
          <span>Thread</span>
          <span>Category</span>
          <span>Status</span>
          <span>Roadmap</span>
          <span>Visibility</span>
          <span>Activity</span>
          <span className="text-right">Action</span>
        </div>
        <div className="divide-y">
          {p.portal.threads.map((t) => (
            <div
              key={t.id}
              className="grid gap-3 px-4 py-4 hover:bg-muted/20 lg:grid-cols-[minmax(240px,1fr)_130px_105px_130px_105px_120px_110px] lg:items-center lg:gap-4"
            >
              <div className="min-w-0">
                <Link
                  className="font-medium hover:text-primary hover:underline"
                  to={`/dashboard/conversations/inbox/chat/${t.id}`}
                >
                  {t.title}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground lg:hidden">
                  {labels[t.category]} ·{" "}
                  {formatDistanceToNow(new Date(t.updatedAt), {
                    addSuffix: true,
                  })}
                </p>
                {t.category === "feature" && (
                  <div className="mt-2 lg:hidden">
                    <FeatureProgressControl
                      thread={t}
                      busy={p.busy}
                      update={p.update}
                    />
                  </div>
                )}
              </div>
              <div className="hidden text-xs text-muted-foreground lg:block">
                {labels[t.category]}
              </div>
              <Status value={t.status} />
              <div className="hidden lg:block">
                {t.category === "feature" ? (
                  <FeatureProgressControl
                    thread={t}
                    busy={p.busy}
                    update={p.update}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              <Visibility value={t.public} />
              <time className="hidden text-xs text-muted-foreground lg:block">
                {formatDistanceToNow(new Date(t.updatedAt), {
                  addSuffix: true,
                })}
              </time>
              <div className="flex justify-end">
                {p.mode === "moderation" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={p.busy}
                    onClick={() => p.update(t, { public: !t.public })}
                  >
                    {t.public ? <EyeOff /> : <Eye />}
                    {t.public ? "Hide" : "Publish"}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={p.busy || t.status === "closed"}
                      onClick={() =>
                        p.update(t, {
                          status: t.status === "open" ? "resolved" : "open",
                        })
                      }
                    >
                      {t.status === "open" ? "Resolve" : "Reopen"}
                    </Button>
                    <Button size="icon-sm" variant="ghost" asChild>
                      <Link
                        aria-label="Open thread"
                        to={`/dashboard/conversations/inbox/chat/${t.id}`}
                      >
                        <ChevronRight />
                      </Link>
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!p.portal.threads.length && (
            <Empty
              icon={p.mode === "moderation" ? ShieldCheck : MessageSquare}
              title="No threads found"
              text={
                p.search || p.category || p.status || p.visibility
                  ? "Try adjusting the search or filters."
                  : "New Threads activity will appear here."
              }
            />
          )}
        </div>
        <div className="flex items-center justify-between border-t px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {p.portal.resultCount
              ? `Showing ${start}–${end} of ${p.portal.resultCount}`
              : "0 results"}
          </p>
          <div className="flex gap-1">
            <Button
              size="icon-sm"
              variant="outline"
              disabled={!p.page}
              onClick={() => p.setPage(p.page - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              disabled={end >= p.portal.resultCount}
              onClick={() => p.setPage(p.page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureProgressControl({
  thread,
  busy,
  update,
}: {
  thread: Thread;
  busy: boolean;
  update: (thread: Thread, body: { progress?: ThreadProgress }) => void;
}) {
  return (
    <select
      aria-label={`Roadmap status for ${thread.title}`}
      className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs font-medium outline-none transition-colors hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/10"
      value={thread.progress || "under_review"}
      disabled={busy}
      onChange={(event) =>
        update(thread, {
          progress: event.target.value as ThreadProgress,
        })
      }
    >
      <option value="under_review">Under review</option>
      <option value="planned">Planned</option>
      <option value="in_progress">In progress</option>
      <option value="shipped">Shipped</option>
    </select>
  );
}

function Domains({
  portal,
  value,
  setValue,
  busy,
  copy,
  add,
  verify,
  remove,
}: {
  portal: Management;
  value: string;
  setValue: (v: string) => void;
  busy: boolean;
  copy: (v: string, l?: string) => Promise<void>;
  add: () => void;
  verify: (id: string) => void;
  remove: (id: string) => void;
}) {
  const activeDomains = portal.domains.filter(
    (domain) => domain.status === "active" && domain.tlsStatus === "active",
  ).length;
  const pendingDomains = portal.domains.length - activeDomains;
  return (
    <section>
      <SectionHeader
        title="Domains"
        description="Manage the addresses customers use to reach your Threads portal."
      />
      <div className="mb-6 grid border sm:grid-cols-3">
        <DomainMetric
          label="Custom domains"
          value={portal.domains.length}
          detail="Connected to this portal"
        />
        <DomainMetric
          label="Active"
          value={activeDomains}
          detail="Serving customer traffic"
        />
        <DomainMetric
          label="Needs setup"
          value={pendingDomains}
          detail="Waiting for DNS or HTTPS"
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {!portal.domainConfiguration.available && (
            <Notice
              title="Portal routing is not configured"
              description="You can verify ownership now. A public portal target is required before activation."
            />
          )}
          {portal.domainConfiguration.tlsMode === "disabled" &&
            portal.domainConfiguration.available && (
              <Notice
                title="HTTPS provisioning is disabled"
                description="DNS can be prepared, but domains cannot become active until TLS is enabled."
              />
            )}
          {portal.domains.map((d) => (
            <div key={d.id} className="border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center border bg-muted/30">
                      <Globe2 className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{d.hostname}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Custom customer portal
                      </p>
                    </div>
                    <DomainState domain={d} />
                  </div>
                </div>
                <div className="flex gap-2">
                  {d.status === "active" && d.url && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={d.url} target="_blank" rel="noreferrer">
                        Open <ExternalLink />
                      </a>
                    </Button>
                  )}
                  {d.status !== "active" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => verify(d.id)}
                    >
                      <RefreshCw /> Check DNS & TLS
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Remove ${d.hostname}`}
                    onClick={() => remove(d.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="grid border-t bg-muted/10 sm:grid-cols-3">
                <DomainStep
                  label="Domain added"
                  complete
                  detail="Saved in InteraOne"
                />
                <DomainStep
                  label="DNS verified"
                  complete={Boolean(
                    d.status !== "pending_dns" && d.status !== "error",
                  )}
                  detail={
                    d.status === "pending_dns"
                      ? "Records required"
                      : "Records detected"
                  }
                />
                <DomainStep
                  label="HTTPS active"
                  complete={d.tlsStatus === "active"}
                  detail={
                    d.tlsStatus === "active"
                      ? "Certificate ready"
                      : d.tlsStatus === "disabled"
                        ? "TLS disabled"
                        : "Waiting for certificate"
                  }
                />
              </div>
              {d.status !== "active" && (
                <div className="border-t p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        Required DNS records
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Add these records with your DNS provider. Changes can
                        take time to propagate.
                      </p>
                    </div>
                    {d.lastCheckedAt && (
                      <span className="text-xs text-muted-foreground">
                        Last checked{" "}
                        {formatDistanceToNow(new Date(d.lastCheckedAt), {
                          addSuffix: true,
                        })}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {(["CNAME", "TXT"] as const).map((type) => {
                      const records = d.dnsRecords.filter(
                        (r) => r.type === type,
                      );
                      return records.length ? (
                        <Dns
                          key={type}
                          type={type}
                          records={records}
                          copy={copy}
                        />
                      ) : null;
                    })}
                  </div>
                  {d.lastError && (
                    <div className="mt-4 flex items-start gap-2 border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
                      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                      <span>{d.lastError}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {!portal.domains.length && (
            <div className="border bg-card">
              <Empty
                icon={Globe2}
                title="No custom domains"
                text="The default InteraOne URL is ready to use."
              />
            </div>
          )}
        </div>
        <aside className="space-y-4 self-start xl:sticky xl:top-24">
          <div className="border bg-card">
            <PanelHeader
              title="Connect a domain"
              subtitle="Use a dedicated subdomain for your portal."
            />
            <form
              className="space-y-3 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <Field label="Domain" hint="Example: support.company.com">
                <Input
                  required
                  placeholder="support.company.com"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </Field>
              <Button className="w-full" disabled={busy || !value.trim()}>
                Add custom domain
              </Button>
            </form>
            <div className="border-t bg-muted/20 px-5 py-4 text-xs leading-5 text-muted-foreground">
              You will receive a TXT record for ownership and a CNAME record for
              routing.
            </div>
          </div>
          <div className="border bg-card">
            <PanelHeader
              title="Default portal URL"
              subtitle="Ready without DNS configuration."
            />
            <div className="p-5">
              <div className="flex items-center justify-between gap-3">
                <PortalState enabled={portal.enabled} />
                <ShieldCheck className="size-4 text-muted-foreground" />
              </div>
              <p className="mt-4 break-all font-mono text-xs leading-5">
                {portal.hostedUrl}
              </p>
              <div className="mt-4 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void copy(portal.hostedUrl, "Portal URL copied")
                  }
                >
                  <Copy /> Copy
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={portal.hostedUrl} target="_blank" rel="noreferrer">
                    Open <ExternalLink />
                  </a>
                </Button>
              </div>
            </div>
          </div>
          <div className="border bg-card p-5">
            <p className="text-sm font-medium">Domain infrastructure</p>
            <dl className="mt-4 space-y-3 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Routing target</dt>
                <dd className="max-w-[190px] truncate font-mono">
                  {portal.domainConfiguration.target || "Unavailable"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">HTTPS mode</dt>
                <dd className="font-medium capitalize">
                  {portal.domainConfiguration.tlsMode.replace("-", " ")}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Deployment</dt>
                <dd className="font-medium capitalize">
                  {portal.domainConfiguration.mode.replace("-", " ")}
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </section>
  );
}

function DomainMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="border-b px-5 py-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function DomainStep({
  label,
  complete,
  detail,
}: {
  label: string;
  complete: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2 border-b px-4 py-3 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0">
      <span
        className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${complete ? "border-success bg-success text-white" : "border-border bg-background"}`}
      >
        {complete && <CheckCircle2 className="size-3" />}
      </span>
      <div>
        <p className="text-xs font-medium">{label}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
function PanelHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof MessageSquare;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="border-b p-5 sm:border-r xl:border-b-0 xl:last:border-r-0">
      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
function SmallMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r px-4 py-3 last:border-r-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
function ThreadRow({ thread }: { thread: Thread }) {
  return (
    <Link
      to={`/dashboard/conversations/inbox/chat/${thread.id}`}
      className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-muted/25"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{thread.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {labels[thread.category]} ·{" "}
          {formatDistanceToNow(new Date(thread.updatedAt), { addSuffix: true })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Status
          value={
            thread.category === "feature"
              ? thread.progress || "under_review"
              : thread.status
          }
        />
        <ChevronRight className="size-4 text-muted-foreground" />
      </div>
    </Link>
  );
}
function Status({ value }: { value: string }) {
  const tone =
    value === "resolved" || value === "shipped"
      ? "border-success/35 text-success"
      : value === "closed"
        ? "border-border text-muted-foreground"
        : value === "under_review"
          ? "border-amber-600/35 text-amber-700 dark:text-amber-300"
          : value === "planned"
            ? "border-violet-600/35 text-violet-700 dark:text-violet-300"
            : value === "in_progress"
              ? "border-sky-600/35 text-sky-700 dark:text-sky-300"
              : "border-primary/30 text-primary";
  const label =
    {
      open: "Open",
      resolved: "Resolved",
      closed: "Closed",
      under_review: "Under review",
      planned: "Planned",
      in_progress: "In progress",
      shipped: "Shipped",
    }[value] || value;
  return (
    <span
      className={`inline-flex items-center rounded-md border bg-transparent px-2 py-1 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}
function Visibility({ value }: { value: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {value ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
      {value ? "Public" : "Private"}
    </span>
  );
}
function PortalState({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs " +
        (enabled
          ? "border-success/30 bg-success/10 text-success"
          : "bg-muted text-muted-foreground")
      }
    >
      <span
        className={
          "size-1.5 rounded-full " +
          (enabled ? "bg-success" : "bg-muted-foreground")
        }
      />
      {enabled ? "Published" : "Unpublished"}
    </span>
  );
}
function DomainState({ domain }: { domain: Domain }) {
  const active = domain.status === "active" && domain.tlsStatus === "active";
  const label = active
    ? "Active"
    : domain.status === "verified"
      ? "DNS verified"
      : domain.status === "provisioning"
        ? "Provisioning"
        : "Awaiting DNS";
  return (
    <span
      className={
        "rounded-full border px-2 py-0.5 text-[11px] " +
        (active
          ? "border-success/30 bg-success/10 text-success"
          : "bg-muted text-muted-foreground")
      }
    >
      {label}
    </span>
  );
}
function Filter({
  label,
  value,
  change,
  children,
}: {
  label: string;
  value: string;
  change: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      aria-label={label}
      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(e) => change(e.target.value)}
    >
      {children}
    </select>
  );
}
function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-5 border-b p-5">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}
function Toggle({
  checked,
  onChange,
  title,
  description,
  icon: Icon,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description: string;
  icon: typeof Globe2;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-4 border-b px-5 py-5 hover:bg-muted/20">
      <span className="grid size-9 shrink-0 place-items-center border bg-muted/30">
        <Icon className="size-4" />
      </span>
      <span className="flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        className="mt-2 size-4 accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function Dns({
  type,
  records,
  copy,
}: {
  type: DnsRecord["type"];
  records: DnsRecord[];
  copy: (v: string, l?: string) => Promise<void>;
}) {
  return (
    <section className="border bg-background">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
        <p className="text-sm font-semibold">{type} record</p>
        <span className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {type}
        </span>
      </div>
      <div className="border-b px-4 py-2.5">
        <p className="text-xs text-muted-foreground">
          {type === "CNAME"
            ? "Routes traffic to your portal."
            : "Verifies domain ownership."}
        </p>
      </div>
      {records.map((r) => (
        <div key={r.name} className="space-y-4 p-4 text-xs">
          <div>
            <p className="mb-1.5 font-medium text-muted-foreground">
              Host / Name
            </p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all leading-5">
                {r.name}
              </code>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Copy ${type} host`}
                onClick={() => void copy(r.name, type + " host copied")}
              >
                <Copy />
              </Button>
            </div>
          </div>
          <div>
            <p className="mb-1.5 font-medium text-muted-foreground">
              Value / Target
            </p>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 break-all leading-5">
                {r.value}
              </code>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Copy ${type} value`}
                onClick={() => void copy(r.value, type + " value copied")}
              >
                <Copy />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
function PortalPreview({
  portal,
  settings,
}: {
  portal: Management;
  settings: Settings;
}) {
  return (
    <aside className="self-start border bg-card">
      <PanelHeader
        title="Portal preview"
        subtitle="Customer-facing experience"
      />
      <div className="border-b px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          {settings.logoUrl || portal.organizationLogoUrl ? (
            <img
              className="size-7 object-contain"
              src={settings.logoUrl || portal.organizationLogoUrl}
              alt=""
            />
          ) : (
            <MessagesSquare className="size-5" />
          )}
          {portal.name}
          <span className="text-muted-foreground">Threads</span>
        </div>
      </div>
      <div className="p-5">
        <span
          className="mb-4 block h-1 w-8"
          style={{ backgroundColor: settings.accent }}
        />
        <p className="text-xl font-semibold">
          {settings.title || "Support & community"}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Get help, join a discussion, or suggest a feature.
        </p>
        <div className="relative mt-5">
          <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <div className="h-9 border pl-9 text-xs leading-9 text-muted-foreground">
            Search threads
          </div>
        </div>
        <button
          type="button"
          className="mt-5 rounded-md px-3 py-2 text-xs font-medium text-white"
          style={{ backgroundColor: settings.accent }}
        >
          New thread
        </button>
      </div>
    </aside>
  );
}
function Notice({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 border border-warning/40 bg-warning/5 p-4">
      <CircleAlert className="mt-0.5 size-4 text-warning" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof MessageSquare;
  title: string;
  text: string;
}) {
  return (
    <div className="grid place-items-center px-5 py-12 text-center">
      <span className="grid size-10 place-items-center border bg-muted/30">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
function WorkspaceSkeleton() {
  return (
    <div className="animate-pulse py-6" role="status">
      <div className="h-6 w-32 bg-muted" />
      <div className="mt-2 h-4 w-72 bg-muted" />
      <div className="mt-6 grid border sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 border-r bg-muted/30" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="h-80 border bg-muted/30" />
        <div className="h-80 border bg-muted/30" />
      </div>
    </div>
  );
}
