export type ThreadCategory = "discussion" | "support" | "feature";

export type ThreadStatus = "open" | "resolved" | "closed";

export type ThreadProgress =
  | "under_review"
  | "planned"
  | "in_progress"
  | "shipped";

export type ThreadAttachment = {
  key: string;
  name: string;
};

export type Thread = {
  id: string;
  title: string;
  category: ThreadCategory;
  public: boolean;
  status: ThreadStatus;
  humanSupport: boolean;
  votes?: number;
  voted?: boolean;
  replyCount?: number;
  participantCount?: number;
  participantProfiles?: Array<{
    id: string;
    name: string;
    initials: string;
    source: string;
  }>;
  progress?: ThreadProgress;
  acceptedReplyId?: string;
  updatedAt: string;
};

export type PortalBrand = {
  name: string;
  slug: string;
  title: string;
  accent: string;
  logoUrl?: string;
};

export type Reaction = {
  emoji: string;
  count: number;
  reacted: boolean;
};

export type ThreadMessage = {
  id: string;
  at: string;
  text: string;
  author: string;
  own?: boolean;
  deleted?: boolean;
  edited?: boolean;
  reactions?: Reaction[];
  replyTo?: {
    id: string;
    text: string;
    author: string;
    deleted?: boolean;
  };
  attachments?: ThreadAttachment[];
};

export type ThreadDetail = Thread & {
  more: boolean;
  following?: boolean;
  canManage?: boolean;
  votes: number;
  voted: boolean;
  opening?: ThreadMessage | null;
  messages: ThreadMessage[];
};

export type PortalView =
  | "community"
  | "feature"
  | "mine"
  | "upvoted"
  | "following"
  | "updates";

export type ThreadSettings = {
  enabled: boolean;
  aiEnabled: boolean;
  title: string;
  logoUrl: string;
  logoKey: string;
  accent: string;
};

export type ThreadDnsRecord = {
  type: "CNAME" | "TXT";
  name: string;
  value: string;
  purpose: string;
};

export type ThreadDomain = {
  id: string;
  hostname: string;
  status: "pending_dns" | "verified" | "provisioning" | "active" | "error";
  tlsStatus: "pending" | "provisioning" | "active" | "disabled" | "error";
  url?: string;
  lastError?: string;
  lastCheckedAt?: string;
  dnsRecords: ThreadDnsRecord[];
};

export type ThreadOverview = {
  total: number;
  open: number;
  openSupport: number;
  resolved: number;
  escalations: number;
  communityActivity: number;
  hidden: number;
  featureVotes: number;
};

export type ThreadManagement = ThreadSettings & {
  name: string;
  slug: string;
  organizationLogoUrl?: string;
  emailAvailable: boolean;
  hostedUrl: string;
  domains: ThreadDomain[];
  overview: ThreadOverview;
  resultCount: number;
  recentThreads: Thread[];
  threads: Thread[];
  domainConfiguration: {
    available: boolean;
    target?: string;
    tlsMode: "on-demand" | "external" | "disabled";
    mode: "cloud" | "self-host";
  };
};

export type ManageThreadsSection =
  | "overview"
  | "discussions"
  | "moderation"
  | "branding"
  | "domains"
  | "settings";

export type ManageThreadsFilters = {
  section: ManageThreadsSection;
  page: number;
  search: string;
  category: string;
  status: string;
  visibility: string;
};

export type ThreadsHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
