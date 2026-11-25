export interface ConversationParticipant {
  _id: string;
  name: string;
  email: string;
  avatar?: string;
}

export interface ConversationVisitor {
  sessionId?: string;
  name: string;
  email: string;
  isAnonymous: boolean;
  phone?: string;
}

export interface ConversationMessage {
  _id: string;
  senderId: string;
  content: string;
  type: string;
  metadata: {
    senderName: string;
    senderEmail: string;
    source: string;
  };
  createdAt: string;
}

export interface ConversationThread {
  category: "support" | "discussion" | "feature";
  public: boolean;
}

export interface ConversationListItem {
  _id: string;
  participants: ConversationParticipant[];
  subject: string;
  lastMessage?: {
    content: string;
    createdAt: string;
    senderId: {
      name: string;
    };
    metadata?: {
      source?: string;
      senderName?: string;
    };
  };
  status: "open" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  tags: string[];
  sessionId: string;
  metadata?: {
    source?: string;
    thread?: ConversationThread;
    customer?: {
      name?: string;
      email?: string;
      phone?: string;
      company?: string;
      initialMessage?: string;
      startedAt?: string;
    };
    customerName?: string;
    senderName?: string;
    senderEmail?: string;
    visitorPhone?: string;
    escalatedAt?: string;
    escalationReason?: string;
    pendingEscalation?: boolean;
  };
  assignedTo?: { _id: string; name: string; email: string };
  unreadCount: number;
  channel?: string;
  createdAt: string;
  lastMessageAt?: string;
}

export interface ConversationDetail {
  _id: string;
  subject: string;
  status: string;
  priority: string;
  sessionId: string;
  channel?: string;
  assignedTo?: { _id: string; name: string; email: string };
  tags?: string[];
  metadata: {
    thread?: ConversationThread;
    customer?: {
      name?: string;
      email?: string;
      phone?: string;
      company?: string;
    };
    customerName?: string;
    senderName?: string;
    senderEmail?: string;
    visitorPhone?: string;
    source?: string;
  };
  createdAt: string;
  updatedAt?: string;
}



export interface AgentOption {
  _id: string;
  name: string;
  email: string;
}


export interface ConversationsResponse {
  success: boolean;
  data: {
    conversations: ConversationListItem[];
  };
}

export interface ConversationDetailResponse {
  success: boolean;
  data: {
    conversation: ConversationDetail;
    messages: ConversationMessage[];
  };
}

export interface StatusResponse {
  success: boolean;
  data: {
    conversation: ConversationDetail;
  };
}

export interface VisitorUpdateResponse {
  success: boolean;
  data: {
    name?: string;
    email?: string;
    isAnonymous: boolean;
  };
}

export interface RouteResponse {
  success: boolean;
  data: {
    conversationId: string;
    assignedTo?: string;
    agentName?: string;
  };
}

export interface Template {
  _id: string;
  organizationId: string;
  title: string;
  content: string;
  shortcut?: string;
  category?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateInput {
  title: string;
  content: string;
  shortcut?: string;
  category?: string;
}

