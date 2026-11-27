import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  ArrowUp,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  MessageCircle,
  Plus,
  Search,
} from "lucide-react";
import { Link } from "react-router";
import { Loader } from "@/shared/ui/loader";
import type { PortalView, Thread } from "../types/types";
import {
  WorkspaceHeading,
  WorkspaceSectionHeading,
  WorkspaceTabs,
} from "./workspace-structure";

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
  onViewChange: (view: PortalView) => void;
  onNewThread: () => void;
};

const copy: Record<
  PortalView,
  { eyebrow: string; title: string; description: string }
> = {
  community: {
    eyebrow: "Explore",
    title: "Community",
    description:
      "A place for conversations, questions, and ideas worth sharing.",
  },
  feature: {
    eyebrow: "Explore",
    title: "Featured",
    description: "See the ideas shaping what comes next, and add your voice.",
  },
  mine: {
    eyebrow: "Your space",
    title: "My threads",
    description:
      "Your conversations and the ideas you follow, together in one place.",
  },
  upvoted: {
    eyebrow: "Your space",
    title: "My threads",
    description:
      "Your conversations and the ideas you follow, together in one place.",
  },
  following: {
    eyebrow: "Your space",
    title: "My threads",
    description:
      "Your conversations and the ideas you follow, together in one place.",
  },
  updates: {
    eyebrow: "Your space",
    title: "Updates",
    description: "Recent activity in conversations you follow.",
  },
};

const categoryLabels = {
  support: "Private support",
  discussion: "Discussion",
  feature: "Feature request",
};
const progressLabels = {
  under_review: "Under review",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
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
  onViewChange,
  onNewThread,
}: PortalHomeProps) {
  const isMine = ["mine", "upvoted", "following"].includes(view);
  const filters: Array<readonly [string, string]> =
    view === "feature"
      ? [
          ["", "All ideas"],
          ["under_review", "Under review"],
          ["planned", "Planned"],
          ["in_progress", "In progress"],
          ["shipped", "Shipped"],
        ]
      : view === "community"
        ? [
            ["", "All conversations"],
            ["discussion", "Discussions"],
            ["feature", "Feature requests"],
          ]
        : [
            ["", "All types"],
            ["support", "Private support"],
            ["discussion", "Discussions"],
            ["feature", "Feature requests"],
          ];

  return (
    <section className="w-full" aria-labelledby="threads-page-title">
      <WorkspaceHeading
        className="max-[600px]:pt-6 max-[600px]:pb-5"
        eyebrow={copy[view].eyebrow}
        title={copy[view].title}
        description={copy[view].description}
        action={
          <button
            type="button"
            className="inline-flex min-h-[39px] items-center justify-center gap-2 rounded-md border border-[var(--threads-action-bg)] bg-[var(--threads-action-bg)] px-[15px] text-[13px] font-bold text-white hover:brightness-[0.92] max-[600px]:min-h-[35px]"
            onClick={onNewThread}
          >
            <Plus size={18} /> Start a thread
          </button>
        }
      />

      {isMine && (
        <WorkspaceTabs
          variant="navigation"
          label="My threads views"
          items={[
            ["mine", "Started by me"],
            ["following", "Following"],
            ["upvoted", "Upvoted"],
          ]}
          value={view}
          onChange={(next) => onViewChange(next as PortalView)}
        />
      )}

      <div className="bg-[var(--threads-surface)]">
        <WorkspaceSectionHeading
          className="min-h-[76px] max-[600px]:min-h-[70px] max-[600px]:flex-col max-[600px]:items-start max-[600px]:[&>div:last-child]:w-full"
          title={
            view === "updates"
              ? "Recent activity"
              : q
                ? "Search results"
                : view === "feature"
                  ? "Feature requests"
                  : isMine
                    ? "Your conversations"
                    : "All conversations"
          }
          detail={
            loading
              ? "Loading conversations…"
              : `${threads.length}${hasNextPage ? "+" : ""} ${view === "updates" ? "updates" : "threads"}${page ? ` · page ${page + 1}` : ""}`
          }
          action={
            view !== "updates" && (
              <label className="flex items-center gap-2 text-[13px] text-[var(--threads-muted)] max-[600px]:w-full max-[600px]:justify-between">
                <span>Sort by</span>
                <select
                  className="max-w-[170px] rounded-[5px] border border-[var(--threads-border)] bg-[var(--threads-surface)] px-[9px] py-[7px] text-[13px] font-semibold text-[var(--threads-text)]"
                  value={sort}
                  onChange={(event) => onSortChange(event.target.value)}
                >
                  <option value="latest">Recent activity</option>
                  <option value="trending">Most popular</option>
                  <option value="unanswered">Needs a reply</option>
                  <option value="solved">Resolved</option>
                </select>
              </label>
            )
          }
        />

        {view !== "updates" && (
          <WorkspaceTabs
            className="max-[600px]:pb-[9px]"
            label="Filter threads"
            items={filters}
            value={category}
            onChange={onCategoryChange}
          />
        )}

        {q && (
          <div className="flex items-center gap-2.5 border-b border-[var(--threads-border)] py-2.5 text-[var(--threads-primary)]">
            <Search size={16} />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--threads-text)] outline-none"
              autoFocus
              value={q}
              onChange={(event) => onSearchChange(event.target.value)}
              aria-label="Search threads"
            />
            <button
              type="button"
              className="whitespace-nowrap text-[13px] font-bold"
              onClick={() => onSearchChange("")}
            >
              Clear search
            </button>
          </div>
        )}

        <div className="min-h-[200px]" aria-busy={loading}>
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              to={threadPath(thread.id)}
              currentPath={currentPath}
              signedIn={signedIn}
              voting={votingId === thread.id}
              onVote={() => onVote(thread)}
            />
          ))}
          {loading && (
            <div
              className="grid min-h-[200px] place-items-center"
              role="status"
              aria-label="Loading threads"
            >
              <Loader size="md" />
            </div>
          )}
          {!loading && threads.length === 0 && (
            <div className="grid min-h-[260px] content-center justify-items-start px-2 py-9 text-left max-[600px]:min-h-[220px]">
              <span className="text-[var(--threads-primary)]">
                {view === "updates" ? (
                  <Bell size={23} />
                ) : q ? (
                  <Search size={23} />
                ) : isMine ? (
                  <LockKeyhole size={23} />
                ) : (
                  <MessageCircle size={23} />
                )}
              </span>
              <h3 className="mt-2.5 text-base font-bold">
                {q
                  ? "No matching threads"
                  : view === "updates"
                    ? "You're all caught up"
                    : isMine
                      ? "Nothing here yet"
                      : "No threads yet"}
              </h3>
              <p className="mt-1 max-w-[360px] text-sm leading-normal text-[var(--threads-muted)]">
                {q
                  ? "Try another search or remove a filter."
                  : view === "updates"
                    ? "New replies and status changes will appear here."
                    : isMine
                      ? "Conversations you start or save will appear here."
                      : "Start the first conversation in this space."}
              </p>
              {!q && view !== "updates" && (
                <button
                  type="button"
                  onClick={onNewThread}
                  className="mt-[14px] inline-flex items-center gap-1.5 text-[13px] font-bold text-[var(--threads-primary)]"
                >
                  Start a thread <ArrowRight size={15} />
                </button>
              )}
            </div>
          )}
        </div>

        {view !== "updates" && (page > 0 || hasNextPage) && (
          <footer className="flex items-center justify-between gap-2.5 py-[13px] text-[13px] text-[var(--threads-muted)] [&_button]:inline-flex [&_button]:items-center [&_button]:gap-[5px] [&_button]:py-[5px] [&_button]:font-bold [&_button]:text-[var(--threads-text)] [&_button:disabled]:opacity-40">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft size={16} /> Previous
            </button>
            <span>Page {page + 1}</span>
            <button
              type="button"
              disabled={!hasNextPage}
              onClick={() => onPageChange(page + 1)}
            >
              Next <ChevronRight size={16} />
            </button>
          </footer>
        )}
      </div>
    </section>
  );
}

function ThreadRow({
  thread,
  to,
  currentPath,
  signedIn,
  voting,
  onVote,
}: {
  thread: Thread;
  to: string;
  currentPath: string;
  signedIn: boolean;
  voting: boolean;
  onVote: () => void;
}) {
  const status =
    thread.category === "feature"
      ? progressLabels[thread.progress || "under_review"]
      : thread.status === "resolved"
        ? "Resolved"
        : thread.status === "closed"
          ? "Closed"
          : thread.replyCount
            ? "Active"
            : "Open";
  const lastActivity = formatDistanceToNow(new Date(thread.updatedAt), {
    addSuffix: true,
  });
  return (
    <article className="group grid min-h-[88px] grid-cols-[38px_minmax(0,1fr)] items-center gap-x-2.5 border-b border-[var(--threads-border)] py-3 transition-colors hover:bg-[var(--threads-surface-low)] min-[601px]:min-h-[90px] min-[601px]:grid-cols-[44px_minmax(0,1fr)_56px_132px] min-[601px]:gap-x-2.5 min-[601px]:px-[9px] min-[901px]:grid-cols-[44px_minmax(0,1fr)_72px_162px_20px] min-[901px]:gap-x-[14px]">
      <div className="flex items-center justify-center">
        {thread.category === "feature" && thread.public ? (
          <button
            type="button"
            className={`grid min-h-[45px] w-[37px] place-items-center gap-px rounded-[5px] border py-1 text-xs font-bold hover:border-[var(--threads-primary)] hover:bg-[color-mix(in_srgb,var(--threads-primary)_6%,var(--threads-surface))] hover:text-[var(--threads-primary)] max-[600px]:min-h-[42px] max-[600px]:w-[34px] ${thread.voted ? "border-[var(--threads-primary)] bg-[color-mix(in_srgb,var(--threads-primary)_6%,var(--threads-surface))] text-[var(--threads-primary)]" : "border-[var(--threads-border)] bg-[var(--threads-surface)] text-[var(--threads-muted)]"}`}
            aria-label={`${thread.voted ? "Remove upvote from" : "Upvote"} ${thread.title}`}
            aria-pressed={thread.voted}
            title={signedIn ? "Vote for this request" : "Sign in to vote"}
            disabled={voting}
            onClick={onVote}
          >
            <ArrowUp size={16} />
            <span>{thread.votes ?? 0}</span>
          </button>
        ) : (
          <span
            className={`grid size-9 place-items-center max-[600px]:size-[34px] ${thread.public ? "text-[var(--threads-primary)]" : "text-[var(--threads-muted)]"}`}
          >
            {thread.public ? (
              <MessageCircle size={19} />
            ) : (
              <LockKeyhole size={18} />
            )}
          </span>
        )}
      </div>
      <Link
        to={to}
        state={{ from: currentPath }}
        className="block min-w-0 text-inherit no-underline hover:[&_h3]:text-[var(--threads-primary)]"
      >
        <div className="flex flex-wrap gap-1.5 text-xs font-semibold leading-[1.35] text-[var(--threads-muted)]">
          <span>{categoryLabels[thread.category]}</span>
          {thread.humanSupport && <span>· Support team</span>}
        </div>
        <h3 className="mt-1 overflow-hidden text-[15px] font-bold leading-[1.4] tracking-[-0.012em] text-[var(--threads-text)] text-ellipsis min-[601px]:text-base">
          {thread.title}
        </h3>
      </Link>
      <div
        className="hidden items-center gap-[5px] text-[13px] tabular-nums text-[var(--threads-muted)] min-[601px]:flex"
        aria-label={`${thread.replyCount ?? 0} replies`}
      >
        <MessageCircle size={15} /> {thread.replyCount ?? 0}
      </div>
      <div className="col-start-2 mt-1 flex min-w-0 gap-2 text-left min-[601px]:col-auto min-[601px]:mt-0 min-[601px]:grid min-[601px]:justify-items-end min-[601px]:gap-[3px] min-[601px]:text-right">
        <span
          className={`inline-flex items-center gap-[3px] text-xs font-bold ${thread.status === "resolved" || thread.progress === "shipped" ? "text-[var(--threads-success)]" : "text-[var(--threads-primary)]"}`}
        >
          {thread.status === "resolved" || thread.progress === "shipped" ? (
            <Check size={12} />
          ) : null}
          {status}
        </span>
        <time
          dateTime={thread.updatedAt}
          className="text-xs text-[var(--threads-muted)] max-[600px]:whitespace-normal min-[601px]:whitespace-nowrap"
        >
          {lastActivity}
        </time>
      </div>
      <Link
        to={to}
        state={{ from: currentPath }}
        className="hidden size-7 place-items-center text-[var(--threads-muted)] opacity-60 group-hover:text-[var(--threads-primary)] group-hover:opacity-100 min-[901px]:grid"
        aria-label={`Open ${thread.title}`}
      >
        <ArrowRight size={17} />
      </Link>
    </article>
  );
}
