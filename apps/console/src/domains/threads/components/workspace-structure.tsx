import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

export function WorkspaceHeading({
  eyebrow,
  title,
  description,
  action,
  footer,
  className,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "border-b border-[var(--threads-border)] py-6 max-[600px]:py-5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-6 max-[600px]:flex-col max-[600px]:items-start max-[600px]:gap-3.5">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-1 text-xs font-bold uppercase tracking-[0.09em] text-[var(--threads-muted)]">
              {eyebrow}
            </div>
          )}
          <h1
            id="threads-page-title"
            className="text-[clamp(28px,2.5vw,34px)] font-bold leading-[1.16] tracking-[-0.035em] text-[var(--threads-text)]"
          >
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm leading-normal text-[var(--threads-muted)]">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {footer && <div className="mt-4">{footer}</div>}
    </header>
  );
}

export function WorkspaceSectionHeading({
  title,
  detail,
  action,
  className,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[68px] items-center justify-between gap-4 py-4",
        className,
      )}
    >
      <div>
        <h2 className="text-base font-bold text-[var(--threads-text)]">
          {title}
        </h2>
        {detail && (
          <p className="mt-0.5 text-xs text-[var(--threads-muted)]">{detail}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function WorkspaceTabs({
  items,
  value,
  onChange,
  label,
  variant = "filter",
  className,
}: {
  items: ReadonlyArray<readonly [string, string]>;
  value: string;
  onChange: (value: string) => void;
  label: string;
  variant?: "filter" | "navigation";
  className?: string;
}) {
  const Element = variant === "navigation" ? "nav" : "div";
  return (
    <Element
      className={cn(
        "flex overflow-x-auto border-b border-[var(--threads-border)]",
        variant === "navigation" ? "mt-[17px] gap-6" : "gap-1 pb-2.5",
        className,
      )}
      aria-label={label}
      {...(variant === "filter" ? { role: "group" as const } : {})}
    >
      {items.map(([key, title]) => (
        <button
          type="button"
          key={key}
          className={cn(
            "shrink-0 text-[13px] font-semibold text-[var(--threads-muted)] hover:text-[var(--threads-text)]",
            variant === "navigation"
              ? "relative px-px pb-[13px] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-transparent"
              : "min-h-[30px] rounded px-2.5 hover:bg-[var(--threads-surface-low)]",
            value === key &&
              (variant === "navigation"
                ? "text-[var(--threads-text)] after:bg-[var(--threads-primary)]"
                : "bg-[color-mix(in_srgb,var(--threads-primary)_10%,var(--threads-surface))] text-[var(--threads-primary)]"),
          )}
          {...(variant === "navigation"
            ? { "aria-current": value === key ? ("page" as const) : undefined }
            : { "aria-pressed": value === key })}
          onClick={() => onChange(key)}
        >
          {title}
        </button>
      ))}
    </Element>
  );
}
