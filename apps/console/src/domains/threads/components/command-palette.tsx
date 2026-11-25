import {
  Bell,
  CornerDownLeft,
  Globe2,
  MessageSquarePlus,
  Search,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import type { PortalView, Thread } from "../types/types";

type CommandPaletteProps = {
  open: boolean;
  threads: Thread[];
  onOpenChange: (open: boolean) => void;
  onThread: (id: string) => void;
  onNewThread: () => void;
  onView: (view: PortalView) => void;
  onSearch: (query: string) => void;
};

export function CommandPalette({
  open,
  threads,
  onOpenChange,
  onThread,
  onNewThread,
  onView,
  onSearch,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const needle = query
      .trim()
      .toLowerCase()
      .replace(/^#thr-/, "");
    if (!needle) return threads.slice(0, 5);
    return threads
      .filter(
        (thread) =>
          thread.title.toLowerCase().includes(needle) ||
          thread.id.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [query, threads]);
  const closeThen = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setQuery("");
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="threads-command [&_strong]:[font-family:var(--font-sans)] [&_code]:[font-family:var(--font-mono)] [&_kbd]:[font-family:var(--font-mono)] [--threads-border:#c7c4d8] [--threads-primary:#5046e5] [border-radius:12px] [font-family:var(--font-sans)] dark:[--threads-border:var(--border)] dark:[--threads-primary:var(--primary)] dark:[background:var(--popover)] dark:[color:var(--popover-foreground)] [&_kbd]:[padding:2px_7px] [&_kbd]:[border:1px_solid_var(--threads-border)] [&_kbd]:[border-radius:6px] [&_kbd]:[color:var(--muted-foreground)] [&_kbd]:[font-size:11px] max-[767px]:[width:calc(100vw_-_24px)] max-w-[576px] gap-0 overflow-hidden border-[var(--threads-border)] p-0 [&>button]:hidden">
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <DialogDescription className="sr-only">
          Search threads or navigate the portal.
        </DialogDescription>
        <label className="threads-command-input [display:flex] [height:39px] [align-items:center] [gap:10px] [padding:0_16px] [border-bottom:1px_solid_var(--threads-border)] [&_svg]:[width:18px] [&_svg]:[color:var(--threads-primary)] [&_input]:[min-width:0] [&_input]:[flex:1] [&_input]:[outline:none] [&_input]:[font-size:14px]">
          <Search />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads, #THR-ID, or jump to…"
          />
          <kbd>Esc</kbd>
        </label>
        <div className="threads-command-body [max-height:430px] [overflow-y:auto] [padding:10px_8px] [&>p]:[padding:0_8px_6px] [&>p]:[color:var(--muted-foreground)] [&>p]:[font-size:12px] [&>p]:[font-weight:500] [&>button]:[display:flex] [&>button]:[width:100%] [&>button]:[min-height:40px] [&>button]:[align-items:center] [&>button]:[gap:8px] [&>button]:[padding:6px_9px] [&>button]:[border-radius:8px] [&>button]:[text-align:left] [&>button:hover]:[background:color-mix(in_srgb,_var(--threads-primary)_8%,_var(--background))] [&>button:hover]:[outline:none] [&>button:focus-visible]:[background:color-mix(in_srgb,_var(--threads-primary)_8%,_var(--background))] [&>button:focus-visible]:[outline:none] [&_svg]:[width:16px] [&_svg]:[flex:none] [&_code]:[color:var(--threads-primary)] [&_code]:[font-size:12px] [&_strong]:[min-width:0] [&_strong]:[flex:1] [&_strong]:[overflow:hidden] [&_strong]:[text-overflow:ellipsis] [&_strong]:[white-space:nowrap] [&_strong]:[font-size:13px] [&_strong]:[font-weight:500] [&_button_>_span:last-child]:[color:var(--muted-foreground)] [&_button_>_span:last-child]:[font-size:11px] [&_button_>_span:last-child]:[text-transform:capitalize] [&_hr]:[margin:8px_0_10px] [&_hr]:[border-color:var(--threads-border)]">
          <p>{query ? "Matching threads" : "Recent threads"}</p>
          {results.map((thread) => (
            <button
              type="button"
              key={thread.id}
              onClick={() => closeThen(() => onThread(thread.id))}
            >
              <span className="threads-command-kind">
                {thread.category === "feature" ? <Sparkles /> : <Globe2 />}
              </span>
              <code>#THR-{thread.id.slice(-3).toUpperCase()}</code>
              <strong>{thread.title}</strong>
              <span>
                {thread.status === "resolved"
                  ? "Resolved"
                  : thread.category === "feature"
                    ? (thread.progress || "under review").replaceAll("_", " ")
                    : "Open"}
              </span>
            </button>
          ))}
          {query && results.length === 0 && (
            <button
              type="button"
              onClick={() => closeThen(() => onSearch(query))}
            >
              <Search />
              <strong>Search all threads for “{query}”</strong>
              <CornerDownLeft />
            </button>
          )}
          <hr />
          <p>Actions &amp; navigation</p>
          <button type="button" onClick={() => closeThen(onNewThread)}>
            <MessageSquarePlus />
            <strong>Create new thread</strong>
            <kbd>C</kbd>
          </button>
          <button
            type="button"
            onClick={() => closeThen(() => onView("community"))}
          >
            <Globe2 />
            <strong>Go to Community</strong>
            <kbd>G C</kbd>
          </button>
          <button
            type="button"
            onClick={() => closeThen(() => onView("feature"))}
          >
            <Sparkles />
            <strong>Go to Feature Requests</strong>
            <kbd>G F</kbd>
          </button>
          <button
            type="button"
            onClick={() => closeThen(() => onView("updates"))}
          >
            <Bell />
            <strong>Go to Updates</strong>
            <kbd>G U</kbd>
          </button>
        </div>
        <footer className="threads-command-footer [display:flex] [gap:14px] [padding:5px_16px] [border-top:1px_solid_var(--threads-border)] [color:var(--muted-foreground)] [font-size:10px] [&_b]:[margin-left:auto] [&_b]:[font-weight:500]">
          <span>↑↓ Navigate</span>
          <span>↵ Open</span>
          <span>Esc Close</span>
          <b>InteraOne Threads</b>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
