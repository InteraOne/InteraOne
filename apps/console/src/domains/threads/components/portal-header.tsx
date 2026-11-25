import {
  Bell,
  Globe2,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
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

const portalLinks = [
  ["community", "Community", Globe2],
  ["feature", "Feature requests", Sparkles],
  ["mine", "My threads", MessageSquare],
  ["updates", "Updates", Bell],
] as const;

export function PortalHeader(props: PortalHeaderProps) {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const navigation = (
    <>
      <div className="flex min-h-9 items-center justify-between gap-2">
        <Link to={props.home} className="flex min-w-0 items-center gap-2" onClick={() => { props.onHome(); setOpen(false); }}>
          <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--threads-primary)] text-white">
            {props.brand?.logoUrl ? <img src={props.brand.logoUrl} alt="" className="size-full object-contain" referrerPolicy="no-referrer" /> : <MessageSquare className="size-4" />}
          </span>
          <span className="min-w-0 leading-tight">
            <strong className="block truncate text-[15px] font-semibold">{props.brand?.name || "Threads"}</strong>
            <span className="block truncate text-xs font-medium text-[var(--threads-primary)]">InteraOne Threads</span>
          </span>
        </Link>
        <button type="button" className="grid size-9 place-items-center rounded-lg hover:bg-[var(--threads-surface-low)] lg:hidden" aria-label="Close navigation" onClick={() => setOpen(false)}><X className="size-[18px]" /></button>
      </div>
      <button type="button" className="mt-3.5 flex h-[37px] items-center gap-[7px] rounded-lg border border-[var(--threads-border)] px-[9px] text-left text-[13px] hover:border-[var(--threads-primary)]" onClick={() => { props.onSearch(); setOpen(false); }}>
        <Search className="size-4" /><span className="flex-1">Search</span><kbd className="rounded border border-[var(--threads-border)] bg-[var(--threads-surface-low)] px-1.5 text-[var(--threads-muted)]">/</kbd>
      </button>
      <button type="button" className="mt-4 flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[var(--threads-primary)] text-sm font-semibold text-white hover:brightness-95" onClick={() => { props.onNewThread(); setOpen(false); }}><Plus className="size-[17px]" /> New thread</button>
      <nav className="mt-[17px]" aria-label="Portal navigation">
        <p className="px-2 pb-1.5 text-xs font-semibold text-[var(--threads-muted)]">Portal</p>
        {portalLinks.map(([key, label, Icon]) => {
          const count = key === "mine" ? props.myCount : key === "updates" ? props.updateCount : 0;
          const active = key === "mine" ? ["mine", "upvoted", "following"].includes(props.view) : props.view === key;
          return <button key={key} type="button" className={`flex min-h-[33px] w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-[var(--threads-surface-low)] ${active ? "bg-[var(--threads-surface-low)] font-semibold text-[var(--threads-primary)]" : "text-[var(--threads-muted)]"}`} aria-current={active ? "page" : undefined} onClick={() => { props.onViewChange(key); setOpen(false); }}>
            <Icon className="size-4" /><span className="flex-1">{label}</span>{count > 0 && <b className="grid min-w-[19px] place-items-center rounded-full bg-[var(--threads-surface-low)] px-1.5 text-[11px]">{count > 99 ? "99+" : count}</b>}
          </button>;
        })}
      </nav>
      <div className="-mx-4 -mb-4 mt-auto grid gap-0.5 border-t border-[var(--threads-border)] p-3 text-xs text-[var(--threads-muted)]">
        <button type="button" className="flex min-h-[34px] items-center gap-2 rounded-md px-2 hover:bg-[var(--threads-surface-low)]" onClick={toggleTheme}>{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}{theme === "dark" ? "Light mode" : "Dark mode"}</button>
        {!props.unavailable && <button type="button" className="flex min-h-[34px] items-center gap-2 rounded-md px-2 hover:bg-[var(--threads-surface-low)]" disabled={props.busy} onClick={props.onSession}>{props.signedIn ? <LogOut className="size-4" /> : <LogIn className="size-4" />}{props.signedIn ? "Sign out" : "Sign in"}</button>}
      </div>
    </>
  );
  return <>
    <header className="sticky top-0 z-35 flex h-14 items-center justify-between border-b border-[var(--threads-border)] bg-[var(--threads-surface)] px-3 lg:hidden">
      <button type="button" className="grid size-9 place-items-center" aria-label="Open navigation" aria-expanded={open} aria-controls="threads-portal-navigation" onClick={() => setOpen(true)}><Menu className="size-[18px]" /></button>
      <Link to={props.home} className="min-w-0 truncate font-semibold" onClick={props.onHome}>{props.brand?.name || "Threads"}</Link>
      <button type="button" className="grid size-9 place-items-center" aria-label="Search threads" onClick={props.onSearch}><Search className="size-[18px]" /></button>
    </header>
    {open && <button type="button" className="fixed inset-0 z-39 bg-black/45 lg:hidden" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside id="threads-portal-navigation" className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-[var(--threads-border)] bg-[var(--threads-surface)] p-4 text-[var(--threads-text)] max-lg:transition-transform ${open ? "max-lg:translate-x-0" : "max-lg:hidden"}`}>{navigation}</aside>
  </>;
}
