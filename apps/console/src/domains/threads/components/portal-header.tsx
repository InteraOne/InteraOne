import {
  Bell,
  Compass,
  LogIn,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useTheme } from "@/shared/theme/theme-context";
import type { PortalBrand, PortalView } from "../types/types";

type PortalHeaderProps = {
  brand?: PortalBrand;
  home: string;
  view: PortalView;
  signedIn: boolean;
  unavailable: boolean;
  busy: boolean;
  myCount: number;
  updateCount: number;
  onHome: () => void;
  onSession: () => void;
  onNewThread: () => void;
  onSearch: () => void;
  onViewChange: (view: PortalView) => void;
};

const navigation = [
  { key: "community", label: "Community", icon: Compass },
  { key: "feature", label: "Featured", icon: Sparkles },
  { key: "mine", label: "My threads", icon: MessageCircle },
] as const;

export function PortalHeader(props: PortalHeaderProps) {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const visit = (view: PortalView) => {
    props.onViewChange(view);
    setOpen(false);
  };
  const active = (key: PortalView) =>
    key === "mine"
      ? ["mine", "upvoted", "following"].includes(props.view)
      : props.view === key;

  return (
    <>
      <header className="sticky top-0 z-40 flex h-[54px] items-center justify-between border-b border-[var(--threads-border)] bg-[var(--threads-surface)] px-[17px] min-[901px]:hidden">
        <button
          type="button"
          className="grid size-[34px] shrink-0 place-items-center text-[var(--threads-text)]"
          aria-label="Open navigation"
          aria-controls="threads-portal-navigation"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Menu size={20} />
        </button>
        <Link
          to={props.home}
          onClick={props.onHome}
          className="truncate text-sm font-bold text-[var(--threads-text)]"
        >
          {props.brand?.name || "Threads"}
        </Link>
        <button
          type="button"
          className="grid size-[34px] shrink-0 place-items-center text-[var(--threads-text)]"
          aria-label="Search threads"
          onClick={props.onSearch}
        >
          <Search size={19} />
        </button>
      </header>
      {open && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-[#16121680] min-[901px]:hidden"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="threads-portal-navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-[var(--threads-border)] bg-[var(--threads-surface-low)] px-4 pb-[18px] pt-[27px] max-[900px]:w-[min(280px,85vw)] max-[900px]:transition-transform max-[900px]:duration-200 ${open ? "max-[900px]:translate-x-0" : "max-[900px]:-translate-x-[101%]"}`}
      >
        <div className="flex items-center justify-between gap-2 px-2">
          <Link
            to={props.home}
            className="flex min-w-0 items-center gap-[11px] text-inherit no-underline"
            onClick={() => {
              props.onHome();
              setOpen(false);
            }}
          >
            <span className="grid size-[38px] shrink-0 place-items-center overflow-hidden rounded-[9px] bg-[var(--threads-action-bg)] text-white [&_img]:size-full [&_img]:object-contain">
              {props.brand?.logoUrl ? (
                <img
                  src={props.brand.logoUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <MessageCircle size={20} />
              )}
            </span>
            <span className="grid min-w-0 gap-px [&_strong]:truncate [&_strong]:text-[15px] [&_strong]:font-bold [&_strong]:leading-[1.2] [&_small]:text-xs [&_small]:leading-[1.25] [&_small]:text-[var(--threads-muted)]">
              <strong>{props.brand?.name || "Threads"}</strong>
              <small>Community portal</small>
            </span>
          </Link>
          <button
            type="button"
            className="hidden size-[30px] shrink-0 place-items-center text-[var(--threads-muted)] max-[900px]:grid"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <button
          type="button"
          className="mt-6 flex h-10 w-full items-center gap-2.5 rounded-[7px] border border-[var(--threads-border)] bg-[var(--threads-surface)] px-2.5 text-left text-[13px] text-[var(--threads-muted)] hover:border-[var(--threads-primary)] hover:text-[var(--threads-text)] [&_span]:flex-1 [&_kbd]:rounded-[3px] [&_kbd]:border [&_kbd]:border-[var(--threads-border)] [&_kbd]:px-[5px] [&_kbd]:py-px [&_kbd]:text-[10px]"
          onClick={() => {
            props.onSearch();
            setOpen(false);
          }}
        >
          <Search size={17} />
          <span>Search threads</span>
          <kbd>/</kbd>
        </button>

        <div className="mt-6">
          <p className="mx-[11px] mb-[9px] text-xs font-bold uppercase tracking-[0.105em] text-[var(--threads-muted)]">
            Explore
          </p>
          <nav aria-label="Portal navigation" className="grid gap-[3px]">
            {navigation.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                className={`flex min-h-[41px] w-full items-center gap-[11px] rounded-md px-[11px] text-left text-sm font-semibold hover:bg-[var(--threads-surface-high)] hover:text-[var(--threads-text)] [&_span:nth-child(2)]:flex-1 ${active(key) ? "bg-[color-mix(in_srgb,var(--threads-primary)_11%,var(--threads-surface))] text-[var(--threads-primary)]" : "text-[var(--threads-muted)]"}`}
                aria-current={active(key) ? "page" : undefined}
                onClick={() => visit(key)}
              >
                <Icon size={18} strokeWidth={1.9} />
                <span>{label}</span>
                {key === "mine" && props.signedIn && props.myCount > 0 && (
                  <span className="min-w-[22px] rounded bg-[var(--threads-surface)] px-[5px] py-0.5 text-center text-xs text-[var(--threads-muted)]">
                    {props.myCount > 99 ? "99+" : props.myCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-[19px] border-t border-[var(--threads-border)] pt-[19px]">
          <p className="mx-[11px] mb-[9px] text-xs font-bold uppercase tracking-[0.105em] text-[var(--threads-muted)]">
            Your activity
          </p>
          <button
            type="button"
            className={`flex min-h-[41px] w-full items-center gap-[11px] rounded-md px-[11px] text-left text-sm font-semibold hover:bg-[var(--threads-surface-high)] hover:text-[var(--threads-text)] [&_span:nth-child(2)]:flex-1 ${props.view === "updates" ? "bg-[color-mix(in_srgb,var(--threads-primary)_11%,var(--threads-surface))] text-[var(--threads-primary)]" : "text-[var(--threads-muted)]"}`}
            aria-current={props.view === "updates" ? "page" : undefined}
            onClick={() => visit("updates")}
          >
            <Bell size={18} strokeWidth={1.9} />
            <span>Updates</span>
            {props.signedIn && props.updateCount > 0 && (
              <span className="min-w-[22px] rounded bg-[var(--threads-surface)] px-[5px] py-0.5 text-center text-xs text-[var(--threads-muted)]">
                {props.updateCount > 99 ? "99+" : props.updateCount}
              </span>
            )}
          </button>
        </div>

        <div className="mt-auto pt-6">
          {!props.unavailable && (
            <button
              type="button"
              className="inline-flex min-h-[39px] w-full items-center justify-center gap-2 rounded-md border border-[var(--threads-action-bg)] bg-[var(--threads-action-bg)] px-[15px] text-[13px] font-bold text-white hover:brightness-[0.92] min-[901px]:hidden"
              onClick={() => {
                props.onNewThread();
                setOpen(false);
              }}
            >
              <Plus size={18} /> Start a thread
            </button>
          )}
          <div className="mt-[18px] grid gap-0.5 border-t border-[var(--threads-border)] pt-[14px] [&_button]:flex [&_button]:min-h-[34px] [&_button]:items-center [&_button]:gap-[11px] [&_button]:rounded-[5px] [&_button]:px-[9px] [&_button]:text-left [&_button]:text-[13px] [&_button]:text-[var(--threads-muted)] [&_button:hover]:bg-[var(--threads-surface-high)] [&_button:hover]:text-[var(--threads-text)] [&_button:disabled]:opacity-50">
            <button type="button" onClick={toggleTheme}>
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
            </button>
            {!props.unavailable && (
              <button
                type="button"
                disabled={props.busy}
                onClick={props.onSession}
              >
                {props.signedIn ? <LogOut size={17} /> : <LogIn size={17} />}
                <span>{props.signedIn ? "Sign out" : "Sign in"}</span>
              </button>
            )}
          </div>
          <p className="mx-[9px] mt-[22px] text-xs text-[var(--threads-muted)]">
            Powered by InteraOne
          </p>
        </div>
      </aside>
    </>
  );
}
