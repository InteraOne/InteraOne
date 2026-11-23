import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Building2, User, Loader2, Edit2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useContactOwners, useUpdateContact } from "../hooks/use-contacts";
import { useUpdateContactAssociation } from "@/domains/conversation/hooks";
import {
  useAccounts,
  useCreateAccount,
} from "@/domains/accounts/hooks/use-accounts";
import { accountsApi } from "@/domains/accounts/api/accounts.api";
import type {
  ContactAcquisitionSource,
  ContactChannel,
  ContactLeadStatus,
  ContactLifecycleStage,
  ContactMethod,
  ContactMethodType,
  ContactWritePayload,
} from "../types/types";
import { InlineCustomFields } from "@/domains/crm/components/inline-custom-fields";
import { LabelPicker } from "@/shared/components/label-editor";

type ContactFormPayload = ContactWritePayload & {
  name: string;
  tags: string[];
};

const toLocalDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

interface ContactFormProps {
  mode: "create" | "update";
  initialValues?: {
    name?: string;
    email?: string;
    phone?: string;
    emails?: ContactMethod[];
    phones?: ContactMethod[];
    company?: string;
    accountId?: string | null;
    tags?: string[];
    lifecycleStage?: ContactLifecycleStage;
    leadStatus?: ContactLeadStatus;
    ownerId?: string | null;
    acquisitionSource?: ContactAcquisitionSource;
    preferredChannel?: ContactChannel | null;
    nextFollowUpAt?: string | null;
    customFields?: Record<string, unknown>;
  };
  onSubmit: (payload: ContactFormPayload) => void | Promise<void>;
  onCancel: () => void;
  tagOptions: string[];
  loading?: boolean;
  ownerOptions?: Array<{ id: string; name: string }>;
}

export function ContactForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  tagOptions,
  loading = false,
  ownerOptions = [],
}: ContactFormProps) {
  const [name, setName] = useState(initialValues?.name || "");
  const [email, setEmail] = useState(initialValues?.email || "");
  const [phone, setPhone] = useState(initialValues?.phone || "");
  const [phoneRows, setPhoneRows] = useState<ContactMethod[]>(
    initialValues?.phones?.length
      ? initialValues.phones
      : [{ value: initialValues?.phone || "", type: "work" }],
  );
  const [emailRows, setEmailRows] = useState<ContactMethod[]>(
    initialValues?.emails?.length
      ? initialValues.emails
      : [{ value: initialValues?.email || "", type: "work" }],
  );
  const [company, setCompany] = useState(initialValues?.company || "");
  const [accountId, setAccountId] = useState(initialValues?.accountId || "");
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const { data: accountsData, isFetching: organizationsLoading } = useAccounts(
    mode === "create" ? company : "",
    100,
  );
  const createAccount = useCreateAccount();
  const [tags, setTags] = useState<string[]>(initialValues?.tags || []);
  const [lifecycleStage, setLifecycleStage] = useState<ContactLifecycleStage>(
    initialValues?.lifecycleStage || "new",
  );
  const [leadStatus, setLeadStatus] = useState<ContactLeadStatus>(
    initialValues?.leadStatus || "needs_review",
  );
  const [ownerId, setOwnerId] = useState(initialValues?.ownerId || "");
  const [acquisitionSource, setAcquisitionSource] =
    useState<ContactAcquisitionSource>(
      initialValues?.acquisitionSource || "manual",
    );
  const [preferredChannel, setPreferredChannel] = useState<ContactChannel | "">(
    initialValues?.preferredChannel || "",
  );
  const [nextFollowUpAt, setNextFollowUpAt] = useState(
    toLocalDateTime(initialValues?.nextFollowUpAt),
  );
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(
    initialValues?.customFields || {},
  );
  const organizationMatches = (accountsData?.accounts || []).filter(
    (account, index, accounts) =>
      accounts.findIndex(
        (candidate) =>
          candidate.name.trim().toLocaleLowerCase() ===
          account.name.trim().toLocaleLowerCase(),
      ) === index,
  );
  const exactOrganization = organizationMatches.find(
    (account) =>
      account.name.trim().toLocaleLowerCase() ===
      company.trim().toLocaleLowerCase(),
  );
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let resolvedAccountId = accountId;
    let resolvedCompany = company.trim();
    if (mode === "create" && resolvedCompany && !resolvedAccountId) {
      try {
        const latest = await accountsApi.list(resolvedCompany, 100);
        const existing = latest.accounts.find(
          (account) =>
            account.name.trim().toLocaleLowerCase() ===
            resolvedCompany.toLocaleLowerCase(),
        );
        if (existing) {
          resolvedAccountId = existing.id;
          resolvedCompany = existing.name;
        } else {
          const created = await createAccount.mutateAsync({
            name: resolvedCompany,
          });
          resolvedAccountId = created._id;
          toast.success("New organization created");
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not create organization",
        );
        return;
      }
    }
    await onSubmit({
      name: name.trim(),
      email:
        (mode === "create" ? emailRows[0]?.value || "" : email).trim() ||
        undefined,
      phone:
        (mode === "create" ? phoneRows[0]?.value || "" : phone).trim() ||
        undefined,
      emails:
        mode === "create"
          ? emailRows
              .map((item) => ({ ...item, value: item.value.trim() }))
              .filter((item) => item.value)
          : undefined,
      phones:
        mode === "create"
          ? phoneRows
              .map((item) => ({ ...item, value: item.value.trim() }))
              .filter((item) => item.value)
          : undefined,
      company: resolvedCompany || undefined,
      accountId: resolvedAccountId || null,
      tags: Array.from(new Set(tags)),
      lifecycleStage,
      leadStatus,
      ownerId: ownerId || null,
      acquisitionSource,
      preferredChannel: preferredChannel || null,
      nextFollowUpAt: nextFollowUpAt
        ? new Date(nextFollowUpAt).toISOString()
        : null,
      customFields,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={mode === "create" ? "flex min-h-0 flex-col" : "space-y-5"}
    >
      {mode === "create" ? (
        <div className="grid max-h-[calc(90vh-158px)] gap-x-8 gap-y-6 overflow-y-auto overscroll-contain bg-foreground/[0.012] p-6 md:grid-cols-2 [&>div]:self-start">
          <div className="grid gap-2">
            <Label htmlFor="contact-name">Name *</Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter name"
              required
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="relative grid gap-2">
            <Label htmlFor="contact-organization">Organization</Label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="contact-organization"
                value={company}
                onFocus={() => setOrganizationOpen(true)}
                onBlur={() =>
                  window.setTimeout(() => setOrganizationOpen(false), 150)
                }
                onChange={(event) => {
                  setCompany(event.target.value);
                  setAccountId("");
                  setOrganizationOpen(true);
                }}
                placeholder="Search or add organization"
                disabled={loading || createAccount.isPending}
                className="pl-9 pr-14"
              />
              {company.trim() && !accountId && !exactOrganization && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                  NEW
                </span>
              )}
            </div>
            {organizationOpen && company.trim() && (
              <div className="absolute left-0 right-0 top-[70px] z-50 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-xl">
                {organizationsLoading && (
                  <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching organizations…
                  </div>
                )}
                {organizationMatches.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setCompany(account.name);
                      setAccountId(account.id);
                      setOrganizationOpen(false);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted"
                  >
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{account.name}</span>
                  </button>
                ))}
                {!exactOrganization && !organizationsLoading && (
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setOrganizationOpen(false)}
                    className="flex w-full items-center gap-2 border-t border-border px-4 py-3 text-left text-sm font-medium text-primary hover:bg-muted"
                  >
                    <Plus className="h-4 w-4" />
                    Add &apos;{company.trim()}&apos; as new organization
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label>Phone</Label>
            {phoneRows.map((row, index) => (
              <div
                key={`phone-${index}`}
                className="grid grid-cols-[minmax(0,1fr)_140px_auto] gap-2"
              >
                <Input
                  value={row.value}
                  onChange={(event) =>
                    setPhoneRows((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, value: event.target.value }
                          : item,
                      ),
                    )
                  }
                  placeholder="Phone number"
                  disabled={loading}
                />
                <Select
                  value={row.type}
                  onValueChange={(value) =>
                    setPhoneRows((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, type: value as ContactMethodType }
                          : item,
                      ),
                    )
                  }
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["work", "home", "mobile", "other"] as const).map(
                      (type) => (
                        <SelectItem key={type} value={type}>
                          {type[0].toUpperCase() + type.slice(1)}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    setPhoneRows((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  disabled={loading || phoneRows.length === 1}
                  aria-label="Remove phone"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setPhoneRows((current) => [
                  ...current,
                  { value: "", type: "work" },
                ])
              }
              disabled={loading || phoneRows.length >= 10}
              className="w-fit text-sm font-medium text-primary hover:underline disabled:opacity-50"
            >
              <Plus className="mr-1 inline h-4 w-4" />
              Add phone
            </button>
          </div>

          <div className="grid gap-2">
            <Label>Email</Label>
            {emailRows.map((row, index) => (
              <div
                key={`email-${index}`}
                className="grid grid-cols-[minmax(0,1fr)_140px_auto] gap-2"
              >
                <Input
                  type="email"
                  value={row.value}
                  onChange={(event) =>
                    setEmailRows((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, value: event.target.value }
                          : item,
                      ),
                    )
                  }
                  placeholder="Email address"
                  disabled={loading}
                />
                <Select
                  value={row.type}
                  onValueChange={(value) =>
                    setEmailRows((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, type: value as ContactMethodType }
                          : item,
                      ),
                    )
                  }
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["work", "home", "other"] as const).map((type) => (
                      <SelectItem key={type} value={type}>
                        {type[0].toUpperCase() + type.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    setEmailRows((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  disabled={loading || emailRows.length === 1}
                  aria-label="Remove email"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setEmailRows((current) => [
                  ...current,
                  { value: "", type: "work" },
                ])
              }
              disabled={loading || emailRows.length >= 10}
              className="w-fit text-sm font-medium text-primary hover:underline disabled:opacity-50"
            >
              <Plus className="mr-1 inline h-4 w-4" />
              Add email
            </button>
          </div>

          <div className="grid gap-2">
            <Label>Labels</Label>
            <LabelPicker
              value={tags.join(", ")}
              options={tagOptions}
              onChange={(value) =>
                setTags(
                  value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                    .slice(0, 20),
                )
              }
              disabled={loading}
            />
          </div>

          <div className="grid gap-2">
            <Label>Owner</Label>
            <Select
              value={ownerId || "unassigned"}
              onValueChange={(value) =>
                setOwnerId(value === "unassigned" ? "" : value)
              }
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue />
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
          </div>
        </div>
      ) : (
        <InlineCustomFields
          entityType="contacts"
          values={customFields}
          onChange={setCustomFields}
          disabled={loading}
          alwaysShowFieldKeys={[
            "name",
            "company",
            "phone",
            "email",
            "tags",
            "ownerId",
          ]}
          systemFields={{
            name: (field) => (
              <div className="grid gap-2">
                <Label htmlFor="contact-name">
                  {field.label}
                  {field.required ? " *" : ""}
                </Label>
                <Input
                  id="contact-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={field.placeholder}
                  required={field.required}
                  disabled={loading}
                />
              </div>
            ),
            email: (field) => (
              <div className="grid gap-2">
                <Label htmlFor="contact-email">{field.label}</Label>
                <Input
                  id="contact-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={field.placeholder}
                  disabled={loading}
                />
              </div>
            ),
            phone: (field) => (
              <div className="grid gap-2">
                <Label htmlFor="contact-phone">{field.label}</Label>
                <Input
                  id="contact-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder={field.placeholder}
                  disabled={loading}
                />
              </div>
            ),
            company: (field) => (
              <div className="grid gap-2">
                <Label>{field.label}</Label>
                <Select
                  value={accountId || "legacy"}
                  onValueChange={(value) => {
                    const nextId = value === "legacy" ? "" : value;
                    setAccountId(nextId);
                    const selected = accountsData?.accounts.find(
                      (item) => item.id === nextId,
                    );
                    if (selected) setCompany(selected.name);
                  }}
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="legacy">
                      No linked organization
                    </SelectItem>
                    {(accountsData?.accounts || []).map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!accountId && (
                  <Input
                    value={company}
                    onChange={(event) => setCompany(event.target.value)}
                    placeholder="Organization name (optional)"
                    disabled={loading}
                  />
                )}
              </div>
            ),
            lifecycleStage: (field) => (
              <div className="grid gap-2">
                <Label>{field.label}</Label>
                <Select
                  value={lifecycleStage}
                  onValueChange={(value) =>
                    setLifecycleStage(value as ContactLifecycleStage)
                  }
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      ["new", "New"],
                      ["qualified", "Qualified"],
                      ["opportunity", "Opportunity"],
                      ["customer", "Customer"],
                      ["inactive", "Inactive"],
                      ["lost", "Lost"],
                    ].map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ),
            leadStatus: (field) => (
              <div className="grid gap-2">
                <Label>{field.label}</Label>
                <Select
                  value={leadStatus}
                  onValueChange={(value) =>
                    setLeadStatus(value as ContactLeadStatus)
                  }
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      ["needs_review", "Needs review"],
                      ["contacted", "Contacted"],
                      ["follow_up", "Follow-up"],
                      ["converted", "Converted"],
                      ["unqualified", "Unqualified"],
                    ].map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ),
            ownerId: (field) => (
              <div className="grid gap-2">
                <Label>{field.label}</Label>
                <Select
                  value={ownerId || "unassigned"}
                  onValueChange={(value) =>
                    setOwnerId(value === "unassigned" ? "" : value)
                  }
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue />
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
              </div>
            ),
            acquisitionSource: (field) => (
              <div className="grid gap-2">
                <Label>{field.label}</Label>
                <Select
                  value={acquisitionSource}
                  onValueChange={(value) =>
                    setAcquisitionSource(value as ContactAcquisitionSource)
                  }
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "manual",
                      "widget",
                      "email",
                      "whatsapp",
                      "telegram",
                      "phone",
                      "qr",
                      "unknown",
                    ].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ),
            preferredChannel: (field) => (
              <div className="grid gap-2">
                <Label>{field.label}</Label>
                <Select
                  value={preferredChannel || "not_set"}
                  onValueChange={(value) =>
                    setPreferredChannel(
                      value === "not_set" ? "" : (value as ContactChannel),
                    )
                  }
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_set">Not set</SelectItem>
                    {["widget", "email", "whatsapp", "telegram", "phone"].map(
                      (value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            ),
            nextFollowUpAt: (field) => (
              <div className="grid gap-2">
                <Label>{field.label}</Label>
                <Input
                  type="datetime-local"
                  value={nextFollowUpAt}
                  onChange={(event) => setNextFollowUpAt(event.target.value)}
                  disabled={loading}
                />
              </div>
            ),
            tags: (field) => (
              <div className="grid gap-2">
                <Label>{field.label}</Label>
                <LabelPicker
                  value={tags.join(", ")}
                  options={Array.from(
                    new Set([
                      ...field.options.map((option) => option.label),
                      ...tagOptions,
                      ...tags,
                    ]),
                  )}
                  onChange={(value) =>
                    setTags(
                      value
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean)
                        .slice(0, 20),
                    )
                  }
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  Select existing tags or create a new one. Up to 20 tags.
                </p>
              </div>
            ),
          }}
        />
      )}

      <DialogFooter
        className={`flex items-center gap-2 ${mode === "create" ? "border-t border-border bg-background px-6 py-4" : ""}`}
      >
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="cursor-pointer"
          disabled={loading}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!name.trim() || loading}
          className="cursor-pointer"
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "create" ? "Create contact" : "Update"}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface ContactDialogProps {
  mode: "create" | "update";
  contactId?: string;
  conversationId?: string;
  contact?: {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    accountId?: string | null;
    tags?: string[];
    lifecycleStage?: ContactLifecycleStage;
    leadStatus?: ContactLeadStatus;
    ownerId?: string | null;
    acquisitionSource?: ContactAcquisitionSource;
    preferredChannel?: ContactChannel | null;
    nextFollowUpAt?: string | null;
    customFields?: Record<string, unknown>;
  };
  triggerType?: "button" | "icon" | "custom";
  customTrigger?: React.ReactNode;
  onSubmit?: (payload: ContactFormPayload) => void | Promise<void>;
  onSuccess?: (updatedContact: {
    name: string;
    email: string;
    phone: string;
    company: string;
    tags: string[];
  }) => void;
}

export function ContactDialog({
  mode,
  contactId,
  conversationId,
  contact,
  triggerType = "button",
  customTrigger,
  onSubmit,
  onSuccess,
}: ContactDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const updateContactMutation = useUpdateContact();
  const associateContactMutation = useUpdateContactAssociation();
  const { data: ownerOptions = [] } = useContactOwners();

  const TAG_OPTIONS = ["VIP", "Enterprise", "Trial", "Billing", "At Risk"];

  const handleFormSubmit = async (payload: ContactFormPayload) => {
    if (mode === "create") {
      setLoading(true);
      try {
        await onSubmit?.(payload);
        setOpen(false);
        toast.success("Contact created successfully");
      } catch (error: unknown) {
        toast.error(
          error instanceof Error ? error.message : "Failed to create contact",
        );
      } finally {
        setLoading(false);
      }
      return;
    }

    const trimmedName = payload.name.trim();
    const trimmedEmail = payload.email?.trim() || "";
    const trimmedPhone = payload.phone?.trim() || "";
    const trimmedCompany = payload.company?.trim() || "";
    const tags = payload.tags;

    if (
      !trimmedName &&
      !trimmedEmail &&
      !trimmedPhone &&
      !trimmedCompany &&
      tags.length === 0
    ) {
      toast.error(
        "Please provide at least a name, email address, phone number, company name, or tags to update.",
      );
      return;
    }

    setLoading(true);
    try {
      if (!contactId || contactId === "temp-contact") {
        if (!conversationId) {
          toast.error(
            "Cannot associate contact: conversation context is missing.",
          );
          setLoading(false);
          return;
        }
        await associateContactMutation.mutateAsync({
          conversationId,
          name: trimmedName || undefined,
          email: trimmedEmail || undefined,
          phone: trimmedPhone || undefined,
          company: trimmedCompany || undefined,
          tags,
        });
        toast.success("Contact associated successfully");
        setOpen(false);
        onSuccess?.({
          name: trimmedName,
          email: trimmedEmail,
          phone: trimmedPhone,
          company: trimmedCompany,
          tags,
        });
        return;
      }

      await updateContactMutation.mutateAsync({
        id: contactId,
        ...payload,
        name: trimmedName || undefined,
        email: trimmedEmail,
        phone: trimmedPhone,
        company: trimmedCompany,
      });

      toast.success("Details updated successfully");
      setOpen(false);
      onSuccess?.({
        name: trimmedName,
        email: trimmedEmail,
        phone: trimmedPhone,
        company: trimmedCompany,
        tags,
      });
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update details",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerType === "custom" && customTrigger ? (
          customTrigger
        ) : triggerType === "icon" ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
            title="Edit contact details"
          >
            <Edit2 className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="cursor-pointer">
            <User className="h-4 w-4 mr-2" />
            {mode === "create" ? "Add contact" : "Update Info"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className={
          mode === "create"
            ? "max-h-[90vh] gap-0 overflow-hidden rounded-2xl border-border/70 p-0 sm:max-w-5xl"
            : "max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-180"
        }
      >
        <DialogHeader
          className={
            mode === "create"
              ? "border-b border-border/60 bg-background px-6 py-5"
              : ""
          }
        >
          <DialogTitle>
            {mode === "create" ? "Create contact" : "Update contact"}
          </DialogTitle>
          {mode === "create" && (
            <DialogDescription>
              Add the essentials now. You can enrich the profile at any time.
            </DialogDescription>
          )}
        </DialogHeader>
        <ContactForm
          key={`${mode}:${contactId || "new"}:${JSON.stringify(contact || {})}`}
          mode={mode}
          initialValues={contact}
          onSubmit={handleFormSubmit}
          onCancel={() => setOpen(false)}
          tagOptions={TAG_OPTIONS}
          loading={loading}
          ownerOptions={ownerOptions}
        />
      </DialogContent>
    </Dialog>
  );
}
