import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  AtSign,
  Bold,
  Building2,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  FileText,
  Flag,
  Image,
  Italic,
  Link,
  List,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  ListOrdered,
  MonitorUp,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  Plus,
  Redo2,
  RemoveFormatting,
  Save,
  Search,
  Send,
  Sparkles,
  Strikethrough,
  Tags,
  Trash2,
  Underline,
  Undo2,
  Upload,
  UserRound,
  Users,
  Utensils,
  Video,
  X,
} from "lucide-react";
import { useNavigate, useParams } from "react-router";
import io from "socket.io-client";
import { toast } from "sonner";
import {
  useAccount,
  useUpdateAccount,
} from "@/domains/accounts/hooks/use-accounts";
import type {
  AccountDetail,
  AccountWritePayload,
} from "@/domains/accounts/types/types";
import { useAuth } from "@/domains/auth/hooks/useAuth";
import { useEmailChannel } from "@/domains/channels/hooks/use-channels";
import { conversationsApi } from "@/domains/conversation/api/conversations.api";
import {
  ACTIVITY_WORKSPACE_TABS,
  ActivityWorkspaceComposer,
  ActivityWorkspaceEmpty,
  ActivityWorkspaceHistoryCard,
  ActivityWorkspaceHistoryFilters,
  ActivityWorkspaceSectionHeader,
  type ActivityWorkspaceTab,
} from "@/domains/crm/components/activity-workspace-ui";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { WhatsAppIcon } from "@/shared/ui/channel-icon";
import { storageApi } from "@/shared/lib/storage.api";
import { sanitizeNoteHtml } from "@/shared/lib/note-html";
import { contactsApi } from "../api/contacts.api";
import { useContacts, useUpdateContact } from "../hooks/use-contacts";
import { toContactViewModel } from "../types/types";
import type {
  Contact,
  ContactTimelineItem,
  ContactWritePayload,
} from "../types/types";

type HistoryFilter =
  | "all"
  | "activities"
  | "notes"
  | "whatsapp"
  | "emails"
  | "files"
  | "documents"
  | "leads"
  | "deals"
  | "changelog";
type ContactField = "firstName" | "lastName" | "email" | "phone" | "company";
type OrganizationField =
  | "name"
  | "labels"
  | "address"
  | "website"
  | "linkedinProfile"
  | "industry"
  | "annualRevenue"
  | "numberOfEmployees";
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3002";

const LABEL_SWATCHES = [
  { id: "blue", dot: "bg-blue-500", badge: "bg-blue-600 text-white" },
  {
    id: "mint",
    dot: "bg-emerald-300",
    badge: "bg-emerald-300 text-emerald-950",
  },
  {
    id: "yellow",
    dot: "bg-yellow-400",
    badge: "bg-yellow-300 text-yellow-950",
  },
  { id: "red", dot: "bg-red-500", badge: "bg-red-500 text-white" },
  { id: "purple", dot: "bg-fuchsia-600", badge: "bg-fuchsia-600 text-white" },
  { id: "gray", dot: "bg-gray-300", badge: "bg-gray-300 text-gray-900" },
  { id: "brown", dot: "bg-amber-700", badge: "bg-amber-700 text-white" },
  {
    id: "orange",
    dot: "bg-orange-400",
    badge: "bg-orange-400 text-orange-950",
  },
  { id: "slate", dot: "bg-slate-500", badge: "bg-slate-500 text-white" },
  { id: "pink", dot: "bg-pink-400", badge: "bg-pink-400 text-pink-950" },
] as const;
interface HistoryItem {
  id: string;
  title: string;
  meta: string;
  icon: typeof MessageSquare;
  kind: Exclude<HistoryFilter, "all">;
  date: string;
  author?: string;
  noteId?: string;
  noteHtml?: string;
  pinned?: boolean;
  timelineItemId?: string;
  fileKey?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  content?: string;
  activityType?: string;
  priority?: string;
  status?: string;
  endAt?: string;
}

function notePlainText(value: string) {
  if (typeof document === "undefined")
    return value
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const wrapper = document.createElement("div");
  wrapper.innerHTML = sanitizeNoteHtml(value);
  return (wrapper.textContent || "").replace(/\s+/g, " ").trim();
}

function activityPriority(priority?: string) {
  if (priority === "high")
    return { label: "High", className: "bg-red-600 text-white" };
  if (priority === "medium")
    return { label: "Medium", className: "bg-yellow-300 text-yellow-950" };
  if (priority === "low")
    return { label: "Low", className: "bg-blue-600 text-white" };
  return { label: "None", className: "bg-muted text-muted-foreground" };
}

function EditableRow({
  label,
  value,
  onSave,
  inputType = "text",
}: {
  label: string;
  value: string;
  onSave: (value: string) => Promise<void>;
  inputType?: "text" | "email" | "tel" | "url";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value === "—" ? "" : value);
  const [saving, setSaving] = useState(false);

  const cancel = () => {
    setDraft(value === "—" ? "" : value);
    setEditing(false);
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch {
      // The field-level save handler already reports the API error.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="group grid min-h-12 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 border-b border-border/50 px-4 py-1.5 last:border-b-0 hover:bg-foreground/[0.025]">
      <span className="text-xs font-medium text-muted-foreground/85">
        {label}
      </span>
      {editing ? (
        <div className="space-y-2 py-1.5">
          <Input
            autoFocus
            type={inputType}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save();
              if (event.key === "Escape") cancel();
            }}
            className="h-9"
          />
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={cancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="xs"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(value === "—" ? "" : value);
            setEditing(true);
          }}
          className="flex min-h-9 min-w-0 items-center justify-between gap-2 rounded-md px-1 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={`Edit ${label.toLowerCase()}`}
        >
          <span
            className={value === "—" ? "text-muted-foreground" : "break-words"}
          >
            {value}
          </span>
          <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
        </button>
      )}
    </div>
  );
}

function PanelSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border/60 px-5 py-5 first:border-t-0">
      <div className="mb-3.5 flex items-center gap-2">
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        <h2 className="text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function NewLabelForm({
  name,
  color,
  onNameChange,
  onColorChange,
  onCancel,
  onSave,
}: {
  name: string;
  color: (typeof LABEL_SWATCHES)[number]["id"];
  onNameChange: (value: string) => void;
  onColorChange: (value: (typeof LABEL_SWATCHES)[number]["id"]) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <div className="border-b border-border px-4 py-3">
        <p className="font-semibold">New label</p>
      </div>
      <div className="space-y-4 p-4">
        <div>
          <Label className="mb-1.5 block text-sm">Label name</Label>
          <Input
            autoFocus
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && onSave()}
            placeholder="Label name"
          />
        </div>
        <div>
          <Label className="mb-2 block text-sm">Label color</Label>
          <div className="flex flex-wrap gap-2">
            {LABEL_SWATCHES.map((swatch) => (
              <button
                key={swatch.id}
                type="button"
                onClick={() => onColorChange(swatch.id)}
                aria-label={`Use ${swatch.id} label color`}
                className={`flex h-7 w-7 items-center justify-center rounded-full ${swatch.dot} ring-offset-2 transition-shadow ${color === swatch.id ? "ring-2 ring-blue-500" : "hover:ring-2 hover:ring-muted-foreground/30"}`}
              >
                {color === swatch.id && (
                  <Check className="h-4 w-4 text-white drop-shadow" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-2.5">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={!name.trim()}
        >
          Save
        </Button>
      </div>
    </>
  );
}

function InsertUrlPopover({
  kind,
  value,
  onChange,
  onCancel,
  onInsert,
}: {
  kind: "link" | "image";
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onInsert: () => void;
}) {
  return (
    <div className="absolute bottom-12 left-2 z-50 w-80 max-w-[calc(100vw-3rem)] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl">
      <p className="mb-2 text-sm font-semibold">Insert {kind}</p>
      <Input
        autoFocus
        type="url"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onInsert();
          }
          if (event.key === "Escape") onCancel();
        }}
        placeholder={
          kind === "link"
            ? "https://example.com"
            : "https://example.com/image.jpg"
        }
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onInsert}
          disabled={!value.trim()}
        >
          Insert
        </Button>
      </div>
    </div>
  );
}

function ContactInformationPanel({
  contact,
  organization,
}: {
  contact: Contact;
  organization?: AccountDetail;
}) {
  const navigate = useNavigate();
  const updateContact = useUpdateContact();
  const updateAccount = useUpdateAccount();
  const queryClient = useQueryClient();
  const [addingLabel, setAddingLabel] = useState(false);
  const [labelSearch, setLabelSearch] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>(contact.tags);
  const [customLabels, setCustomLabels] = useState<string[]>([]);
  const [savingLabels, setSavingLabels] = useState(false);
  const [addingOrganizationLabel, setAddingOrganizationLabel] = useState(false);
  const [organizationLabelSearch, setOrganizationLabelSearch] = useState("");
  const [selectedOrganizationLabels, setSelectedOrganizationLabels] = useState<
    string[]
  >(organization?.account?.labels || []);
  const [customOrganizationLabels, setCustomOrganizationLabels] = useState<
    string[]
  >([]);
  const [savingOrganizationLabels, setSavingOrganizationLabels] =
    useState(false);
  const [newLabelTarget, setNewLabelTarget] = useState<
    "contact" | "organization" | null
  >(null);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] =
    useState<(typeof LABEL_SWATCHES)[number]["id"]>("blue");
  const [generatingInsights, setGeneratingInsights] = useState(false);
  const [savedLabelColors, setSavedLabelColors] = useState<
    Record<string, string>
  >(() => {
    try {
      return JSON.parse(
        window.localStorage.getItem("contact-label-colors") || "{}",
      );
    } catch {
      return {};
    }
  });
  const account = organization?.account;
  const accountFields = account?.customFields || {};
  const nameParts = contact.name.trim().split(/\s+/);
  const firstName = nameParts[0] || "—";
  const lastName = nameParts.slice(1).join(" ") || "—";
  const initials =
    nameParts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "C";

  const saveContact = async (field: ContactField, value: string) => {
    let payload: ContactWritePayload;
    if (field === "firstName")
      payload = {
        name: [value, lastName === "—" ? "" : lastName]
          .filter(Boolean)
          .join(" "),
      };
    else if (field === "lastName")
      payload = {
        name: [firstName === "—" ? "" : firstName, value]
          .filter(Boolean)
          .join(" "),
      };
    else payload = { [field]: value };
    if (!payload.name && (field === "firstName" || field === "lastName")) {
      toast.error("Contact name cannot be empty");
      return;
    }
    try {
      await updateContact.mutateAsync({ id: contact.id, ...payload });
      toast.success("Contact updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update contact",
      );
      throw error;
    }
  };

  const saveOrganization = async (field: OrganizationField, value: string) => {
    if (!account) {
      if (field === "name") return saveContact("company", value);
      toast.error("Link an organization before editing organization fields");
      return;
    }
    let payload: Partial<AccountWritePayload>;
    if (field === "name" || field === "website" || field === "industry")
      payload = { [field]: value };
    else if (field === "labels")
      payload = {
        labels: value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      };
    else payload = { customFields: { ...accountFields, [field]: value } };
    try {
      await updateAccount.mutateAsync({ id: account.id, payload });
      toast.success("Organization updated");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update organization",
      );
      throw error;
    }
  };

  const generateInsights = async () => {
    const conversation = contact.conversations.find(
      (item) => item.id !== `conv-${contact.id}`,
    );
    if (!conversation) {
      toast.error(
        "This contact needs a conversation before AI insights can be generated",
      );
      return;
    }
    setGeneratingInsights(true);
    const socket = io(SOCKET_URL, {
      auth: { token: window.localStorage.getItem("token") },
      transports: ["websocket", "polling"],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        if (socket.connected) {
          resolve();
          return;
        }
        const timeout = window.setTimeout(
          () => reject(new Error("Could not connect to the AI service")),
          8000,
        );
        socket.once("connect", () => {
          window.clearTimeout(timeout);
          resolve();
        });
        socket.once("connect_error", () => {
          window.clearTimeout(timeout);
          reject(new Error("Could not connect to the AI service"));
        });
      });
      const request = await conversationsApi.generateNote(
        conversation.id,
        undefined,
        contact.name,
      );
      const result = await new Promise<{ note: string }>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("AI insight generation timed out")),
          30000,
        );
        socket.on(
          "assist:result",
          (payload: {
            requestId: string;
            action: string;
            data: { note?: string };
          }) => {
            if (
              payload.requestId !== request.requestId ||
              payload.action !== "generate-note"
            )
              return;
            window.clearTimeout(timeout);
            if (!payload.data?.note)
              reject(new Error("AI returned an empty insight"));
            else resolve({ note: payload.data.note });
          },
        );
      });
      const normalized = result.note.toLowerCase();
      const sentiment = /frustrat|unhappy|upset|angry|negative|dissatisf/.test(
        normalized,
      )
        ? ("negative" as const)
        : /happy|satisf|positive|pleased|thank/.test(normalized)
          ? ("positive" as const)
          : contact.insights.sentiment;
      await contactsApi.updateInsights(contact.id, {
        summary: result.note,
        sentiment,
        topics: contact.insights.topics,
      });
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("AI insights generated");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to generate AI insights",
      );
    } finally {
      socket.disconnect();
      setGeneratingInsights(false);
    }
  };

  const saveLabels = async () => {
    const labelsToAdd = selectedLabels.filter(
      (label) => !contact.tags.includes(label),
    );
    const labelsToRemove = contact.tags.filter(
      (label) => !selectedLabels.includes(label),
    );
    setSavingLabels(true);
    try {
      await Promise.all([
        ...labelsToAdd.map((label) => contactsApi.addTag(contact.id, label)),
        ...labelsToRemove.map((label) =>
          contactsApi.removeTag(contact.id, label),
        ),
      ]);
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      setAddingLabel(false);
      setLabelSearch("");
      toast.success("Labels updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update labels",
      );
    } finally {
      setSavingLabels(false);
    }
  };
  const openLabels = () => {
    setSelectedLabels(contact.tags);
    setLabelSearch("");
    setNewLabelTarget(null);
    setAddingLabel(true);
  };
  const openNewLabelForm = (target: "contact" | "organization") => {
    setNewLabelTarget(target);
    setNewLabelName(
      target === "contact"
        ? labelSearch.trim()
        : organizationLabelSearch.trim(),
    );
    setNewLabelColor("blue");
  };
  const openOrganizationLabels = () => {
    setSelectedOrganizationLabels(account?.labels || []);
    setOrganizationLabelSearch("");
    setNewLabelTarget(null);
    setAddingOrganizationLabel(true);
  };
  const saveNewLabel = () => {
    const label = newLabelName.trim();
    if (!label || !newLabelTarget) return;
    if (newLabelTarget === "contact") {
      setCustomLabels((labels) =>
        labels.includes(label) ? labels : [...labels, label],
      );
      setSelectedLabels((labels) =>
        labels.includes(label) ? labels : [...labels, label],
      );
      setLabelSearch("");
    } else {
      setCustomOrganizationLabels((labels) =>
        labels.includes(label) ? labels : [...labels, label],
      );
      setSelectedOrganizationLabels((labels) =>
        labels.includes(label) ? labels : [...labels, label],
      );
      setOrganizationLabelSearch("");
    }
    const nextColors = { ...savedLabelColors, [label]: newLabelColor };
    setSavedLabelColors(nextColors);
    window.localStorage.setItem(
      "contact-label-colors",
      JSON.stringify(nextColors),
    );
    setNewLabelTarget(null);
    setNewLabelName("");
  };
  const saveOrganizationLabels = async () => {
    setSavingOrganizationLabels(true);
    try {
      await saveOrganization("labels", selectedOrganizationLabels.join(", "));
      setAddingOrganizationLabel(false);
      setOrganizationLabelSearch("");
    } catch {
      // The organization save handler already reports the API error.
    } finally {
      setSavingOrganizationLabels(false);
    }
  };
  const labelOptions = Array.from(
    new Set([
      "Hot lead",
      "Customer",
      "Warm lead",
      "Cold lead",
      "VIP",
      "Enterprise",
      "Trial",
      "Billing",
      "At Risk",
      ...contact.tags,
      ...customLabels,
    ]),
  );
  const visibleLabelOptions = labelOptions.filter((label) =>
    label.toLowerCase().includes(labelSearch.trim().toLowerCase()),
  );
  const organizationLabelOptions = Array.from(
    new Set([
      ...labelOptions,
      ...(account?.labels || []),
      ...customOrganizationLabels,
    ]),
  );
  const visibleOrganizationLabelOptions = organizationLabelOptions.filter(
    (label) =>
      label
        .toLowerCase()
        .includes(organizationLabelSearch.trim().toLowerCase()),
  );
  const labelColors = [
    "bg-red-500 text-white",
    "bg-emerald-300 text-emerald-950",
    "bg-yellow-300 text-yellow-950",
    "bg-blue-600 text-white",
    "bg-violet-500 text-white",
    "bg-cyan-300 text-cyan-950",
  ];
  const labelColor = (label: string) =>
    LABEL_SWATCHES.find((swatch) => swatch.id === savedLabelColors[label])
      ?.badge ||
    labelColors[
      Math.abs(
        [...label].reduce((total, char) => total + char.charCodeAt(0), 0),
      ) % labelColors.length
    ];
  const organizationValue = (field: OrganizationField) => {
    if (field === "name") return account?.name || contact.company || "—";
    if (field === "website")
      return account?.website || contact.account?.website || "—";
    if (field === "industry")
      return account?.industry || contact.account?.industry || "—";
    if (field === "labels") return account?.labels?.join(", ") || "—";
    const value = accountFields[field];
    return value === undefined || value === null || value === ""
      ? "—"
      : String(value);
  };
  const deals = (organization?.opportunities || []).filter(
    (deal) => !deal.primaryContact || deal.primaryContact.id === contact.id,
  );

  return (
    <Card className="gap-0 overflow-visible rounded-2xl border border-border/70 bg-card py-0 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_36px_rgba(0,0,0,0.035)] ring-0 xl:sticky xl:top-6">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/10 bg-primary/[0.09] text-sm font-semibold text-primary">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">
            Contact details
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {account?.name ||
              contact.company ||
              contact.email ||
              "Contact information"}
          </p>
        </div>
      </div>
      <PanelSection title="Summary">
        <div className="space-y-3 text-sm">
          <div className="relative rounded-xl border border-border/60 bg-foreground/[0.018] p-3.5">
            <div className="flex items-start gap-2">
              <Tags className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1.5">
                  {contact.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={openLabels}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${labelColor(tag)}`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={openLabels}
                  className={`${contact.tags.length ? "mt-2" : ""} text-xs font-medium text-primary hover:underline`}
                >
                  {contact.tags.length ? "Edit labels" : "Add labels"}
                </button>
                {addingLabel && (
                  <div className="absolute left-0 top-7 z-50 w-[336px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
                    {newLabelTarget === "contact" ? (
                      <NewLabelForm
                        name={newLabelName}
                        color={newLabelColor}
                        onNameChange={setNewLabelName}
                        onColorChange={setNewLabelColor}
                        onCancel={() => setNewLabelTarget(null)}
                        onSave={saveNewLabel}
                      />
                    ) : (
                      <>
                        <div className="p-2.5">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              autoFocus
                              value={labelSearch}
                              onChange={(event) =>
                                setLabelSearch(event.target.value)
                              }
                              onKeyDown={(event) =>
                                event.key === "Enter" &&
                                openNewLabelForm("contact")
                              }
                              placeholder="Search for labels"
                              className="h-9 pl-8 pr-8"
                            />
                            {labelSearch && (
                              <button
                                type="button"
                                onClick={() => setLabelSearch("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="max-h-36 overflow-y-auto border-y border-border px-2 py-1.5">
                          {visibleLabelOptions.map((label) => {
                            const selected = selectedLabels.includes(label);
                            return (
                              <button
                                key={label}
                                type="button"
                                onClick={() =>
                                  setSelectedLabels((labels) =>
                                    selected
                                      ? labels.filter((item) => item !== label)
                                      : [...labels, label],
                                  )
                                }
                                className="flex w-full items-center justify-between rounded-md px-1.5 py-2 text-left hover:bg-muted"
                              >
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${labelColor(label)}`}
                                >
                                  {label}
                                </span>
                                {selected && (
                                  <Check className="h-4 w-4 text-primary" />
                                )}
                              </button>
                            );
                          })}
                          {visibleLabelOptions.length === 0 && (
                            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                              No matching labels
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => openNewLabelForm("contact")}
                          className="flex w-full items-center gap-2 border-b border-border px-3 py-3 text-sm text-primary hover:bg-muted"
                        >
                          <Plus className="h-4 w-4" />
                          Add label
                        </button>
                        <div className="flex justify-end gap-2 p-2.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setAddingLabel(false)}
                            disabled={savingLabels}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void saveLabels()}
                            disabled={savingLabels}
                          >
                            {savingLabels ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Save"
                            )}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-background/50">
            <a
              href={contact.email ? `mailto:${contact.email}` : undefined}
              className="flex min-h-10 items-center gap-3 border-b border-border/60 px-3 py-2 text-primary hover:bg-muted/40"
            >
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">
                {contact.email || "Add email"}
              </span>
            </a>
            <a
              href={contact.phone ? `tel:${contact.phone}` : undefined}
              className="flex min-h-10 items-center gap-3 border-b border-border/60 px-3 py-2 text-primary hover:bg-muted/40"
            >
              <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">
                {contact.phone || "Add phone"}
              </span>
            </a>
            <button
              type="button"
              onClick={() =>
                contact.account &&
                navigate(`/dashboard/crm/organizations/${contact.account.id}`)
              }
              className="flex min-h-10 w-full items-center gap-3 px-3 py-2 text-left text-primary hover:bg-muted/40"
            >
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">
                {account?.name || contact.company || "Add organization"}
              </span>
            </button>
          </div>
        </div>
      </PanelSection>
      <PanelSection title="Details">
        <div className="overflow-hidden rounded-xl border border-border/60 bg-background/50">
          <EditableRow
            label="First name"
            value={firstName}
            onSave={(value) => saveContact("firstName", value)}
          />
          <EditableRow
            label="Last name"
            value={lastName}
            onSave={(value) => saveContact("lastName", value)}
          />
          <EditableRow
            label="Email"
            value={contact.email || "—"}
            inputType="email"
            onSave={(value) => saveContact("email", value)}
          />
          <EditableRow
            label="Phone"
            value={contact.phone || "—"}
            inputType="tel"
            onSave={(value) => saveContact("phone", value)}
          />
          <EditableRow
            label="Organization"
            value={contact.company || "—"}
            onSave={(value) => saveContact("company", value)}
          />
        </div>
      </PanelSection>
      <PanelSection
        title="Organization"
        icon={<Building2 className="h-4 w-4 text-primary" />}
      >
        <div className="overflow-hidden rounded-xl border border-border/60 bg-background/50">
          {(
            [
              ["name", "Name"],
              ["labels", "Labels"],
              ["address", "Address"],
              ["website", "Website"],
              ["linkedinProfile", "LinkedIn profile"],
              ["industry", "Industry"],
              ["annualRevenue", "Annual revenue"],
              ["numberOfEmployees", "No. of Employees"],
            ] as Array<[OrganizationField, string]>
          ).map(([field, label]) =>
            field === "labels" ? (
              <div
                key={field}
                className="group relative grid min-h-11 grid-cols-[104px_minmax(0,1fr)] items-center gap-2 border-b border-border/60 px-3 py-1 hover:bg-muted/30"
              >
                <span className="text-xs font-medium text-muted-foreground">
                  Labels
                </span>
                <button
                  type="button"
                  onClick={openOrganizationLabels}
                  className="flex min-h-9 min-w-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex min-w-0 flex-wrap gap-1.5">
                    {(account?.labels || []).length ? (
                      (account?.labels || []).map((tag) => (
                        <span
                          key={tag}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${labelColor(tag)}`}
                        >
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Add labels
                      </span>
                    )}
                  </span>
                  <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
                {addingOrganizationLabel && (
                  <div className="absolute left-2 top-10 z-50 w-[336px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
                    {newLabelTarget === "organization" ? (
                      <NewLabelForm
                        name={newLabelName}
                        color={newLabelColor}
                        onNameChange={setNewLabelName}
                        onColorChange={setNewLabelColor}
                        onCancel={() => setNewLabelTarget(null)}
                        onSave={saveNewLabel}
                      />
                    ) : (
                      <>
                        <div className="p-2.5">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              autoFocus
                              value={organizationLabelSearch}
                              onChange={(event) =>
                                setOrganizationLabelSearch(event.target.value)
                              }
                              onKeyDown={(event) =>
                                event.key === "Enter" &&
                                openNewLabelForm("organization")
                              }
                              placeholder="Search organization labels"
                              className="h-9 pl-8 pr-8"
                            />
                            {organizationLabelSearch && (
                              <button
                                type="button"
                                onClick={() => setOrganizationLabelSearch("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="max-h-40 overflow-y-auto border-y border-border px-2 py-1.5">
                          {visibleOrganizationLabelOptions.map((option) => {
                            const selected =
                              selectedOrganizationLabels.includes(option);
                            return (
                              <button
                                key={option}
                                type="button"
                                onClick={() =>
                                  setSelectedOrganizationLabels((labels) =>
                                    selected
                                      ? labels.filter((item) => item !== option)
                                      : [...labels, option],
                                  )
                                }
                                className="flex w-full items-center justify-between rounded-md px-1.5 py-2 text-left hover:bg-muted"
                              >
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${labelColor(option)}`}
                                >
                                  {option}
                                </span>
                                {selected && (
                                  <Check className="h-4 w-4 text-primary" />
                                )}
                              </button>
                            );
                          })}
                          {visibleOrganizationLabelOptions.length === 0 && (
                            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                              No matching labels
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => openNewLabelForm("organization")}
                          className="flex w-full items-center gap-2 border-b border-border px-3 py-3 text-sm text-primary hover:bg-muted"
                        >
                          <Plus className="h-4 w-4" />
                          Add label
                        </button>
                        <div className="flex justify-end gap-2 p-2.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setAddingOrganizationLabel(false)}
                            disabled={savingOrganizationLabels}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void saveOrganizationLabels()}
                            disabled={savingOrganizationLabels}
                          >
                            {savingOrganizationLabels ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Save"
                            )}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <EditableRow
                key={field}
                label={label}
                value={organizationValue(field)}
                inputType={
                  field === "website" || field === "linkedinProfile"
                    ? "url"
                    : "text"
                }
                onSave={(value) => saveOrganization(field, value)}
              />
            ),
          )}
        </div>
      </PanelSection>
      <PanelSection
        title="AI Insights"
        icon={<Sparkles className="h-4 w-4 text-amber-500" />}
      >
        <div className="rounded-lg border border-border/70 bg-gradient-to-br from-amber-50/70 to-violet-50/50 p-3 dark:from-amber-950/20 dark:to-violet-950/20">
          <div className="mb-3 flex justify-end">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => void generateInsights()}
              disabled={generatingInsights}
            >
              {generatingInsights ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              {contact.insights.summary &&
              !contact.insights.summary.toLowerCase().startsWith("no insights")
                ? "Regenerate"
                : "Generate insights"}
            </Button>
          </div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Conversation sentiment
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${contact.insights.sentiment === "positive" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : contact.insights.sentiment === "negative" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
            >
              {contact.insights.sentiment}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {contact.insights.summary}
          </p>
          {contact.insights.topics.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {contact.insights.topics.map((topic) => (
                <span
                  key={topic}
                  className="rounded-full border border-border bg-background/80 px-2 py-0.5 text-[10px] font-medium"
                >
                  {topic}
                </span>
              ))}
            </div>
          )}
        </div>
      </PanelSection>
      <PanelSection
        title="Chat History"
        icon={<MessageSquare className="h-4 w-4 text-blue-500" />}
      >
        <div className="space-y-2">
          {contact.conversations.slice(0, 3).map((conversation) => {
            const channel = conversation.channel.toLowerCase();
            const ConversationIcon = channel.includes("email")
              ? Mail
              : channel.includes("phone")
                ? Phone
                : MessageSquare;
            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() =>
                  navigate(
                    `/dashboard/conversations/inbox/chat/${conversation.id}`,
                  )
                }
                className="w-full rounded-lg border border-border/70 bg-background p-3 text-left transition-colors hover:border-primary/30 hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-xs font-medium capitalize">
                    {channel.includes("whatsapp") ? (
                      <WhatsAppIcon className="h-4 w-4 shrink-0" />
                    ) : (
                      <ConversationIcon
                        className={`h-4 w-4 shrink-0 ${channel.includes("email") ? "text-rose-500" : channel.includes("phone") ? "text-sky-600" : "text-blue-500"}`}
                      />
                    )}
                    <span className="truncate">
                      {conversation.channel.replaceAll("_", " ")}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${conversation.status === "open" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}
                  >
                    {conversation.status}
                  </span>
                </div>
                <p className="mt-2 truncate text-xs text-muted-foreground">
                  {conversation.lastMessage}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground/80">
                  {new Date(conversation.updatedAt).toLocaleString()}
                </p>
              </button>
            );
          })}
          {contact.conversations.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No chat history yet.
            </div>
          )}
          {contact.conversations.length > 3 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-xs text-primary"
              onClick={() => navigate("/dashboard/conversations/inbox")}
            >
              View all conversations ({contact.conversations.length})
            </Button>
          )}
        </div>
      </PanelSection>
      <PanelSection title="Deals">
        {deals.length ? (
          <div className="space-y-2">
            {deals.map((deal) => (
              <button
                key={deal.id}
                type="button"
                onClick={() => navigate(`/dashboard/crm/pipeline/${deal.id}`)}
                className="w-full rounded-md border border-border p-3 text-left hover:bg-muted/50"
              >
                <p className="truncate text-sm font-medium">{deal.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {deal.currency} {deal.value.toLocaleString()}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">No deals added yet.</p>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => navigate("/dashboard/crm/pipeline")}
              title="Add deal"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </PanelSection>
    </Card>
  );
}

function ActivityComposer({
  contact,
  onClose,
  activity,
}: {
  contact: Contact;
  onClose: () => void;
  activity?: ContactTimelineItem;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const descriptionRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef(0);
  const [timelineInteraction, setTimelineInteraction] = useState<
    "move" | "resize-start" | "resize-end" | null
  >(null);
  const initialStart = useMemo(() => {
    if (activity?.startAt) return new Date(activity.startAt);
    const date = new Date();
    date.setMinutes(date.getMinutes() < 30 ? 30 : 60, 0, 0);
    return date;
  }, [activity?.startAt]);
  const initialEnd = useMemo(
    () =>
      activity?.endAt
        ? new Date(activity.endAt)
        : new Date(initialStart.getTime() + 60 * 60 * 1000),
    [activity?.endAt, initialStart],
  );
  const localDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const localTime = (date: Date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const [title, setTitle] = useState(activity?.title || "Meeting");
  const [activityType, setActivityType] = useState<
    "call" | "meeting" | "task" | "deadline" | "lunch"
  >(activity?.activityType || "meeting");
  const [startDate, setStartDate] = useState(localDate(initialStart));
  const [startTime, setStartTime] = useState(localTime(initialStart));
  const [endDate, setEndDate] = useState(localDate(initialEnd));
  const [endTime, setEndTime] = useState(localTime(initialEnd));
  const [priority, setPriority] = useState<"none" | "low" | "medium" | "high">(
    activity?.priority === "normal" ? "none" : activity?.priority || "none",
  );
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [description, setDescription] = useState(activity?.content || "");
  const [location, setLocation] = useState(activity?.location || "");
  const [videoCallUrl, setVideoCallUrl] = useState(
    activity?.videoCallUrl || "",
  );
  const [showLocation, setShowLocation] = useState(Boolean(activity?.location));
  const [showVideoCall, setShowVideoCall] = useState(
    Boolean(activity?.videoCallUrl),
  );
  const [markDone, setMarkDone] = useState(activity?.status === "done");
  const [saving, setSaving] = useState(false);
  const activityTypes = [
    { id: "call" as const, label: "Call", icon: Phone },
    { id: "meeting" as const, label: "Meeting", icon: Users },
    { id: "task" as const, label: "Task", icon: CheckSquare },
    { id: "deadline" as const, label: "Deadline", icon: Flag },
    { id: "lunch" as const, label: "Lunch", icon: Utensils },
  ];
  const startAt = new Date(`${startDate}T${startTime}`);
  const endAt = new Date(`${endDate}T${endTime}`);
  const durationMinutes = Math.max(
    15,
    Math.round((endAt.getTime() - startAt.getTime()) / 60000) || 60,
  );
  useEffect(() => {
    const timeline = timelineRef.current;
    if (timeline)
      timeline.scrollTop = Math.max(0, (initialStart.getHours() - 2) * 48);
    if (descriptionRef.current)
      descriptionRef.current.innerHTML = sanitizeNoteHtml(
        activity?.content || "",
      );
  }, [activity?.content, initialStart]);
  const reset = () => {
    setTitle("Meeting");
    setActivityType("meeting");
    setStartDate(localDate(initialStart));
    setStartTime(localTime(initialStart));
    setEndDate(localDate(initialEnd));
    setEndTime(localTime(initialEnd));
    setPriority("none");
    setPriorityOpen(false);
    setDescription("");
    setLocation("");
    setVideoCallUrl("");
    setShowLocation(false);
    setShowVideoCall(false);
    setMarkDone(false);
    if (descriptionRef.current) descriptionRef.current.innerHTML = "";
  };
  const saveActivity = async () => {
    if (
      !title.trim() ||
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(endAt.getTime()) ||
      endAt <= startAt
    ) {
      toast.error("Enter a title and a valid activity time range");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        content: sanitizeNoteHtml(
          descriptionRef.current?.innerHTML || description,
        ),
        activityType,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        priority,
        status: markDone ? "done" : "scheduled",
        location: location.trim(),
        videoCallUrl: videoCallUrl.trim(),
      } as const;
      if (activity)
        await contactsApi.updateActivity(contact.id, activity.id, payload);
      else await contactsApi.addActivity(contact.id, payload);
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success(activity ? "Activity updated" : "Activity scheduled");
      reset();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to schedule activity",
      );
    } finally {
      setSaving(false);
    }
  };
  const formatDescription = (
    command: "bold" | "italic" | "underline" | "insertUnorderedList",
  ) => {
    descriptionRef.current?.focus();
    document.execCommand(command, false);
    setDescription(descriptionRef.current?.innerHTML || "");
  };
  const previewTop =
    Math.max(0, Math.min(24, startAt.getHours() + startAt.getMinutes() / 60)) *
    48;
  const previewHeight = Math.max(
    28,
    Math.min(24 * 48 - previewTop, (durationMinutes / 60) * 48),
  );
  const shiftDay = (amount: number) => {
    const nextStart = new Date(startAt);
    nextStart.setDate(nextStart.getDate() + amount);
    const nextEnd = new Date(endAt);
    nextEnd.setDate(nextEnd.getDate() + amount);
    setStartDate(localDate(nextStart));
    setEndDate(localDate(nextEnd));
  };
  const handleTimelinePointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!timelineInteraction || !timelineRef.current) return;
    const timelineRect = timelineRef.current.getBoundingClientRect();
    const pointerY =
      event.clientY - timelineRect.top + timelineRef.current.scrollTop;
    const pointerMinutes = Math.round(((pointerY / 48) * 60) / 15) * 15;
    if (timelineInteraction === "resize-start") {
      const endMinutes =
        endAt.toDateString() === startAt.toDateString()
          ? endAt.getHours() * 60 + endAt.getMinutes()
          : 24 * 60;
      const nextMinutes = Math.max(
        0,
        Math.min(endMinutes - 15, pointerMinutes),
      );
      const nextStart = new Date(`${startDate}T00:00`);
      nextStart.setMinutes(nextMinutes);
      setStartTime(localTime(nextStart));
      return;
    }
    if (timelineInteraction === "resize-end") {
      const startMinutes = startAt.getHours() * 60 + startAt.getMinutes();
      const nextMinutes = Math.max(
        startMinutes + 15,
        Math.min(24 * 60, pointerMinutes),
      );
      const nextEnd = new Date(`${startDate}T00:00`);
      nextEnd.setMinutes(nextMinutes);
      setEndDate(localDate(nextEnd));
      setEndTime(localTime(nextEnd));
      return;
    }
    const rawY = pointerY - dragOffsetRef.current;
    const snappedMinutes = Math.round(((rawY / 48) * 60) / 15) * 15;
    const nextMinutes = Math.max(
      0,
      Math.min(24 * 60 - durationMinutes, snappedMinutes),
    );
    const nextStart = new Date(`${startDate}T00:00`);
    nextStart.setMinutes(nextMinutes);
    const nextEnd = new Date(nextStart.getTime() + durationMinutes * 60000);
    setStartTime(localTime(nextStart));
    setEndDate(localDate(nextEnd));
    setEndTime(localTime(nextEnd));
  };
  const dayActivities = (contact.timelineItems || []).filter(
    (item) =>
      item.type === "activity" &&
      item.startAt &&
      new Date(item.startAt).toDateString() === startAt.toDateString(),
  );

  return (
    <div className="grid overflow-hidden rounded-md border border-border lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-4 p-4">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="h-11 text-xl"
          placeholder="Activity title"
        />
        <div className="flex flex-wrap gap-2">
          {activityTypes.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              type="button"
              variant={activityType === id ? "default" : "outline"}
              size="icon-lg"
              onClick={() => {
                const hasDefaultTitle =
                  activityTypes.some((type) => type.label === title) ||
                  !title.trim();
                setActivityType(id);
                if (hasDefaultTitle) setTitle(label);
              }}
              title={label}
            >
              <Icon className="h-4 w-4" />
            </Button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_1fr_1fr] sm:items-center">
          <Input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          <Input
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
          <span className="text-center">–</span>
          <Input
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
          />
          <Input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>
        <div className="relative flex items-center gap-2">
          <Flag className="h-4 w-4 text-muted-foreground" />
          <button
            type="button"
            onClick={() => setPriorityOpen((value) => !value)}
            className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium"
          >
            Priority <ChevronDown className="h-4 w-4" />
          </button>
          {priorityOpen && (
            <div className="absolute left-6 top-11 z-40 w-60 rounded-xl border border-border bg-popover p-2 shadow-xl">
              {(["none", "high", "medium", "low"] as const).map((value) => {
                const option = activityPriority(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setPriority(value);
                      setPriorityOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-semibold hover:bg-muted"
                  >
                    <span
                      className={
                        value === "none"
                          ? ""
                          : `rounded px-1.5 py-0.5 text-[10px] uppercase ${option.className}`
                      }
                    >
                      {option.label}
                    </span>
                    {priority === value && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setShowLocation((value) => !value)}
            className="font-medium text-primary"
          >
            Add location
          </button>
          <button
            type="button"
            onClick={() => setShowVideoCall((value) => !value)}
            className="font-medium text-primary"
          >
            Video call
          </button>
          <span className="font-medium text-primary">Description</span>
        </div>
        {showLocation && (
          <div className="relative">
            <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Location"
              className="pl-9"
            />
          </div>
        )}
        {showVideoCall && (
          <div className="relative">
            <Video className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="url"
              value={videoCallUrl}
              onChange={(event) => setVideoCallUrl(event.target.value)}
              placeholder="https://meeting-link.example"
              className="pl-9"
            />
          </div>
        )}
        <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/80 shadow-sm ring-1 ring-amber-100/60 dark:border-amber-900/50 dark:bg-amber-950/20 dark:ring-amber-950/40">
          <div
            ref={descriptionRef}
            contentEditable
            suppressContentEditableWarning
            data-placeholder="Add a description…"
            onInput={(event) => setDescription(event.currentTarget.innerHTML)}
            className="min-h-32 p-4 text-sm leading-6 outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
          />
          <div className="flex gap-1 border-t border-amber-200 bg-background/40 px-3 py-2.5 dark:border-amber-900/50">
            {(
              [
                { label: "Bold", icon: Bold, command: "bold" },
                { label: "Italic", icon: Italic, command: "italic" },
                { label: "Underline", icon: Underline, command: "underline" },
                { label: "List", icon: List, command: "insertUnorderedList" },
              ] as const
            ).map(({ label, icon: Icon, command }) => (
              <Button
                key={label}
                type="button"
                variant="ghost"
                size="icon"
                onMouseDown={(event) => {
                  event.preventDefault();
                  formatDescription(command);
                }}
                title={label}
              >
                <Icon className="h-4 w-4" />
              </Button>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-border px-3 py-2 text-sm">
          <UserRound className="mr-2 inline h-4 w-4" />
          {user?.name || user?.email || "You"} (You)
        </div>
        <div className="space-y-2">
          <div className="rounded-md border border-border px-3 py-2 text-sm">
            <UserRound className="mr-2 inline h-4 w-4" />
            {contact.name}
          </div>
          {contact.company && (
            <div className="rounded-md border border-border px-3 py-2 text-sm">
              <Building2 className="mr-2 inline h-4 w-4" />
              {contact.company}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={markDone}
              onChange={(event) => setMarkDone(event.target.checked)}
            />
            Mark as done
          </label>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={() => void saveActivity()}
            disabled={saving}
          >
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save
          </Button>
        </div>
      </div>
      <div className="border-l border-border bg-muted/10">
        <div className="flex items-center justify-between border-b border-border px-3 py-3 text-sm font-semibold">
          <span>
            {startAt.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
          <span className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => shiftDay(-1)}
              title="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => shiftDay(1)}
              title="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </span>
        </div>
        <div
          ref={timelineRef}
          className="relative h-[480px] touch-none overflow-y-auto"
          onPointerMove={handleTimelinePointerMove}
          onPointerUp={() => setTimelineInteraction(null)}
          onPointerCancel={() => setTimelineInteraction(null)}
        >
          <div className="relative h-[1152px]">
            {Array.from({ length: 25 }, (_, index) => (
              <div
                key={index}
                className="absolute left-0 right-0 flex h-12 border-t border-border"
                style={{ top: index * 48 }}
              >
                <span className="w-14 -translate-y-2 bg-background pr-2 text-right text-xs text-muted-foreground">
                  {new Date(2000, 0, 1, index).toLocaleTimeString([], {
                    hour: "numeric",
                  })}
                </span>
              </div>
            ))}
            {dayActivities.map((item) => {
              const itemStart = new Date(item.startAt!);
              const itemEnd = new Date(
                item.endAt || new Date(itemStart.getTime() + 3600000),
              );
              const top =
                (itemStart.getHours() + itemStart.getMinutes() / 60) * 48;
              const height = Math.max(
                24,
                ((itemEnd.getTime() - itemStart.getTime()) / 3600000) * 48,
              );
              return (
                <div
                  key={item.id}
                  className="absolute left-16 right-3 overflow-hidden rounded-sm bg-muted px-2 py-1 text-xs font-semibold text-foreground"
                  style={{ top, height }}
                >
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {item.title}
                  </span>
                </div>
              );
            })}
            <div
              role="slider"
              aria-label="Activity time"
              aria-valuetext={`${startTime} to ${endTime}`}
              tabIndex={0}
              onPointerDown={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                dragOffsetRef.current = event.clientY - rect.top;
                event.currentTarget.setPointerCapture(event.pointerId);
                setTimelineInteraction("move");
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                  return;
                event.preventDefault();
                const amount = event.key === "ArrowUp" ? -15 : 15;
                const nextStart = new Date(startAt.getTime() + amount * 60000);
                const nextEnd = new Date(endAt.getTime() + amount * 60000);
                if (
                  nextStart.toDateString() !== startAt.toDateString() ||
                  nextEnd.toDateString() !== endAt.toDateString()
                )
                  return;
                setStartTime(localTime(nextStart));
                setEndTime(localTime(nextEnd));
              }}
              className={`absolute left-16 right-3 z-10 select-none overflow-hidden rounded-sm bg-blue-600 px-2 py-1 text-xs font-semibold text-white shadow-sm ${timelineInteraction === "move" ? "cursor-grabbing ring-2 ring-blue-300" : timelineInteraction ? "ring-2 ring-blue-300" : "cursor-grab"}`}
              style={{ top: previewTop, height: previewHeight }}
            >
              <span
                aria-hidden="true"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setTimelineInteraction("resize-start");
                }}
                className="absolute inset-x-0 top-0 z-20 h-2 cursor-ns-resize bg-blue-400/0 hover:bg-blue-300/70"
              >
                <span className="absolute left-1/2 top-1 h-0.5 w-8 -translate-x-1/2 rounded-full bg-white/70" />
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {title || "Activity"}
              </span>
              <span className="mt-0.5 block font-normal">
                {startAt.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                →{" "}
                {endAt.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <span
                aria-hidden="true"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setTimelineInteraction("resize-end");
                }}
                className="absolute inset-x-0 bottom-0 z-20 h-2 cursor-ns-resize bg-blue-400/0 hover:bg-blue-300/70"
              >
                <span className="absolute bottom-1 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-white/70" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotesComposer({ contact }: { contact: Contact }) {
  const queryClient = useQueryClient();
  const editorRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeFormats, setActiveFormats] = useState<string[]>([]);
  const [insertKind, setInsertKind] = useState<"link" | "image" | null>(null);
  const [insertUrl, setInsertUrl] = useState("");

  const setEditorContent = (value: string) => {
    const safeValue = sanitizeNoteHtml(value);
    setDraft(safeValue);
    if (editorRef.current) editorRef.current.innerHTML = safeValue;
  };
  const cancel = () => {
    setEditorContent("");
    setActiveFormats([]);
  };
  const saveNote = async () => {
    const content = sanitizeNoteHtml(editorRef.current?.innerHTML || draft);
    if (!notePlainText(content) && !content.includes("<img")) return;
    setSaving(true);
    try {
      await contactsApi.addNote(contact.id, content);
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      cancel();
      toast.success("Note added to history");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save note",
      );
    } finally {
      setSaving(false);
    }
  };
  const refreshActiveFormats = () => {
    const formats = [
      "bold",
      "italic",
      "underline",
      "insertUnorderedList",
    ].filter((command) => document.queryCommandState(command));
    setActiveFormats(formats);
  };
  const syncDraft = () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!(editor.textContent || "").trim() && !editor.querySelector("img"))
      editor.innerHTML = "";
    setDraft(editor.innerHTML);
    refreshActiveFormats();
  };
  const runCommand = (
    command: "bold" | "italic" | "underline" | "insertUnorderedList",
  ) => {
    editorRef.current?.focus();
    document.execCommand(command, false);
    syncDraft();
  };
  const openInsertPopup = (kind: "link" | "image") => {
    const selection = window.getSelection();
    savedSelectionRef.current = selection?.rangeCount
      ? selection.getRangeAt(0).cloneRange()
      : null;
    setInsertKind(kind);
    setInsertUrl("");
  };
  const insertUrlContent = () => {
    const url = insertUrl.trim();
    if (!insertKind || !/^https?:\/\//i.test(url)) {
      toast.error("Enter a valid http or https URL");
      return;
    }
    editorRef.current?.focus();
    const selection = window.getSelection();
    if (selection && savedSelectionRef.current) {
      selection.removeAllRanges();
      selection.addRange(savedSelectionRef.current);
    }
    if (insertKind === "link") {
      if (selection?.isCollapsed) {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.textContent = url;
        document.execCommand("insertHTML", false, anchor.outerHTML);
      } else document.execCommand("createLink", false, url);
    } else document.execCommand("insertImage", false, url);
    syncDraft();
    setInsertKind(null);
    setInsertUrl("");
  };
  const addMention = () => {
    editorRef.current?.focus();
    document.execCommand("insertText", false, "@");
    syncDraft();
  };
  const tools = [
    {
      label: "Bold",
      icon: Bold,
      command: "bold",
      action: () => runCommand("bold"),
    },
    {
      label: "Italic",
      icon: Italic,
      command: "italic",
      action: () => runCommand("italic"),
    },
    {
      label: "Underline",
      icon: Underline,
      command: "underline",
      action: () => runCommand("underline"),
    },
    { label: "Link", icon: Link, action: () => openInsertPopup("link") },
    { label: "Mention", icon: AtSign, action: addMention },
    { label: "Image", icon: Image, action: () => openInsertPopup("image") },
    {
      label: "List",
      icon: List,
      command: "insertUnorderedList",
      action: () => runCommand("insertUnorderedList"),
    },
  ];

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/80 shadow-sm ring-1 ring-amber-100/60 dark:border-amber-900/60 dark:bg-amber-950/20 dark:ring-amber-950/40">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder="Write a note…"
          onInput={syncDraft}
          onKeyUp={refreshActiveFormats}
          onMouseUp={refreshActiveFormats}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void saveNote();
            }
          }}
          className="min-h-36 max-h-96 overflow-y-auto p-5 text-[15px] leading-6 outline-none empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] [&_a]:text-primary [&_a]:underline [&_img]:my-2 [&_img]:max-h-64 [&_img]:max-w-full [&_img]:rounded-md [&_li]:ml-5 [&_ul]:list-disc"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-3 border-t border-amber-200/80 bg-background/40 px-4 py-3 dark:border-amber-900/60">
          {insertKind && (
            <InsertUrlPopover
              kind={insertKind}
              value={insertUrl}
              onChange={setInsertUrl}
              onCancel={() => {
                setInsertKind(null);
                setInsertUrl("");
              }}
              onInsert={insertUrlContent}
            />
          )}
          <div className="flex flex-wrap items-center gap-1">
            {tools.map(({ label, icon: Icon, command, action }) => (
              <Button
                key={label}
                type="button"
                variant="ghost"
                size="icon"
                onMouseDown={(event) => {
                  event.preventDefault();
                  action();
                }}
                title={label}
                aria-pressed={
                  command ? activeFormats.includes(command) : undefined
                }
                className={
                  command && activeFormats.includes(command)
                    ? "bg-muted text-foreground"
                    : ""
                }
              >
                <Icon className="h-4 w-4" />
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {draft && (
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={cancel}
                disabled={saving}
              >
                Cancel
              </Button>
            )}
            <Button
              type="button"
              size="lg"
              onClick={() => void saveNote()}
              disabled={
                (!notePlainText(draft) && !draft.includes("<img")) || saving
              }
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EmailComposer({ contact }: { contact: Contact }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: emailChannel } = useEmailChannel();
  const bodyRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [senderOpen, setSenderOpen] = useState(false);
  const [selectedSender, setSelectedSender] = useState("");
  const [insertKind, setInsertKind] = useState<"link" | "image" | null>(null);
  const [insertUrl, setInsertUrl] = useState("");
  const configuredSenders = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...(emailChannel?.config.email?.addresses || []),
            emailChannel?.config.email?.address || "",
          ].filter(Boolean),
        ),
      ),
    [emailChannel],
  );

  useEffect(() => {
    if (configuredSenders.length && !configuredSenders.includes(selectedSender))
      setSelectedSender(configuredSenders[0]);
  }, [configuredSenders, selectedSender]);

  const syncBody = () => setBody(bodyRef.current?.innerHTML || "");
  const format = (command: string, value?: string) => {
    bodyRef.current?.focus();
    document.execCommand(command, false, value);
    syncBody();
  };
  const openInsertPopup = (kind: "link" | "image") => {
    const selection = window.getSelection();
    savedSelectionRef.current = selection?.rangeCount
      ? selection.getRangeAt(0).cloneRange()
      : null;
    setInsertKind(kind);
    setInsertUrl("");
  };
  const insertUrlContent = () => {
    const url = insertUrl.trim();
    if (!insertKind || !/^https?:\/\//i.test(url)) {
      toast.error("Enter a valid http or https URL");
      return;
    }
    bodyRef.current?.focus();
    const selection = window.getSelection();
    if (selection && savedSelectionRef.current) {
      selection.removeAllRanges();
      selection.addRange(savedSelectionRef.current);
    }
    if (insertKind === "link") {
      if (selection?.isCollapsed) {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.textContent = url;
        document.execCommand("insertHTML", false, anchor.outerHTML);
      } else document.execCommand("createLink", false, url);
    } else document.execCommand("insertImage", false, url);
    syncBody();
    setInsertKind(null);
    setInsertUrl("");
  };
  const writeEmail = () => {
    const firstName = contact.name.split(" ")[0] || contact.name;
    const draft = `<p>Hi ${firstName},</p><p>${subject ? `I’m reaching out regarding ${subject.toLowerCase()}.` : "I’m reaching out to follow up with you."}</p><p>Please let me know if you have any questions.</p><p>Best regards,<br>${user?.name || "Your team"}</p>`;
    setBody(draft);
    if (bodyRef.current) bodyRef.current.innerHTML = draft;
  };
  const sendEmail = async () => {
    const htmlBody = sanitizeNoteHtml(bodyRef.current?.innerHTML || body);
    const plainBody = notePlainText(htmlBody);
    if (!contact.email || !subject.trim() || !plainBody) return;
    setSending(true);
    try {
      await contactsApi.sendEmail(contact.id, {
        subject: subject.trim(),
        body: plainBody,
        html: htmlBody,
        from: selectedSender || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      setSubject("");
      setBody("");
      if (bodyRef.current) bodyRef.current.innerHTML = "";
      toast.success("Email sent and added to history");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send email",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="relative grid grid-cols-[90px_1fr] items-center border-b border-border px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">From</span>
        <button
          type="button"
          onClick={() => setSenderOpen((open) => !open)}
          className="flex w-fit max-w-full items-center gap-2 rounded-md px-2 py-1 font-semibold hover:bg-muted"
        >
          <span className="truncate">
            {selectedSender || user?.email || "Configured email channel"}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" />
        </button>
        {senderOpen && (
          <div className="absolute left-[90px] top-11 z-40 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
            <div className="p-2">
              {configuredSenders.length ? (
                configuredSenders.map((sender) => (
                  <button
                    key={sender}
                    type="button"
                    onClick={() => {
                      setSelectedSender(sender);
                      setSenderOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="truncate">{sender}</span>
                    {selectedSender === sender && (
                      <Check className="h-4 w-4 text-blue-600" />
                    )}
                  </button>
                ))
              ) : (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  No verified email account configured.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => navigate("/dashboard/channels/email")}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-3 text-sm hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
              New email account
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-[90px_1fr] items-center border-b border-border px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">Recipients</span>
        <span>{contact.email || "No email address"}</span>
      </div>
      <div className="grid grid-cols-[90px_1fr] items-center border-b border-border px-4 py-1.5 text-sm">
        <span className="text-muted-foreground">Subject</span>
        <Input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Email subject"
          className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="flex justify-end border-b border-border px-3 py-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={writeEmail}
          className="text-violet-700"
        >
          <Sparkles className="mr-1.5 h-4 w-4" />
          Write my email
        </Button>
      </div>
      <div
        ref={bodyRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder="Write your email…"
        onInput={(event) => setBody(event.currentTarget.innerHTML)}
        className="min-h-52 p-4 text-sm outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] [&_a]:text-primary [&_a]:underline [&_img]:max-w-full [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc"
      />
      <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
        {insertKind && (
          <InsertUrlPopover
            kind={insertKind}
            value={insertUrl}
            onChange={setInsertUrl}
            onCancel={() => {
              setInsertKind(null);
              setInsertUrl("");
            }}
            onInsert={insertUrlContent}
          />
        )}
        <div className="flex flex-wrap items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onMouseDown={(event) => {
              event.preventDefault();
              format("undo");
            }}
            title="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onMouseDown={(event) => {
              event.preventDefault();
              format("redo");
            }}
            title="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <span className="mx-1 h-6 border-l border-border" />
          <select
            aria-label="Font family"
            defaultValue="Arial"
            onChange={(event) => format("fontName", event.target.value)}
            className="h-8 rounded border-0 bg-transparent px-1 text-sm outline-none"
          >
            <option>Arial</option>
            <option>Georgia</option>
            <option>Tahoma</option>
            <option>Verdana</option>
            <option>Courier New</option>
          </select>
          <select
            aria-label="Font size"
            defaultValue="3"
            onChange={(event) => format("fontSize", event.target.value)}
            className="h-8 w-12 rounded border-0 bg-transparent text-sm outline-none"
          >
            <option value="2">S</option>
            <option value="3">M</option>
            <option value="4">L</option>
            <option value="5">XL</option>
          </select>
          {(
            [
              { label: "Bold", icon: Bold, command: "bold" },
              { label: "Italic", icon: Italic, command: "italic" },
              { label: "Underline", icon: Underline, command: "underline" },
              {
                label: "Strikethrough",
                icon: Strikethrough,
                command: "strikeThrough",
              },
              {
                label: "Numbered list",
                icon: ListOrdered,
                command: "insertOrderedList",
              },
              {
                label: "Bulleted list",
                icon: List,
                command: "insertUnorderedList",
              },
              { label: "Align left", icon: AlignLeft, command: "justifyLeft" },
              {
                label: "Align center",
                icon: AlignCenter,
                command: "justifyCenter",
              },
              {
                label: "Align right",
                icon: AlignRight,
                command: "justifyRight",
              },
            ] as const
          ).map(({ label, icon: Icon, command }) => (
            <Button
              key={label}
              type="button"
              variant="ghost"
              size="icon-xs"
              onMouseDown={(event) => {
                event.preventDefault();
                format(command);
              }}
              title={label}
            >
              <Icon className="h-4 w-4" />
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onMouseDown={(event) => {
              event.preventDefault();
              openInsertPopup("link");
            }}
            title="Insert link"
          >
            <Link className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onMouseDown={(event) => {
              event.preventDefault();
              openInsertPopup("image");
            }}
            title="Insert image"
          >
            <Image className="h-4 w-4" />
          </Button>
          <label
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded hover:bg-muted"
            title="Text color"
          >
            <span className="font-serif text-base font-semibold underline decoration-red-500 decoration-2">
              A
            </span>
            <input
              type="color"
              className="sr-only"
              onChange={(event) => format("foreColor", event.target.value)}
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onMouseDown={(event) => {
              event.preventDefault();
              format("removeFormat");
            }}
            title="Clear formatting"
          >
            <RemoveFormatting className="h-4 w-4" />
          </Button>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => void sendEmail()}
          disabled={
            sending || !contact.email || !subject.trim() || !notePlainText(body)
          }
        >
          {sending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-4 w-4" />
          )}
          Send
        </Button>
      </div>
    </div>
  );
}

export function ContactFileWorkspace({
  contact,
  documentMode = false,
}: {
  contact: Contact;
  documentMode?: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [documentView, setDocumentView] = useState<"documents" | "templates">(
    "documents",
  );
  const items = (contact.timelineItems || []).filter(
    (item) => item.type === (documentMode ? "document" : "file"),
  );

  const uploadFiles = async (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length) return;
    setUploading(true);
    try {
      for (const file of selected) {
        const { data: uploadMeta } =
          await storageApi.generatePresignedUploadUrl(
            file.name,
            file.type || "application/octet-stream",
            3600,
          );
        await storageApi.uploadFileWithPresignedUrl(uploadMeta.uploadUrl, file);
        await contactsApi.addTimelineItem(contact.id, {
          type: documentMode ? "document" : "file",
          title: file.name,
          fileName: file.name,
          fileKey: uploadMeta.fileKey,
          mimeType: file.type,
          size: file.size,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success(
        `${selected.length} ${documentMode ? "document" : "file"}${selected.length === 1 ? "" : "s"} uploaded`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  const input = (
    <input
      ref={inputRef}
      type="file"
      multiple
      className="hidden"
      accept={
        documentMode ? ".pdf,.doc,.docx" : ".pdf,.doc,.docx,.jpg,.jpeg,.png"
      }
      onChange={(event) =>
        event.target.files && void uploadFiles(event.target.files)
      }
    />
  );

  if (!documentMode)
    return (
      <div>
        {input}
        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void uploadFiles(event.dataTransfer.files);
          }}
          className={`flex min-h-28 items-center justify-center rounded-md border-2 border-dashed p-5 transition-colors ${dragging ? "border-primary bg-primary/5" : "border-border bg-muted/20"}`}
        >
          <Button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Upload files
          </Button>
          <span className="ml-2 text-sm">or drag files here.</span>
        </div>
        {items.length > 0 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {items.map((item) => (
              <a
                key={item.id}
                href={
                  item.fileKey
                    ? storageApi.getProxyFileUrl(item.fileKey)
                    : undefined
                }
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-muted"
              >
                <Paperclip className="h-4 w-4 text-primary" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {item.fileName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.author} ·{" "}
                    {item.size ? `${Math.ceil(item.size / 1024)} KB` : "File"}
                  </span>
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    );

  return (
    <div>
      {input}
      <div className="mb-5 flex items-center justify-between border-b border-border">
        <div className="flex">
          <button
            type="button"
            onClick={() => setDocumentView("documents")}
            className={`border-b-2 px-3 py-3 text-sm ${documentView === "documents" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
          >
            Documents
          </button>
          <button
            type="button"
            onClick={() => setDocumentView("templates")}
            className={`border-b-2 px-3 py-3 text-sm ${documentView === "templates" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
          >
            Templates
          </button>
        </div>
        <button
          type="button"
          onClick={() => navigate("/dashboard/integrations")}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Learn more
        </button>
      </div>
      {documentView === "templates" ? (
        <div className="mx-auto max-w-xl py-5 text-center">
          <div className="mb-4 flex justify-center gap-3">
            <Cloud className="h-12 w-12 text-blue-600" />
            <FileText className="h-12 w-12 text-primary" />
          </div>
          <h3 className="font-semibold">
            Create more powerful documents with cloud storage
          </h3>
          <div className="mx-auto mt-3 w-fit space-y-2 text-left text-sm">
            <p>✓ Create editable documents</p>
            <p>✓ Autofill documents with contact data</p>
            <p>✓ Set up shared templates to save time</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="mt-5"
            onClick={() => navigate("/dashboard/integrations")}
          >
            <Cloud className="mr-2 h-4 w-4" />
            Connect cloud storage
          </Button>
        </div>
      ) : (
        <div>
          <div className="mb-5 flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <MonitorUp className="mr-2 h-4 w-4" />
              )}
              Upload from device
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-primary"
              onClick={() => navigate("/dashboard/integrations")}
            >
              <Cloud className="mr-2 h-4 w-4" />
              Connect cloud storage
            </Button>
          </div>
          <p className="mb-3 text-xs font-semibold uppercase">
            Documents created
          </p>
          {items.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((item) => (
                <a
                  key={item.id}
                  href={
                    item.fileKey
                      ? storageApi.getProxyFileUrl(item.fileKey)
                      : undefined
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-muted"
                >
                  <FileText className="h-5 w-5 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {item.fileName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <FileText className="mx-auto mb-2 h-7 w-7" />
              No documents created yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContactActivityWorkspace({ contact }: { contact: Contact }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ActivityWorkspaceTab>("activity");
  const [activityComposerOpen, setActivityComposerOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [expandFocus, setExpandFocus] = useState(false);
  const [editingHistoryNoteId, setEditingHistoryNoteId] = useState<
    string | null
  >(null);
  const [historyNoteDraft, setHistoryNoteDraft] = useState("");
  const [savingHistoryNote, setSavingHistoryNote] = useState(false);
  const [completingActivityId, setCompletingActivityId] = useState<
    string | null
  >(null);
  const [completedActivityIds, setCompletedActivityIds] = useState<string[]>(
    [],
  );
  const [editingActivity, setEditingActivity] =
    useState<ContactTimelineItem | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "activity" | "note" | "file";
    id: string;
    label: string;
  } | null>(null);
  const [deletingTarget, setDeletingTarget] = useState(false);
  const [fileDescriptionItem, setFileDescriptionItem] =
    useState<HistoryItem | null>(null);
  const [fileDescriptionDraft, setFileDescriptionDraft] = useState("");
  const [savingFileDescription, setSavingFileDescription] = useState(false);
  const historyEditorRef = useRef<HTMLDivElement>(null);
  const history = useMemo<HistoryItem[]>(
    () =>
      [
        ...contact.notes.map((note) => ({
          id: `note-${note.id}`,
          title: notePlainText(note.content),
          meta: `${note.author} · ${new Date(note.createdAt).toLocaleString()}`,
          icon: MessageSquare,
          kind: "notes" as const,
          date: note.createdAt,
          author: note.author,
          noteId: note.id,
          noteHtml: note.content,
          pinned: note.pinned,
        })),
        ...(contact.timelineItems || []).map((item) => ({
          id: `timeline-${item.id}`,
          timelineItemId: item.id,
          title: item.title,
          meta: `${item.author} · ${new Date(item.createdAt).toLocaleString()}`,
          icon:
            item.type === "email"
              ? Mail
              : item.type === "document"
                ? FileText
                : item.type === "activity"
                  ? CalendarDays
                  : Paperclip,
          kind:
            item.type === "email"
              ? ("emails" as const)
              : item.type === "document"
                ? ("documents" as const)
                : item.type === "activity"
                  ? ("activities" as const)
                  : ("files" as const),
          date: item.startAt || item.createdAt,
          author: item.author,
          fileKey: item.fileKey,
          fileName: item.fileName,
          mimeType: item.mimeType,
          size: item.size,
          content: item.content,
          activityType: item.activityType,
          priority: item.priority,
          status: item.status,
          endAt: item.endAt,
        })),
        ...contact.conversations.map((conversation) => {
          const channel = conversation.channel.toLowerCase();
          const kind: Exclude<HistoryFilter, "all"> = channel.includes(
            "whatsapp",
          )
            ? "whatsapp"
            : channel.includes("email")
              ? "emails"
              : channel.includes("file")
                ? "files"
                : channel.includes("document")
                  ? "documents"
                  : "activities";
          const icon =
            kind === "emails"
              ? Mail
              : kind === "files"
                ? Paperclip
                : kind === "documents"
                  ? FileText
                  : MessageSquare;
          return {
            id: `conversation-${conversation.id}`,
            title: conversation.lastMessage,
            meta: `${conversation.channel} conversation · ${new Date(conversation.updatedAt).toLocaleString()}`,
            icon,
            kind,
            date: conversation.updatedAt,
          };
        }),
        {
          id: "created",
          title: "Person created",
          meta: new Date(contact.createdAt).toLocaleString(),
          icon: UserRound,
          kind: "changelog" as const,
          date: contact.createdAt,
        },
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [contact],
  );
  const historyFilters: Array<{ id: HistoryFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "activities", label: "Activities" },
    { id: "notes", label: "Notes" },
    { id: "whatsapp", label: "WhatsApp" },
    { id: "emails", label: "Emails" },
    { id: "files", label: "Files" },
    { id: "documents", label: "Documents" },
    { id: "leads", label: "Leads" },
    { id: "deals", label: "Deals" },
    { id: "changelog", label: "Changelog" },
  ];
  const filteredHistory =
    historyFilter === "all"
      ? history
      : history.filter((item) => item.kind === historyFilter);
  const historyCount = (filter: HistoryFilter) =>
    filter === "all"
      ? history.length
      : history.filter((item) => item.kind === filter).length;
  const focusActivities = (contact.timelineItems || [])
    .filter(
      (item) =>
        item.type === "activity" &&
        item.status === "scheduled" &&
        item.startAt &&
        !completedActivityIds.includes(item.id),
    )
    .sort(
      (a, b) => new Date(a.startAt!).getTime() - new Date(b.startAt!).getTime(),
    );
  const pinnedNotes = contact.notes.filter((note) => note.pinned);
  const formatHistoryDate = (value: string) => {
    const date = new Date(value);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    return `${isToday ? "Today" : date.toLocaleDateString()} at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  };
  const formatFileSize = (size?: number) => {
    if (!size) return "File";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };
  const startHistoryNoteEdit = (item: HistoryItem) => {
    if (!item.noteId || item.noteHtml === undefined) return;
    setEditingHistoryNoteId(item.noteId);
    setHistoryNoteDraft(sanitizeNoteHtml(item.noteHtml));
    requestAnimationFrame(() => {
      if (historyEditorRef.current) {
        historyEditorRef.current.innerHTML = sanitizeNoteHtml(
          item.noteHtml || "",
        );
        historyEditorRef.current.focus();
      }
    });
  };
  const cancelHistoryNoteEdit = () => {
    setEditingHistoryNoteId(null);
    setHistoryNoteDraft("");
  };
  const saveHistoryNote = async () => {
    if (!editingHistoryNoteId) return;
    const content = sanitizeNoteHtml(
      historyEditorRef.current?.innerHTML || historyNoteDraft,
    );
    if (!notePlainText(content) && !content.includes("<img")) return;
    setSavingHistoryNote(true);
    try {
      await contactsApi.updateNote(contact.id, editingHistoryNoteId, content);
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      cancelHistoryNoteEdit();
      toast.success("Note updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update note",
      );
    } finally {
      setSavingHistoryNote(false);
    }
  };
  const toggleNotePin = async (noteId: string, pinned: boolean) => {
    setOpenActionMenuId(null);
    try {
      await contactsApi.updateNote(contact.id, noteId, { pinned });
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success(pinned ? "Note pinned to focus" : "Note unpinned");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update note",
      );
    }
  };
  const requestDelete = (target: {
    kind: "activity" | "note" | "file";
    id: string;
    label: string;
  }) => {
    setOpenActionMenuId(null);
    setDeleteTarget(target);
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingTarget(true);
    try {
      if (deleteTarget.kind === "activity")
        await contactsApi.deleteActivity(contact.id, deleteTarget.id);
      else if (deleteTarget.kind === "note")
        await contactsApi.deleteNote(contact.id, deleteTarget.id);
      else await contactsApi.deleteTimelineItem(contact.id, deleteTarget.id);
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success(`${deleteTarget.label} deleted`);
      setDeleteTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to delete ${deleteTarget.label.toLowerCase()}`,
      );
    } finally {
      setDeletingTarget(false);
    }
  };
  const openActivityEditor = (activityId?: string) => {
    if (!activityId) return;
    const activity = (contact.timelineItems || []).find(
      (item) => item.id === activityId && item.type === "activity",
    );
    if (activity) setEditingActivity(activity);
    setOpenActionMenuId(null);
  };
  const openFileDescription = (item: HistoryItem) => {
    setFileDescriptionItem(item);
    setFileDescriptionDraft(item.content || "");
    setOpenActionMenuId(null);
  };
  const saveFileDescription = async () => {
    if (!fileDescriptionItem?.timelineItemId) return;
    setSavingFileDescription(true);
    try {
      await contactsApi.updateTimelineItem(
        contact.id,
        fileDescriptionItem.timelineItemId,
        fileDescriptionDraft.trim(),
      );
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("File description updated");
      setFileDescriptionItem(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update file description",
      );
    } finally {
      setSavingFileDescription(false);
    }
  };
  const formatHistoryNote = (
    command: "bold" | "italic" | "underline" | "insertUnorderedList",
  ) => {
    historyEditorRef.current?.focus();
    document.execCommand(command, false);
    setHistoryNoteDraft(historyEditorRef.current?.innerHTML || "");
  };
  const completeActivity = async (activityId: string) => {
    setCompletingActivityId(activityId);
    setCompletedActivityIds((ids) =>
      ids.includes(activityId) ? ids : [...ids, activityId],
    );
    try {
      await contactsApi.updateActivityStatus(contact.id, activityId, "done");
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Activity marked as done");
    } catch (error) {
      setCompletedActivityIds((ids) => ids.filter((id) => id !== activityId));
      toast.error(
        error instanceof Error ? error.message : "Failed to complete activity",
      );
    } finally {
      setCompletingActivityId(null);
    }
  };
  const tabMessage =
    tab === "call"
      ? contact.phone
        ? `Call ${contact.phone}`
        : "Add a phone number to call this contact."
      : tab === "email"
        ? contact.email
          ? `Email ${contact.email}`
          : "Add an email address to contact this person."
        : tab === "whatsapp"
          ? contact.phone
            ? `Start a WhatsApp conversation with ${contact.phone}.`
            : "Add a phone number to use WhatsApp."
          : tab === "files" || tab === "documents"
            ? "Upload or attach files to this contact."
            : "Add an activity or follow-up for this contact.";

  return (
    <div className="contact-activity-workspace space-y-5">
      <ActivityWorkspaceComposer
        tab={tab}
        onTabChange={setTab}
        flushContent={tab === "activity" && !activityComposerOpen}
      >
        {tab === "activity" ? (
          activityComposerOpen ? (
            <ActivityComposer
              contact={contact}
              onClose={() => setActivityComposerOpen(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setActivityComposerOpen(true)}
              className="w-full px-4 py-5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              Click here to add an activity…
            </button>
          )
        ) : tab === "notes" ? (
          <NotesComposer contact={contact} />
        ) : tab === "email" ? (
          <EmailComposer contact={contact} />
        ) : tab === "files" ? (
          <ContactFileWorkspace contact={contact} />
        ) : tab === "documents" ? (
          <ContactFileWorkspace contact={contact} documentMode />
        ) : (
          <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-5 text-center">
            <p className="font-medium">
              {ACTIVITY_WORKSPACE_TABS.find((item) => item.id === tab)?.label}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{tabMessage}</p>
            {(tab === "call" || tab === "whatsapp") && contact.phone ? (
              <Button asChild size="sm" className="mt-3">
                <a
                  href={
                    tab === "whatsapp"
                      ? `https://wa.me/${contact.phone?.replace(/\D/g, "")}`
                      : `tel:${contact.phone}`
                  }
                >
                  Start{" "}
                  {ACTIVITY_WORKSPACE_TABS.find(
                    (item) => item.id === tab,
                  )?.label.toLowerCase()}
                </a>
              </Button>
            ) : null}
          </div>
        )}
      </ActivityWorkspaceComposer>
      <section className="px-1">
        <ActivityWorkspaceSectionHeader
          title="Focus"
          expanded={expandFocus}
          onExpandedChange={setExpandFocus}
        />
        {focusActivities.length || pinnedNotes.length ? (
          <div className="mt-4 grid gap-3">
            {pinnedNotes.slice(0, expandFocus ? undefined : 2).map((note) => (
              <div
                key={`pinned-${note.id}`}
                className="relative flex gap-3 pl-1"
              >
                <span className="z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                  <Pin className="h-4 w-4 text-amber-600" />
                </span>
                <div className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-amber-50/80 p-3 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Pinned note · {note.author}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => void toggleNotePin(note.id, false)}
                      title="Unpin note"
                    >
                      <Pin className="h-4 w-4" />
                    </Button>
                  </div>
                  <div
                    className="text-sm [&_a]:text-primary [&_a]:underline [&_li]:ml-5 [&_ul]:list-disc"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeNoteHtml(note.content),
                    }}
                  />
                </div>
              </div>
            ))}
            {focusActivities
              .slice(
                0,
                expandFocus ? undefined : Math.max(0, 2 - pinnedNotes.length),
              )
              .map((item) => {
                const FocusIcon =
                  item.activityType === "call"
                    ? Phone
                    : item.activityType === "meeting"
                      ? Users
                      : item.activityType === "deadline"
                        ? Flag
                        : item.activityType === "lunch"
                          ? Utensils
                          : CheckSquare;
                const priorityInfo = activityPriority(item.priority);
                const overdue =
                  new Date(item.endAt || item.startAt!).getTime() < Date.now();
                const activityDate = new Date(item.startAt!);
                const dateLabel =
                  activityDate.toDateString() === new Date().toDateString()
                    ? `Today at ${activityDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                    : activityDate.toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      });
                return (
                  <div
                    key={item.id}
                    className="relative flex gap-3 pl-1 before:absolute before:left-5 before:top-10 before:h-[calc(100%+12px)] before:border-l before:border-dashed before:border-border last:before:hidden"
                  >
                    <span className="z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                      <FocusIcon className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1 overflow-visible rounded-lg border border-border bg-background shadow-sm">
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void completeActivity(item.id)}
                              disabled={Boolean(completingActivityId)}
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-muted-foreground/40 text-emerald-600 hover:border-emerald-600"
                              title="Mark as done"
                              aria-label={`Mark ${item.title} as done`}
                            >
                              {completingActivityId === item.id && (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingActivity(item)}
                              className="truncate text-left font-semibold hover:text-primary hover:underline"
                            >
                              {item.title}
                            </button>
                          </div>
                          <div className="relative">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              onClick={() =>
                                setOpenActionMenuId((value) =>
                                  value === `focus-${item.id}`
                                    ? null
                                    : `focus-${item.id}`,
                                )
                              }
                              aria-label={`More actions for ${item.title}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                            {openActionMenuId === `focus-${item.id}` && (
                              <div className="absolute right-0 top-8 z-50 w-44 rounded-lg border border-border bg-popover p-1.5 shadow-xl">
                                <button
                                  type="button"
                                  onClick={() => setEditingActivity(item)}
                                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                                >
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void completeActivity(item.id)}
                                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                                >
                                  <Check className="h-4 w-4" />
                                  Mark as done
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    requestDelete({
                                      kind: "activity",
                                      id: item.id,
                                      label: "Activity",
                                    })
                                  }
                                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {overdue && (
                            <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                              Overdue
                            </span>
                          )}
                          {!overdue &&
                          item.priority &&
                          item.priority !== "none" &&
                          item.priority !== "normal" ? (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${priorityInfo.className}`}
                            >
                              {priorityInfo.label}
                            </span>
                          ) : null}
                          <span
                            className={
                              overdue ? "text-red-600" : "text-emerald-600"
                            }
                          >
                            {dateLabel}
                          </span>
                          <span>· {item.author}</span>
                          <span>
                            · <UserRound className="inline h-3.5 w-3.5" />{" "}
                            {contact.name}
                          </span>
                          {contact.company && (
                            <span>
                              · <Building2 className="inline h-3.5 w-3.5" />{" "}
                              {contact.company}
                            </span>
                          )}
                        </div>
                      </div>
                      {item.content && notePlainText(item.content) && (
                        <div
                          className="border-t border-amber-200 bg-amber-50/80 px-4 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/20"
                          dangerouslySetInnerHTML={{
                            __html: sanitizeNoteHtml(item.content),
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <ActivityWorkspaceEmpty
            title="No focus items yet"
            description="Scheduled activities, pinned notes, email drafts and scheduled emails will appear here."
          />
        )}
      </section>
      <ActivityWorkspaceHistoryCard>
        <ActivityWorkspaceHistoryFilters
          filters={historyFilters.map((filter) => ({
            ...filter,
            count:
              filter.id === "activities" || filter.id === "notes"
                ? historyCount(filter.id)
                : undefined,
          }))}
          active={historyFilter}
          onChange={setHistoryFilter}
        />
        {filteredHistory.length > 0 ? (
          <div>
            {filteredHistory.map((item) => {
              const Icon = item.icon;
              const editingThisNote = Boolean(
                item.noteId && editingHistoryNoteId === item.noteId,
              );
              const isNote = item.kind === "notes";
              const isFileItem =
                item.kind === "files" || item.kind === "documents";
              const isActivity = item.kind === "activities";
              return (
                <div
                  key={item.id}
                  className="relative flex gap-3 pb-4 pl-1 before:absolute before:left-5 before:top-10 before:h-[calc(100%-20px)] before:border-l before:border-dashed before:border-border last:before:hidden"
                >
                  <span
                    className={`z-10 flex shrink-0 items-center justify-center rounded-full border border-border bg-background ${isNote || isFileItem || isActivity ? "h-10 w-10" : "ml-2 h-4 w-4"}`}
                  >
                    {(isNote || isFileItem || isActivity) && (
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    {isNote ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            {formatHistoryDate(item.date)} ·{" "}
                            {item.author || "Web App"}
                          </span>
                          {item.noteId && !editingThisNote && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="px-2 text-xs font-semibold text-foreground hover:text-primary"
                              >
                                Add a comment
                              </button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => startHistoryNoteEdit(item)}
                                title="Edit note"
                              >
                                <AlignLeft className="h-3.5 w-3.5" />
                              </Button>
                              <div className="relative">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() =>
                                    setOpenActionMenuId((value) =>
                                      value === item.id ? null : item.id,
                                    )
                                  }
                                  title="More note actions"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                                {openActionMenuId === item.id && (
                                  <div className="absolute right-0 top-8 z-50 w-44 rounded-lg border border-border bg-popover p-1.5 shadow-xl">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void toggleNotePin(
                                          item.noteId!,
                                          !item.pinned,
                                        )
                                      }
                                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                                    >
                                      <Pin className="h-4 w-4" />
                                      {item.pinned
                                        ? "Unpin this note"
                                        : "Pin this note"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        requestDelete({
                                          kind: "note",
                                          id: item.noteId!,
                                          label: "Note",
                                        })
                                      }
                                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        {editingThisNote ? (
                          <div className="overflow-hidden rounded-md border border-amber-200 bg-background/60 dark:border-amber-900/50">
                            <div
                              ref={historyEditorRef}
                              contentEditable
                              suppressContentEditableWarning
                              role="textbox"
                              aria-multiline="true"
                              onInput={(event) =>
                                setHistoryNoteDraft(
                                  event.currentTarget.innerHTML,
                                )
                              }
                              onKeyDown={(event) => {
                                if (
                                  (event.ctrlKey || event.metaKey) &&
                                  event.key === "Enter"
                                ) {
                                  event.preventDefault();
                                  void saveHistoryNote();
                                }
                              }}
                              className="min-h-24 p-3 text-sm outline-none [&_a]:text-primary [&_a]:underline [&_li]:ml-5 [&_ul]:list-disc"
                            />
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200/80 p-2 dark:border-amber-900/60">
                              <div className="flex gap-0.5">
                                {(
                                  [
                                    {
                                      label: "Bold",
                                      icon: Bold,
                                      command: "bold",
                                    },
                                    {
                                      label: "Italic",
                                      icon: Italic,
                                      command: "italic",
                                    },
                                    {
                                      label: "Underline",
                                      icon: Underline,
                                      command: "underline",
                                    },
                                    {
                                      label: "List",
                                      icon: List,
                                      command: "insertUnorderedList",
                                    },
                                  ] as const
                                ).map(
                                  ({ label, icon: FormatIcon, command }) => (
                                    <Button
                                      key={label}
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        formatHistoryNote(command);
                                      }}
                                      title={label}
                                    >
                                      <FormatIcon className="h-3.5 w-3.5" />
                                    </Button>
                                  ),
                                )}
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={cancelHistoryNoteEdit}
                                  disabled={savingHistoryNote}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => void saveHistoryNote()}
                                  disabled={
                                    savingHistoryNote ||
                                    (!notePlainText(historyNoteDraft) &&
                                      !historyNoteDraft.includes("<img"))
                                  }
                                >
                                  {savingHistoryNote && (
                                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                  )}
                                  Save
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="break-words text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_img]:my-2 [&_img]:max-h-64 [&_img]:max-w-full [&_img]:rounded-md [&_li]:ml-5 [&_ul]:list-disc"
                            dangerouslySetInnerHTML={{
                              __html: sanitizeNoteHtml(item.noteHtml || ""),
                            }}
                          />
                        )}
                      </div>
                    ) : isFileItem && item.fileKey ? (
                      <div className="group flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/30">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${item.mimeType === "application/pdf" ? "bg-red-50 text-red-600 dark:bg-red-950/40" : "bg-blue-50 text-blue-600 dark:bg-blue-950/40"}`}
                        >
                          <FileText className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <a
                            href={storageApi.getProxyFileUrl(item.fileKey)}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-sm font-semibold text-primary hover:underline"
                          >
                            {item.fileName || item.title}
                          </a>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {formatHistoryDate(item.date)} ·{" "}
                            {item.author || "Web App"} ·{" "}
                            {formatFileSize(item.size)} · {contact.name}
                            {contact.company ? ` · ${contact.company}` : ""}
                          </span>
                          {item.content && (
                            <span className="mt-1 block text-xs text-foreground">
                              {item.content}
                            </span>
                          )}
                        </span>
                        <div className="relative">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() =>
                              setOpenActionMenuId((value) =>
                                value === item.id ? null : item.id,
                              )
                            }
                            aria-label={`More actions for ${item.fileName || item.title}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                          {openActionMenuId === item.id && (
                            <div className="absolute right-0 top-8 z-50 w-48 rounded-lg border border-border bg-popover p-1.5 shadow-xl">
                              <button
                                type="button"
                                onClick={() => openFileDescription(item)}
                                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                              >
                                <AlignLeft className="h-4 w-4" />
                                Add description
                              </button>
                              <a
                                href={storageApi.getProxyFileUrl(item.fileKey)}
                                download={item.fileName || item.title}
                                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                              >
                                <Save className="h-4 w-4" />
                                Download
                              </a>
                              <button
                                type="button"
                                onClick={() =>
                                  requestDelete({
                                    kind: "file",
                                    id: item.timelineItemId!,
                                    label:
                                      item.kind === "documents"
                                        ? "Document"
                                        : "File",
                                  })
                                }
                                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : isActivity ? (
                      <div className="rounded-xl border border-border bg-background px-4 py-3 shadow-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${item.status === "done" ? "bg-emerald-600 text-white" : "border border-muted-foreground/40"}`}
                            >
                              {item.status === "done" && (
                                <Check className="h-3 w-3" />
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                openActivityEditor(item.timelineItemId)
                              }
                              className="truncate text-left text-sm font-semibold hover:text-primary hover:underline"
                            >
                              {item.title}
                            </button>
                          </div>
                          <div className="relative">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              onClick={() =>
                                setOpenActionMenuId((value) =>
                                  value === item.id ? null : item.id,
                                )
                              }
                              aria-label={`More actions for ${item.title}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                            {openActionMenuId === item.id && (
                              <div className="absolute right-0 top-8 z-50 w-44 rounded-lg border border-border bg-popover p-1.5 shadow-xl">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openActivityEditor(item.timelineItemId)
                                  }
                                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                                >
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </button>
                                {item.status !== "done" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      item.timelineItemId &&
                                      void completeActivity(item.timelineItemId)
                                    }
                                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                                  >
                                    <Check className="h-4 w-4" />
                                    Mark as done
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    requestDelete({
                                      kind: "activity",
                                      id: item.timelineItemId!,
                                      label: "Activity",
                                    })
                                  }
                                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {item.priority &&
                          item.priority !== "none" &&
                          item.priority !== "normal" ? (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${activityPriority(item.priority).className}`}
                            >
                              {activityPriority(item.priority).label}
                            </span>
                          ) : null}
                          <span>{formatHistoryDate(item.date)}</span>
                          <span>· {item.author}</span>
                          <span>
                            · <UserRound className="inline h-3.5 w-3.5" />{" "}
                            {contact.name}
                          </span>
                          {contact.company && (
                            <span>
                              · <Building2 className="inline h-3.5 w-3.5" />{" "}
                              {contact.company}
                            </span>
                          )}
                        </div>
                        {item.content && notePlainText(item.content) && (
                          <div
                            className="mt-3 border-t border-amber-200 bg-amber-50/80 px-3 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/20"
                            dangerouslySetInnerHTML={{
                              __html: sanitizeNoteHtml(item.content),
                            }}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="px-1 py-0.5">
                        <p className="text-sm font-medium">
                          {item.title}: {formatHistoryDate(item.date)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatHistoryDate(item.date)} ·{" "}
                          {item.author || item.meta}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border py-10 text-center">
            <p className="text-sm font-medium">
              No{" "}
              {historyFilters
                .find((filter) => filter.id === historyFilter)
                ?.label.toLowerCase()}{" "}
              history yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              New items will appear here automatically.
            </p>
          </div>
        )}
      </ActivityWorkspaceHistoryCard>
      {editingActivity && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-activity-title"
        >
          <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-xl border border-border bg-background shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-5 py-4">
              <h2 id="edit-activity-title" className="text-lg font-semibold">
                Edit activity
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setEditingActivity(null)}
                aria-label="Close edit activity"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="p-4">
              <ActivityComposer
                key={editingActivity.id}
                contact={contact}
                activity={editingActivity}
                onClose={() => setEditingActivity(null)}
              />
            </div>
          </div>
        </div>
      )}
      {fileDescriptionItem && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="file-description-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 id="file-description-title" className="font-semibold">
                Add file description
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setFileDescriptionItem(null)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="space-y-4 p-5">
              <p className="truncate text-sm font-medium">
                {fileDescriptionItem.fileName || fileDescriptionItem.title}
              </p>
              <textarea
                autoFocus
                value={fileDescriptionDraft}
                onChange={(event) =>
                  setFileDescriptionDraft(event.target.value)
                }
                rows={5}
                maxLength={20000}
                placeholder="Add a description…"
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFileDescriptionItem(null)}
                  disabled={savingFileDescription}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void saveFileDescription()}
                  disabled={savingFileDescription}
                >
                  {savingFileDescription && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-item-title"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-2xl">
            <h2 id="delete-item-title" className="font-semibold">
              Delete {deleteTarget.label.toLowerCase()}?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deletingTarget}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void confirmDelete()}
                disabled={deletingTarget}
              >
                {deletingTarget && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ContactDetailsPage() {
  const navigate = useNavigate();
  const { contactId } = useParams<{ contactId: string }>();
  const { data: contacts = [], isLoading } = useContacts();
  const contact = contacts.find((item) => item.id === contactId);
  const { data: organization } = useAccount(contact?.account?.id);
  if (isLoading)
    return (
      <div className="flex min-h-[360px] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading contact…
      </div>
    );
  if (!contact)
    return (
      <div className="space-y-5">
        <Button
          variant="ghost"
          onClick={() => navigate("/dashboard/crm/contacts")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to contacts
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <h1 className="font-semibold">Contact not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This contact may have been deleted or you may not have access to
              it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  const contactView = toContactViewModel(contact);
  const initials = contactView.name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const lifecycleTone =
    contactView.lifecycleStage === "customer"
      ? "bg-emerald-500/[0.09] text-emerald-700 dark:text-emerald-300"
      : contactView.lifecycleStage === "opportunity"
        ? "bg-violet-500/[0.09] text-violet-700 dark:text-violet-300"
        : contactView.lifecycleStage === "qualified"
          ? "bg-blue-500/[0.09] text-blue-700 dark:text-blue-300"
          : "bg-foreground/[0.05] text-muted-foreground";
  return (
    <div className="crm-workspace w-full space-y-6 pb-10">
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground hover:text-foreground"
          onClick={() => navigate("/dashboard/crm/contacts")}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Contacts
        </Button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          CRM contact
        </div>
      </div>

      <section className="flex flex-col gap-5 rounded-2xl border border-border/70 bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.025)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-primary/10 bg-primary/[0.09] text-lg font-semibold text-primary">
            {initials || "?"}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-2xl font-semibold tracking-[-0.025em]">
                {contactView.name}
              </h1>
              <span
                className={`rounded-md px-2 py-1 text-xs font-medium capitalize ${lifecycleTone}`}
              >
                {contactView.lifecycleStage}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {contactView.company && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  {contactView.company}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <UserRound className="h-3.5 w-3.5" />
                {contactView.owner?.name || "Unassigned"}
              </span>
              {contactView.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-foreground/[0.05] px-1.5 py-0.5 text-xs"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {contactView.email ? (
            <Button
              asChild
              variant="outline"
              className="border-border/70 bg-background"
            >
              <a href={`mailto:${contactView.email}`}>
                <Mail className="h-4 w-4" /> Email
              </a>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              <Mail className="h-4 w-4" /> Email
            </Button>
          )}
          {contactView.phone ? (
            <Button
              asChild
              variant="outline"
              className="border-border/70 bg-background"
            >
              <a href={`tel:${contactView.phone}`}>
                <Phone className="h-4 w-4" /> Call
              </a>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              <Phone className="h-4 w-4" /> Call
            </Button>
          )}
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <ContactInformationPanel
          contact={contactView}
          organization={organization}
        />
        <ContactActivityWorkspace contact={contactView} />
      </div>
    </div>
  );
}
