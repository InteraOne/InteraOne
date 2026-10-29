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
    tools: CatalogTool[];
  }

  const readTool = (slug: string, name: string, description: string): CatalogTool => ({
    slug, name, description, risk: "read", defaultEnabled: true,
  });

  const writeTool = (slug: string, name: string, description: string): CatalogTool => ({
    slug, name, description, risk: "write", defaultEnabled: false,
  });

  // Exact names, slugs, and descriptions were fetched from the current Composio
  // tool catalog. Adding a toolkit or action remains a code-reviewed server-side
  // policy change. Reads default on; writes require policy opt-in and approval.
  export const INTEGRATION_CATALOG: CatalogToolkit[] = [
    {
      slug: "gmail",
      name: "Gmail",
      description: "Read email and prepare or send replies from a connected Gmail account.",
      tools: [
        readTool("GMAIL_FETCH_EMAILS", "Fetch emails", "Fetches a list of email messages from a Gmail account, supporting filtering, pagination, and optional full content retrieval. Results are NOT sorted by recency; sort by internalDate client-side. The messages field may be absent or empty (valid no-results state); always null-check before accessing messageId or threadId. Null-check subject and header fields before string operations. For large result sets, prefer ids_only=true or metadata-only listing, then hydrate via GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID."),
        readTool("GMAIL_LIST_LABELS", "List Gmail labels", "Retrieves all system and user-created labels for a Gmail account in a single unpaginated response. Primary use: obtain internal label IDs (e.g., 'Label_123') required by other Gmail tools — display names cannot be used as label identifiers and cause silent failures or errors. System labels (INBOX, UNREAD, SPAM, TRASH, etc.) are case-sensitive and must be used exactly as returned; INBOX, SPAM, and TRASH are read-only and cannot be added/removed via label modification tools. The Gmail search 'label:' operator accepts display names, but label_ids parameters in tools like GMAIL_FETCH_EMAILS require internal IDs from this tool — mixing conventions yields zero results silently. Do not hardcode label IDs across sessions; refresh via this tool on conflict errors."),
        writeTool("GMAIL_CREATE_EMAIL_DRAFT", "Create email draft", "Creates a Gmail email draft. While all fields are optional per the Gmail API, practical validation requires at least one of recipient_email, cc, or bcc and at least one of subject or body. Supports To/Cc/Bcc recipients, subject, plain/HTML body (ensure `is_html=True` for HTML), attachments, and threading. Returns a draft_id that must be used as-is with GMAIL_SEND_DRAFT — synthetic or stale IDs will fail. When creating a draft reply to an existing thread (thread_id provided), leave subject empty to stay in the same thread; setting a subject will create a NEW thread instead. HTTP 429 may occur on rapid creation/send sequences; apply exponential backoff."),
        writeTool("GMAIL_SEND_EMAIL", "Send Email", "Sends an email via Gmail API using the authenticated user's Google profile display name. Sends immediately and is irreversible — confirm recipients, subject, body, and attachments before calling. At least one of 'to' (or 'recipient_email'), 'cc', or 'bcc' must be provided. At least one of subject or body must be provided. Requires `is_html=True` if the body contains HTML. All common file types including PNG, JPG, PDF, MP4, etc. are supported as attachments. Gmail API limits total message size to ~25 MB after base64 encoding. To reply in an existing thread, use GMAIL_REPLY_TO_THREAD instead. No scheduled send support; enforce timing externally."),
      ],
    },
    {
      slug: "slack",
      name: "Slack",
      description: "Find workspace context and communicate in connected Slack conversations.",
      tools: [
        readTool("SLACK_FIND_CHANNELS", "Find channels", "Find channels in a Slack workspace by any criteria - name, topic, purpose, or description. Returns channel IDs (C*/G* prefixed) required by most Slack tools — always resolve names to IDs here before passing to other tools. NOTE: This action searches channels and conversations visible to the authenticated user. Empty results may indicate: - No channels match the search query in name, topic, or purpose - The target private channel or DM is not accessible to the authenticated user because they are not a member - The connection lacks required read scopes (channels:read, groups:read, im:read, mpim:read). If empty, retry with exact_match=false or exclude_archived=false to avoid false negatives. In large workspaces, paginate using next_cursor to avoid missing matches. Check 'composio_execution_message' and 'total_channels_searched' in the response for details."),
        readTool("SLACK_FETCH_CONVERSATION_HISTORY", "Fetch conversation history", "Fetches a chronological list of messages and events from a specified Slack conversation, accessible by the authenticated user/bot, with options for pagination and time range filtering. IMPORTANT LIMITATION: This action only returns messages from the main channel timeline. Threaded replies are NOT returned by this endpoint. To retrieve threaded replies, use the SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION action (conversations.replies API) instead. The oldest/latest timestamp filters work reliably for filtering the main channel timeline, but cannot be used to retrieve individual threaded replies - even if you know the exact reply timestamp, setting oldest=latest to that timestamp will return an empty messages array. To get threaded replies: 1. Use this action to get parent messages (which include thread_ts, reply_count, latest_reply fields) 2. Use SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION with the parent's thread_ts to fetch all replies in that thread"),
        readTool("SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION", "Retrieve conversation replies", "Retrieves replies to a specific parent message in a Slack conversation, using the channel ID and the parent message's timestamp (`ts`). Note: The parent message in the response contains metadata (reply_count, reply_users, latest_reply) that indicates expected thread activity. If the returned messages array contains fewer replies than reply_count indicates, check: (1) has_more=true means pagination is needed, (2) recently posted replies may have timing delays, (3) some replies may be filtered by permissions or deleted. The composio_execution_message field will warn about any detected mismatches."),
        readTool("SLACK_SEARCH_MESSAGES", "Search messages", "Workspace‑wide Slack message search with date ranges and filters. Use `query` modifiers (e.g., in:#channel, from:@user, before/after:YYYY-MM-DD), sorting (score/timestamp), and pagination."),
        readTool("SLACK_FIND_USER_BY_EMAIL_ADDRESS", "Lookup users by email", "Retrieves the Slack user object for an active user by their registered email address; requires the users:read.email OAuth scope. Fails with 'users_not_found' if the email is unregistered, the user is inactive, the account is a guest, or the email is hidden by workspace privacy settings."),
        writeTool("SLACK_SEND_MESSAGE", "Send message", "Posts a message to a Slack channel, DM, or private group. Provide exactly one visible content mode: `markdown_text` for normal Markdown content, or `blocks` for raw Slack Block Kit layouts. Use `fallback_text` only with `blocks`; it maps to Slack's top-level `text` fallback. Fails with `not_in_channel`, `channel_not_found`, or `channel_is_archived` if the bot lacks access. Rate-limited at ~1 req/sec (HTTP 429, honor `Retry-After`). Not idempotent — duplicate calls post duplicate messages."),
        writeTool("SLACK_SCHEDULE_MESSAGE", "Schedule message", "Schedules a message to a Slack channel, DM, or private group for a future time (`post_at`), requiring `text`, `blocks`, or `attachments` for content; scheduling is limited to 120 days in advance."),
      ],
    },
    {
      slug: "googlecalendar",
      name: "Google Calendar",
      description: "Check availability and manage events in connected Google Calendars.",
      tools: [
        readTool("GOOGLECALENDAR_EVENTS_LIST", "List Events", "Lists or incrementally synchronizes events from one calendar, defaulting to the connected user's primary calendar. Use timeMin/timeMax for a time window, singleEvents to expand recurring series, showDeleted to include cancelled events, query for text search, orderBy to sort, pageToken to continue a page sequence, and syncToken to retrieve changes after a completed full sync. A sync token cannot be combined with event, text, property, time, update-time, or ordering filters; keep other parameters unchanged across sync pages. The final page returns nextSyncToken, and an expired token requires a new full sync after Google returns HTTP 410. Use fields to request a smaller partial response, including continuation tokens needed by the workflow."),
        readTool("GOOGLECALENDAR_FIND_EVENT", "Find event", "Finds events in a specified Google Calendar using text query, time ranges (event start/end, last modification), and event types. Ensure `timeMin` is not chronologically after `timeMax` if both are provided. Results may span multiple pages; always follow `nextPageToken` until absent to avoid silently missing events. Validate the correct match from results by checking summary, start.dateTime, and organizer.email before using event_id for mutations. An empty `items` array means no events matched — widen filters rather than treating it as an error."),
        readTool("GOOGLECALENDAR_FIND_FREE_SLOTS", "Find free slots", "Finds both free and busy time slots in Google Calendars for specified calendars within a defined time range. If `time_min` is not provided, defaults to the current timestamp in the specified timezone. If `time_max` is not provided, defaults to 23:59:59 of the day specified in `time_min` (if provided), otherwise defaults to 23:59:59 of the current day in the specified timezone. Returns busy intervals and calculates free slots by finding gaps between busy periods; `time_min` must precede `time_max` if both are provided. This action retrieves free and busy time slots for the specified calendars over a given time period. It analyzes the busy intervals from the calendars and provides calculated free slots based on the gaps in the busy periods. Returned free slots are unfiltered by duration; callers must filter intervals to those fully containing the required meeting length. No event metadata (titles, descriptions, links) is returned; use GOOGLECALENDAR_EVENTS_LIST for event details."),
        readTool("GOOGLECALENDAR_FREE_BUSY_QUERY", "Query Calendar Availability", "Queries raw busy intervals for one or more calendars or groups over an exact time range. Returns per-calendar and per-group availability and errors, without event titles or details. Use GOOGLECALENDAR_FIND_FREE_SLOTS when you want default time bounds and computed free intervals; use GOOGLECALENDAR_EVENTS_LIST when you need event records."),
        writeTool("GOOGLECALENDAR_CREATE_EVENT", "Create Event", "Creates a timed event using start_datetime and either end_datetime or duration fields, or an all-day event using an inclusive start_date and exclusive end_date. send_updates defaults to \"all\", which emails all attendees; choose \"externalOnly\" or \"none\" to control notifications. The organizer is added as an attendee unless exclude_organizer is true, and a Google Meet link is requested by default. No conflict checking is performed; use GOOGLECALENDAR_FREE_BUSY_QUERY first when conflicts matter. Returns the created event under response_data."),
        writeTool("GOOGLECALENDAR_UPDATE_EVENT", "Update Google event", "Updates an existing event in Google Calendar. REQUIRES event_id - you MUST first search for the event using GOOGLECALENDAR_FIND_EVENT or GOOGLECALENDAR_EVENTS_LIST to obtain the event_id. This is a full PUT replacement: omitted fields (including attendees, reminders, recurrence, conferencing) are cleared. Always provide the complete desired event state. Use GOOGLECALENDAR_PATCH_EVENT instead for partial edits."),
      ],
    },
    {
      slug: "github",
      name: "GitHub",
      description: "Search engineering work and manage issues in connected GitHub repositories.",
      tools: [
        readTool("GITHUB_SEARCH_REPOSITORIES", "Search repositories", "Searches GitHub repositories using a flexible query (keywords, qualifiers) with sorting, ordering, and pagination. IMPORTANT: The 'q' parameter (search query) is REQUIRED and must always be provided."),
        readTool("GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS", "Search issues and pull requests", "Searches GitHub for issues and pull requests. Supports keywords, qualifiers (repo:, org:, user:, state:, label:, author:, assignee:, mentions:, etc.), and type filters (is:issue, is:pr). Type filters cannot be used alone - they must be combined with at least one keyword or other qualifier. All other qualifiers work independently. The @me shorthand (e.g., assignee:@me, mentions:@me) is automatically resolved to your username. Logical operators (AND, OR, NOT) are supported but limited to a maximum of 5 operators total per query."),
        readTool("GITHUB_GET_ISSUE_COMMENTS", "Get issue comments", "Retrieves all comments for a specific GitHub issue in chronological order. Use this action when you need to view discussion history, analyze comment threads, or fetch comment details for a specific issue. Comments can be filtered by update time and paginated for large discussions."),
        writeTool("GITHUB_CREATE_AN_ISSUE", "Create an issue", "Creates a new issue in a GitHub repository, requiring the repository to exist and have issues enabled; specific fields like assignees, milestone, or labels may require push access."),
        writeTool("GITHUB_CREATE_AN_ISSUE_COMMENT", "Create an issue comment", "Creates a new comment on an existing GitHub issue or pull request within the specified repository."),
        writeTool("GITHUB_UPDATE_AN_ISSUE", "Update an issue", "Updates an existing GitHub issue's title, body, state, milestone, labels, or assignees; `state_reason` is only processed if `state` also changes, and use `null` or `[]` to clear applicable fields."),
      ],
    },
    {
      slug: "jira",
      name: "Jira",
      description: "Search, create, assign, and transition work in connected Jira projects.",
      tools: [
        readTool("JIRA_SEARCH_ISSUES", "Search issues", "Advanced Jira issue search supporting structured filters and raw JQL. At least one filter parameter (e.g., jql, project_key, updated_after) is required; calls with no parameters will be rejected."),
        readTool("JIRA_FETCH_BULK_ISSUES", "Bulk Fetch Issues", "Tool to bulk fetch multiple Jira issues by their IDs or keys (max 100 per call). Use when you need to retrieve details for multiple issues efficiently in a single API call."),
        readTool("JIRA_LIST_ISSUE_COMMENTS", "List Issue Comments", "Retrieves paginated comments from a Jira issue with optional ordering. Paginate by incrementing `start_at` by `max_results` until the cumulative count reaches the `total` field in the response. A response with `total=0` and an empty comments array means the issue has no comments."),
        writeTool("JIRA_CREATE_ISSUE", "Create Issue", "Creates a new Jira issue (e.g., bug, task, story) in a specified project. IMPORTANT: Different Jira projects may have custom required fields beyond the standard ones (summary, project_key, issue_type). If issue creation fails with 'field X is required', use JIRA_GET_CREATE_METADATA_ISSUE_TYPE_FIELDS (requires projectIdOrKey and issueTypeId parameters) to discover available fields for your project, or check your Jira project's configuration. Custom fields can be provided via the 'additional_properties' parameter as a JSON string (e.g., '{\"customfield_12345\": \"value\"}'). Rapid bulk creation may trigger HTTP 429 rate limiting; throttle calls and use exponential backoff on 429 responses."),
        writeTool("JIRA_ADD_COMMENT", "Add Comment", "Adds a comment using Atlassian Document Format (ADF) for rich text to an existing Jira issue."),
        writeTool("JIRA_ASSIGN_ISSUE", "Assign Issue", "Assigns a Jira issue to a user, default assignee, or unassigns; supports email/name lookup."),
        writeTool("JIRA_TRANSITION_ISSUE", "Transition Issue", "Transitions a Jira issue to a different workflow state, with support for transition name lookup and user assignment by email. IMPORTANT: Only fields that are on the transition's screen can be set during the transition. Which fields are available depends on the Jira workflow configuration and varies per project. Use JIRA_GET_TRANSITIONS with expand='transitions.fields' to check which fields a transition supports. If a field (e.g., assignee) is not on the transition screen, use a JIRA_EDIT_ISSUE action after the transition to set other fields."),
      ],
    },
    {
      slug: "notion",
      name: "Notion",
      description: "Find knowledge and maintain pages in a connected Notion workspace.",
      tools: [
        readTool("NOTION_SEARCH_NOTION_PAGE", "Search Notion pages and databases", "Searches Notion pages and databases by title. Use specific search terms to find items by title (primary approach). KNOWN LIMITATIONS: (1) Search indexing is not immediate - recently shared items may not appear. (2) Search is not exhaustive - results may be incomplete. (3) Database pages return all custom properties with full nested structures, which can create large responses for databases with many properties - use filter_properties to reduce response size. FALLBACK STRATEGY: If a specific title search returns empty results despite knowing items exist, try an empty query to list all accessible items and filter client-side."),
        readTool("NOTION_RETRIEVE_PAGE", "Retrieve page", "Retrieve a Notion page's properties/metadata (not block content) by page_id. Use when you have a page URL/ID and need to access its properties; for page content use block-children tools."),
        readTool("NOTION_GET_PAGE_MARKDOWN", "Get page markdown", "Retrieve a Notion page's full content rendered as Notion-flavored Markdown in a single API call. Use when you need the readable content of a page without recursive block-children fetching."),
        readTool("NOTION_QUERY_DATABASE_WITH_FILTER", "Query database with filter", "Tool to query a Notion database with server-side filtering, sorting, and pagination. Use when you need to retrieve a subset of rows by property, date, status, or other conditions."),
        writeTool("NOTION_CREATE_NOTION_PAGE", "Create Notion page", "Creates a new page in a Notion workspace under a specified parent page or database. Supports creating pages with markdown content using the native markdown parameter, or as an empty page that can be populated later. PREREQUISITES: - Parent page/database must exist and be accessible in your Notion workspace - Use search_pages or list_databases first to obtain valid parent IDs LIMITATIONS: - Cannot create root-level pages (must have a parent) - May encounter conflicts if creating pages too quickly - Title-based parent search is less reliable than using UUIDs - The markdown parameter is mutually exclusive with children/content parameters"),
        writeTool("NOTION_UPDATE_PAGE_MARKDOWN", "Update page markdown", "Apply synchronous targeted edits or replace a Notion page using Markdown."),
      ],
    },
    {
      slug: "hubspot",
      name: "HubSpot",
      description: "Look up CRM records and manage contacts, tickets, and notes in HubSpot.",
      tools: [
        readTool("HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA", "Search contacts by criteria", "Searches for HubSpot contacts using a text query, specific filter criteria (filters in a group are ANDed, groups are ORed), sorting, and pagination to retrieve selected properties."),
        readTool("HUBSPOT_READ_CONTACT", "Read contact", "Retrieves a HubSpot contact by its ID."),
        readTool("HUBSPOT_GET_TICKETS", "Get tickets", "Retrieves multiple HubSpot tickets by their IDs."),
        readTool("HUBSPOT_SEARCH_TICKETS", "Search tickets", "Searches for HubSpot tickets using flexible criteria and filters."),
        writeTool("HUBSPOT_CREATE_CONTACT", "Create contact", "Creates a new HubSpot contact."),
        writeTool("HUBSPOT_CREATE_TICKET", "Create ticket", "Creates a new HubSpot ticket."),
        writeTool("HUBSPOT_UPDATE_TICKET", "Update ticket", "Updates properties for an existing HubSpot ticket."),
        writeTool("HUBSPOT_CREATE_NOTE", "Create note", "Creates a new HubSpot CRM note. Use when you need to add a timestamped note with optional attachments and associations to contacts, companies, deals, or tickets."),
      ],
    },
  ];

  export function getCatalogToolkit(slug: string): CatalogToolkit | undefined {
    return INTEGRATION_CATALOG.find((toolkit) => toolkit.slug === slug.toLowerCase());
  }

  export function getCatalogTool(toolkitSlug: string, toolSlug: string): CatalogTool | undefined {
    return getCatalogToolkit(toolkitSlug)?.tools.find((tool) => tool.slug === toolSlug);
  }
