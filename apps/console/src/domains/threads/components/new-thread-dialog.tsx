import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  MessageSquare,
  Send,
  Sparkles,
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { Loader } from "@/shared/ui/loader";
import { Composer } from "./composer";
import { threadsApi } from "../api/threads.api";
import type { Thread, ThreadCategory } from "../types/types";

const THREAD_TYPES = [
  {
    value: "support",
    label: "Question",
    help: "Ask support or peers for help",
    heading: "Ask a question",
    description: "Share the context someone needs to give you a useful answer.",
    titlePlaceholder: "What do you need help with?",
    detailsPlaceholder:
      "Describe what you tried, what happened, and what you expected…",
    icon: CircleHelp,
  },
  {
    value: "feature",
    label: "Feature request",
    help: "Propose an improvement to the product",
    heading: "Request a feature",
    description:
      "Explain the problem and the improvement you would like to see.",
    titlePlaceholder: "What would you like us to improve?",
    detailsPlaceholder:
      "Describe the problem, your ideal outcome, and who would benefit…",
    icon: Sparkles,
  },
  {
    value: "discussion",
    label: "Discussion",
    help: "Share an idea or start a conversation",
    heading: "Start a discussion",
    description: "Introduce a topic for the community to explore together.",
    titlePlaceholder: "What would you like to discuss?",
    detailsPlaceholder:
      "Add context, your perspective, or a question for the community…",
    icon: MessageSquare,
  },
] satisfies Array<{
  value: ThreadCategory;
  label: string;
  help: string;
  heading: string;
  description: string;
  titlePlaceholder: string;
  detailsPlaceholder: string;
  icon: typeof CircleHelp;
}>;

type NewThreadDialogProps = {
  open: boolean;
  busy: boolean;
  base: string;
  token: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onThread: (id: string) => void;
};

export function NewThreadDialog({
  open,
  busy,
  base,
  token,
  onOpenChange,
  onSubmit,
  onThread,
}: NewThreadDialogProps) {
  const [category, setCategory] = useState<ThreadCategory | null>(null);
  const [title, setTitle] = useState("");
  const [matches, setMatches] = useState<Thread[]>([]);
  const [matching, setMatching] = useState(false);
  useEffect(() => {
    if (!open || title.trim().length < 6) return;
    let current = true;
    const timer = window.setTimeout(() => {
      setMatching(true);
      void threadsApi
        .findSimilar(base, token, title)
        .then((threads) => {
          if (current) setMatches(threads);
        })
        .catch(() => {
          if (current) setMatches([]);
        })
        .finally(() => {
          if (current) setMatching(false);
        });
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [base, open, title, token]);
  function changeOpen(next: boolean) {
    if (!next) {
      setTitle("");
      setMatches([]);
      setMatching(false);
      setCategory(null);
    }
    onOpenChange(next);
  }
  const selectedType = THREAD_TYPES.find((type) => type.value === category);
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="threads-compose-dialog [&_h2]:[font-family:var(--font-sans)] [--threads-border:#c7c4d8] [--threads-primary:#5046e5] [border-color:var(--threads-border)] [border-radius:12px] [font-family:var(--font-sans)] [font-size:14px] [line-height:20px] [letter-spacing:var(--tracking-normal)] dark:[--threads-border:var(--border)] dark:[--threads-primary:var(--primary)] dark:[background:var(--popover)] dark:[color:var(--popover-foreground)] [&_button]:[font-family:var(--font-sans)] [&_input]:[font-family:var(--font-sans)] [&_textarea]:[font-family:var(--font-sans)] [&_legend]:[color:var(--foreground)] [&_legend]:[font-size:14px] [&_legend]:[font-weight:500] [&_legend]:[line-height:20px] [&_input]:[font-size:14px] [&_input]:[font-weight:400] [&_input]:[line-height:20px] [&_textarea]:[font-size:14px] [&_textarea]:[font-weight:400] [&_textarea]:[line-height:20px] [&_input::placeholder]:[font-weight:400] [&_textarea::placeholder]:[font-weight:400] [&[data-slot=\'input\']]:[height:36px] [&[data-slot=\'input\']]:[padding-inline:12px] max-h-[92vh] max-w-[672px] gap-0 overflow-y-auto p-0">
        <DialogHeader className="border-b border-[var(--threads-border)] px-6 py-5 pr-14">
          {selectedType && (
            <button
              type="button"
              className="threads-compose-back [display:inline-flex] [width:max-content] [align-items:center] [gap:5px] [margin-bottom:7px] [color:var(--muted-foreground)] [font-size:11px] [font-weight:600] hover:[color:var(--threads-primary)] [&_svg]:[width:13px] [&_svg]:[height:13px]"
              onClick={() => {
                setCategory(null);
                setTitle("");
                setMatches([]);
                setMatching(false);
              }}
            >
              <ArrowLeft /> Back to thread types
            </button>
          )}
          <DialogTitle className="text-lg font-semibold tracking-tight">
            {selectedType ? selectedType.heading : "Create a new thread"}
          </DialogTitle>
          <DialogDescription className="text-sm font-normal leading-5">
            {selectedType
              ? selectedType.description
              : "Choose the type of thread you want to create."}
          </DialogDescription>
        </DialogHeader>
        {!selectedType ? (
          <div className="threads-type-grid [display:grid] [gap:10px] [padding:20px_24px_24px] [&>button]:[display:grid] [&>button]:[min-height:76px] [&>button]:[grid-template-columns:38px_minmax(0,_1fr)_18px] [&>button]:[align-items:center] [&>button]:[gap:12px] [&>button]:[padding:12px_14px] [&>button]:[border:1px_solid_var(--threads-border)] [&>button]:[border-radius:9px] [&>button]:[text-align:left] [&>button]:[transition:border-color_120ms_ease,_background_120ms_ease,_transform_120ms_ease] [&>button:hover]:[border-color:color-mix(_in_srgb,_var(--threads-primary)_55%,_var(--threads-border)_)] [&>button:hover]:[background:color-mix(in_srgb,_var(--threads-primary)_4%,_var(--background))] [&>button:hover]:[transform:translateY(-1px)] [&>button:focus-visible]:[border-color:var(--threads-primary)] [&>button:focus-visible]:[outline:3px_solid_color-mix(in_srgb,_var(--threads-primary)_14%,_transparent)] [&>button:focus-visible]:[outline-offset:1px] [&>button>span:nth-child(2)]:[min-width:0] [&_strong]:[display:block] [&_strong]:[font-size:13px] [&_strong]:[font-weight:650] [&_strong]:[line-height:19px] [&_small]:[display:block] [&_small]:[margin-top:2px] [&_small]:[color:var(--muted-foreground)] [&_small]:[font-size:12px] [&_small]:[font-weight:400] [&_small]:[line-height:17px] [&>button>svg]:[width:16px] [&>button>svg]:[height:16px] [&>button>svg]:[color:var(--muted-foreground)] [&>button>svg]:[transition:transform_120ms_ease,_color_120ms_ease] [&>button:hover>svg]:[color:var(--threads-primary)] [&>button:hover>svg]:[transform:translateX(2px)] max-[767px]:[padding:16px]" aria-label="Thread types">
            {THREAD_TYPES.map(({ value, label, help, icon: Icon }) => (
              <button
                type="button"
                key={value}
                onClick={() => setCategory(value)}
              >
                <span className="threads-type-icon [display:grid] [width:38px] [height:38px] [place-items:center] [border-radius:8px] [color:var(--threads-primary)] [background:color-mix(in_srgb,_var(--threads-primary)_9%,_var(--background))] [&_svg]:[width:17px] [&_svg]:[height:17px]" aria-hidden="true">
                  <Icon />
                </span>
                <span>
                  <strong>{label}</strong>
                  <small>{help}</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <>
            <form
              id="threads-new-form"
              onSubmit={onSubmit}
              className="grid gap-5 px-6 py-5"
            >
              <input type="hidden" name="category" value={selectedType.value} />
              <label className="threads-field [color:var(--foreground)] [font-size:14px] [font-weight:500] [line-height:20px] [display:grid] [gap:7px] [&>span]:[display:flex] [&>span]:[justify-content:space-between] [&_i]:[color:var(--muted-foreground)] [&_i]:[font-size:12px] [&_i]:[font-style:normal] [&_i]:[font-weight:400]">
                Title
                <Input
                  name="title"
                  required
                  maxLength={180}
                  value={title}
                  onChange={(event) => {
                    const next = event.target.value;
                    setTitle(next);
                    if (next.trim().length < 6) {
                      setMatches([]);
                      setMatching(false);
                    }
                  }}
                  placeholder={selectedType.titlePlaceholder}
                />
              </label>
              {(matching || matches.length > 0) && (
                <section
                  className="overflow-hidden rounded-lg border border-[var(--threads-border)] bg-card"
                  aria-live="polite"
                >
                  <header className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-semibold">
                    <Sparkles className="size-3.5 text-[var(--threads-primary)]" />
                    Similar threads — check whether one already answers this
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {matching
                        ? "Searching"
                        : `${matches.length} ${matches.length === 1 ? "match" : "matches"}`}
                    </span>
                  </header>
                  {matching ? (
                    <div className="grid min-h-16 place-items-center">
                      <Loader size="sm" />
                    </div>
                  ) : (
                    matches.map((thread) => (
                      <button
                        type="button"
                        key={thread.id}
                        className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted/50"
                        onClick={() => {
                          changeOpen(false);
                          onThread(thread.id);
                        }}
                      >
                        <CheckCircle2
                          className={`size-3.5 shrink-0 ${thread.status === "resolved" ? "text-success" : "text-muted-foreground"}`}
                        />
                        <code className="shrink-0 text-[10px] text-muted-foreground">
                          #THR-{thread.id.slice(-3).toUpperCase()}
                        </code>
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {thread.title}
                        </span>
                        <span className="shrink-0 text-[var(--threads-primary)]">
                          View <ArrowUpRight className="inline size-3" />
                        </span>
                      </button>
                    ))
                  )}
                </section>
              )}
              <div className="threads-field [color:var(--foreground)] [font-size:14px] [font-weight:500] [line-height:20px] [display:grid] [gap:7px] [&>span]:[display:flex] [&>span]:[justify-content:space-between] [&_i]:[color:var(--muted-foreground)] [&_i]:[font-size:12px] [&_i]:[font-style:normal] [&_i]:[font-weight:400]">
                <span>
                  Details <i>Markdown supported</i>
                </span>
                <Composer
                  key={(open ? "open" : "closed") + "-" + selectedType.value}
                  base={base}
                  token={token}
                  placeholder={selectedType.detailsPlaceholder}
                />
              </div>
            </form>
            <DialogFooter className="border-t border-[var(--threads-border)] px-6 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => changeOpen(false)}
              >
                Cancel
              </Button>
              <Button
                form="threads-new-form"
                disabled={busy}
                className="threads-primary-button hover:[filter:brightness(0.94)] [color:white] [background:var(--threads-primary)]"
              >
                {busy ? <Loader size="sm" /> : <Send />}{" "}
                {busy
                  ? "Publishing…"
                  : "Publish " + selectedType.label.toLowerCase()}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
