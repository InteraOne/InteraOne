import { IntegrationToolRisk } from "@shared/models";

export interface CatalogTool {
  slug: string;
  name: string;
  risk: IntegrationToolRisk;
  description: string;
  defaultEnabled: boolean;
}

export interface CatalogToolkit {
  slug: string;
  name: string;
  description: string;
  logo?: string;
  category?: string;
  toolsCount?: number;
  tools: CatalogTool[];
}

export interface RemoteCatalogTool {
  slug: string;
  name: string;
  description?: string;
  toolkitSlug: string;
}

const readTool = (
  slug: string,
  name: string,
  description: string,
): CatalogTool => ({
  slug,
  name,
  description,
  risk: "read",
  defaultEnabled: true,
});

const writeTool = (
  slug: string,
  name: string,
  description: string,
): CatalogTool => ({
  slug,
  name,
  description,
  risk: "write",
  defaultEnabled: false,
});

const READ_ACTION_PATTERN =
  /(^|_)(GET|LIST|FIND|FETCH|SEARCH|QUERY|RETRIEVE|LOOKUP|READ|CHECK|DESCRIBE|VIEW|DOWNLOAD|INSPECT|PREVIEW|COUNT|VERIFY|VALIDATE)(_|$)/;
const SENSITIVE_ACTION_PATTERN =
  /(^|_)(DELETE|REMOVE|REVOKE|PURGE|TERMINATE|DEACTIVATE|DISABLE|CANCEL|ARCHIVE)(_|$)/;

export function inferToolRisk(slug: string): IntegrationToolRisk {
  if (SENSITIVE_ACTION_PATTERN.test(slug)) return "sensitive";
  if (READ_ACTION_PATTERN.test(slug)) return "read";
  return "write";
}

export function mergeRemoteCatalogTools(
  remoteTools: RemoteCatalogTool[],
): CatalogToolkit[] {
  const toolsByToolkit = new Map<string, RemoteCatalogTool[]>();
  for (const tool of remoteTools) {
    const existing = toolsByToolkit.get(tool.toolkitSlug) ?? [];
    existing.push(tool);
    toolsByToolkit.set(tool.toolkitSlug, existing);
  }

  return INTEGRATION_CATALOG.map((toolkit) => {
    const remote = toolsByToolkit.get(toolkit.slug);
    return mergeToolkitTools(toolkit, remote ?? []);
  });
}

export function mergeToolkitTools(
  toolkit: CatalogToolkit,
  remote: RemoteCatalogTool[],
): CatalogToolkit {
  if (!remote.length) return toolkit;

  const reviewedTools = new Map(toolkit.tools.map((tool) => [tool.slug, tool]));
  const seen = new Set<string>();
  const tools = remote
    .filter((tool) => {
      if (seen.has(tool.slug)) return false;
      seen.add(tool.slug);
      return true;
    })
    .map((tool): CatalogTool => {
      const reviewed = reviewedTools.get(tool.slug);
      if (reviewed) {
        return {
          ...reviewed,
          name: tool.name || reviewed.name,
          description: tool.description || reviewed.description,
        };
      }
      const risk = inferToolRisk(tool.slug);
      return {
        slug: tool.slug,
        name: tool.name,
        description:
          tool.description ||
          `Runs the ${tool.name} action in ${toolkit.name}.`,
        risk,
        defaultEnabled: risk === "read",
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return { ...toolkit, tools, toolsCount: tools.length };
}

// This reviewed catalog is the offline fallback. When Composio is available,
// its complete toolkit directory is exposed and every current non-deprecated
// action is loaded on demand. Reads default on; mutations require approval.
export const INTEGRATION_CATALOG: CatalogToolkit[] = [
  {
    slug: "gmail",
    name: "Gmail",
    description:
      "Read email and prepare or send replies from a connected Gmail account.",
    tools: [
      readTool(
        "GMAIL_FETCH_EMAILS",
        "Fetch emails",
        "Fetches a list of email messages from a Gmail account, supporting filtering, pagination, and optional full content retrieval. Results are NOT sorted by recency; sort by internalDate client-side. The messages field may be absent or empty (valid no-results state); always null-check before accessing messageId or threadId. Null-check subject and header fields before string operations. For large result sets, prefer ids_only=true or metadata-only listing, then hydrate via GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID.",
      ),
      readTool(
        "GMAIL_LIST_LABELS",
        "List Gmail labels",
        "Retrieves all system and user-created labels for a Gmail account in a single unpaginated response. Primary use: obtain internal label IDs (e.g., 'Label_123') required by other Gmail tools — display names cannot be used as label identifiers and cause silent failures or errors. System labels (INBOX, UNREAD, SPAM, TRASH, etc.) are case-sensitive and must be used exactly as returned; INBOX, SPAM, and TRASH are read-only and cannot be added/removed via label modification tools. The Gmail search 'label:' operator accepts display names, but label_ids parameters in tools like GMAIL_FETCH_EMAILS require internal IDs from this tool — mixing conventions yields zero results silently. Do not hardcode label IDs across sessions; refresh via this tool on conflict errors.",
      ),
      writeTool(
        "GMAIL_CREATE_EMAIL_DRAFT",
        "Create email draft",
        "Creates a Gmail email draft. While all fields are optional per the Gmail API, practical validation requires at least one of recipient_email, cc, or bcc and at least one of subject or body. Supports To/Cc/Bcc recipients, subject, plain/HTML body (ensure `is_html=True` for HTML), attachments, and threading. Returns a draft_id that must be used as-is with GMAIL_SEND_DRAFT — synthetic or stale IDs will fail. When creating a draft reply to an existing thread (thread_id provided), leave subject empty to stay in the same thread; setting a subject will create a NEW thread instead. HTTP 429 may occur on rapid creation/send sequences; apply exponential backoff.",
      ),
      writeTool(
        "GMAIL_SEND_EMAIL",
        "Send Email",
        "Sends an email via Gmail API using the authenticated user's Google profile display name. Sends immediately and is irreversible — confirm recipients, subject, body, and attachments before calling. At least one of 'to' (or 'recipient_email'), 'cc', or 'bcc' must be provided. At least one of subject or body must be provided. Requires `is_html=True` if the body contains HTML. All common file types including PNG, JPG, PDF, MP4, etc. are supported as attachments. Gmail API limits total message size to ~25 MB after base64 encoding. To reply in an existing thread, use GMAIL_REPLY_TO_THREAD instead. No scheduled send support; enforce timing externally.",
      ),
    ],
  },
  {
    slug: "slack",
    name: "Slack",
    description:
      "Find workspace context and communicate in connected Slack conversations.",
    tools: [
      readTool(
        "SLACK_FIND_CHANNELS",
        "Find channels",
        "Find channels in a Slack workspace by any criteria - name, topic, purpose, or description. Returns channel IDs (C*/G* prefixed) required by most Slack tools — always resolve names to IDs here before passing to other tools. NOTE: This action searches channels and conversations visible to the authenticated user. Empty results may indicate: - No channels match the search query in name, topic, or purpose - The target private channel or DM is not accessible to the authenticated user because they are not a member - The connection lacks required read scopes (channels:read, groups:read, im:read, mpim:read). If empty, retry with exact_match=false or exclude_archived=false to avoid false negatives. In large workspaces, paginate using next_cursor to avoid missing matches. Check 'composio_execution_message' and 'total_channels_searched' in the response for details.",
      ),
      readTool(
        "SLACK_FETCH_CONVERSATION_HISTORY",
        "Fetch conversation history",
        "Fetches a chronological list of messages and events from a specified Slack conversation, accessible by the authenticated user/bot, with options for pagination and time range filtering. IMPORTANT LIMITATION: This action only returns messages from the main channel timeline. Threaded replies are NOT returned by this endpoint. To retrieve threaded replies, use the SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION action (conversations.replies API) instead. The oldest/latest timestamp filters work reliably for filtering the main channel timeline, but cannot be used to retrieve individual threaded replies - even if you know the exact reply timestamp, setting oldest=latest to that timestamp will return an empty messages array. To get threaded replies: 1. Use this action to get parent messages (which include thread_ts, reply_count, latest_reply fields) 2. Use SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION with the parent's thread_ts to fetch all replies in that thread",
      ),
      readTool(
        "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION",
        "Retrieve conversation replies",
        "Retrieves replies to a specific parent message in a Slack conversation, using the channel ID and the parent message's timestamp (`ts`). Note: The parent message in the response contains metadata (reply_count, reply_users, latest_reply) that indicates expected thread activity. If the returned messages array contains fewer replies than reply_count indicates, check: (1) has_more=true means pagination is needed, (2) recently posted replies may have timing delays, (3) some replies may be filtered by permissions or deleted. The composio_execution_message field will warn about any detected mismatches.",
      ),
      readTool(
        "SLACK_SEARCH_MESSAGES",
        "Search messages",
        "Workspace‑wide Slack message search with date ranges and filters. Use `query` modifiers (e.g., in:#channel, from:@user, before/after:YYYY-MM-DD), sorting (score/timestamp), and pagination.",
      ),
      readTool(
        "SLACK_FIND_USER_BY_EMAIL_ADDRESS",
        "Lookup users by email",
        "Retrieves the Slack user object for an active user by their registered email address; requires the users:read.email OAuth scope. Fails with 'users_not_found' if the email is unregistered, the user is inactive, the account is a guest, or the email is hidden by workspace privacy settings.",
      ),
      writeTool(
        "SLACK_SEND_MESSAGE",
        "Send message",
        "Posts a message to a Slack channel, DM, or private group. Provide exactly one visible content mode: `markdown_text` for normal Markdown content, or `blocks` for raw Slack Block Kit layouts. Use `fallback_text` only with `blocks`; it maps to Slack's top-level `text` fallback. Fails with `not_in_channel`, `channel_not_found`, or `channel_is_archived` if the bot lacks access. Rate-limited at ~1 req/sec (HTTP 429, honor `Retry-After`). Not idempotent — duplicate calls post duplicate messages.",
      ),
      writeTool(
        "SLACK_SCHEDULE_MESSAGE",
        "Schedule message",
        "Schedules a message to a Slack channel, DM, or private group for a future time (`post_at`), requiring `text`, `blocks`, or `attachments` for content; scheduling is limited to 120 days in advance.",
      ),
    ],
  },
  {
    slug: "googlecalendar",
    name: "Google Calendar",
    description:
      "Check availability and manage events in connected Google Calendars.",
    tools: [
      readTool(
        "GOOGLECALENDAR_EVENTS_LIST",
        "List Events",
        "Lists or incrementally synchronizes events from one calendar, defaulting to the connected user's primary calendar. Use timeMin/timeMax for a time window, singleEvents to expand recurring series, showDeleted to include cancelled events, query for text search, orderBy to sort, pageToken to continue a page sequence, and syncToken to retrieve changes after a completed full sync. A sync token cannot be combined with event, text, property, time, update-time, or ordering filters; keep other parameters unchanged across sync pages. The final page returns nextSyncToken, and an expired token requires a new full sync after Google returns HTTP 410. Use fields to request a smaller partial response, including continuation tokens needed by the workflow.",
      ),
      readTool(
        "GOOGLECALENDAR_FIND_EVENT",
        "Find event",
        "Finds events in a specified Google Calendar using text query, time ranges (event start/end, last modification), and event types. Ensure `timeMin` is not chronologically after `timeMax` if both are provided. Results may span multiple pages; always follow `nextPageToken` until absent to avoid silently missing events. Validate the correct match from results by checking summary, start.dateTime, and organizer.email before using event_id for mutations. An empty `items` array means no events matched — widen filters rather than treating it as an error.",
      ),
      readTool(
        "GOOGLECALENDAR_FIND_FREE_SLOTS",
        "Find free slots",
        "Finds both free and busy time slots in Google Calendars for specified calendars within a defined time range. If `time_min` is not provided, defaults to the current timestamp in the specified timezone. If `time_max` is not provided, defaults to 23:59:59 of the day specified in `time_min` (if provided), otherwise defaults to 23:59:59 of the current day in the specified timezone. Returns busy intervals and calculates free slots by finding gaps between busy periods; `time_min` must precede `time_max` if both are provided. This action retrieves free and busy time slots for the specified calendars over a given time period. It analyzes the busy intervals from the calendars and provides calculated free slots based on the gaps in the busy periods. Returned free slots are unfiltered by duration; callers must filter intervals to those fully containing the required meeting length. No event metadata (titles, descriptions, links) is returned; use GOOGLECALENDAR_EVENTS_LIST for event details.",
      ),
      readTool(
        "GOOGLECALENDAR_FREE_BUSY_QUERY",
        "Query Calendar Availability",
        "Queries raw busy intervals for one or more calendars or groups over an exact time range. Returns per-calendar and per-group availability and errors, without event titles or details. Use GOOGLECALENDAR_FIND_FREE_SLOTS when you want default time bounds and computed free intervals; use GOOGLECALENDAR_EVENTS_LIST when you need event records.",
      ),
      writeTool(
        "GOOGLECALENDAR_CREATE_EVENT",
        "Create Event",
        'Creates a timed event using start_datetime and either end_datetime or duration fields, or an all-day event using an inclusive start_date and exclusive end_date. send_updates defaults to "all", which emails all attendees; choose "externalOnly" or "none" to control notifications. The organizer is added as an attendee unless exclude_organizer is true, and a Google Meet link is requested by default. No conflict checking is performed; use GOOGLECALENDAR_FREE_BUSY_QUERY first when conflicts matter. Returns the created event under response_data.',
      ),
      writeTool(
        "GOOGLECALENDAR_UPDATE_EVENT",
        "Update Google event",
        "Updates an existing event in Google Calendar. REQUIRES event_id - you MUST first search for the event using GOOGLECALENDAR_FIND_EVENT or GOOGLECALENDAR_EVENTS_LIST to obtain the event_id. This is a full PUT replacement: omitted fields (including attendees, reminders, recurrence, conferencing) are cleared. Always provide the complete desired event state. Use GOOGLECALENDAR_PATCH_EVENT instead for partial edits.",
      ),
    ],
  },
  {
    slug: "github",
    name: "GitHub",
    description:
      "Search engineering work and manage issues in connected GitHub repositories.",
    tools: [
      readTool(
        "GITHUB_SEARCH_REPOSITORIES",
        "Search repositories",
        "Searches GitHub repositories using a flexible query (keywords, qualifiers) with sorting, ordering, and pagination. IMPORTANT: The 'q' parameter (search query) is REQUIRED and must always be provided.",
      ),
      readTool(
        "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        "Search issues and pull requests",
        "Searches GitHub for issues and pull requests. Supports keywords, qualifiers (repo:, org:, user:, state:, label:, author:, assignee:, mentions:, etc.), and type filters (is:issue, is:pr). Type filters cannot be used alone - they must be combined with at least one keyword or other qualifier. All other qualifiers work independently. The @me shorthand (e.g., assignee:@me, mentions:@me) is automatically resolved to your username. Logical operators (AND, OR, NOT) are supported but limited to a maximum of 5 operators total per query.",
      ),
      readTool(
        "GITHUB_GET_ISSUE_COMMENTS",
        "Get issue comments",
        "Retrieves all comments for a specific GitHub issue in chronological order. Use this action when you need to view discussion history, analyze comment threads, or fetch comment details for a specific issue. Comments can be filtered by update time and paginated for large discussions.",
      ),
      writeTool(
        "GITHUB_CREATE_AN_ISSUE",
        "Create an issue",
        "Creates a new issue in a GitHub repository, requiring the repository to exist and have issues enabled; specific fields like assignees, milestone, or labels may require push access.",
      ),
      writeTool(
        "GITHUB_CREATE_AN_ISSUE_COMMENT",
        "Create an issue comment",
        "Creates a new comment on an existing GitHub issue or pull request within the specified repository.",
      ),
      writeTool(
        "GITHUB_UPDATE_AN_ISSUE",
        "Update an issue",
        "Updates an existing GitHub issue's title, body, state, milestone, labels, or assignees; `state_reason` is only processed if `state` also changes, and use `null` or `[]` to clear applicable fields.",
      ),
    ],
  },
  {
    slug: "jira",
    name: "Jira",
    description:
      "Search, create, assign, and transition work in connected Jira projects.",
    tools: [
      readTool(
        "JIRA_SEARCH_ISSUES",
        "Search issues",
        "Advanced Jira issue search supporting structured filters and raw JQL. At least one filter parameter (e.g., jql, project_key, updated_after) is required; calls with no parameters will be rejected.",
      ),
      readTool(
        "JIRA_FETCH_BULK_ISSUES",
        "Bulk Fetch Issues",
        "Tool to bulk fetch multiple Jira issues by their IDs or keys (max 100 per call). Use when you need to retrieve details for multiple issues efficiently in a single API call.",
      ),
      readTool(
        "JIRA_LIST_ISSUE_COMMENTS",
        "List Issue Comments",
        "Retrieves paginated comments from a Jira issue with optional ordering. Paginate by incrementing `start_at` by `max_results` until the cumulative count reaches the `total` field in the response. A response with `total=0` and an empty comments array means the issue has no comments.",
      ),
      writeTool(
        "JIRA_CREATE_ISSUE",
        "Create Issue",
        "Creates a new Jira issue (e.g., bug, task, story) in a specified project. IMPORTANT: Different Jira projects may have custom required fields beyond the standard ones (summary, project_key, issue_type). If issue creation fails with 'field X is required', use JIRA_GET_CREATE_METADATA_ISSUE_TYPE_FIELDS (requires projectIdOrKey and issueTypeId parameters) to discover available fields for your project, or check your Jira project's configuration. Custom fields can be provided via the 'additional_properties' parameter as a JSON string (e.g., '{\"customfield_12345\": \"value\"}'). Rapid bulk creation may trigger HTTP 429 rate limiting; throttle calls and use exponential backoff on 429 responses.",
      ),
      writeTool(
        "JIRA_ADD_COMMENT",
        "Add Comment",
        "Adds a comment using Atlassian Document Format (ADF) for rich text to an existing Jira issue.",
      ),
      writeTool(
        "JIRA_ASSIGN_ISSUE",
        "Assign Issue",
        "Assigns a Jira issue to a user, default assignee, or unassigns; supports email/name lookup.",
      ),
      writeTool(
        "JIRA_TRANSITION_ISSUE",
        "Transition Issue",
        "Transitions a Jira issue to a different workflow state, with support for transition name lookup and user assignment by email. IMPORTANT: Only fields that are on the transition's screen can be set during the transition. Which fields are available depends on the Jira workflow configuration and varies per project. Use JIRA_GET_TRANSITIONS with expand='transitions.fields' to check which fields a transition supports. If a field (e.g., assignee) is not on the transition screen, use a JIRA_EDIT_ISSUE action after the transition to set other fields.",
      ),
    ],
  },
  {
    slug: "notion",
    name: "Notion",
    description:
      "Find knowledge and maintain pages in a connected Notion workspace.",
    tools: [
      readTool(
        "NOTION_SEARCH_NOTION_PAGE",
        "Search Notion pages and databases",
        "Searches Notion pages and databases by title. Use specific search terms to find items by title (primary approach). KNOWN LIMITATIONS: (1) Search indexing is not immediate - recently shared items may not appear. (2) Search is not exhaustive - results may be incomplete. (3) Database pages return all custom properties with full nested structures, which can create large responses for databases with many properties - use filter_properties to reduce response size. FALLBACK STRATEGY: If a specific title search returns empty results despite knowing items exist, try an empty query to list all accessible items and filter client-side.",
      ),
      readTool(
        "NOTION_RETRIEVE_PAGE",
        "Retrieve page",
        "Retrieve a Notion page's properties/metadata (not block content) by page_id. Use when you have a page URL/ID and need to access its properties; for page content use block-children tools.",
      ),
      readTool(
        "NOTION_GET_PAGE_MARKDOWN",
        "Get page markdown",
        "Retrieve a Notion page's full content rendered as Notion-flavored Markdown in a single API call. Use when you need the readable content of a page without recursive block-children fetching.",
      ),
      readTool(
        "NOTION_QUERY_DATABASE_WITH_FILTER",
        "Query database with filter",
        "Tool to query a Notion database with server-side filtering, sorting, and pagination. Use when you need to retrieve a subset of rows by property, date, status, or other conditions.",
      ),
      writeTool(
        "NOTION_CREATE_NOTION_PAGE",
        "Create Notion page",
        "Creates a new page in a Notion workspace under a specified parent page or database. Supports creating pages with markdown content using the native markdown parameter, or as an empty page that can be populated later. PREREQUISITES: - Parent page/database must exist and be accessible in your Notion workspace - Use search_pages or list_databases first to obtain valid parent IDs LIMITATIONS: - Cannot create root-level pages (must have a parent) - May encounter conflicts if creating pages too quickly - Title-based parent search is less reliable than using UUIDs - The markdown parameter is mutually exclusive with children/content parameters",
      ),
      writeTool(
        "NOTION_UPDATE_PAGE_MARKDOWN",
        "Update page markdown",
        "Apply synchronous targeted edits or replace a Notion page using Markdown.",
      ),
    ],
  },
  {
    slug: "hubspot",
    name: "HubSpot",
    description:
      "Look up CRM records and manage contacts, tickets, and notes in HubSpot.",
    tools: [
      readTool(
        "HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA",
        "Search contacts by criteria",
        "Searches for HubSpot contacts using a text query, specific filter criteria (filters in a group are ANDed, groups are ORed), sorting, and pagination to retrieve selected properties.",
      ),
      readTool(
        "HUBSPOT_READ_CONTACT",
        "Read contact",
        "Retrieves a HubSpot contact by its ID.",
      ),
      readTool(
        "HUBSPOT_GET_TICKETS",
        "Get tickets",
        "Retrieves multiple HubSpot tickets by their IDs.",
      ),
      readTool(
        "HUBSPOT_SEARCH_TICKETS",
        "Search tickets",
        "Searches for HubSpot tickets using flexible criteria and filters.",
      ),
      writeTool(
        "HUBSPOT_CREATE_CONTACT",
        "Create contact",
        "Creates a new HubSpot contact.",
      ),
      writeTool(
        "HUBSPOT_CREATE_TICKET",
        "Create ticket",
        "Creates a new HubSpot ticket.",
      ),
      writeTool(
        "HUBSPOT_UPDATE_TICKET",
        "Update ticket",
        "Updates properties for an existing HubSpot ticket.",
      ),
      writeTool(
        "HUBSPOT_CREATE_NOTE",
        "Create note",
        "Creates a new HubSpot CRM note. Use when you need to add a timestamped note with optional attachments and associations to contacts, companies, deals, or tickets.",
      ),
    ],
  },
  {
    slug: "googledrive",
    name: "Google Drive",
    description:
      "Find, inspect, organize, and upload files in a connected Google Drive.",
    tools: [
      readTool(
        "GOOGLEDRIVE_FIND_FILE",
        "Find file",
        "Finds files in Google Drive using names, content, file types, folders, and other supported search criteria.",
      ),
      readTool(
        "GOOGLEDRIVE_GET_FILE_METADATA",
        "Get file metadata",
        "Retrieves metadata for a Google Drive file by its file ID.",
      ),
      readTool(
        "GOOGLEDRIVE_LIST_FOLDER_CHILDREN_V2",
        "List folder contents",
        "Lists the files and folders contained inside a Google Drive folder.",
      ),
      writeTool(
        "GOOGLEDRIVE_CREATE_FOLDER",
        "Create folder",
        "Creates a folder in Google Drive, optionally inside an existing parent folder.",
      ),
      writeTool(
        "GOOGLEDRIVE_UPLOAD_FILE",
        "Upload file",
        "Uploads a file to Google Drive and optionally places it in a selected folder.",
      ),
    ],
  },
  {
    slug: "trello",
    name: "Trello",
    description:
      "Read boards and cards, then create new work in a connected Trello workspace.",
    tools: [
      readTool(
        "TRELLO_GET_MEMBERS_ME",
        "Get current member",
        "Retrieves the authenticated Trello member and their accessible workspace information.",
      ),
      readTool(
        "TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER",
        "List member boards",
        "Lists Trello boards available to a member.",
      ),
      readTool(
        "TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD",
        "List board cards",
        "Retrieves the cards currently present on a Trello board.",
      ),
      writeTool(
        "TRELLO_ADD_CARDS",
        "Create card",
        "Creates a card in a selected Trello list.",
      ),
    ],
  },
  {
    slug: "asana",
    name: "Asana",
    description:
      "Search project work and create tasks in a connected Asana workspace.",
    tools: [
      readTool(
        "ASANA_GET_CURRENT_USER",
        "Get current user",
        "Retrieves the authenticated Asana user.",
      ),
      readTool(
        "ASANA_GET_MULTIPLE_WORKSPACES",
        "List workspaces",
        "Lists Asana workspaces visible to the authenticated user.",
      ),
      readTool(
        "ASANA_SEARCH_TASKS_IN_WORKSPACE",
        "Search workspace tasks",
        "Searches for tasks inside an Asana workspace using supported task filters.",
      ),
      writeTool(
        "ASANA_CREATE_A_TASK",
        "Create task",
        "Creates an Asana task with the supplied workspace, project, assignee, and task details.",
      ),
    ],
  },
  {
    slug: "linear",
    name: "Linear",
    description:
      "Search engineering work and manage issues in a connected Linear workspace.",
    tools: [
      readTool(
        "LINEAR_LIST_LINEAR_TEAMS",
        "List teams",
        "Lists the teams available in the connected Linear workspace.",
      ),
      readTool(
        "LINEAR_SEARCH_ISSUES",
        "Search issues",
        "Searches Linear issues using the supplied workspace filters and query.",
      ),
      readTool(
        "LINEAR_GET_LINEAR_ISSUE",
        "Get issue",
        "Retrieves a Linear issue and its current details.",
      ),
      readTool(
        "LINEAR_LIST_LINEAR_PROJECTS",
        "List projects",
        "Lists projects in the connected Linear workspace.",
      ),
      readTool(
        "LINEAR_LIST_LINEAR_USERS",
        "List users",
        "Lists users in the connected Linear workspace.",
      ),
      readTool(
        "LINEAR_LIST_LINEAR_STATES",
        "List workflow states",
        "Lists the issue workflow states configured in Linear.",
      ),
      readTool(
        "LINEAR_LIST_COMMENTS",
        "List comments",
        "Lists comments attached to a Linear issue.",
      ),
      writeTool(
        "LINEAR_CREATE_LINEAR_ISSUE",
        "Create issue",
        "Creates an issue in a selected Linear team.",
      ),
      writeTool(
        "LINEAR_CREATE_LINEAR_COMMENT",
        "Create comment",
        "Adds a comment to a Linear issue.",
      ),
      writeTool(
        "LINEAR_UPDATE_ISSUE",
        "Update issue",
        "Updates fields on an existing Linear issue.",
      ),
    ],
  },
  {
    slug: "googlesheets",
    name: "Google Sheets",
    description:
      "Read spreadsheet data and safely create or update rows in Google Sheets.",
    tools: [
      readTool(
        "GOOGLESHEETS_SEARCH_SPREADSHEETS",
        "Search spreadsheets",
        "Searches spreadsheets accessible to the connected Google account.",
      ),
      readTool(
        "GOOGLESHEETS_GET_SHEET_NAMES",
        "Get sheet names",
        "Lists worksheet names in a Google spreadsheet.",
      ),
      readTool(
        "GOOGLESHEETS_VALUES_GET",
        "Read spreadsheet values",
        "Reads values from a selected spreadsheet range.",
      ),
      readTool(
        "GOOGLESHEETS_GET_SPREADSHEET_INFO",
        "Get spreadsheet info",
        "Retrieves spreadsheet metadata and worksheet information.",
      ),
      readTool(
        "GOOGLESHEETS_QUERY_TABLE",
        "Query spreadsheet table",
        "Queries structured data from a spreadsheet table.",
      ),
      readTool(
        "GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW",
        "Look up row",
        "Finds a matching row in a Google spreadsheet.",
      ),
      writeTool(
        "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND",
        "Append spreadsheet values",
        "Appends values to a selected Google Sheets range.",
      ),
      writeTool(
        "GOOGLESHEETS_CREATE_GOOGLE_SHEET1",
        "Create spreadsheet",
        "Creates a new Google spreadsheet.",
      ),
      writeTool(
        "GOOGLESHEETS_VALUES_UPDATE",
        "Update spreadsheet values",
        "Updates values in a selected spreadsheet range.",
      ),
      writeTool(
        "GOOGLESHEETS_UPSERT_ROWS",
        "Upsert rows",
        "Updates matching rows or inserts new rows in a spreadsheet.",
      ),
    ],
  },
  {
    slug: "googledocs",
    name: "Google Docs",
    description:
      "Read, create, and update documents in a connected Google Workspace account.",
    tools: [
      readTool(
        "GOOGLEDOCS_GET_DOCUMENT_BY_ID",
        "Get document",
        "Retrieves a Google document by its document ID.",
      ),
      readTool(
        "GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT",
        "Read document text",
        "Retrieves the plain text content of a Google document.",
      ),
      writeTool(
        "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN",
        "Create document",
        "Creates a Google document from Markdown content.",
      ),
      writeTool(
        "GOOGLEDOCS_UPDATE_EXISTING_DOCUMENT",
        "Update document",
        "Updates content in an existing Google document.",
      ),
      writeTool(
        "GOOGLEDOCS_REPLACE_ALL_TEXT",
        "Replace document text",
        "Replaces matching text throughout a Google document.",
      ),
      writeTool(
        "GOOGLEDOCS_REPLACE_IMAGE",
        "Replace document image",
        "Replaces an image in a Google document.",
      ),
    ],
  },
  {
    slug: "zendesk",
    name: "Zendesk",
    description:
      "Search support activity and manage customer tickets in Zendesk.",
    tools: [
      readTool(
        "ZENDESK_GET_ABOUT_ME",
        "Get current agent",
        "Retrieves the connected Zendesk agent profile.",
      ),
      readTool(
        "ZENDESK_SEARCH_ZENDESK",
        "Search Zendesk",
        "Searches Zendesk tickets, users, and related support records.",
      ),
      readTool(
        "ZENDESK_GET_ZENDESK_TICKET_BY_ID",
        "Get ticket",
        "Retrieves a Zendesk ticket by its ID.",
      ),
      readTool(
        "ZENDESK_GET_RECENT_TICKETS",
        "Get recent tickets",
        "Retrieves recently created or updated Zendesk tickets.",
      ),
      readTool(
        "ZENDESK_GET_TICKET_COMMENTS",
        "Get ticket comments",
        "Retrieves comments and conversation history for a Zendesk ticket.",
      ),
      readTool(
        "ZENDESK_LIST_ZENDESK_TICKETS",
        "List tickets",
        "Lists tickets visible to the connected Zendesk account.",
      ),
      readTool(
        "ZENDESK_SEARCH_ZENDESK_USERS",
        "Search users",
        "Searches for Zendesk users and customers.",
      ),
      writeTool(
        "ZENDESK_UPDATE_ZENDESK_TICKET",
        "Update ticket",
        "Updates an existing Zendesk ticket.",
      ),
      writeTool(
        "ZENDESK_CREATE_ZENDESK_TICKET",
        "Create ticket",
        "Creates a new Zendesk support ticket.",
      ),
      writeTool(
        "ZENDESK_REPLY_ZENDESK_TICKET",
        "Reply to ticket",
        "Adds a reply to an existing Zendesk ticket.",
      ),
    ],
  },
  {
    slug: "outlook",
    name: "Outlook",
    description:
      "Search mail, send messages, and manage calendar events in Outlook.",
    tools: [
      readTool(
        "OUTLOOK_GET_PROFILE",
        "Get profile",
        "Retrieves the connected Outlook profile.",
      ),
      readTool(
        "OUTLOOK_SEARCH_MESSAGES",
        "Search messages",
        "Searches email messages in the connected Outlook mailbox.",
      ),
      readTool(
        "OUTLOOK_GET_MESSAGE",
        "Get message",
        "Retrieves an Outlook email message by its ID.",
      ),
      readTool(
        "OUTLOOK_GET_SCHEDULE",
        "Get schedule",
        "Retrieves availability information from Outlook calendars.",
      ),
      readTool(
        "OUTLOOK_GET_USER_CALENDAR",
        "Get calendar",
        "Retrieves the connected user's Outlook calendar.",
      ),
      readTool(
        "OUTLOOK_GET_USER_CALENDAR_EVENT",
        "Get calendar event",
        "Retrieves a specific Outlook calendar event.",
      ),
      writeTool(
        "OUTLOOK_SEND_EMAIL",
        "Send email",
        "Sends an email from the connected Outlook mailbox.",
      ),
      writeTool(
        "OUTLOOK_CALENDAR_CREATE_EVENT",
        "Create calendar event",
        "Creates an event in the connected Outlook calendar.",
      ),
      writeTool(
        "OUTLOOK_CREATE_TASK",
        "Create task",
        "Creates a Microsoft To Do task through the connected Outlook account.",
      ),
      writeTool(
        "OUTLOOK_UPDATE_CALENDAR_EVENT",
        "Update calendar event",
        "Updates an existing Outlook calendar event.",
      ),
    ],
  },
  {
    slug: "googlemeet",
    name: "Google Meet",
    description:
      "Create meeting spaces and inspect conference records from Google Meet.",
    tools: [
      readTool(
        "GOOGLEMEET_GET_MEET",
        "Get meeting",
        "Retrieves details for a Google Meet space.",
      ),
      readTool(
        "GOOGLEMEET_LIST_CONFERENCE_RECORDS",
        "List conference records",
        "Lists Google Meet conference records available to the connected account.",
      ),
      readTool(
        "GOOGLEMEET_LIST_PARTICIPANTS",
        "List participants",
        "Lists participants from a selected Google Meet conference record.",
      ),
      readTool(
        "GOOGLEMEET_GET_RECORDINGS_BY_CONFERENCE_RECORD_ID",
        "Get recordings",
        "Retrieves recordings associated with a Google Meet conference record.",
      ),
      readTool(
        "GOOGLEMEET_GET_TRANSCRIPTS_BY_CONFERENCE_RECORD_ID",
        "Get transcripts",
        "Retrieves transcripts associated with a Google Meet conference record.",
      ),
      readTool(
        "GOOGLEMEET_LIST_TRANSCRIPT_ENTRIES",
        "List transcript entries",
        "Lists the spoken transcript entries from a Google Meet transcript.",
      ),
      readTool(
        "GOOGLEMEET_LIST_RECORDINGS",
        "List recordings",
        "Lists Google Meet recordings available to the connected account.",
      ),
      writeTool(
        "GOOGLEMEET_CREATE_MEET",
        "Create meeting",
        "Creates a new Google Meet space.",
      ),
      writeTool(
        "GOOGLEMEET_UPDATE_SPACE",
        "Update meeting space",
        "Updates settings for a Google Meet space.",
      ),
      writeTool(
        "GOOGLEMEET_END_ACTIVE_CONFERENCE",
        "End conference",
        "Ends the active conference in a Google Meet space.",
      ),
    ],
  },
  {
    slug: "microsoft_teams",
    name: "Microsoft Teams",
    description:
      "Read team conversations and safely send messages through Microsoft Teams.",
    tools: [
      readTool(
        "MICROSOFT_TEAMS_GET_MY_PROFILE",
        "Get profile",
        "Retrieves the connected Microsoft Teams user profile.",
      ),
      readTool(
        "MICROSOFT_TEAMS_LIST_USER_JOINED_TEAMS",
        "List joined teams",
        "Lists Microsoft Teams joined by the connected user.",
      ),
      readTool(
        "MICROSOFT_TEAMS_TEAMS_LIST_CHANNEL_MESSAGES",
        "List channel messages",
        "Lists messages from a selected Microsoft Teams channel.",
      ),
      readTool(
        "MICROSOFT_TEAMS_CHATS_GET_ALL_CHATS",
        "List chats",
        "Lists chats available to the connected Microsoft Teams user.",
      ),
      readTool(
        "MICROSOFT_TEAMS_SEARCH_MESSAGES",
        "Search messages",
        "Searches messages accessible to the connected Microsoft Teams user.",
      ),
      readTool(
        "MICROSOFT_TEAMS_LIST_USER_CHAT_MESSAGES",
        "List chat messages",
        "Lists messages from a selected Microsoft Teams chat.",
      ),
      readTool(
        "MICROSOFT_TEAMS_GET_PRESENCE",
        "Get presence",
        "Retrieves a Microsoft Teams user's current presence.",
      ),
      writeTool(
        "MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE",
        "Send channel message",
        "Posts a message to a selected Microsoft Teams channel.",
      ),
      writeTool(
        "MICROSOFT_TEAMS_CREATE_MEETING",
        "Create meeting",
        "Creates an online Microsoft Teams meeting.",
      ),
      writeTool(
        "MICROSOFT_TEAMS_TEAMS_POST_CHAT_MESSAGE",
        "Send chat message",
        "Sends a message to a selected Microsoft Teams chat.",
      ),
    ],
  },
  {
    slug: "airtable",
    name: "Airtable",
    description:
      "Read bases and records, then add structured data to Airtable.",
    tools: [
      readTool(
        "AIRTABLE_GET_USER_INFO",
        "Get user information",
        "Retrieves information about the connected Airtable user.",
      ),
      readTool(
        "AIRTABLE_LIST_BASES",
        "List bases",
        "Lists Airtable bases available to the connected account.",
      ),
      readTool(
        "AIRTABLE_LIST_RECORDS",
        "List records",
        "Lists records from a selected Airtable table.",
      ),
      readTool(
        "AIRTABLE_GET_BASE_METADATA",
        "Get base metadata",
        "Retrieves metadata for an Airtable base.",
      ),
      readTool(
        "AIRTABLE_GET_BASE_SCHEMA",
        "Get base schema",
        "Retrieves table and field definitions for an Airtable base.",
      ),
      readTool(
        "AIRTABLE_GET_RECORD",
        "Get record",
        "Retrieves a single Airtable record.",
      ),
      readTool(
        "AIRTABLE_LIST_COMMENTS",
        "List comments",
        "Lists comments attached to an Airtable record.",
      ),
      writeTool(
        "AIRTABLE_CREATE_RECORDS",
        "Create records",
        "Creates one or more records in an Airtable table.",
      ),
      writeTool(
        "AIRTABLE_UPDATE_RECORD",
        "Update record",
        "Updates an existing Airtable record.",
      ),
      writeTool(
        "AIRTABLE_CREATE_COMMENT",
        "Create comment",
        "Adds a comment to an Airtable record.",
      ),
    ],
  },
  {
    slug: "shopify",
    name: "Shopify",
    description:
      "Inspect store, product, and order data and run approved Shopify updates.",
    tools: [
      readTool(
        "SHOPIFY_QUERY_SHOP",
        "Get shop",
        "Retrieves details about the connected Shopify store.",
      ),
      readTool(
        "SHOPIFY_GRAPH_QL_PRODUCTS",
        "Query products",
        "Queries Shopify products, variants, media, and publication information.",
      ),
      readTool(
        "SHOPIFY_GRAPH_QL_ORDERS",
        "Query orders",
        "Queries orders from the connected Shopify store.",
      ),
      readTool(
        "SHOPIFY_GRAPH_QL_COLLECTIONS",
        "Query collections",
        "Queries collections and their publication information from Shopify.",
      ),
      readTool(
        "SHOPIFY_GRAPH_QL_CUSTOMERS",
        "Query customers",
        "Queries Shopify customers and customer search results.",
      ),
      readTool(
        "SHOPIFY_GRAPH_QL_INVENTORY",
        "Query inventory",
        "Queries Shopify inventory items and inventory levels.",
      ),
      readTool(
        "SHOPIFY_GRAPH_QL_SHOP",
        "Query shop metadata",
        "Queries Shopify shop and app metadata.",
      ),
      writeTool(
        "SHOPIFY_GRAPH_QL_WRITE_OPERATIONS",
        "Update Shopify data",
        "Runs an approved Shopify GraphQL write operation.",
      ),
      writeTool(
        "SHOPIFY_CREATE_CUSTOMER",
        "Create customer",
        "Creates a customer in the connected Shopify store.",
      ),
      writeTool(
        "SHOPIFY_UPDATE_ORDER",
        "Update order",
        "Updates an order in the connected Shopify store.",
      ),
    ],
  },
  {
    slug: "zoom",
    name: "Zoom",
    description:
      "Review meetings, participants, and recordings and manage approved Zoom meetings.",
    tools: [
      readTool(
        "ZOOM_GET_A_MEETING",
        "Get meeting",
        "Retrieves details for a Zoom meeting.",
      ),
      readTool(
        "ZOOM_LIST_MEETINGS",
        "List meetings",
        "Lists Zoom meetings for the connected user.",
      ),
      readTool(
        "ZOOM_LIST_PAST_MEETING_INSTANCES",
        "List past meeting instances",
        "Lists completed instances of a recurring Zoom meeting.",
      ),
      readTool(
        "ZOOM_GET_PAST_MEETING_PARTICIPANTS",
        "Get meeting participants",
        "Retrieves participants from a completed Zoom meeting.",
      ),
      readTool(
        "ZOOM_GET_MEETING_RECORDINGS",
        "Get meeting recordings",
        "Retrieves cloud recordings for a Zoom meeting.",
      ),
      readTool(
        "ZOOM_LIST_ALL_RECORDINGS",
        "List recordings",
        "Lists cloud recordings available to the connected Zoom user.",
      ),
      readTool(
        "ZOOM_GET_USER",
        "Get user",
        "Retrieves a Zoom user's profile and account details.",
      ),
      writeTool(
        "ZOOM_CREATE_A_MEETING",
        "Create meeting",
        "Creates a Zoom meeting after approval.",
      ),
      writeTool(
        "ZOOM_UPDATE_A_MEETING",
        "Update meeting",
        "Updates the schedule or settings of a Zoom meeting after approval.",
      ),
      writeTool(
        "ZOOM_DELETE_A_MEETING",
        "Delete meeting",
        "Deletes a Zoom meeting after approval.",
      ),
    ],
  },
];

export function getCatalogToolkit(slug: string): CatalogToolkit | undefined {
  return INTEGRATION_CATALOG.find(
    (toolkit) => toolkit.slug === slug.toLowerCase(),
  );
}

export function getCatalogTool(
  toolkitSlug: string,
  toolSlug: string,
): CatalogTool | undefined {
  return getCatalogToolkit(toolkitSlug)?.tools.find(
    (tool) => tool.slug === toolSlug,
  );
}
