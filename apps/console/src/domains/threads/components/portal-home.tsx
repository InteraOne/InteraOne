import { formatDistanceToNow } from "date-fns";
import {
  ArrowUp,
  Bell,
  CheckCircle2,
  CircleHelp,
  Mail,
  MessageSquare,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Loader } from "@/shared/ui/loader";
import type { PortalView, Thread } from "../types/types";

type PortalHomeProps = {
  threads: Thread[];
  view: PortalView;
  signedIn: boolean;
  loading: boolean;
  votingId?: string;
  q: string;
  category: string;
  sort: string;
  page: number;
  hasNextPage: boolean;
  currentPath: string;
  threadPath: (id: string) => string;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onVote: (thread: Thread) => void;
};
const pageCopy: Record<PortalView, { title: string; description: string }> = {
  community: {
    title: "Community",
    description:
      "Browse public discussions and ideas shared across this workspace.",
  },
  feature: {
    title: "Feature Requests",
    description:
      "Vote on product ideas and track where each request sits on the roadmap.",
  },
  mine: {
    title: "My Threads",
    description:
      "Follow your questions, requests, and discussions in one place.",
  },
  upvoted: {
    title: "My Threads",
    description:
      "Follow your questions, requests, and discussions in one place.",
  },
  following: {
    title: "My Threads",
    description:
      "Follow your questions, requests, and discussions in one place.",
  },
  updates: {
    title: "Updates",
    description:
      "Replies and status changes across threads you created or follow.",
  },
};
const labels = {
  support: "Question",
  discussion: "Discussion",
  feature: "Feature request",
};

export function PortalHome({
  threads,
  view,
  signedIn,
  loading,
  votingId,
  q,
  category,
  sort,
  page,
  hasNextPage,
  currentPath,
  threadPath,
  onSearchChange,
  onCategoryChange,
  onSortChange,
  onPageChange,
  onVote,
}: PortalHomeProps) {
  const copy = pageCopy[view];
  const stats = threads.reduce(
    (summary, thread) => ({
      replies: summary.replies + (thread.replyCount ?? 0),
      votes: summary.votes + (thread.votes ?? 0),
      resolved:
        summary.resolved +
        (thread.status === "resolved" || thread.progress === "shipped" ? 1 : 0),
    }),
    { replies: 0, votes: 0, resolved: 0 },
  );
  const popularRequests = [...threads]
    .filter((thread) => thread.category === "feature")
    .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
    .slice(0, 3);

  return (
    <section className="threads-page [width:100%] [margin:0_auto]" aria-labelledby="threads-page-title">
      <header className="threads-page-heading [display:flex] [align-items:end] [justify-content:space-between] [gap:20px] [padding:6px_0_22px] [&_h1]:[font-size:27px] [&_h1]:[line-height:33px] [&_h1]:[font-weight:650] [&_h1]:[letter-spacing:-0.55px] [&_p]:[max-width:680px] [&_p]:[margin-top:4px] [&_p]:[color:var(--threads-muted)] [&_p]:[font-size:13px] [&_p]:[line-height:20px] max-[767px]:[&_h1]:[font-size:22px] max-[767px]:[&_h1]:[line-height:28px] max-[767px]:[&_p]:[font-size:13px]">
        <div>
          <span className="threads-page-eyebrow [display:block] [margin-bottom:5px] [color:var(--threads-muted)] [font-size:10px] [font-weight:650] [letter-spacing:0.08em] [text-transform:uppercase]">InteraOne workspace</span>
          <h1 id="threads-page-title">{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
      </header>
      <section className="threads-toolbar [display:flex] [min-height:54px] [flex-wrap:wrap] [align-items:center] [justify-content:space-between] [gap:10px_18px] [padding:9px_0] [border-top:1px_solid_var(--threads-border)] [border-bottom:1px_solid_var(--threads-border)] [background:var(--threads-surface)] max-[767px]:[display:grid] max-[767px]:[padding:8px_0]" aria-label="Thread filters">
        <div
          className="threads-filter-tabs [display:flex] [min-width:0] [align-items:center] [gap:3px] [overflow-x:auto] [&_button]:[display:inline-flex] [&_button]:[height:32px] [&_button]:[flex:none] [&_button]:[align-items:center] [&_button]:[gap:6px] [&_button]:[padding:0_10px] [&_button]:[border-radius:7px] [&_button]:[color:var(--threads-muted)] [&_button]:[font-size:12px] [&_button]:[font-weight:600] [&_button]:[transition:color_120ms_ease,_background_120ms_ease] [&_button:hover]:[color:var(--threads-text)] [&_button:hover]:[background:var(--threads-surface-low)] [&_button.active]:[color:var(--threads-text)] [&_button.active]:[background:var(--threads-surface-high)] [&_svg]:[width:14px] [&_svg]:[height:14px] max-[767px]:[width:100%]"
          role="group"
          aria-label={`${copy.title} filters`}
        >
          {view === "feature" ? (
            <>
              <Filter active={!category} onClick={() => onCategoryChange("")}>
                All
              </Filter>
              <Filter
                active={category === "under_review"}
                onClick={() => onCategoryChange("under_review")}
              >
                Under review
              </Filter>
              <Filter
                active={category === "planned"}
                onClick={() => onCategoryChange("planned")}
              >
                Planned
              </Filter>
              <Filter
                active={category === "in_progress"}
                onClick={() => onCategoryChange("in_progress")}
                icon={<Zap />}
              >
                In progress
              </Filter>
              <Filter
                active={category === "shipped"}
                onClick={() => onCategoryChange("shipped")}
                icon={<CheckCircle2 />}
              >
                Shipped
              </Filter>
            </>
          ) : view === "updates" ? (
            <Filter active icon={<Bell />}>
              All updates
            </Filter>
          ) : view === "community" ? (
            <>
              <Filter active={!category} onClick={() => onCategoryChange("")}>
                All
              </Filter>
              <Filter
                active={category === "feature"}
                onClick={() => onCategoryChange("feature")}
                icon={<Sparkles />}
              >
                Feature requests
              </Filter>
              <Filter
                active={category === "discussion"}
                onClick={() => onCategoryChange("discussion")}
                icon={<MessageSquare />}
              >
                Discussions
              </Filter>
            </>
          ) : (
            <>
              <Filter active={!category} onClick={() => onCategoryChange("")}>
                All
              </Filter>
              <Filter
                active={category === "feature"}
                onClick={() => onCategoryChange("feature")}
                icon={<Sparkles />}
              >
                Feature requests
              </Filter>
              <Filter
                active={category === "support"}
                onClick={() => onCategoryChange("support")}
                icon={<CircleHelp />}
              >
                Questions
              </Filter>
              <Filter
                active={category === "discussion"}
                onClick={() => onCategoryChange("discussion")}
                icon={<MessageSquare />}
              >
                Discussions
              </Filter>
            </>
          )}
        </div>
        {view !== "updates" && (
          <div className="threads-sort [display:flex] [flex:none] [align-items:center] [gap:7px] [&_label]:[display:flex] [&_label]:[height:32px] [&_label]:[align-items:center] [&_label]:[gap:5px] [&_label]:[padding:0_8px] [&_label]:[border:1px_solid_var(--threads-border)] [&_label]:[border-radius:7px] [&_label]:[color:var(--threads-muted)] [&_label]:[background:var(--threads-surface)] [&_label]:[font-size:11px] [&_span]:[font-weight:600] [&_select]:[max-width:108px] [&_select]:[border:0] [&_select]:[background:transparent] [&_select]:[color:var(--threads-text)] [&_select]:[font-size:11px] [&_select]:[font-weight:600] [&_select]:[outline:none] max-[767px]:[width:100%] max-[767px]:[justify-content:space-between] max-[767px]:[&_label]:[flex:1] max-[767px]:[&_label]:[justify-content:space-between]">
            <label>
              <span>Status</span>
              <select
                value={
                  sort === "solved" || sort === "unanswered" ? sort : "all"
                }
                onChange={(event) =>
                  onSortChange(
                    event.target.value === "all"
                      ? "latest"
                      : event.target.value,
                  )
                }
              >
                <option value="all">All</option>
                <option value="unanswered">Needs reply</option>
                <option value="solved">Resolved</option>
              </select>
            </label>
            <label>
              <span>Sort</span>
              <select
                value={sort === "trending" ? "trending" : "latest"}
                onChange={(event) => onSortChange(event.target.value)}
              >
                <option value="latest">Recent</option>
                <option value="trending">Most voted</option>
              </select>
            </label>
          </div>
        )}
        {q && (
          <label className="threads-inline-search [display:flex] [width:100%] [height:38px] [align-items:center] [gap:8px] [padding:0_10px] [border:1px_solid_color-mix(in_srgb,_var(--threads-primary)_55%,_var(--threads-border))] [border-radius:8px] [&_svg]:[width:16px] [&_svg]:[color:var(--threads-primary)] [&_input]:[min-width:0] [&_input]:[flex:1] [&_input]:[outline:none] [&_button]:[color:var(--threads-primary)] [&_button]:[font-size:12px] [&_button]:[font-weight:600]">
            <Search />
            <input
              autoFocus
              value={q}
              onChange={(event) => onSearchChange(event.target.value)}
              aria-label="Search threads"
            />
            <button type="button" onClick={() => onSearchChange("")}>
              Clear
            </button>
          </label>
        )}
      </section>

      <div className="threads-page-grid [display:grid] [grid-template-columns:minmax(0,_1fr)_300px] [align-items:stretch] [gap:0] max-[1180px]:[grid-template-columns:minmax(0,_1fr)_244px] max-[899px]:[grid-template-columns:minmax(0,_1fr)]">
        <main className="threads-feed-panel [min-width:0] [padding-right:28px] [background:var(--threads-surface)] max-[899px]:[padding-right:0]">
          <header className="threads-feed-heading [display:flex] [min-height:64px] [align-items:center] [justify-content:space-between] [gap:16px] [padding:12px_4px] [border-bottom:1px_solid_var(--threads-border)] [&_h2]:[font-size:13px] [&_h2]:[font-weight:650] [&_p]:[margin-top:2px] [&_p]:[color:var(--threads-muted)] [&_p]:[font-size:11px] [&>span]:[margin-top:2px] [&>span]:[color:var(--threads-muted)] [&>span]:[font-size:11px] max-[767px]:[min-height:58px] max-[767px]:[padding:11px_4px]">
            <div>
              <h2>
                {q
                  ? "Search results"
                  : view === "updates"
                    ? "Recent updates"
                    : "Latest activity"}
              </h2>
              <p>
                {loading
                  ? "Refreshing threads…"
                  : `${threads.length} thread${threads.length === 1 ? "" : "s"} in this view`}
              </p>
            </div>
            {!loading && threads.length > 0 && <span>Page {page + 1}</span>}
          </header>
          <div className="threads-list [min-height:320px]" aria-busy={loading}>
            {threads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                to={threadPath(thread.id)}
                state={{ from: currentPath }}
                update={view === "updates"}
                signedIn={signedIn}
                voting={votingId === thread.id}
                onVote={() => onVote(thread)}
              />
            ))}
            {loading && <ThreadRowsLoader />}
            {!loading && threads.length === 0 && (
              <EmptyThreads view={view} q={q} />
            )}
          </div>
          {!loading && threads.length > 0 && view === "updates" && (
            <p className="threads-end [padding:13px_16px] [border-top:1px_solid_var(--threads-border)] [color:var(--threads-muted)] [font-size:11px] [text-align:center]">You&apos;re all caught up</p>
          )}
          {view !== "updates" && (page > 0 || hasNextPage) && (
            <footer className="threads-pagination [display:flex] [align-items:center] [justify-content:end] [gap:12px] [padding:11px_14px] [border-top:1px_solid_var(--threads-border)] [font-size:11px] [&_button]:[padding:6px_10px] [&_button]:[border:1px_solid_var(--threads-border)] [&_button]:[border-radius:7px] [&_button:disabled]:[opacity:0.45]">
              <button
                type="button"
                disabled={!page}
                onClick={() => onPageChange(page - 1)}
              >
                Previous
              </button>
              <span>Page {page + 1}</span>
              <button
                type="button"
                disabled={!hasNextPage}
                onClick={() => onPageChange(page + 1)}
              >
                Next
              </button>
            </footer>
          )}
        </main>

        <aside className="threads-insights [display:block] [min-width:0] [padding-left:24px] [border-left:1px_solid_var(--threads-border)] max-[899px]:[display:grid] max-[899px]:[grid-template-columns:repeat(2,_minmax(0,_1fr))] max-[899px]:[padding-left:0] max-[899px]:[border-top:1px_solid_var(--threads-border)] max-[899px]:[border-left:0] max-[767px]:[display:block]" aria-label="Community insights">
          <section className="threads-insight-card [border-bottom:1px_solid_var(--threads-border)] [background:var(--threads-surface)] [&>header]:[padding:18px_0_12px] [&>headerspan]:[display:block] [&>headerspan]:[color:var(--threads-muted)] [&>headerspan]:[font-size:9px] [&>headerspan]:[font-weight:700] [&>headerspan]:[letter-spacing:0.09em] [&>headerspan]:[text-transform:uppercase] [&>headerstrong]:[display:block] [&>headerstrong]:[margin-top:2px] [&>headerstrong]:[font-size:13px] [&>headerstrong]:[font-weight:650] max-[899px]:[padding:0_18px] max-[899px]:[&:nth-child(even)]:[border-left:1px_solid_var(--threads-border)] max-[767px]:[padding:0_4px] max-[767px]:[&:nth-child(even)]:[border-left:0]">
            <header>
              <span className="block text-[9px] font-bold tracking-wider text-[var(--threads-muted)] uppercase">Current view</span>
              <strong className="mt-0.5 block text-[13px] font-semibold">Snapshot</strong>
            </header>
            <dl className="threads-stat-grid [display:grid] [grid-template-columns:repeat(2,_1fr)] [&_div]:[padding:12px_0] [&_div]:[border-right:1px_solid_color-mix(in_srgb,_var(--threads-border)_65%,_transparent)] [&_div]:[border-bottom:1px_solid_color-mix(in_srgb,_var(--threads-border)_65%,_transparent)] [&_div:nth-child(odd)]:[padding-right:14px] [&_div:nth-child(even)]:[padding-left:14px] [&_div:nth-child(even)]:[border-right:0] [&_div:nth-last-child(-n_+_2)]:[border-bottom:0] [&_dt]:[color:var(--threads-muted)] [&_dt]:[font-size:10px] [&_dt]:[font-weight:600] [&_dd]:[margin-top:3px] [&_dd]:[font-size:20px] [&_dd]:[font-weight:650] [&_dd]:[line-height:1] [&_dd]:[font-variant-numeric:tabular-nums]">
              <div>
                <dt>Threads</dt>
                <dd>{threads.length}</dd>
              </div>
              <div>
                <dt>Replies</dt>
                <dd>{stats.replies}</dd>
              </div>
              <div>
                <dt>Resolved</dt>
                <dd>{stats.resolved}</dd>
              </div>
              <div>
                <dt>Votes</dt>
                <dd>{stats.votes}</dd>
              </div>
            </dl>
          </section>
          <section className="threads-insight-card [border-bottom:1px_solid_var(--threads-border)] [background:var(--threads-surface)] [&>header]:[padding:18px_0_12px] [&>headerspan]:[display:block] [&>headerspan]:[color:var(--threads-muted)] [&>headerspan]:[font-size:9px] [&>headerspan]:[font-weight:700] [&>headerspan]:[letter-spacing:0.09em] [&>headerspan]:[text-transform:uppercase] [&>headerstrong]:[display:block] [&>headerstrong]:[margin-top:2px] [&>headerstrong]:[font-size:13px] [&>headerstrong]:[font-weight:650] max-[899px]:[padding:0_18px] max-[899px]:[&:nth-child(even)]:[border-left:1px_solid_var(--threads-border)] max-[767px]:[padding:0_4px] max-[767px]:[&:nth-child(even)]:[border-left:0]">
            <header>
              <span className="block text-[9px] font-bold tracking-wider text-[var(--threads-muted)] uppercase">Community signal</span>
              <strong className="mt-0.5 block text-[13px] font-semibold">Top requests</strong>
            </header>
            {popularRequests.length ? (
              <div className="threads-top-requests [display:grid] [padding:4px_0_14px] [&_a]:[display:grid] [&_a]:[grid-template-columns:38px_minmax(0,_1fr)] [&_a]:[align-items:center] [&_a]:[gap:8px] [&_a]:[padding:8px_0] [&_a]:[border-radius:6px] [&_a:hover]:[background:var(--threads-surface-low)] [&_a_>_span]:[display:inline-flex] [&_a_>_span]:[height:28px] [&_a_>_span]:[align-items:center] [&_a_>_span]:[justify-content:center] [&_a_>_span]:[gap:2px] [&_a_>_span]:[border:1px_solid_var(--threads-border)] [&_a_>_span]:[border-radius:6px] [&_a_>_span]:[color:var(--threads-muted)] [&_a_>_span]:[font-size:10px] [&_a_>_span]:[font-weight:650] [&_svg]:[width:11px] [&_strong]:[overflow:hidden] [&_strong]:[text-overflow:ellipsis] [&_strong]:[white-space:nowrap] [&_strong]:[font-size:11px] [&_strong]:[font-weight:600]">
                {popularRequests.map((thread) => (
                  <Link
                    key={thread.id}
                    to={threadPath(thread.id)}
                    state={{ from: currentPath }}
                  >
                    <span>
                      <ArrowUp />
                      {thread.votes ?? 0}
                    </span>
                    <strong>{thread.title}</strong>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="threads-insight-empty [padding:2px_0_18px] [color:var(--threads-muted)] [font-size:11px] [line-height:17px]">
                Feature requests in the current view will appear here.
              </p>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
function Filter({
  active,
  icon,
  children,
  onClick,
}: {
  active?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "active" : ""}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}
function ThreadRow({
  thread,
  to,
  state,
  update,
  signedIn,
  voting,
  onVote,
}: {
  thread: Thread;
  to: string;
  state: { from: string };
  update: boolean;
  signedIn: boolean;
  voting: boolean;
  onVote: () => void;
}) {
  const resolved =
    thread.status === "resolved" || thread.progress === "shipped";
  const status =
    thread.category === "feature"
      ? {
          under_review: "Under review",
          planned: "Planned",
          in_progress: "In progress",
          shipped: "Shipped",
        }[thread.progress || "under_review"]
      : resolved
        ? "Resolved"
        : (thread.replyCount ?? 0) === 0
          ? "Needs reply"
          : "Open";
  const statusTone = resolved
    ? "resolved"
    : thread.category === "feature"
      ? thread.progress || "under_review"
      : status === "Open"
        ? "open"
        : "needs_reply";
  return (
    <article className={`threads-row [display:flex] [min-height:72px] [align-items:center] [gap:16px] [padding:12px_16px] [border-bottom:1px_solid_color-mix(in_srgb,_var(--threads-border)_75%,_transparent)] [transition:background_120ms_ease-out] last:[border-bottom:0] hover:[background:var(--threads-surface-low)] max-[767px]:[gap:10px] max-[767px]:[padding-inline:4px] max-[767px]:[align-items:flex-start] max-[767px]:[padding:14px_4px] ${update ? "threads-update-row [min-height:96px] [border:1px_solid_var(--threads-border)] [border-width:0_0_1px]" : ""} min-h-[72px] gap-4 px-4 py-3 hover:bg-[var(--threads-surface-low)] max-[767px]:gap-2.5 max-[767px]:px-1 max-[767px]:py-[14px]`}>
      {update ? (
        <span className="threads-update-icon [display:grid] [width:36px] [height:36px] [flex:none] [place-items:center] [border-radius:50%] [color:var(--threads-primary)] [background:var(--threads-surface-low)] [&_svg]:[width:17px]">
          {resolved ? (
            <CheckCircle2 />
          ) : thread.category === "feature" ? (
            <Sparkles />
          ) : (
            <Bell />
          )}
        </span>
      ) : thread.category === "feature" ? (
        <button
          type="button"
          className={`threads-vote [display:inline-flex] [width:40px] [height:46px] [flex:none] [flex-direction:column] [align-items:center] [justify-content:center] [border:1px_solid_var(--threads-border)] [border-radius:8px] [font-size:12px] [font-weight:600] [&.accent]:[border-color:var(--threads-primary)] [&.accent]:[color:var(--threads-primary)] [&.accent]:[background:color-mix(_in_srgb,_var(--threads-primary)_8%,_var(--threads-surface)_)] [&:is(button):hover]:[border-color:var(--threads-primary)] [&:is(button):hover]:[color:var(--threads-primary)] [&:is(button):hover]:[transform:translateY(-1px)] [&:is(button):disabled]:[cursor:wait] [&:is(button):disabled]:[opacity:0.65] [&_svg]:[width:12px] [&_svg]:[height:12px] ${thread.voted ? "accent" : ""}`}
          aria-label={`${thread.voted ? "Remove upvote from" : "Upvote"} ${thread.title}`}
          aria-pressed={thread.voted}
          disabled={voting}
          title={signedIn ? "Upvote this feature" : "Sign in to upvote"}
          onClick={onVote}
        >
          {voting ? (
            <span className="size-3 animate-pulse rounded-full bg-current" />
          ) : (
            <ArrowUp />
          )}
          {thread.votes ?? 0}
        </button>
      ) : (
        <span className="threads-vote [display:inline-flex] [width:40px] [height:46px] [flex:none] [flex-direction:column] [align-items:center] [justify-content:center] [border:1px_solid_var(--threads-border)] [border-radius:8px] [font-size:12px] [font-weight:600] [&.accent]:[border-color:var(--threads-primary)] [&.accent]:[color:var(--threads-primary)] [&.accent]:[background:color-mix(_in_srgb,_var(--threads-primary)_8%,_var(--threads-surface)_)] [&:is(button):hover]:[border-color:var(--threads-primary)] [&:is(button):hover]:[color:var(--threads-primary)] [&:is(button):hover]:[transform:translateY(-1px)] [&:is(button):disabled]:[cursor:wait] [&:is(button):disabled]:[opacity:0.65] [&_svg]:[width:12px] [&_svg]:[height:12px]" aria-hidden="true">
          <MessageSquare />
          {thread.replyCount ?? 0}
        </span>
      )}
      <Link
        to={to}
        state={state}
        className="flex min-w-0 flex-1 flex-col gap-[3px] rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--threads-primary)]"
      >
        <span className="threads-row-title [display:flex] [flex-wrap:wrap] [align-items:center] [gap:8px] [&_strong]:[overflow:hidden] [&_strong]:[text-overflow:ellipsis] [&_strong]:[font-size:15px] [&_strong]:[font-weight:600]">
          <strong>{thread.title}</strong>
          <em
            className={`threads-status-badge [display:inline-flex] [height:23px] [align-items:center] [padding:0_8px] [border:1px_solid_color-mix(in_srgb,_currentColor_28%,_var(--threads-border))] [border-radius:6px] [color:var(--threads-muted)] [background:transparent] [font-size:11px] [font-style:normal] [font-weight:600] [line-height:1] [white-space:nowrap] [&.status-open]:[color:#2563eb] [&.status-under-review]:[color:#a16207] [&.status-needs-reply]:[color:#a16207] [&.status-planned]:[color:#7c3aed] [&.status-in-progress]:[color:#0369a1] [&.status-resolved]:[color:#15803d] [&.status-shipped]:[color:#15803d] [&.status-closed]:[color:#64748b] dark:[&.status-open]:[color:#93c5fd] dark:[&.status-under-review]:[color:#facc15] dark:[&.status-needs-reply]:[color:#facc15] dark:[&.status-planned]:[color:#c4b5fd] dark:[&.status-in-progress]:[color:#7dd3fc] dark:[&.status-resolved]:[color:#86efac] dark:[&.status-shipped]:[color:#86efac] dark:[&.status-closed]:[color:#cbd5e1] status-${statusTone.replaceAll("_", "-")}`}
          >
            {status}
          </em>
          <code className="whitespace-nowrap text-[11px] text-[var(--threads-muted)]">THR-{thread.id.slice(-3).toUpperCase()}</code>
        </span>
        <span className="threads-row-summary [display:block] [margin-top:3px] [color:var(--threads-muted)] [font-size:12px] max-[767px]:[overflow:hidden] max-[767px]:[text-overflow:ellipsis] max-[767px]:[white-space:nowrap]">
          {update
            ? `Activity on your ${labels[thread.category].toLowerCase()}.`
            : thread.public
              ? `${labels[thread.category]} in the public workspace.`
              : "A private support thread."}
          <b aria-hidden="true" className="mx-[7px] font-normal">·</b>
          <span>{labels[thread.category]}</span>
        </span>
      </Link>
      <div className="flex shrink-0 items-center gap-[18px] max-[767px]:gap-2 max-[767px]:[&_.threads-participants [display:flex] [flex:none] [align-items:center] [padding:0_5px_0_10px] max-[767px]:[display:none]]:hidden">
        <ParticipantProfiles thread={thread} />
        <span className="flex w-[52px] items-center justify-end gap-[5px] text-xs text-[var(--threads-muted)] tabular-nums max-[767px]:w-auto" aria-label={`${thread.replyCount ?? 0} replies`}>
          <MessageSquare className="size-3.5" /> {thread.replyCount ?? 0}
        </span>
        <time dateTime={thread.updatedAt} className="w-[72px] whitespace-nowrap text-right text-[11px] text-[var(--threads-muted)] max-[767px]:w-[58px]">
          {formatDistanceToNow(new Date(thread.updatedAt), { addSuffix: false })}
        </time>
      </div>
    </article>
  );
}

function ParticipantProfiles({ thread }: { thread: Thread }) {
  const total = thread.participantCount ?? 0;
  const profiles = thread.participantProfiles ?? [];
  if (total === 0) return null;

  const visibleProfiles = profiles.slice(0, 3);
  const remaining = Math.max(0, total - Math.max(visibleProfiles.length, 1));
  const names = visibleProfiles.map((profile) => profile.name).join(", ");

  return (
    <span
      className="threads-participants [display:flex] [flex:none] [align-items:center] [padding:0_5px_0_10px] max-[767px]:[display:none] w-20 justify-end pr-[5px] pl-0"
      aria-label={
        names || `${total} email participant${total === 1 ? "" : "s"}`
      }
    >
      {visibleProfiles.length > 0 ? (
        visibleProfiles.map((profile) => (
          <span
            key={profile.id}
            className="threads-participant-avatar [display:grid] [width:29px] [height:29px] [place-items:center] [margin-left:-8px] [border:2px_solid_var(--threads-surface)] [border-radius:50%] [color:var(--threads-text)] [background:var(--threads-surface-high)] [box-shadow:0_1px_3px_rgb(15_23_42_/_10%)] [font-size:9px] [font-weight:700] [letter-spacing:-0.01em] first:[margin-left:0] [&:nth-child(2)]:[background:color-mix(_in_srgb,_var(--threads-primary)_9%,_var(--threads-surface)_)] [&:nth-child(3)]:[background:color-mix(_in_srgb,_var(--threads-success)_8%,_var(--threads-surface)_)] [&_svg]:[width:13px] [&_svg]:[height:13px] [&[data-source=\'ai\']]:[color:var(--threads-primary)]"
            title={profile.name}
            data-source={profile.source}
            aria-hidden="true"
          >
            {profile.source === "ai" ? <Sparkles /> : profile.initials}
          </span>
        ))
      ) : (
        <span
          className="threads-participant-avatar [display:grid] [width:29px] [height:29px] [place-items:center] [margin-left:-8px] [border:2px_solid_var(--threads-surface)] [border-radius:50%] [color:var(--threads-text)] [background:var(--threads-surface-high)] [box-shadow:0_1px_3px_rgb(15_23_42_/_10%)] [font-size:9px] [font-weight:700] [letter-spacing:-0.01em] first:[margin-left:0] [&:nth-child(2)]:[background:color-mix(_in_srgb,_var(--threads-primary)_9%,_var(--threads-surface)_)] [&:nth-child(3)]:[background:color-mix(_in_srgb,_var(--threads-success)_8%,_var(--threads-surface)_)] [&_svg]:[width:13px] [&_svg]:[height:13px] [&[data-source=\'ai\']]:[color:var(--threads-primary)]"
          title="Email participant"
          aria-hidden="true"
        >
          <Mail />
        </span>
      )}
      {remaining > 0 && (
        <span
          className="threads-participant-avatar [display:grid] [width:29px] [height:29px] [place-items:center] [margin-left:-8px] [border:2px_solid_var(--threads-surface)] [border-radius:50%] [color:var(--threads-text)] [background:var(--threads-surface-high)] [box-shadow:0_1px_3px_rgb(15_23_42_/_10%)] [font-size:9px] [font-weight:700] [letter-spacing:-0.01em] first:[margin-left:0] [&:nth-child(2)]:[background:color-mix(_in_srgb,_var(--threads-primary)_9%,_var(--threads-surface)_)] [&:nth-child(3)]:[background:color-mix(_in_srgb,_var(--threads-success)_8%,_var(--threads-surface)_)] [&_svg]:[width:13px] [&_svg]:[height:13px] [&[data-source=\'ai\']]:[color:var(--threads-primary)] threads-participant-overflow [color:var(--threads-muted)] [background:var(--threads-surface)] [font-size:9px]"
          title={`${remaining} more participant${remaining === 1 ? "" : "s"}`}
          aria-hidden="true"
        >
          +{remaining}
        </span>
      )}
    </span>
  );
}
function ThreadRowsLoader() {
  return (
    <div
      role="status"
      aria-label="Loading threads"
      className="grid min-h-72 place-items-center"
    >
      <Loader size="md" />
    </div>
  );
}
function EmptyThreads({ view, q }: { view: PortalView; q: string }) {
  const title =
    view === "updates"
      ? "All caught up"
      : view === "upvoted"
        ? "No upvoted threads"
        : view === "following"
          ? "No followed threads"
          : view === "feature"
            ? "No matching feature requests"
            : view === "community"
              ? "No matching discussions"
              : "No matching threads";
  return (
    <div className="threads-empty [display:grid] [min-height:360px] [place-items:center] [align-content:center] [padding:30px] [text-align:center] [&>svg]:[width:26px] [&>svg]:[color:var(--threads-muted)] [&_h2]:[margin-top:10px] [&_h2]:[font-size:16px] [&_h2]:[font-weight:600] [&_p]:[margin-top:3px] [&_p]:[color:var(--threads-muted)] [&_p]:[font-size:13px]">
      <Search />
      <h2>{title}</h2>
      <p>
        {q
          ? "Try a different search term or clear the current filters."
          : view === "updates"
            ? "New replies and status changes will appear here."
            : view === "upvoted"
              ? "Threads you upvote will appear here."
              : view === "following"
                ? "Threads you follow will appear here."
                : "There is nothing in this view yet."}
      </p>
    </div>
  );
}
