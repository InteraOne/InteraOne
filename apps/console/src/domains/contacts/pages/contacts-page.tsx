import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Plus,
  Search,
  SlidersHorizontal,
  Users,
  AlertTriangle,
  Loader2,
  Tag,
  Building2,
  CalendarClock,
  CircleCheckBig,
  CircleDotDashed,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Mail,
  Pencil,
  Phone,
  UserRound,
  Download,
  Trash2,
  X,
} from "lucide-react";
import { ContactDialog } from "@/domains/contacts/components/contact-form";
import {
  usePendingConflicts,
  useResolveConflict,
  useDeleteContacts,
  useBulkAddTags,
  useCreateContact,
  useContactOwners,
  useContactsPage,
  useUpdateContact,
} from "../hooks/use-contacts";
import type {
  ContactListItem,
  Contact,
  ContactWritePayload,
} from "../types/types";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from "@/shared/ui/pagination";
import { DeleteConfirmDialog } from "@/shared/components/delete-confirm-dialog";
import {
  useCrmRecords,
  useSalesPipeline,
} from "@/domains/crm/hooks/use-crm-records";

const TAG_OPTIONS = ["VIP", "Enterprise", "Trial", "Billing", "At Risk"];
const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Most recent activity" },
  { value: "conversations", label: "Conversations" },
  { value: "created", label: "Date created" },
];

const FILTER_ACTIVITY = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const FILTER_CONVERSATIONS = [
  { value: "1-2", label: "1-2 conversations" },
  { value: "3-10", label: "3-10 conversations" },
  { value: "10+", label: "10+ conversations" },
];

const SOURCE_OPTIONS = [
  { value: "facebook_lead_ads", label: "Facebook Lead Ads" },
  { value: "google_forms", label: "Google Forms" },
  { value: "manual", label: "Manually added" },
  { value: "widget", label: "Website widget" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" },
  { value: "phone", label: "Phone" },
  { value: "qr", label: "QR code" },
];

const formatSourceLabel = (value: string) =>
  SOURCE_OPTIONS.find((option) => option.value === value)?.label ||
  value.replaceAll("_", " ");

const toContactViewModel = (item: ContactListItem): Contact => ({
  id: item.id,
  name: item.name,
  email: item.email,
  phone: item.phone,
  company: item.company,
  tags: item.tags || [],
  lifecycleStage: item.lifecycleStage || "new",
  leadStatus: item.leadStatus || "needs_review",
  owner: item.owner || null,
  acquisitionSource: item.acquisitionSource || "unknown",
  integrationSources: item.integrationSources || [],
  preferredChannel: item.preferredChannel || null,
  nextFollowUpAt: item.nextFollowUpAt || null,
  lastContactedAt: item.lastContactedAt || null,
  lastActivity: item.lastActivity,
  createdAt: item.createdAt,
  isOnline: false,
  conversationCount: item.conversationCount,
  notes: item.notes || [],
  conversations:
    item.conversations && item.conversations.length > 0
      ? item.conversations
      : [
          {
            id: `conv-${item.id}`,
            status: "open",
            lastMessage: "Conversation context is still syncing.",
            channel: "widget",
            updatedAt: item.updatedAt,
          },
        ],
  insights: {
    summary:
      item.insights?.summary ||
      "No insights yet. Continue conversations to generate AI insights.",
    sentiment: item.insights?.sentiment || "neutral",
    topics: item.insights?.topics || [],
  },
  conflicts: item.conflicts || [],
  customFields: item.customFields || {},
});

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

type EditableContactField = "name" | "company" | "email" | "phone" | "ownerId";
type ContactColumnId =
  | "contact"
  | "organization"
  | "email"
  | "phone"
  | "openDeals"
  | "wonDeals"
  | "nextActivity"
  | "owner";

const CONTACT_COLUMNS: Record<
  ContactColumnId,
  { label: string; width: string }
> = {
  contact: { label: "Contact", width: "minmax(260px,1.35fr)" },
  organization: { label: "Organization", width: "minmax(180px,.9fr)" },
  email: { label: "Email", width: "minmax(220px,1.1fr)" },
  phone: { label: "Phone", width: "minmax(160px,.75fr)" },
  openDeals: { label: "Open deals", width: "120px" },
  wonDeals: { label: "Won deals", width: "120px" },
  nextActivity: { label: "Next activity", width: "minmax(180px,.9fr)" },
  owner: { label: "Owner", width: "minmax(190px,.9fr)" },
};
const DEFAULT_CONTACT_COLUMN_ORDER = Object.keys(
  CONTACT_COLUMNS,
) as ContactColumnId[];

type InlineEditor = {
  contact: Contact;
  field: EditableContactField;
  value: string;
};

const INLINE_FIELD_LABELS: Record<EditableContactField, string> = {
  name: "name",
  company: "organization",
  email: "email",
  phone: "phone",
  ownerId: "owner",
};

function EditableContactCell({
  contact,
  field,
  editor,
  onEdit,
  onCancel,
  onChange,
  onSave,
  onOpenContact,
  saving,
  ownerOptions,
  className,
  order,
  children,
}: {
  contact: Contact;
  field: EditableContactField;
  editor: InlineEditor | null;
  onEdit: (
    event: MouseEvent,
    contact: Contact,
    field: EditableContactField,
  ) => void;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSave: () => Promise<void>;
  onOpenContact?: () => void;
  saving: boolean;
  ownerOptions: Array<{ id: string; name: string }>;
  className?: string;
  order?: number;
  children: ReactNode;
}) {
  const isEditing = editor?.contact.id === contact.id && editor.field === field;
  const label = INLINE_FIELD_LABELS[field];

  return (
    <div
      className={`relative h-full w-full min-w-0 ${className || ""}`}
      style={{ order }}
    >
      {onOpenContact ? (
        <div className="group flex h-full min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenContact();
            }}
            className="min-w-0 flex-1 rounded-md px-1 py-1 text-left outline-none hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring"
            title="Open contact details"
          >
            {children}
          </button>
          <button
            type="button"
            onClick={(event) => onEdit(event, contact, field)}
            className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            title={`Edit ${label}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={(event) => onEdit(event, contact, field)}
          className="group flex h-full w-full min-w-0 items-center gap-1 rounded-md px-1 py-1 text-left outline-none hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring"
          title={`Edit ${label}`}
        >
          {children}
          <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      )}

      {isEditing && (
        <form
          className={`absolute z-50 w-64 rounded-xl border border-border/70 bg-popover p-3 shadow-2xl ${
            field === "ownerId"
              ? "right-1 top-full mt-1"
              : "left-1 top-full mt-1"
          }`}
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            void onSave();
          }}
        >
          <Label className="mb-2 block text-sm font-medium">Edit {label}</Label>
          {field === "ownerId" ? (
            <Select
              value={editor.value || "unassigned"}
              onValueChange={(nextValue) =>
                onChange(nextValue === "unassigned" ? "" : nextValue)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select owner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {ownerOptions.map((owner) => (
                  <SelectItem key={owner.id} value={owner.id}>
                    {owner.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              autoFocus
              type={field === "email" ? "email" : "text"}
              value={editor.value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={`Enter ${label}`}
            />
          )}
          <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={onCancel}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || (field === "name" && !editor.value.trim())}
              className="cursor-pointer"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ContactsPage() {
  const navigate = useNavigate();
  const [isConflictSheetOpen, setIsConflictSheetOpen] = useState(false);
  const [focusedConflictContactId, setFocusedConflictContactId] = useState<
    string | null
  >(null);
  const [searchValue, setSearchValue] = useState("");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [activityFilter, setActivityFilter] = useState<string>("all");
  const [conversationFilter, setConversationFilter] = useState<string>("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<string>("all");
  const [leadStatusFilter, setLeadStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [sortValue, setSortValue] = useState("recent");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isBulkTagDialogOpen, setIsBulkTagDialogOpen] = useState(false);
  const [bulkTagsInput, setBulkTagsInput] = useState("");
  const [inlineEditor, setInlineEditor] = useState<InlineEditor | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<ContactColumnId | null>(
    null,
  );
  const [columnOrder, setColumnOrder] = useState<ContactColumnId[]>(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem("contacts-column-order") || "[]",
      ) as ContactColumnId[];
      return saved.length === DEFAULT_CONTACT_COLUMN_ORDER.length &&
        DEFAULT_CONTACT_COLUMN_ORDER.every((id) => saved.includes(id))
        ? saved
        : DEFAULT_CONTACT_COLUMN_ORDER;
    } catch {
      return DEFAULT_CONTACT_COLUMN_ORDER;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(
      "contacts-column-order",
      JSON.stringify(columnOrder),
    );
  }, [columnOrder]);

  const moveColumn = (source: ContactColumnId, targetIndex: number) => {
    setColumnOrder((current) => {
      const sourceIndex = current.indexOf(source);
      if (sourceIndex < 0) return current;
      const next = [...current];
      next.splice(sourceIndex, 1);
      next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, source);
      return next;
    });
  };
  const columnPosition = (id: ContactColumnId) => columnOrder.indexOf(id);
  const columnGridTemplate = columnOrder
    .map((id) => CONTACT_COLUMNS[id].width)
    .join(" ");

  const {
    data: contactsPage,
    isLoading: isLoadingContacts,
    error: loadErrorData,
  } = useContactsPage({
    search: searchValue,
    page: currentPage,
    limit: 10,
    lifecycleStage: lifecycleFilter,
    leadStatus: leadStatusFilter,
    acquisitionSource: sourceFilter,
    tags: tagFilters,
    activityRange: activityFilter,
    conversationRange: conversationFilter,
    sort: sortValue,
  });
  const { data: conflicts = [] } = usePendingConflicts();
  const { data: deals = [] } = useCrmRecords();
  const { data: pipeline } = useSalesPipeline();

  const resolveConflictMutation = useResolveConflict();
  const deleteContactsMutation = useDeleteContacts();
  const bulkAddTagsMutation = useBulkAddTags();
  const createContactMutation = useCreateContact();
  const updateContactMutation = useUpdateContact();
  const { data: ownerOptions = [] } = useContactOwners();

  const loadError = loadErrorData ? loadErrorData.message : "";

  const contacts = useMemo(
    () => (contactsPage?.contacts || []).map(toContactViewModel),
    [contactsPage?.contacts],
  );

  const filteredContacts = contacts;
  const displayedContacts = contacts;
  const paginatedContacts = contacts;
  const totalItems = contactsPage?.total || 0;
  const totalPages = contactsPage?.totalPages || 1;
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * 10 + 1;
  const endItem = Math.min(currentPage * 10, totalItems);
  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    const pages: Array<number | string> = [1];
    if (currentPage > 3) pages.push("...");
    for (
      let page = Math.max(2, currentPage - 1);
      page <= Math.min(totalPages - 1, currentPage + 1);
      page += 1
    ) {
      pages.push(page);
    }
    if (currentPage < totalPages - 2) pages.push("...");
    pages.push(totalPages);
    return pages;
  }, [currentPage, totalPages]);
  const goToPage = (page: number) =>
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  const goToNext = () => goToPage(currentPage + 1);
  const goPrev = () => goToPage(currentPage - 1);

  const openInlineEditor = (
    event: MouseEvent,
    contact: Contact,
    field: EditableContactField,
  ) => {
    event.stopPropagation();
    const values: Record<EditableContactField, string> = {
      name: contact.name,
      company: contact.company || "",
      email: contact.email || "",
      phone: contact.phone || "",
      ownerId: contact.owner?.id || "",
    };
    setInlineEditor({ contact, field, value: values[field] });
  };

  const saveInlineEditor = async () => {
    if (!inlineEditor) return;
    const { contact, field, value } = inlineEditor;
    if (field === "name" && !value.trim()) return;
    try {
      await updateContactMutation.mutateAsync({
        id: contact.id,
        [field]: field === "ownerId" ? value || null : value.trim(),
      });
      setInlineEditor(null);
    } catch (error) {
      alert(
        error instanceof Error ? error.message : "Failed to update contact",
      );
    }
  };

  const dealCountsByContact = useMemo(() => {
    const stageTypes = new Map(
      (pipeline?.stages || []).map((stage) => [stage.id, stage.type]),
    );
    const counts = new Map<string, { open: number; closed: number }>();

    deals.forEach((deal) => {
      const contactId = deal.contact?.id;
      if (!contactId) return;
      const current = counts.get(contactId) || { open: 0, closed: 0 };
      const stageType = stageTypes.get(deal.stage);
      const isClosed =
        stageType === "won" ||
        stageType === "lost" ||
        /won|lost|closed/i.test(deal.stage);
      if (isClosed) current.closed += 1;
      else current.open += 1;
      counts.set(contactId, current);
    });

    return counts;
  }, [deals, pipeline]);

  useEffect(() => {
    const timeout = setTimeout(() => setCurrentPage(1), 0);
    return () => clearTimeout(timeout);
  }, [
    searchValue,
    tagFilters,
    activityFilter,
    conversationFilter,
    lifecycleFilter,
    leadStatusFilter,
    sourceFilter,
    sortValue,
  ]);

  useEffect(() => {
    const timeout = setTimeout(() => setSelectedContacts([]), 0);
    return () => clearTimeout(timeout);
  }, [
    currentPage,
    searchValue,
    tagFilters,
    activityFilter,
    conversationFilter,
    lifecycleFilter,
    leadStatusFilter,
    sourceFilter,
    sortValue,
  ]);

  useEffect(() => {
    if (!contactsPage || contactsPage.page === currentPage) return;
    const timeout = setTimeout(() => setCurrentPage(contactsPage.page), 0);
    return () => clearTimeout(timeout);
  }, [contactsPage, currentPage]);

  const toggleBulkSelect = (id: string) => {
    setSelectedContacts((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleSelectAll = () => {
    const allFilteredSelected = filteredContacts.every((contact) =>
      selectedContacts.includes(contact.id),
    );
    if (allFilteredSelected) {
      const filteredIds = new Set(
        filteredContacts.map((contact) => contact.id),
      );
      setSelectedContacts((current) =>
        current.filter((contactId) => !filteredIds.has(contactId)),
      );
    } else {
      setSelectedContacts((current) => [
        ...new Set([
          ...current,
          ...filteredContacts.map((contact) => contact.id),
        ]),
      ]);
    }
  };

  const handleAddContact = async (
    payload: ContactWritePayload & { name: string; tags: string[] },
  ) => {
    try {
      const created = await createContactMutation.mutateAsync(payload);
      const createdId = created?._id || created?.id;
      if (createdId) navigate(`/dashboard/crm/contacts/${createdId}`);
    } catch (err) {
      throw err instanceof Error ? err : new Error("Failed to create contact");
    }
  };

  const clearFilters = () => {
    setSearchValue("");
    setTagFilters([]);
    setActivityFilter("all");
    setConversationFilter("all");
    setLifecycleFilter("all");
    setLeadStatusFilter("all");
    setSourceFilter("all");
    setCurrentPage(1);
  };

  const hasActiveFilters = Boolean(
    searchValue.trim() ||
    tagFilters.length > 0 ||
    activityFilter !== "all" ||
    conversationFilter !== "all" ||
    lifecycleFilter !== "all" ||
    leadStatusFilter !== "all" ||
    sourceFilter !== "all",
  );
  const activeFilterCount =
    tagFilters.length +
    Number(activityFilter !== "all") +
    Number(conversationFilter !== "all") +
    Number(lifecycleFilter !== "all") +
    Number(leadStatusFilter !== "all") +
    Number(sourceFilter !== "all");

  const handleBulkDelete = async () => {
    if (selectedContacts.length === 0) return;
    try {
      await deleteContactsMutation.mutateAsync(selectedContacts);
      setSelectedContacts([]);
      setIsDeleteDialogOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete contacts");
    }
  };

  const handleBulkAddTags = async () => {
    if (selectedContacts.length === 0) return;
    const tagsToAdd = bulkTagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tagsToAdd.length === 0) return;
    try {
      await bulkAddTagsMutation.mutateAsync({
        ids: selectedContacts,
        tags: tagsToAdd,
      });
      setSelectedContacts([]);
      setBulkTagsInput("");
      setIsBulkTagDialogOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add tags");
    }
  };

  const handleBulkExport = () => {
    if (selectedContacts.length === 0) return;
    const selected = contacts.filter((c) => selectedContacts.includes(c.id));
    const headers = [
      "Name",
      "Email",
      "Phone",
      "Organization",
      "Source",
      "Source form",
      "Tags",
      "Conversation Count",
      "Last Activity",
      "Created At",
    ];
    const csvRows = [headers.join(",")];

    for (const c of selected) {
      const row = [
        `"${(c.name || "").replace(/"/g, '""')}"`,
        `"${(c.email || "").replace(/"/g, '""')}"`,
        `"${(c.phone || "").replace(/"/g, '""')}"`,
        `"${(c.company || "").replace(/"/g, '""')}"`,
        `"${(c.integrationSources[0]?.providerLabel || formatSourceLabel(c.acquisitionSource)).replace(/"/g, '""')}"`,
        `"${(c.integrationSources[0]?.formName || "").replace(/"/g, '""')}"`,
        `"${(c.tags || []).join("; ").replace(/"/g, '""')}"`,
        c.conversationCount || 0,
        c.lastActivity,
        c.createdAt,
      ];
      csvRows.push(row.join(","));
    }

    const csvContent = "\uFEFF" + csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `contacts_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleResolveConflict = async (
    conflictId: string,
    action: "apply" | "dismiss",
  ) => {
    try {
      await resolveConflictMutation.mutateAsync({ conflictId, action });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to resolve conflict");
    }
  };

  return (
    <div className="crm-workspace space-y-6 pb-8">
      <header
        className="flex flex-col gap-5 border-b border-border/60 pb-5 sm:flex-row sm:items-end sm:justify-between"
        data-tour-id="page-contacts-heading"
      >
        <div className="min-w-0">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            CRM · People
          </p>
          <div className="flex items-center gap-3">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em]">
              Contacts
            </h1>
            {!isLoadingContacts && (
              <span className="rounded-full border border-border/70 bg-background px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {totalItems}
              </span>
            )}
          </div>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
            A single view of every relationship, conversation, and next step.
          </p>
          {loadError && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Contacts could not be refreshed: {loadError}
            </p>
          )}
        </div>
        <div data-tour-id="page-contacts-primary-action">
          <ContactDialog
            mode="create"
            onSubmit={handleAddContact}
            triggerType="custom"
            customTrigger={
              <Button
                size="lg"
                className="w-full cursor-pointer rounded-lg px-4 shadow-sm sm:w-auto"
              >
                <Plus className="mr-1 h-4 w-4" />
                New contact
              </Button>
            }
          />
        </div>
      </header>

      <Card
        className="min-w-0 gap-0 overflow-hidden rounded-xl border border-border/70 bg-card py-0 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_10px_36px_rgba(0,0,0,0.035)] ring-0"
        data-tour-id="page-contacts-list"
      >
        <CardHeader className="space-y-0 border-b border-border/60 p-0">
          <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
            <div
              className="relative min-w-0 flex-1 lg:max-w-xl"
              data-tour-id="page-contacts-search"
            >
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/75" />
              <Input
                placeholder="Search people, email, phone, or company…"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                className="h-9 cursor-text border-transparent bg-foreground/[0.035] pl-9 pr-9 shadow-none focus-visible:bg-background"
              />
              {searchValue && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchValue("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-1 items-center justify-end gap-2">
              <Button
                type="button"
                variant={
                  filtersExpanded || activeFilterCount ? "secondary" : "outline"
                }
                className="relative h-9 flex-1 cursor-pointer border-border/70 bg-background lg:flex-none"
                onClick={() => setFiltersExpanded((current) => !current)}
                aria-expanded={filtersExpanded}
              >
                <SlidersHorizontal className="mr-1 h-4 w-4" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
              <Select value={sortValue} onValueChange={setSortValue}>
                <SelectTrigger className="h-9 w-[180px] cursor-pointer border-border/70 bg-background shadow-none">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {filtersExpanded && (
            <div
              className="border-t border-border/60 bg-foreground/[0.018] p-4"
              data-tour-id="page-contacts-filters"
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Lifecycle stage
                  </Label>
                  <Select
                    value={lifecycleFilter}
                    onValueChange={setLifecycleFilter}
                  >
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All stages</SelectItem>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="qualified">Qualified</SelectItem>
                      <SelectItem value="opportunity">Opportunity</SelectItem>
                      <SelectItem value="customer">Customer</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="lost">Lost</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Lead status
                  </Label>
                  <Select
                    value={leadStatusFilter}
                    onValueChange={setLeadStatusFilter}
                  >
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="needs_review">Needs review</SelectItem>
                      <SelectItem value="contacted">Contacted</SelectItem>
                      <SelectItem value="follow_up">Follow-up</SelectItem>
                      <SelectItem value="converted">Converted</SelectItem>
                      <SelectItem value="unqualified">Unqualified</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Contact source
                  </Label>
                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      {SOURCE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Last activity
                  </Label>
                  <Select
                    value={activityFilter}
                    onValueChange={setActivityFilter}
                  >
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue placeholder="Select range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any time</SelectItem>
                      {FILTER_ACTIVITY.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Conversations
                  </Label>
                  <Select
                    value={conversationFilter}
                    onValueChange={setConversationFilter}
                  >
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue placeholder="Select volume" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any volume</SelectItem>
                      {FILTER_CONVERSATIONS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 sm:col-span-2 lg:col-span-3 xl:col-span-6">
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-xs text-muted-foreground">
                      Labels
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 cursor-pointer px-2 text-xs"
                      onClick={clearFilters}
                      disabled={!hasActiveFilters}
                    >
                      Clear all
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {TAG_OPTIONS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setTagFilters((prev) =>
                            prev.includes(tag)
                              ? prev.filter((item) => item !== tag)
                              : [...prev, tag],
                          )
                        }
                        className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          tagFilters.includes(tag)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-0 p-0">
          {conflicts.length > 0 && (
            <button
              onClick={() => {
                setFocusedConflictContactId(null);
                setIsConflictSheetOpen(true);
              }}
              className="m-3 mb-0 flex w-[calc(100%-1.5rem)] cursor-pointer items-center justify-between rounded-lg border border-border/70 bg-foreground/[0.025] p-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/[0.05]"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <span>{conflicts.length} Pending Profile Conflicts</span>
              </div>
              <span className="text-xs underline">Review conflicts</span>
            </button>
          )}

          {selectedContacts.length > 0 && (
            <div className="m-3 mb-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-foreground/[0.03] px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="flex h-5 min-w-5 items-center justify-center rounded-md bg-primary px-1 text-[11px] text-primary-foreground">
                  {selectedContacts.length}
                </span>
                selected
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsBulkTagDialogOpen(true)}
                  className="cursor-pointer"
                >
                  <Tag className="h-3.5 w-3.5" /> Add tags
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkExport}
                  className="cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" /> Export
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setIsDeleteDialogOpen(true)}
                  className="cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  filteredContacts.length > 0 &&
                  filteredContacts.every((contact) =>
                    selectedContacts.includes(contact.id),
                  )
                }
                onChange={toggleSelectAll}
                className="crm-checkbox cursor-pointer"
              />
              Select page
            </label>
            <span>
              Showing {startItem}-{endItem} of {totalItems} results
            </span>
          </div>

          <div className="crm-table-scroll overflow-x-auto bg-background">
            <div className="min-w-[1540px]">
              <div
                className="sticky top-0 z-10 grid items-stretch border-b border-border/70 bg-card/95 text-[11px] font-semibold uppercase tracking-[0.075em] text-muted-foreground backdrop-blur"
                style={{ gridTemplateColumns: `48px ${columnGridTemplate}` }}
              >
                <span className="px-4 py-3.5" />
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
                        {CONTACT_COLUMNS[columnId].label}
                      </span>
                      <span className="hidden shrink-0 group-hover:flex group-focus-within:flex">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveColumn(columnId, index - 1)}
                          className="rounded p-0.5 hover:bg-background disabled:opacity-20"
                          aria-label={`Move ${CONTACT_COLUMNS[columnId].label} left`}
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={index === columnOrder.length - 1}
                          onClick={() => moveColumn(columnId, index + 1)}
                          className="rounded p-0.5 hover:bg-background disabled:opacity-20"
                          aria-label={`Move ${CONTACT_COLUMNS[columnId].label} right`}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col">
                {paginatedContacts.map((contact) => {
                  const isSelected = selectedContacts.includes(contact.id);
                  const dealCounts = dealCountsByContact.get(contact.id) || {
                    open: 0,
                    closed: 0,
                  };
                  return (
                    <div
                      key={contact.id}
                      className={`relative grid min-h-[64px] grid-cols-[48px_minmax(0,1fr)] border-b border-border/55 text-left transition-colors select-none last:border-b-0 ${
                        isSelected
                          ? "bg-primary/[0.055] shadow-[inset_2px_0_0_var(--primary)]"
                          : "hover:bg-foreground/[0.025]"
                      }`}
                    >
                      <div className="flex items-center justify-center px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${contact.name} for bulk actions`}
                          checked={selectedContacts.includes(contact.id)}
                          onChange={() => toggleBulkSelect(contact.id)}
                          className="crm-checkbox cursor-pointer"
                        />
                      </div>
                      <div
                        className="grid min-w-0 items-stretch text-left"
                        style={{ gridTemplateColumns: columnGridTemplate }}
                      >
                        <EditableContactCell
                          contact={contact}
                          field="name"
                          editor={inlineEditor}
                          onEdit={openInlineEditor}
                          onCancel={() => setInlineEditor(null)}
                          onChange={(value) =>
                            setInlineEditor((current) =>
                              current ? { ...current, value } : null,
                            )
                          }
                          onSave={saveInlineEditor}
                          onOpenContact={() =>
                            navigate(`/dashboard/crm/contacts/${contact.id}`)
                          }
                          saving={updateContactMutation.isPending}
                          ownerOptions={ownerOptions}
                          order={columnPosition("contact")}
                          className="min-w-0 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <h3 className="truncate text-sm font-medium text-foreground">
                                {contact.name}
                              </h3>
                              {contact.conflicts &&
                                contact.conflicts.length > 0 && (
                                  <AlertTriangle
                                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                    aria-label="Profile conflict"
                                  />
                                )}
                            </div>
                            <p className="mt-0.5 truncate text-xs capitalize text-muted-foreground">
                              {contact.lifecycleStage}
                              {contact.tags[0] ? ` · ${contact.tags[0]}` : ""}
                            </p>
                          </div>
                        </EditableContactCell>
                        <EditableContactCell
                          contact={contact}
                          field="company"
                          editor={inlineEditor}
                          onEdit={openInlineEditor}
                          onCancel={() => setInlineEditor(null)}
                          onChange={(value) =>
                            setInlineEditor((current) =>
                              current ? { ...current, value } : null,
                            )
                          }
                          onSave={saveInlineEditor}
                          saving={updateContactMutation.isPending}
                          ownerOptions={ownerOptions}
                          order={columnPosition("organization")}
                          className="flex min-w-0 items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground"
                        >
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/55" />
                          <span className="truncate" title={contact.company}>
                            {contact.company || "—"}
                          </span>
                        </EditableContactCell>
                        <EditableContactCell
                          contact={contact}
                          field="email"
                          editor={inlineEditor}
                          onEdit={openInlineEditor}
                          onCancel={() => setInlineEditor(null)}
                          onChange={(value) =>
                            setInlineEditor((current) =>
                              current ? { ...current, value } : null,
                            )
                          }
                          onSave={saveInlineEditor}
                          saving={updateContactMutation.isPending}
                          ownerOptions={ownerOptions}
                          order={columnPosition("email")}
                          className="flex min-w-0 items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground"
                        >
                          <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground/55" />
                          <span className="truncate" title={contact.email}>
                            {contact.email || "—"}
                          </span>
                        </EditableContactCell>
                        <EditableContactCell
                          contact={contact}
                          field="phone"
                          editor={inlineEditor}
                          onEdit={openInlineEditor}
                          onCancel={() => setInlineEditor(null)}
                          onChange={(value) =>
                            setInlineEditor((current) =>
                              current ? { ...current, value } : null,
                            )
                          }
                          onSave={saveInlineEditor}
                          saving={updateContactMutation.isPending}
                          ownerOptions={ownerOptions}
                          order={columnPosition("phone")}
                          className="flex min-w-0 items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground"
                        >
                          <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground/55" />
                          <span className="truncate">
                            {contact.phone || "—"}
                          </span>
                        </EditableContactCell>
                        <div
                          className="flex items-center px-3 py-2.5 text-sm"
                          style={{ order: columnPosition("openDeals") }}
                        >
                          <span className="inline-flex items-center gap-1.5 font-medium tabular-nums text-foreground">
                            <CircleDotDashed className="h-3.5 w-3.5 text-muted-foreground" />
                            {dealCounts.open}
                          </span>
                        </div>
                        <div
                          className="flex items-center px-3 py-2.5 text-sm"
                          style={{ order: columnPosition("wonDeals") }}
                        >
                          <span className="inline-flex items-center gap-1.5 font-medium tabular-nums text-foreground">
                            <CircleCheckBig className="h-3.5 w-3.5 text-muted-foreground" />
                            {dealCounts.closed}
                          </span>
                        </div>
                        <div
                          className="flex min-w-0 items-center px-3 py-2.5 text-sm text-muted-foreground"
                          style={{ order: columnPosition("nextActivity") }}
                        >
                          <span className="inline-flex max-w-full items-center gap-2 text-muted-foreground">
                            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">
                              {contact.nextFollowUpAt
                                ? formatDate(contact.nextFollowUpAt)
                                : "Not scheduled"}
                            </span>
                          </span>
                        </div>
                        <EditableContactCell
                          contact={contact}
                          field="ownerId"
                          editor={inlineEditor}
                          onEdit={openInlineEditor}
                          onCancel={() => setInlineEditor(null)}
                          onChange={(value) =>
                            setInlineEditor((current) =>
                              current ? { ...current, value } : null,
                            )
                          }
                          onSave={saveInlineEditor}
                          saving={updateContactMutation.isPending}
                          ownerOptions={ownerOptions}
                          order={columnPosition("owner")}
                          className="min-w-0 px-3 py-2.5 text-sm text-muted-foreground"
                        >
                          <span className="flex w-full min-w-0 items-center gap-2">
                            {contact.owner?.name ? (
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-[10px] font-semibold text-muted-foreground">
                                {contact.owner.name
                                  .split(" ")
                                  .map((part) => part[0])
                                  .join("")
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </span>
                            ) : (
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.04] text-muted-foreground/60">
                                <UserRound className="h-3.5 w-3.5" />
                              </span>
                            )}
                            <span
                              className={`truncate font-medium ${contact.owner?.name ? "text-foreground" : "text-muted-foreground"}`}
                            >
                              {contact.owner?.name || "Unassigned"}
                            </span>
                          </span>
                        </EditableContactCell>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {!isLoadingContacts && displayedContacts.length === 0 && (
            <div className="m-4 rounded-xl border border-dashed border-border/80 bg-foreground/[0.015] p-12 text-center">
              <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-foreground/[0.05]">
                <Users className="h-5 w-5 text-muted-foreground" />
              </span>
              <p className="font-medium">No contacts found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "No contacts match the current search and filters."
                  : "Create the first contact to begin building your CRM."}
              </p>
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={clearFilters}
                  className="mt-4 cursor-pointer"
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}

          {totalPages > 1 && (
            <div className="border-t border-border/60 px-4 py-3">
              <Pagination>
                <PaginationContent>
                  <PaginationItem className="cursor-pointer">
                    <PaginationPrevious
                      onClick={(e) => {
                        e.preventDefault();
                        goPrev();
                      }}
                      className={
                        currentPage === 1
                          ? "pointer-events-none opacity-50"
                          : ""
                      }
                    />
                  </PaginationItem>
                  {pageNumbers.map((page, idx) => (
                    <PaginationItem key={idx} className="cursor-pointer">
                      {page === "..." ? (
                        <PaginationEllipsis />
                      ) : (
                        <PaginationLink
                          isActive={page === currentPage}
                          onClick={(e) => {
                            e.preventDefault();
                            goToPage(page as number);
                          }}
                        >
                          {page}
                        </PaginationLink>
                      )}
                    </PaginationItem>
                  ))}
                  <PaginationItem className="cursor-pointer">
                    <PaginationNext
                      onClick={(e) => {
                        e.preventDefault();
                        goToNext();
                      }}
                      className={
                        currentPage === totalPages
                          ? "pointer-events-none opacity-50"
                          : ""
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      <DeleteConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleBulkDelete}
        title="Delete Contacts"
        itemName={`${selectedContacts.length} selected contact(s)`}
        isDeleting={deleteContactsMutation.isPending}
      />

      <Dialog open={isBulkTagDialogOpen} onOpenChange={setIsBulkTagDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-primary" />
              Add Tags in Bulk
            </DialogTitle>
            <DialogDescription>
              Apply tags to the {selectedContacts.length} selected contacts.
              Enter tags separated by commas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-tags-input">Tags</Label>
              <Input
                id="bulk-tags-input"
                placeholder="e.g. VIP, Enterprise, At Risk"
                value={bulkTagsInput}
                onChange={(e) => setBulkTagsInput(e.target.value)}
                autoFocus
                className="cursor-text"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setIsBulkTagDialogOpen(false);
                setBulkTagsInput("");
              }}
              disabled={bulkAddTagsMutation.isPending}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={handleBulkAddTags}
              disabled={bulkAddTagsMutation.isPending || !bulkTagsInput.trim()}
              className="cursor-pointer bg-primary hover:bg-primary/95 text-primary-foreground border-0"
            >
              {bulkAddTagsMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Add Tags
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isConflictSheetOpen} onOpenChange={setIsConflictSheetOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              Pending Profile Conflicts
            </DialogTitle>
            <DialogDescription>
              {focusedConflictContactId
                ? "Review and resolve conflicting profile details captured for this contact."
                : "Multiple conflicting profile details were captured during user conversations. Resolve them below to maintain profile integrity."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {(focusedConflictContactId
              ? conflicts.filter(
                  (c) => c.contactId === focusedConflictContactId,
                )
              : conflicts
            ).map((conflict) => (
              <div
                key={conflict.id}
                className="border border-border rounded-lg p-4 space-y-3 bg-muted/20"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-sm">
                      {conflict.contactName}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {conflict.contactEmail || "No email"}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize text-xs">
                    {conflict.field} Mismatch
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm bg-background border border-border rounded-md p-3">
                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">
                      Current Value
                    </span>
                    <span className="font-medium text-foreground block truncate">
                      {conflict.currentValue || (
                        <em className="text-muted-foreground text-xs">
                          Not set
                        </em>
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-muted-foreground">
                      Proposed Value
                    </span>
                    <span className="block truncate font-medium text-foreground">
                      {conflict.proposedValue}
                    </span>
                  </div>
                </div>

                <div className="flex justify-between items-center gap-3 pt-1">
                  <button
                    onClick={() => {
                      setIsConflictSheetOpen(false);
                      navigate(
                        `/dashboard/conversations/inbox/chat/${conflict.conversationId}`,
                      );
                    }}
                    className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer bg-transparent border-0 p-0"
                  >
                    View Chat Session
                  </button>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleResolveConflict(conflict.id, "dismiss")
                      }
                      className="cursor-pointer text-xs"
                    >
                      Keep Current
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        handleResolveConflict(conflict.id, "apply")
                      }
                      className="cursor-pointer border-0 bg-primary text-xs text-primary-foreground hover:bg-primary/85"
                    >
                      Apply Proposed
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {conflicts.length === 0 && (
              <div className="text-center py-6 text-sm text-muted-foreground">
                All conflicts have been resolved!
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
