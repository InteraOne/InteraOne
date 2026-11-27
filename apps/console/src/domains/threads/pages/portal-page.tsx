import { Composer } from "../components/composer";
import { RichText } from "../components/rich-text";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { DropdownMenu } from "radix-ui";
import {
  ArrowLeft,
  ArrowUp,
  Bell,
  CircleCheckBig,
  LockKeyhole,
  Link2,
  MoreHorizontal,
  Reply as ReplyIcon,
  Sparkles,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { Loader } from "@/shared/ui/loader";
import { cn } from "@/shared/lib/utils";
import { DeleteConfirmDialog } from "@/shared/components/delete-confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { PortalAuthDialog } from "../components/portal-auth-dialog";
import { PortalHeader } from "../components/portal-header";
import { PortalHome } from "../components/portal-home";
import {
  WorkspaceHeading,
  WorkspaceSectionHeading,
} from "../components/workspace-structure";
import { CommandPalette } from "../components/command-palette";
import { NewThreadDialog } from "../components/new-thread-dialog";
import { MessageReactions } from "../components/message-reactions";
import { portalErrorStatus, threadsApi } from "../api/threads.api";
import { threadKeys, useCustomDomainBrand, usePortalQueries } from "../hooks";
import type { PortalView, Thread } from "../types/types";

import { customerThreadPath, portalPath } from "../utils/threads-paths";

const labels = {
  support: "Question",
  discussion: "Discussion",
  feature: "Feature request",
};

const statusLabels: Record<string, string> = {
  open: "Open",
  resolved: "Resolved",
  closed: "Closed",
  under_review: "Under review",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
};

const threadActionClass =
  "inline-flex min-h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] border border-transparent px-[9px] text-[13px] font-bold text-[var(--threads-muted)] hover:bg-[color-mix(in_srgb,var(--threads-primary)_5%,var(--threads-surface))] hover:text-[var(--threads-primary)] focus-visible:outline-2 focus-visible:outline-[var(--threads-primary)] disabled:opacity-50 aria-pressed:bg-[color-mix(in_srgb,var(--threads-primary)_5%,var(--threads-surface))] aria-pressed:text-[var(--threads-primary)]";

function navigateToReply(replyId: string) {
  const target = document.getElementById(`reply-${replyId}`);
  if (!target) {
    toast.error("The original message is not loaded in this view");
    return;
  }

  const hash = `#reply-${encodeURIComponent(replyId)}`;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}${hash}`,
  );
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  target.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "center",
  });
  target.focus({ preventScroll: true });
  target.classList.remove("threads-reply-target");
  window.requestAnimationFrame(() => {
    target.classList.add("threads-reply-target");
    window.setTimeout(
      () => target.classList.remove("threads-reply-target"),
      1800,
    );
  });
}
export function LegacyThreadRedirect() {
  const { slug = "", threadId = "" } = useParams();
  const { search, hash } = useLocation();
  return (
    <Navigate replace to={customerThreadPath(slug, threadId) + search + hash} />
  );
}

export function PortalPage() {
  const { slug = "", threadId } = useParams();
  return <Portal key={slug} slug={slug} threadId={threadId} />;
}
export function CustomDomainPortalPage() {
  const { threadId } = useParams();
  const brand = useCustomDomainBrand();
  if (brand.isLoading) return <PortalLoading />;
  if (!brand.data) return <Navigate replace to="/auth/login" />;
  return (
    <Portal
      key={brand.data.slug}
      slug={brand.data.slug}
      threadId={threadId}
      customDomain
    />
  );
}
function Portal({
  slug,
  threadId,
  customDomain = false,
}: {
  slug: string;
  threadId?: string;
  customDomain?: boolean;
}) {
  const base = customDomain ? "/host" : "/p/" + encodeURIComponent(slug),
    home = customDomain ? "/" : portalPath(slug),
    threadPath = (id: string) =>
      customDomain
        ? `/thread/${encodeURIComponent(id)}`
        : customerThreadPath(slug, id);
  const location = useLocation();
  const [params] = useSearchParams();
  const nav = useNavigate(),
    cache = useQueryClient(),
    storage = "threads.session." + slug;
  const [token, setToken] = useState(
    () => sessionStorage.getItem(storage) || "",
  );
  const [email, setEmail] = useState(""),
    [sent, setSent] = useState(false),
    [auth, setAuth] = useState(false);
  const requestedView = params.get("view");
  const view =
    requestedView === "mine" ||
    requestedView === "upvoted" ||
    requestedView === "following" ||
    requestedView === "feature" ||
    requestedView === "updates"
      ? requestedView
      : "community";
  const requestedCategory = params.get("category") || "";
  const allowedCategories =
    view === "feature"
      ? ["under_review", "planned", "in_progress", "shipped"]
      : view === "community"
        ? ["discussion", "feature"]
        : ["support", "discussion", "feature"];
  const initialCategory = allowedCategories.includes(requestedCategory)
    ? requestedCategory
    : "";
  const [sort, setSort] = useState("latest"),
    [category, setCategory] = useState(initialCategory),
    [q, setQ] = useState(""),
    [page, setPage] = useState(0),
    [compose, setCompose] = useState(false),
    [commandOpen, setCommandOpen] = useState(false);
  const [composeAfterSignIn, setComposeAfterSignIn] = useState(false);
  const [votingId, setVotingId] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingReply, setEditingReply] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const [deletingReply, setDeletingReply] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ id: string; before: string } | null>(
    null,
  );
  const [replyTo, setReplyTo] = useState<{
    id: string;
    author: string;
    text: string;
  } | null>(null);
  const before = history?.id === threadId ? history?.before : "";
  const {
    brand: org,
    list,
    myThreads,
    updates,
    detail,
  } = usePortalQueries({
    slug,
    base,
    token,
    threadId,
    before,
    view,
    query: q,
    page,
    sort,
    category,
  });
  const d = threadId && !detail.error ? detail.data : undefined;
  const detailOrigin = (location.state as { from?: string } | null)?.from || "";
  const detailOriginView =
    detailOrigin.includes("view=mine") ||
    detailOrigin.includes("view=upvoted") ||
    detailOrigin.includes("view=following")
      ? "mine"
      : detailOrigin.includes("view=feature") || d?.category === "feature"
        ? "feature"
        : d?.category === "support"
          ? "mine"
          : "community";
  const displayStatus = d
    ? d.category === "feature"
      ? d.progress || "under_review"
      : d.status
    : "open";
  const opening = d?.opening ?? d?.messages[0];
  const replies =
    d?.messages.filter((message) => message.id !== opening?.id) ?? [];
  const visibleThreads = (list.data ?? []).filter((thread) => {
    if (view === "community" && thread.category === "support") return false;
    if (view === "feature" && category) return thread.progress === category;
    return true;
  });
  useEffect(() => {
    const openCommand = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches(
        "input, textarea, select, [contenteditable=true]",
      );
      if (
        (event.key === "/" && !typing) ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
      ) {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", openCommand);
    return () => window.removeEventListener("keydown", openCommand);
  }, []);
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      await cache.invalidateQueries({ queryKey: threadKeys.portal(slug) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  function updateSession(value: string) {
    cache.removeQueries({ queryKey: threadKeys.portal(slug) });
    sessionStorage[value ? "setItem" : "removeItem"](storage, value);
    setToken(value);
    setSent(false);
    setAuth(false);
    setCompose(Boolean(value && composeAfterSignIn && !threadId));
    setComposeAfterSignIn(false);
  }
  function switchView(v: string) {
    setCompose(false);
    setPage(0);
    setCategory("");
    setSort("latest");
    setError("");
    setHistory(null);
    setReplyTo(null);
    nav(v === "community" ? home : `${home}?view=${v}`);
  }
  function startReply(message: { id: string; author: string; text: string }) {
    setReplyTo(message);
    if (!token) {
      setAuth(true);
      return;
    }
    requestAnimationFrame(() => {
      document
        .getElementById("thread-reply-form")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  function vote(thread: Thread) {
    if (busy) return;
    if (!token) {
      setAuth(true);
      return;
    }
    setVotingId(thread.id);
    void act(async () => {
      try {
        await threadsApi.vote(base, thread.id, token, !thread.voted);
      } finally {
        setVotingId("");
      }
    });
  }
  function toggleReaction(messageId: string, emoji: string, reacted: boolean) {
    if (busy) return;
    if (!token) {
      setAuth(true);
      return;
    }
    if (!d) return;
    void act(async () => {
      await threadsApi.toggleReaction(
        base,
        d.id,
        messageId,
        token,
        emoji,
        reacted,
      );
    });
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    void act(async () => {
      const payload = {
        text: data.get("text"),
        attachments: data.getAll("attachments"),
        ...(threadId && data.get("replyToId")
          ? { replyToId: data.get("replyToId") }
          : {}),
        ...(!threadId
          ? { title: data.get("title"), category: data.get("category") }
          : {}),
      };
      const result = threadId
        ? await threadsApi.createReply(base, threadId, token, payload)
        : await threadsApi.createThread(base, token, payload);
      form.reset();
      setReplyTo(null);
      setCompose(false);
      setHistory(null);
      if (!threadId) {
        const createdCategory = String(data.get("category") || "");
        const destination =
          createdCategory === "support"
            ? home + "?view=mine&category=support"
            : createdCategory === "feature"
              ? home + "?view=feature"
              : home;
        setCategory(createdCategory === "support" ? "support" : "");
        nav(threadPath(result.id), {
          state: { from: destination },
        });
      }
    });
  }
  const unavailable = portalErrorStatus(org.error) === 404;
  const expired = [list.error, detail.error].some(
    (error) => portalErrorStatus(error) === 401,
  );
  const unknownThread = portalErrorStatus(detail.error) === 404;
  const signInForThread = Boolean(threadId && !token && unknownThread);
  const failure =
    error ||
    org.error?.message ||
    (!threadId
      ? list.error?.message
      : unknownThread
        ? undefined
        : detail.error?.message);
  return (
    <main
      className="min-h-screen bg-[var(--threads-surface)] font-sans text-sm text-[var(--threads-text)] [--threads-surface:#fffdfc] [--threads-surface-low:#faf5f5] [--threads-surface-high:#f4e9eb] [--threads-text:#261e22] [--threads-muted:#5e5157] [--threads-border:#e7dcdf] [--threads-success:#447a53] [--threads-primary:var(--threads-accent)] [--threads-action-bg:var(--threads-accent)] dark:[--threads-surface:#191719] dark:[--threads-surface-low:#242124] dark:[--threads-surface-high:#302a2e] dark:[--threads-text:#f5f0f1] dark:[--threads-muted:#c9bec3] dark:[--threads-border:#41383d] dark:[--threads-success:#91c49d] dark:[--threads-primary:color-mix(in_srgb,var(--threads-accent)_42%,white)] [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-[var(--threads-primary)] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-[var(--threads-primary)] [&_select:focus-visible]:outline-2 [&_select:focus-visible]:outline-[var(--threads-primary)] [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-[var(--threads-primary)]"
      style={
        { "--threads-accent": org.data?.accent ?? "#32685b" } as CSSProperties
      }
    >
      <PortalHeader
        brand={org.data}
        home={home}
        view={threadId ? detailOriginView : (view as PortalView)}
        signedIn={Boolean(token)}
        unavailable={unavailable}
        busy={busy}
        myCount={myThreads.data?.length ?? 0}
        updateCount={updates.data?.length ?? 0}
        onHome={() => {
          setCompose(false);
          setHistory(null);
          setError("");
        }}
        onSession={() =>
          token
            ? void act(async () => {
                try {
                  await threadsApi.deleteSession(base, token);
                } finally {
                  updateSession("");
                  if (!threadId) nav(home);
                }
              })
            : setAuth(true)
        }
        onNewThread={() => {
          if (token) setCompose(true);
          else {
            setComposeAfterSignIn(true);
            setAuth(true);
          }
        }}
        onSearch={() => setCommandOpen(true)}
        onViewChange={(nextView) => {
          if (
            !token &&
            (
              ["mine", "upvoted", "following", "updates"] as PortalView[]
            ).includes(nextView)
          ) {
            setAuth(true);
            return;
          }
          switchView(nextView);
        }}
      />
      <PortalAuthDialog
        open={auth && !unavailable}
        organizationName={org.data?.name}
        email={email}
        sent={sent}
        busy={busy}
        onOpenChange={setAuth}
        onEmailChange={(value) => {
          setEmail(value);
          setSent(false);
        }}
        onResetCode={() => setSent(false)}
        onSubmit={(code) =>
          void act(async () => {
            if (sent) {
              const session = await threadsApi.createSession(base, email, code);
              updateSession(session.token);
            } else {
              await threadsApi.sendSignInCode(base, email);
              setSent(true);
            }
          })
        }
      />
      <CommandPalette
        open={commandOpen}
        threads={list.data ?? []}
        onOpenChange={setCommandOpen}
        onThread={(id) =>
          nav(threadPath(id), {
            state: { from: location.pathname + location.search },
          })
        }
        onNewThread={() => {
          if (token) setCompose(true);
          else {
            setComposeAfterSignIn(true);
            setAuth(true);
          }
        }}
        onView={(nextView) => {
          if (
            !token &&
            (
              ["mine", "upvoted", "following", "updates"] as PortalView[]
            ).includes(nextView)
          )
            setAuth(true);
          else switchView(nextView);
        }}
        onSearch={(value) => {
          setQ(value);
          setPage(0);
        }}
      />
      {token && (
        <NewThreadDialog
          key={compose ? "open" : "closed"}
          open={compose}
          busy={busy}
          base={base}
          token={token}
          onOpenChange={setCompose}
          onSubmit={submit}
          onThread={(id) =>
            nav(threadPath(id), {
              state: { from: location.pathname + location.search },
            })
          }
        />
      )}
      <Dialog
        open={Boolean(editingReply)}
        onOpenChange={(open) => {
          if (!open) setEditingReply(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit reply</DialogTitle>
            <DialogDescription>
              Update your message. The reply will be marked as edited.
            </DialogDescription>
          </DialogHeader>
          <form
            id="threads-edit-reply-form"
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!editingReply?.text.trim() || !d) return;
              void act(async () => {
                await threadsApi.updateReply(
                  base,
                  d.id,
                  editingReply.id,
                  token,
                  editingReply.text,
                );
                setEditingReply(null);
              });
            }}
          >
            <Textarea
              autoFocus
              value={editingReply?.text || ""}
              onChange={(event) =>
                setEditingReply((reply) =>
                  reply ? { ...reply, text: event.target.value } : null,
                )
              }
              maxLength={12000}
              className="min-h-36 resize-y"
            />
          </form>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingReply(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              form="threads-edit-reply-form"
              disabled={busy || !editingReply?.text.trim()}
            >
              {busy && <Loader size="sm" />}
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DeleteConfirmDialog
        isOpen={Boolean(deletingReply)}
        onClose={() => {
          if (!busy) setDeletingReply(null);
        }}
        onConfirm={() => {
          if (!deletingReply || !d) return;
          void act(async () => {
            await threadsApi.deleteReply(base, d.id, deletingReply.id, token);
            setDeletingReply(null);
          });
        }}
        title="Delete reply?"
        description="This reply will be removed from the thread. This action cannot be undone."
        isDeleting={busy}
      />
      <div
        className={
          "ml-56 min-h-screen px-7 pb-16 max-[900px]:ml-0 max-[900px]:px-6 max-[900px]:pb-[50px] max-[600px]:px-4 max-[600px]:pb-11"
        }
      >
        {failure && (
          <p role="alert" className="mb-5 rounded-md border p-3 text-sm">
            {failure}
            {expired && (
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  updateSession("");
                  setAuth(true);
                }}
              >
                Sign in again
              </Button>
            )}
          </p>
        )}
        {org.data && !unavailable && (
          <>
            {threadId ? (
              <header className="relative z-1 flex min-h-[52px] items-center justify-between border-b border-[var(--threads-border)] px-0 max-[600px]:min-h-12">
                <div className="flex min-w-0 items-center gap-3 max-md:gap-2">
                  <Button
                    className="border-0 bg-transparent pl-0 text-[13px] text-[var(--threads-muted)] hover:text-[var(--threads-primary)]"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const from = (location.state as { from?: string } | null)
                        ?.from;
                      if (
                        from &&
                        (from === home || from.startsWith(home + "?"))
                      ) {
                        const query = from.includes("?")
                          ? from.slice(from.indexOf("?"))
                          : "";
                        setCategory(
                          new URLSearchParams(query).get("category") || "",
                        );
                        nav(from);
                      } else {
                        setCategory("");
                        nav(home);
                      }
                    }}
                  >
                    <ArrowLeft />{" "}
                    {detailOriginView === "mine"
                      ? "My threads"
                      : detailOriginView === "feature"
                        ? "Featured"
                        : "Community"}
                  </Button>
                </div>
              </header>
            ) : (
              <PortalHome
                threads={!list.error ? visibleThreads : []}
                view={view as PortalView}
                signedIn={Boolean(token)}
                loading={list.isLoading}
                votingId={votingId}
                q={q}
                category={category}
                sort={sort}
                page={page}
                hasNextPage={(list.data?.length ?? 0) === 30}
                currentPath={location.pathname + location.search}
                threadPath={threadPath}
                onSearchChange={(value) => {
                  setQ(value);
                  setPage(0);
                }}
                onCategoryChange={(value) => {
                  setCategory(value);
                  setPage(0);
                  const next = new URLSearchParams(location.search);
                  if (value) next.set("category", value);
                  else next.delete("category");
                  nav(location.pathname + (next.size ? `?${next}` : ""), {
                    replace: true,
                  });
                }}
                onSortChange={(value) => {
                  setSort(value);
                  setPage(0);
                }}
                onPageChange={setPage}
                onVote={vote}
                onViewChange={switchView}
                onNewThread={() => {
                  if (token) setCompose(true);
                  else {
                    setComposeAfterSignIn(true);
                    setAuth(true);
                  }
                }}
              />
            )}
            {threadId && detail.isLoading && <ThreadDetailSkeleton />}
            {unknownThread && (
              <section className="mx-auto mt-4 max-w-3xl rounded-xl border bg-card p-6 sm:p-8">
                <div className="mb-4 grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <LockKeyhole className="size-5" />
                </div>
                <h1 className="text-xl font-semibold">
                  {signInForThread
                    ? "Sign in to open this thread"
                    : "Thread unavailable"}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {signInForThread
                    ? "Use the email address you used to open the request."
                    : "This link may be private or the thread may have been removed."}
                </p>
                {signInForThread && !auth && (
                  <Button className="mt-4" onClick={() => setAuth(true)}>
                    Sign in
                  </Button>
                )}
              </section>
            )}
            {d && (
              <div className="grid grid-cols-[minmax(0,1fr)_240px] items-start gap-x-8 pb-12 text-[var(--threads-text)] max-[1100px]:grid-cols-[minmax(0,1fr)_205px] max-[1100px]:gap-x-6 max-[980px]:block">
                <div className="hidden items-center justify-between pt-4 text-xs font-bold uppercase tracking-[0.07em] text-[var(--threads-muted)] max-[980px]:flex [&_button]:text-[13px] [&_button]:font-bold [&_button]:normal-case [&_button]:tracking-normal [&_button]:text-[var(--threads-primary)]">
                  <span>Conversation</span>
                  <button type="button" onClick={() => setDetailsOpen(true)}>
                    Thread details <span aria-hidden="true">↗</span>
                  </button>
                </div>
                <WorkspaceHeading
                  className="col-start-1 row-start-1 border-b-0 pt-6 pb-0 max-[600px]:pt-4 [&_h1]:max-w-[46ch] [&_h1]:text-[clamp(29px,3vw,38px)] [&_h1]:leading-[1.18] max-[600px]:[&_h1]:text-[28px]"
                  eyebrow={
                    <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold normal-case tracking-normal text-[var(--threads-muted)] [&>span:first-child]:text-[var(--threads-primary)]">
                      <span>{labels[d.category]}</span>
                      <span aria-hidden="true">/</span>
                      <span>
                        {d.public
                          ? "Public conversation"
                          : "Private conversation"}
                      </span>
                      <span aria-hidden="true">/</span>
                      <span
                        className={`inline-flex items-center gap-1.5 ${["resolved", "shipped"].includes(displayStatus) ? "text-[var(--threads-success)]" : "text-[var(--threads-primary)]"}`}
                      >
                        <span className="size-1.5 rounded-full bg-current" />
                        {statusLabels[displayStatus] || displayStatus}
                      </span>
                    </div>
                  }
                  title={d.title}
                  footer={
                    <div className="flex items-center justify-between gap-4 max-[600px]:flex-col max-[600px]:items-start">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-[33px] shrink-0 place-items-center rounded-full bg-[var(--threads-action-bg)] text-[13px] font-bold text-white">
                          {opening?.author.slice(0, 1).toUpperCase() || "?"}
                        </span>
                        <span className="grid min-w-0 gap-0.5">
                          <strong className="truncate text-sm font-bold text-[var(--threads-text)]">
                            {opening?.author || "Member"}
                          </strong>
                          <time
                            className="text-xs text-[var(--threads-muted)]"
                            dateTime={opening?.at}
                          >
                            {opening
                              ? new Date(opening.at).toLocaleDateString(
                                  undefined,
                                  { dateStyle: "medium" },
                                )
                              : "Recently"}
                          </time>
                        </span>
                      </div>
                    </div>
                  }
                />
                <article className="col-start-1 row-start-2 min-w-0">
                  <section
                    id={opening ? `reply-${opening.id}` : undefined}
                    tabIndex={opening ? -1 : undefined}
                    className="border-b border-[var(--threads-border)] pt-4 pb-6 scroll-mt-20 focus:outline-none"
                    aria-label="Original post"
                  >
                    {opening && (
                      <>
                        <div className="max-w-[72ch] text-base leading-[1.65] text-[var(--threads-text)]">
                          <RichText text={opening.text} />
                          <Attachments
                            files={opening.attachments}
                            base={base}
                            threadId={d.id}
                            token={token}
                          />
                        </div>
                        <div className="mt-4 flex flex-wrap items-center justify-start gap-x-4 gap-y-3 [&_[aria-label='Message_reactions']]:mt-0">
                          <MessageReactions
                            reactions={opening.reactions}
                            disabled={busy}
                            onToggle={(emoji, reacted) =>
                              toggleReaction(opening.id, emoji, reacted)
                            }
                          />
                          <div className="flex flex-wrap justify-start gap-2">
                            {d.category === "feature" && d.public && (
                              <button
                                type="button"
                                className={cn(threadActionClass, "text-[var(--threads-primary)]")}
                                aria-pressed={d.voted}
                                disabled={busy || votingId === d.id}
                                aria-label={`${d.voted ? "Remove upvote from" : "Upvote"} ${d.title}`}
                                onClick={() => vote(d)}
                              >
                                <ArrowUp size={15} /> <span>{d.votes}</span>{" "}
                                <span>{d.voted ? "Upvoted" : "Upvote"}</span>
                              </button>
                            )}
                            {opening && d.status === "open" && (
                              <button
                                type="button"
                                className={threadActionClass}
                                onClick={() => startReply(opening)}
                              >
                                <ReplyIcon size={15} /> Reply
                              </button>
                            )}
                            <button
                              type="button"
                              className={threadActionClass}
                              disabled={busy}
                              aria-pressed={!!d.following}
                              onClick={() =>
                                token
                                  ? void act(() =>
                                      threadsApi.follow(
                                        base,
                                        d.id,
                                        token,
                                        !d.following,
                                      ),
                                    )
                                  : setAuth(true)
                              }
                            >
                              <Bell size={15} />{" "}
                              {d.following ? "Following" : "Follow"}
                            </button>
                            <button
                              type="button"
                              className={threadActionClass}
                              onClick={() => {
                                const url = new URL(
                                  threadPath(d.id),
                                  window.location.origin,
                                );
                                void navigator.clipboard
                                  .writeText(url.href)
                                  .then(() =>
                                    toast.success("Thread link copied"),
                                  )
                                  .catch(() =>
                                    toast.error(
                                      "Could not copy the thread link",
                                    ),
                                  );
                              }}
                            >
                              <Link2 size={15} /> Copy link
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </section>
                  <section aria-label="Replies">
                    <WorkspaceSectionHeading
                      className="min-h-[50px] border-b border-[var(--threads-border)] py-2 [&_h2]:text-[15px] [&_button]:text-[13px] [&_button]:font-bold [&_button]:text-[var(--threads-primary)] [&_button:hover]:underline"
                      title={`${d.replyCount ?? 0} ${d.replyCount === 1 ? "reply" : "replies"}`}
                      action={
                        d.more ? (
                          <button
                            type="button"
                            onClick={() =>
                              setHistory({ id: d.id, before: d.messages[0].id })
                            }
                          >
                            Earlier replies
                          </button>
                        ) : before ? (
                          <button
                            type="button"
                            onClick={() => setHistory(null)}
                          >
                            Latest replies
                          </button>
                        ) : undefined
                      }
                    />
                    {!replies.length && (
                      <div className="py-12 text-center">
                        <p className="text-sm font-medium">No replies yet</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Be the first to continue this conversation.
                        </p>
                      </div>
                    )}
                    {replies.map((m) => {
                      const official = m.author
                        .toLowerCase()
                        .includes("support team");
                      return (
                        <section
                          key={m.id}
                          id={`reply-${m.id}`}
                          tabIndex={-1}
                          className="group grid grid-cols-[34px_minmax(0,1fr)] gap-x-3 border-b border-[var(--threads-border)] py-6 scroll-mt-[76px] focus:outline-none [&.threads-reply-target]:outline [&.threads-reply-target]:outline-1 max-[600px]:grid-cols-[30px_minmax(0,1fr)] max-[600px]:gap-x-2 max-[600px]:py-4"
                        >
                          <span
                            className={`col-start-1 row-start-1 row-span-3 grid size-[31px] place-items-center rounded-full text-xs font-semibold max-[600px]:size-7 ${official ? "bg-[var(--threads-action-bg)] text-white" : "bg-[var(--threads-surface-high)] text-[var(--threads-text)]"}`}
                          >
                            {m.author === "AI assistant" ? (
                              <Sparkles className="size-4" />
                            ) : (
                              m.author.slice(0, 1).toUpperCase()
                            )}
                          </span>
                          <header className="col-start-2 row-start-1 flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <strong className="text-sm font-semibold text-[var(--threads-text)]">
                                  {m.author}
                                </strong>
                                {official && (
                                  <span className="rounded-[3px] bg-[color-mix(in_srgb,var(--threads-primary)_9%,var(--threads-surface))] px-1.5 py-0.5 text-xs font-bold text-[var(--threads-primary)]">
                                    Official response
                                  </span>
                                )}
                                {m.author === "AI assistant" && (
                                  <span className="rounded-[3px] bg-[color-mix(in_srgb,var(--threads-primary)_9%,var(--threads-surface))] px-1.5 py-0.5 text-xs font-bold text-[var(--threads-primary)]">
                                    Automated reply
                                  </span>
                                )}
                                {d.acceptedReplyId === m.id && (
                                  <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700">
                                    <CircleCheckBig className="size-3.5" />{" "}
                                    Accepted solution
                                  </span>
                                )}
                              </div>
                              <time
                                dateTime={m.at}
                                className="mt-0.5 block text-xs text-[var(--threads-muted)]"
                              >
                                {formatDistanceToNow(new Date(m.at), {
                                  addSuffix: true,
                                })}
                                {m.edited ? " · Edited" : ""}
                              </time>
                            </div>
                            <DropdownMenu.Root>
                              <DropdownMenu.Trigger asChild>
                                <button
                                  type="button"
                                  aria-label={`Actions for ${m.author}'s reply`}
                                  className="grid size-8 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-teal-600 dark:hover:bg-slate-800"
                                >
                                  <MoreHorizontal className="size-[18px]" />
                                </button>
                              </DropdownMenu.Trigger>
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content
                                  align="end"
                                  sideOffset={5}
                                  className="z-50 min-w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                                >
                                  <DropdownMenu.Item
                                    onSelect={() => {
                                      void navigator.clipboard
                                        .writeText(
                                          `${window.location.origin}${threadPath(d.id)}#reply-${m.id}`,
                                        )
                                        .then(() =>
                                          toast.success("Reply link copied"),
                                        )
                                        .catch(() =>
                                          toast.error(
                                            "Could not copy reply link",
                                          ),
                                        );
                                    }}
                                    className="cursor-pointer rounded px-3 py-2 text-[13px] outline-none hover:bg-slate-50 focus:bg-slate-50 dark:hover:bg-slate-800"
                                  >
                                    Copy link
                                  </DropdownMenu.Item>
                                  {token && m.own && !m.deleted && (
                                    <>
                                      <DropdownMenu.Item
                                        onSelect={() =>
                                          setEditingReply({
                                            id: m.id,
                                            text: m.text,
                                          })
                                        }
                                        className="cursor-pointer rounded px-3 py-2 text-[13px] outline-none hover:bg-slate-50 focus:bg-slate-50 dark:hover:bg-slate-800"
                                      >
                                        Edit reply
                                      </DropdownMenu.Item>
                                      <DropdownMenu.Item
                                        onSelect={() =>
                                          setDeletingReply({
                                            id: m.id,
                                            text: m.text,
                                          })
                                        }
                                        className="cursor-pointer rounded px-3 py-2 text-[13px] text-red-600 outline-none hover:bg-red-50 focus:bg-red-50"
                                      >
                                        Delete reply
                                      </DropdownMenu.Item>
                                    </>
                                  )}
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu.Root>
                          </header>
                          <div className="col-start-2 row-start-2 mt-3 max-w-[72ch] text-base leading-[1.65] text-[var(--threads-text)]">
                            {m.replyTo && (
                              <ReplyReference replyTo={m.replyTo} />
                            )}
                            <RichText text={m.text} />
                            <Attachments
                              files={m.attachments}
                              base={base}
                              threadId={d.id}
                              token={token}
                            />
                          </div>
                          {!m.deleted && (
                            <div className="col-start-2 row-start-3 mt-3 flex flex-wrap items-center gap-4 text-[13px] [&_[aria-label='Message_reactions']]:mt-0">
                              <MessageReactions
                                reactions={m.reactions}
                                disabled={busy}
                                onToggle={(emoji, reacted) =>
                                  toggleReaction(m.id, emoji, reacted)
                                }
                              />
                              {d.status === "open" && (
                                <button
                                  type="button"
                                  onClick={() => startReply(m)}
                                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--threads-muted)] hover:text-[var(--threads-primary)]"
                                >
                                  <ReplyIcon className="size-3.5" /> Reply
                                </button>
                              )}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </section>
                  {token && d.category === "support" && (
                    <div className="flex flex-wrap items-center gap-3 pt-4 text-[13px] text-[var(--threads-muted)] [&_button]:border-[var(--threads-border)] [&_button]:bg-[var(--threads-surface)] [&_button]:text-[var(--threads-primary)] [&_button:hover]:border-[var(--threads-primary)] [&_button:hover]:bg-[var(--threads-surface-low)]">
                      {d.status === "open" && d.humanSupport && (
                        <p className="text-sm text-[var(--threads-muted)]">
                          With the support team
                        </p>
                      )}
                      {d.status === "open" && !d.humanSupport && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await threadsApi.escalate(base, d.id, token);
                            })
                          }
                        >
                          Request a team member
                        </Button>
                      )}
                      {(d.status === "open" || d.status === "resolved") && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await threadsApi.updateStatus(
                                base,
                                d.id,
                                token,
                                d.status === "open" ? "resolved" : "open",
                              );
                            })
                          }
                        >
                          {d.status === "open"
                            ? "Mark as resolved"
                            : "Reopen thread"}
                        </Button>
                      )}
                    </div>
                  )}
                  {d.status === "open" &&
                    (token ? (
                      <form
                        key={d.messages.at(-1)?.id || d.id}
                        id="thread-reply-form"
                        onSubmit={submit}
                        className={`pt-6 ${d.category === "support" ? "mt-0" : "mt-6 border-t border-[var(--threads-border)]"}`}
                      >
                        <div className="mb-4 [&_h2]:text-[15px] [&_h2]:font-bold [&_h2]:text-[var(--threads-text)] [&_p]:mt-[3px] [&_p]:text-[13px] [&_p]:text-[var(--threads-muted)]">
                          <h2>Write a reply</h2>
                          <p>
                            Keep the conversation going with a helpful response.
                          </p>
                        </div>
                        {replyTo && (
                          <div className="threads-reply-context [display:flex] [align-items:flex-start] [gap:10px] [padding:9px_10px] [border-radius:8px] [color:var(--threads-text)] [background:color-mix(_in_srgb,_var(--threads-primary)_6%,_var(--threads-surface)_)] [box-shadow:inset_3px_0_var(--threads-primary)]">
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left hover:text-[var(--threads-primary)]"
                              onClick={() => navigateToReply(replyTo.id)}
                            >
                              <p className="text-xs font-semibold">
                                Replying to {replyTo.author}
                              </p>
                              <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                                {replyTo.text}
                              </p>
                            </button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label="Cancel message reply"
                              onClick={() => setReplyTo(null)}
                            >
                              ×
                            </Button>
                            <input
                              type="hidden"
                              name="replyToId"
                              value={replyTo.id}
                            />
                          </div>
                        )}
                        <Composer
                          key={d.messages.at(-1)?.id || "new"}
                          base={base}
                          token={token}
                          focusKey={replyTo?.id}
                          reply
                          action={
                            <Button
                              className="ml-auto h-8 rounded-md bg-[var(--threads-action-bg)] px-4 text-[13px] font-semibold text-white hover:brightness-90"
                              disabled={busy}
                            >
                              {busy ? <Loader size="sm" /> : "Post reply"}
                            </Button>
                          }
                        />
                      </form>
                    ) : (
                      <div className="mx-8 mt-6 mb-8 flex items-center justify-between gap-4 rounded-[14px] border border-[var(--threads-border)] bg-[var(--threads-surface)] p-5 max-[767px]:mx-0">
                        <div>
                          <p className="text-sm font-medium">
                            Join the conversation
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Sign in with your email to post a reply or follow
                            updates.
                          </p>
                        </div>
                        <Button onClick={() => setAuth(true)}>
                          Sign in to reply
                        </Button>
                      </div>
                    ))}
                </article>
                <aside
                  className="sticky top-6 col-start-2 row-start-1 row-span-2 min-w-0 border-l border-[var(--threads-border)] pt-6 pl-6 max-[1100px]:pl-4 max-[980px]:hidden"
                  aria-label="Conversation details"
                >
                  <div>
                    <h2 className="border-b border-[var(--threads-border)] pb-3 text-sm font-bold text-[var(--threads-text)]">
                      Thread details
                    </h2>
                    <dl className="grid gap-3 py-4 [&>div]:flex [&>div]:justify-between [&>div]:gap-3 [&>div]:text-[13px] [&>div]:leading-normal [&_dt]:text-[var(--threads-muted)] [&_dd]:text-right [&_dd]:font-semibold [&_dd]:text-[var(--threads-text)]">
                      <div>
                        <dt>Visibility</dt>
                        <dd>{d.public ? "Public" : "Private"}</dd>
                      </div>
                      <div>
                        <dt>Participants</dt>
                        <dd>{d.participantCount ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>
                          {new Date(d.updatedAt).toLocaleDateString(undefined, {
                            dateStyle: "medium",
                          })}
                        </dd>
                      </div>
                      <div>
                        <dt>Reference</dt>
                        <dd>THR-{d.id.slice(-3).toUpperCase()}</dd>
                      </div>
                    </dl>
                  </div>
                  <p className="border-t border-[var(--threads-border)] pt-4 text-xs leading-[1.55] text-[var(--threads-muted)]">
                    {d.public
                      ? token
                        ? "Anyone can read and join this conversation."
                        : "Anyone can read this conversation. Sign in to participate."
                      : "Only you and the support team can read this conversation."}
                  </p>
                </aside>
                <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
                  <DialogContent className="max-w-md rounded-none border-zinc-300 p-7 dark:border-zinc-700">
                    <DialogHeader>
                      <DialogTitle>Thread details</DialogTitle>
                      <DialogDescription>
                        Context for this conversation.
                      </DialogDescription>
                    </DialogHeader>
                    <dl className="mt-4 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                      {[
                        ["Type", labels[d.category]],
                        ["Visibility", d.public ? "Public" : "Private"],
                        [
                          "Status",
                          statusLabels[displayStatus] || displayStatus,
                        ],
                        ["Participants", String(d.participantCount ?? 0)],
                        [
                          "Updated",
                          new Date(d.updatedAt).toLocaleDateString(undefined, {
                            dateStyle: "medium",
                          }),
                        ],
                        ["Reference", `#THR-${d.id.slice(-3).toUpperCase()}`],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="flex justify-between gap-4 py-3"
                        >
                          <dt className="text-zinc-500">{label}</dt>
                          <dd className="text-right font-medium">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function PortalLoading() {
  return (
    <main
      className="grid min-h-screen place-items-center bg-background"
      aria-label="Loading Threads"
    >
      <Loader size="lg" />
    </main>
  );
}

function ThreadDetailSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading thread"
      className="grid min-h-80 place-items-center"
    >
      <Loader size="md" />
    </div>
  );
}

function ReplyReference({
  replyTo,
}: {
  replyTo: { id: string; text: string; author: string; deleted?: boolean };
}) {
  return (
    <a
      href={`#reply-${replyTo.id}`}
      className="mb-3 block border-l-2 border-[var(--threads-primary)] bg-[var(--threads-surface-low)] px-3 py-2 text-[var(--threads-muted)] no-underline hover:bg-[var(--threads-surface-high)] [&_strong]:block [&_strong]:text-[13px] [&_strong]:text-[var(--threads-text)] [&_span]:mt-0.5 [&_span]:line-clamp-2 [&_span]:text-[13px] [&_span]:leading-normal"
      onClick={(event) => {
        event.preventDefault();
        navigateToReply(replyTo.id);
      }}
    >
      <strong>Replying to {replyTo.author}</strong>
      <span>{replyTo.text}</span>
    </a>
  );
}

function Attachments({
  files,
  base,
  threadId,
  token,
}: {
  files?: { key: string; name: string }[];
  base: string;
  threadId: string;
  token: string;
}) {
  return files?.length ? (
    <div className="mt-3 flex flex-wrap gap-2">
      {files.map((file) => (
        <Button
          key={file.key}
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              const result = await threadsApi.getAttachmentUrl(
                base,
                threadId,
                token,
                file.key,
              );
              window.open(result.url, "_blank", "noopener,noreferrer");
            } catch {
              toast.error("Could not open attachment");
            }
          }}
        >
          <Link2 size={14} />
          {file.name}
        </Button>
      ))}
    </div>
  ) : null;
}
