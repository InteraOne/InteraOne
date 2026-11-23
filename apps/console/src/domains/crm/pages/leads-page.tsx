import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Flame,
  GripVertical,
  MoreHorizontal,
  Plus,
  Search,
  Tags,
  Download,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { DeleteConfirmDialog } from "@/shared/components/delete-confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { LeadDialog } from "../components/lead-dialog";
import { LeadDetailsPage } from "./lead-details-page";
import {
  useConvertLead,
  useDeleteCrmRecord,
  useLeads,
  useUpdateCrmRecord,
} from "../hooks/use-crm-records";

const labelClass = () =>
  "border border-border/70 bg-foreground/[0.035] text-muted-foreground";

const money = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);

const formatNextActivity = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfActivity = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDifference = Math.round(
    (startOfActivity.getTime() - startOfToday.getTime()) / 86_400_000,
  );
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (dayDifference === -1) return `Yesterday at ${time}`;
  if (dayDifference === 0) return `Today at ${time}`;
  if (dayDifference === 1) return `Tomorrow at ${time}`;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatCreatedAt = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

type LeadColumnId =
  | "title"
  | "contact"
  | "organization"
  | "nextActivity"
  | "labels"
  | "source"
  | "created"
  | "owner";

const LEAD_COLUMNS: Record<LeadColumnId, { label: string; width: string }> = {
  title: { label: "Lead", width: "minmax(280px,1.35fr)" },
  contact: { label: "Contact person", width: "minmax(240px,1.05fr)" },
  organization: { label: "Organization", width: "minmax(200px,.95fr)" },
  nextActivity: { label: "Next activity", width: "minmax(200px,1fr)" },
  labels: { label: "Labels", width: "minmax(150px,.75fr)" },
  source: { label: "Source", width: "minmax(150px,.75fr)" },
  created: { label: "Created", width: "minmax(180px,.9fr)" },
  owner: { label: "Owner", width: "minmax(180px,.85fr)" },
};
const DEFAULT_LEAD_COLUMN_ORDER = Object.keys(LEAD_COLUMNS) as LeadColumnId[];

export function LeadsPage() {
  const { data: leads = [], isLoading } = useLeads();
  const pageRef = useRef<HTMLDivElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState("all");
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [isDetailsClosing, setIsDetailsClosing] = useState(false);
  const [detailsPanelHeight, setDetailsPanelHeight] = useState<number>();
  const [actionMenu, setActionMenu] = useState<{
    leadId: string;
    title: string;
    top: number;
    left: number;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkLabelsOpen, setBulkLabelsOpen] = useState(false);
  const [bulkLabelsInput, setBulkLabelsInput] = useState("");
  const [draggedColumn, setDraggedColumn] = useState<LeadColumnId | null>(null);
  const [columnOrder, setColumnOrder] = useState<LeadColumnId[]>(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem("leads-column-order") || "[]",
      ) as LeadColumnId[];
      return saved.length === DEFAULT_LEAD_COLUMN_ORDER.length &&
        DEFAULT_LEAD_COLUMN_ORDER.every((id) => saved.includes(id))
        ? saved
        : DEFAULT_LEAD_COLUMN_ORDER;
    } catch {
      return DEFAULT_LEAD_COLUMN_ORDER;
    }
  });
  const convertLead = useConvertLead();
  const deleteLead = useDeleteCrmRecord("lead");
  const updateLead = useUpdateCrmRecord("lead");

  useEffect(() => {
    window.localStorage.setItem(
      "leads-column-order",
      JSON.stringify(columnOrder),
    );
  }, [columnOrder]);

  useEffect(() => {
    if (!actionMenu) return;
    const close = () => setActionMenu(null);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [actionMenu]);

  useLayoutEffect(() => {
    const page = pageRef.current;
    const container = page?.parentElement;
    if (!activeLeadId || !page || !container) {
      return;
    }

    const alignPanelBottom = () => {
      const height =
        container.getBoundingClientRect().bottom -
        page.getBoundingClientRect().top;
      setDetailsPanelHeight(Math.max(0, Math.floor(height)));
    };

    alignPanelBottom();
    const observer = new ResizeObserver(alignPanelBottom);
    observer.observe(container);
    window.addEventListener("resize", alignPanelBottom);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", alignPanelBottom);
    };
  }, [activeLeadId]);

  const moveColumn = (source: LeadColumnId, targetIndex: number) => {
    setColumnOrder((current) => {
      const sourceIndex = current.indexOf(source);
      if (sourceIndex < 0) return current;
      const next = [...current];
      next.splice(sourceIndex, 1);
      next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, source);
      return next;
    });
  };
  const columnGridTemplate = columnOrder
    .map((id) => LEAD_COLUMNS[id].width)
    .join(" ");

  const labels = useMemo(
    () => [...new Set(leads.flatMap((lead) => lead.labels || []))].sort(),
    [leads],
  );
  const filteredLeads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return leads.filter((lead) => {
      const matchesLabel =
        labelFilter === "all" || lead.labels?.includes(labelFilter);
      const matchesSearch =
        !query ||
        [
          lead.title,
          lead.contact?.name,
          lead.contact?.email,
          lead.company,
          lead.owner?.name,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));
      return matchesLabel && matchesSearch;
    });
  }, [labelFilter, leads, search]);
  const activeLeadIndex = activeLeadId
    ? filteredLeads.findIndex((lead) => lead.id === activeLeadId)
    : -1;

  const convertSelectedLead = async (id: string) => {
    setActionMenu(null);
    try {
      await convertLead.mutateAsync(id);
      toast.success("Lead converted to deal");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to convert lead",
      );
    }
  };

  const deleteSelectedLead = async () => {
    if (!deleteTarget) return;
    try {
      await deleteLead.mutateAsync(deleteTarget.id);
      setSelectedLeads((current) =>
        current.filter((id) => id !== deleteTarget.id),
      );
      if (activeLeadId === deleteTarget.id) setActiveLeadId(null);
      setDeleteTarget(null);
      toast.success("Lead deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete lead",
      );
    }
  };

  const toggleSelectPage = () => {
    const pageIds = filteredLeads.map((lead) => lead.id);
    const allSelected = pageIds.every((id) => selectedLeads.includes(id));
    setSelectedLeads((current) =>
      allSelected
        ? current.filter((id) => !pageIds.includes(id))
        : [...new Set([...current, ...pageIds])],
    );
  };

  const exportSelectedLeads = () => {
    const selected = leads.filter((lead) => selectedLeads.includes(lead.id));
    if (!selected.length) return;
    const rows = [
      [
        "Title",
        "Contact",
        "Organization",
        "Value",
        "Currency",
        "Labels",
        "Owner",
      ],
      ...selected.map((lead) => [
        lead.title,
        lead.contact?.name || "",
        lead.account?.name || lead.company || "",
        String(lead.value),
        lead.currency,
        (lead.labels || []).join("; "),
        lead.owner?.name || "",
      ]),
    ];
    const csv = rows
      .map((row) =>
        row.map((value) => `"${value.replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "selected-leads.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const addLabelsToSelectedLeads = async () => {
    const labelsToAdd = bulkLabelsInput
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    if (!labelsToAdd.length) return;
    try {
      await Promise.all(
        leads
          .filter((lead) => selectedLeads.includes(lead.id))
          .map((lead) =>
            updateLead.mutateAsync({
              id: lead.id,
              labels: [...new Set([...(lead.labels || []), ...labelsToAdd])],
            }),
          ),
      );
      setBulkLabelsInput("");
      setBulkLabelsOpen(false);
      toast.success("Labels added to selected leads");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add labels",
      );
    }
  };

  const deleteSelectedLeads = async () => {
    try {
      await Promise.all(selectedLeads.map((id) => deleteLead.mutateAsync(id)));
      if (activeLeadId && selectedLeads.includes(activeLeadId))
        setActiveLeadId(null);
      setSelectedLeads([]);
      setBulkDeleteOpen(false);
      toast.success("Selected leads deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete leads",
      );
    }
  };

  return (
    <div ref={pageRef} className="crm-workspace relative space-y-6 pb-8">
      <header className="flex flex-col gap-5 border-b border-border/60 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            CRM · Pipeline
          </p>
          <div className="flex items-center gap-3">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em]">
              Leads
            </h1>
            <span className="rounded-full border border-border/70 bg-background px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {leads.length}
            </span>
          </div>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
            Qualify incoming opportunities and keep every next step moving.
          </p>
        </div>
        <Button
          size="lg"
          className="rounded-lg px-4 shadow-sm"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="mr-1 h-4 w-4" /> New lead
        </Button>
      </header>

      <Card className="gap-0 overflow-hidden rounded-xl border border-border/70 bg-card py-0 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_10px_36px_rgba(0,0,0,0.035)] ring-0">
        <div className="flex flex-col gap-3 border-b border-border/60 p-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1 lg:max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/75" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search leads, people, companies, or owners…"
              className="h-9 border-transparent bg-foreground/[0.035] pl-9 pr-9 shadow-none focus-visible:bg-background"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <Filter className="h-4 w-4 text-muted-foreground/75" />
            <Select value={labelFilter} onValueChange={setLabelFilter}>
              <SelectTrigger className="h-9 w-[180px] border-border/70 bg-background shadow-none">
                <SelectValue placeholder="All labels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All labels</SelectItem>
                {labels.map((label) => (
                  <SelectItem key={label} value={label}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <CardContent className="p-0">
          <div className="space-y-0">
            {selectedLeads.length > 0 && (
              <div className="m-3 mb-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-foreground/[0.03] px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-md bg-primary px-1 text-[11px] text-primary-foreground">
                    {selectedLeads.length}
                  </span>
                  selected
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBulkLabelsOpen(true)}
                  >
                    <Tags className="h-3.5 w-3.5" /> Add labels
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportSelectedLeads}
                  >
                    <Download className="h-3.5 w-3.5" /> Export
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={
                    filteredLeads.length > 0 &&
                    filteredLeads.every((lead) =>
                      selectedLeads.includes(lead.id),
                    )
                  }
                  onChange={toggleSelectPage}
                  className="crm-checkbox cursor-pointer"
                />
                Select page
              </label>
              <span>
                Showing {filteredLeads.length} of {leads.length} results
              </span>
            </div>
          </div>
          <div className="crm-table-scroll overflow-x-auto">
            <div className="min-w-[1740px]">
              <div
                className="sticky top-0 z-10 grid items-stretch border-b border-border/70 bg-card/95 text-[11px] font-semibold uppercase tracking-[0.075em] text-muted-foreground backdrop-blur"
                style={{
                  gridTemplateColumns: `48px ${columnGridTemplate} 48px`,
                }}
              >
                <span className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label="Select all leads"
                    checked={
                      filteredLeads.length > 0 &&
                      filteredLeads.every((lead) =>
                        selectedLeads.includes(lead.id),
                      )
                    }
                    onChange={(event) =>
                      setSelectedLeads(
                        event.target.checked
                          ? filteredLeads.map((lead) => lead.id)
                          : [],
                      )
                    }
                    className="crm-checkbox cursor-pointer"
                  />
                </span>
                {columnOrder.map((columnId, index) => {
                  return (
                    <div
                      key={columnId}
                      draggable
                      onDragStart={(event) => {
                        setDraggedColumn(columnId);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDraggedColumn(null)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggedColumn && draggedColumn !== columnId)
                          moveColumn(draggedColumn, index);
                        setDraggedColumn(null);
                      }}
                      className={`group flex cursor-grab items-center gap-1.5 px-3 py-3.5 active:cursor-grabbing ${draggedColumn === columnId ? "bg-primary/10 opacity-60" : "hover:bg-foreground/[0.03]"}`}
                    >
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/35 opacity-0 transition-opacity group-hover:opacity-100" />
                      <span className="min-w-0 flex-1 truncate">
                        {LEAD_COLUMNS[columnId].label}
                      </span>
                      <span className="hidden shrink-0 group-hover:flex group-focus-within:flex">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveColumn(columnId, index - 1)}
                          className="rounded p-0.5 hover:bg-background disabled:opacity-20"
                          aria-label={`Move ${LEAD_COLUMNS[columnId].label} left`}
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={index === columnOrder.length - 1}
                          onClick={() => moveColumn(columnId, index + 1)}
                          className="rounded p-0.5 hover:bg-background disabled:opacity-20"
                          aria-label={`Move ${LEAD_COLUMNS[columnId].label} right`}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </div>
                  );
                })}
                <span />
              </div>

              <div className="flex flex-col">
                {filteredLeads.map((lead) => {
                  const nextActivity = lead.activities
                    .filter(
                      (activity) => activity.dueAt && !activity.completedAt,
                    )
                    .sort(
                      (a, b) =>
                        new Date(a.dueAt!).getTime() -
                        new Date(b.dueAt!).getTime(),
                    )[0];
                  const selected = selectedLeads.includes(lead.id);
                  const active = activeLeadId === lead.id;
                  return (
                    <div
                      key={lead.id}
                      className={`grid min-h-[64px] border-b border-border/55 transition-colors last:border-b-0 ${selected || active ? "bg-primary/[0.055] shadow-[inset_2px_0_0_var(--primary)]" : "hover:bg-foreground/[0.025]"}`}
                      style={{
                        gridTemplateColumns: `48px ${columnGridTemplate} 48px`,
                      }}
                    >
                      <div className="flex items-start justify-center pt-4">
                        <input
                          type="checkbox"
                          aria-label={`Select ${lead.title}`}
                          checked={selected}
                          onChange={() =>
                            setSelectedLeads((current) =>
                              selected
                                ? current.filter((id) => id !== lead.id)
                                : [...current, lead.id],
                            )
                          }
                          className="crm-checkbox cursor-pointer"
                        />
                      </div>
                      {columnOrder.map((columnId) => (
                        <button
                          key={columnId}
                          type="button"
                          onClick={() => setActiveLeadId(lead.id)}
                          className="flex min-w-0 flex-col items-start justify-start overflow-hidden px-3 py-3 text-left outline-none hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          {columnId === "title" ? (
                            <span className="block w-full min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {lead.title}
                              </span>
                              <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                                {money(lead.value, lead.currency)}
                              </span>
                            </span>
                          ) : columnId === "contact" ? (
                            <span className="block w-full min-w-0">
                              <span className="block truncate text-sm text-foreground">
                                {lead.contact?.name || "—"}
                              </span>
                              {lead.contact?.email ? (
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                  {lead.contact.email}
                                </span>
                              ) : null}
                            </span>
                          ) : columnId === "organization" ? (
                            <span className="block w-full truncate">
                              {lead.account?.name || lead.company || "—"}
                            </span>
                          ) : columnId === "nextActivity" ? (
                            nextActivity ? (
                              <span
                                className={
                                  new Date(nextActivity.dueAt!).getTime() <
                                  Date.now()
                                    ? "block w-full truncate font-medium text-foreground"
                                    : "block w-full truncate text-foreground"
                                }
                              >
                                {formatNextActivity(nextActivity.dueAt!)}
                              </span>
                            ) : (
                              <span className="block w-full truncate text-muted-foreground">
                                No activity
                              </span>
                            )
                          ) : columnId === "labels" ? (
                            <span className="flex w-full flex-wrap items-center gap-1">
                              {lead.labels?.length ? (
                                lead.labels.slice(0, 2).map((label) => (
                                  <span
                                    key={label}
                                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${labelClass()}`}
                                  >
                                    {label}
                                  </span>
                                ))
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                              {(lead.labels?.length || 0) > 2 && (
                                <span className="text-xs text-muted-foreground">
                                  +{lead.labels!.length - 2}
                                </span>
                              )}
                            </span>
                          ) : columnId === "source" ? (
                            <span className="block w-full truncate text-muted-foreground">
                              {lead.sourceOrigin === "manual"
                                ? "Manually created"
                                : lead.sourceOrigin || "—"}
                            </span>
                          ) : columnId === "created" ? (
                            <span className="block w-full truncate text-muted-foreground">
                              {formatCreatedAt(lead.createdAt)}
                            </span>
                          ) : (
                            <span className="flex w-full min-w-0 items-center gap-2 overflow-hidden">
                              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-background text-[10px] font-semibold">
                                {lead.owner?.name
                                  ?.split(" ")
                                  .map((part) => part[0])
                                  .join("")
                                  .slice(0, 2)
                                  .toUpperCase() || "—"}
                              </span>
                              <span className="min-w-0 truncate">
                                {lead.owner?.name || "Unassigned"}
                              </span>
                            </span>
                          )}
                        </button>
                      ))}
                      <div className="flex items-center justify-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`More actions for ${lead.title}`}
                          aria-haspopup="menu"
                          aria-expanded={actionMenu?.leadId === lead.id}
                          onClick={(event) => {
                            const rect =
                              event.currentTarget.getBoundingClientRect();
                            const menuWidth = 212;
                            const menuHeight = 104;
                            setActionMenu((current) =>
                              current?.leadId === lead.id
                                ? null
                                : {
                                    leadId: lead.id,
                                    title: lead.title,
                                    top:
                                      rect.bottom + menuHeight + 8 <=
                                      window.innerHeight
                                        ? rect.bottom + 6
                                        : Math.max(
                                            8,
                                            rect.top - menuHeight - 6,
                                          ),
                                    left: Math.max(
                                      8,
                                      Math.min(
                                        window.innerWidth - menuWidth - 8,
                                        rect.right - menuWidth,
                                      ),
                                    ),
                                  },
                            );
                          }}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {!isLoading && filteredLeads.length === 0 && (
            <div className="m-4 rounded-xl border border-dashed border-border/80 bg-foreground/[0.015] py-14 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-foreground/[0.05]">
                <Flame className="h-5 w-5 text-muted-foreground" />
              </span>
              <p className="mt-3 font-medium">No leads found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a lead or adjust your search.
              </p>
            </div>
          )}
          {isLoading && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Loading leads…
            </div>
          )}
        </CardContent>
      </Card>
      {activeLeadId && (
        <section
          className={`lead-details-panel absolute inset-y-0 left-0 right-0 z-30 min-w-0 overflow-visible rounded-r-xl border border-border/80 bg-background shadow-2xl lg:left-43 ${
            isDetailsClosing
              ? "lead-details-panel--closing"
              : "lead-details-panel--opening"
          }`}
          style={
            detailsPanelHeight === undefined
              ? undefined
              : { height: detailsPanelHeight }
          }
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget || !isDetailsClosing)
              return;
            setActiveLeadId(null);
            setIsDetailsClosing(false);
          }}
        >
          <div className="absolute -left-12 top-2 z-50 flex w-12 flex-col overflow-hidden rounded-l-xl border border-r-0 border-border bg-background p-1 shadow-lg">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsDetailsClosing(true)}
              title="Close lead details"
            >
              <span className="text-xl leading-none">×</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={activeLeadIndex <= 0}
              onClick={() => {
                if (activeLeadIndex > 0)
                  setActiveLeadId(filteredLeads[activeLeadIndex - 1].id);
              }}
              title="Previous lead"
            >
              <ChevronLeft className="h-4 w-4 rotate-90" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={
                activeLeadIndex < 0 ||
                activeLeadIndex >= filteredLeads.length - 1
              }
              onClick={() => {
                if (
                  activeLeadIndex >= 0 &&
                  activeLeadIndex < filteredLeads.length - 1
                )
                  setActiveLeadId(filteredLeads[activeLeadIndex + 1].id);
              }}
              title="Next lead"
            >
              <ChevronRight className="h-4 w-4 rotate-90" />
            </Button>
          </div>
          <LeadDetailsPage
            key={activeLeadId}
            leadId={activeLeadId}
            embedded
            showNavigationControls={false}
            onClose={() => setIsDetailsClosing(true)}
          />
        </section>
      )}

      <LeadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(id) => setActiveLeadId(id)}
      />

      {actionMenu &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close lead actions"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setActionMenu(null)}
            />
            <div
              role="menu"
              aria-label={`Actions for ${actionMenu.title}`}
              className="fixed z-50 w-[212px] overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
              style={{ top: actionMenu.top, left: actionMenu.left }}
            >
              <button
                type="button"
                role="menuitem"
                disabled={convertLead.isPending}
                onClick={() => void convertSelectedLead(actionMenu.leadId)}
                className="flex w-full rounded-md px-3 py-2.5 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                Convert to deal
              </button>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDeleteTarget({
                    id: actionMenu.leadId,
                    title: actionMenu.title,
                  });
                  setActionMenu(null);
                }}
                className="flex w-full rounded-md px-3 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10"
              >
                Delete
              </button>
            </div>
          </>,
          document.body,
        )}

      <DeleteConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void deleteSelectedLead()}
        title="Delete Lead"
        itemName={deleteTarget?.title}
        isDeleting={deleteLead.isPending}
      />
      <DeleteConfirmDialog
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={() => void deleteSelectedLeads()}
        title="Delete Selected Leads"
        itemName={`${selectedLeads.length} selected lead(s)`}
        isDeleting={deleteLead.isPending}
      />
      <Dialog open={bulkLabelsOpen} onOpenChange={setBulkLabelsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add labels</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Apply comma-separated labels to {selectedLeads.length} selected
              lead(s).
            </p>
            <Input
              autoFocus
              value={bulkLabelsInput}
              onChange={(event) => setBulkLabelsInput(event.target.value)}
              placeholder="Hot lead, VIP"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkLabelsOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void addLabelsToSelectedLeads()}
              disabled={!bulkLabelsInput.trim() || updateLead.isPending}
            >
              Add labels
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
