import { parseMarkdown } from "./utils/markdown";
import { PROTO_VERSION, state } from "./config";
import { INTERAONE_LOGO_SVG } from "../shared/assets";
export { INTERAONE_LOGO_SVG };

// ── Pegtop 3D loader ─────────────────────────────────────────────────────────

const PEGTOP_SVG_PATH = `M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z`;

function pegtopSvg(id: string, delay?: string) {
  const style = delay ? ` style="animation-delay:${delay}"` : "";
  return `
    <svg id="${id}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"${style}>
      ${
        id === "pegtopone"
          ? `
      <defs>
        <filter id="shine-ldr"><feGaussianBlur stdDeviation="3"></feGaussianBlur></filter>
        <mask id="mask-ldr">
          <path d="${PEGTOP_SVG_PATH}" fill="white"></path>
        </mask>
        <radialGradient id="grad-ldr-1" cx="50" cy="66" fx="50" fy="66" r="30" gradientTransform="translate(0 35) scale(1 0.5)" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="black" stop-opacity="0.3"></stop>
          <stop offset="50%" stop-color="black" stop-opacity="0.1"></stop>
          <stop offset="100%" stop-color="black" stop-opacity="0"></stop>
        </radialGradient>
        <radialGradient id="grad-ldr-2" cx="55" cy="20" fx="55" fy="20" r="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="white" stop-opacity="0.3"></stop>
          <stop offset="50%" stop-color="white" stop-opacity="0.1"></stop>
          <stop offset="100%" stop-color="white" stop-opacity="0"></stop>
        </radialGradient>
      </defs>
      <g>
        <path d="${PEGTOP_SVG_PATH}" fill="currentColor"></path>
        <path d="${PEGTOP_SVG_PATH}" fill="url(#grad-ldr-1)"></path>
        <path d="${PEGTOP_SVG_PATH}" fill="none" stroke="white" opacity="0.3" stroke-width="3" filter="url(#shine-ldr)" mask="url(#mask-ldr)"></path>
        <path d="${PEGTOP_SVG_PATH}" fill="url(#grad-ldr-2)"></path>
      </g>`
          : `<g>
        <path d="${PEGTOP_SVG_PATH}" fill="currentColor"></path>
        <path d="${PEGTOP_SVG_PATH}" fill="url(#grad-ldr-1)"></path>
        <path d="${PEGTOP_SVG_PATH}" fill="url(#grad-ldr-2)"></path>
      </g>`
      }
    </svg>`;
}

export function PegtopLoader(): string {
  return `
    <div class="pegtop-loader">
      ${pegtopSvg("pegtopone")}
      ${pegtopSvg("pegtoptwo", "0.3s")}
      ${pegtopSvg("pegtopthree", "0.6s")}
    </div>
  `;
}

// ── Tool call collapsible card ────────────────────────────────────────────────

export function createToolStepsPanel(): HTMLElement {
  const block = document.createElement("div");
  block.className = "tool-call-block";

  const card = document.createElement("div");
  card.className = "tool-call-card";

  const header = document.createElement("div");
  header.className = "tool-call-header";
  header.innerHTML = `
    <span class="tool-call-header-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="16.5 9.4 7.5 4.21 7.5 14.79 16.5 9.4"></polyline>
      </svg>
    </span>
    <span class="tool-call-title">Executing...</span>
    <span class="tool-call-chevron">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </span>
  `;

  const body = document.createElement("div");
  body.className = "tool-call-body";

  const timeline = document.createElement("div");
  timeline.className = "tool-steps-timeline";
  timeline.style.padding = "10px 12px";

  body.appendChild(timeline);
  card.appendChild(header);
  card.appendChild(body);
  block.appendChild(card);

  header.addEventListener("click", () => card.classList.toggle("is-collapsed"));
  (block as any)._timeline = timeline;

  return block;
}

export function addToolStep(panel: HTMLElement, label: string): HTMLElement {
  const timeline =
    ((panel as any)._timeline as HTMLElement) ||
    (panel.querySelector(".tool-steps-timeline") as HTMLElement);

  const step = document.createElement("div");
  step.className = "tool-step is-loading";
  step.innerHTML = `
    <div class="tool-step-icon">
      <div class="tool-step-spinner"></div>
      <svg class="tool-step-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <div class="tool-step-content">
      <div class="tool-step-label">${escapeHtml(label)}</div>
    </div>
  `;
  timeline.appendChild(step);
  scrollToBottom();
  return step;
}

export function completeToolStep(
  step: HTMLElement,
  detail?: string,
  failed = false,
) {
  step.classList.remove("is-loading");
  step.classList.add(failed ? "is-failed" : "is-done");

  if (detail) {
    const content = step.querySelector(".tool-step-content") as HTMLElement;
    const detailEl = document.createElement("div");
    detailEl.className = "tool-step-detail";
    detailEl.textContent = detail;
    content.appendChild(detailEl);
  }

  scrollToBottom();
}

export function removeToolStepsPanel() {
  const blocks =
    elements.messagesContainer?.querySelectorAll(".tool-call-block");
  blocks?.forEach((block) => block.remove());
  state._toolStepsEl = null;
}

// ── DOM element references ────────────────────────────────────────────────────

export const elements = {
  appRoot: document.getElementById("app"),
  welcomeScreen: document.getElementById("welcomeScreen"),
  greetingTitle: document.getElementById("vx-greeting"),
  greetingSubtext: document.getElementById("vx-subtext"),
  brandAvatar: document.getElementById("vx-avatar"),
  suggestionsContainer: document.getElementById("suggestions"),
  messagesContainer: document.getElementById("messagesContainer"),
  messageInput: document.getElementById("messageInput") as HTMLTextAreaElement,
  sendBtn: document.getElementById("sendBtn") as HTMLButtonElement,
  typingIndicator: document.getElementById("typingIndicator"),
  historyBtn: document.getElementById("historyBtn"),
  historyOverlay: document.getElementById("historyOverlay"),
  closeHistoryBtn: document.getElementById("closeHistoryBtn"),
  historyList: document.getElementById("historyList"),
  historySearch: document.getElementById(
    "historySearch",
  ) as HTMLInputElement | null,
  maximizeBtn: document.getElementById("vx-maximize"),
  minimizeBtn: document.getElementById("vx-minimize"),
  newChatBtn: document.getElementById("newChatBtn") as HTMLButtonElement | null,
  tabChat: document.getElementById("tabChat") as HTMLButtonElement | null,
  tabHistory: document.getElementById("tabHistory") as HTMLButtonElement | null,
};

// ── Typing / loading indicators ───────────────────────────────────────────────

let _typingDotsEl: HTMLElement | null = null;
let _agentTypingEl: HTMLElement | null = null;
let _openSkeletonTimer: number | null = null;

export function showTypingDots(_context?: string) {
  if (_typingDotsEl) return;
  const wrapper = document.createElement("div");
  wrapper.className = "loader-wrapper";
  if (state._escalationShown) {
    wrapper.innerHTML = `
      <div class="three-dots-loader" aria-label="Agent is typing">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `;
  } else {
    wrapper.innerHTML = PegtopLoader();
  }
  _typingDotsEl = wrapper;
  elements.messagesContainer?.appendChild(wrapper);
  scrollToBottom();
}

export function removeTypingDots() {
  if (_typingDotsEl) {
    _typingDotsEl.remove();
    _typingDotsEl = null;
  }
}

export function showTyping() {
  if (_agentTypingEl) return;
  const wrapper = document.createElement("div");
  wrapper.className = "loader-wrapper";
  if (state._escalationShown) {
    wrapper.innerHTML = `
      <div class="three-dots-loader" aria-label="Agent is typing">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `;
  } else {
    wrapper.innerHTML = PegtopLoader();
  }
  _agentTypingEl = wrapper;
  elements.messagesContainer?.appendChild(wrapper);
  scrollToBottom();
}

export function hideTyping() {
  if (_agentTypingEl) {
    _agentTypingEl.remove();
    _agentTypingEl = null;
  }
}

export function showOpenSkeleton(durationMs = 1000) {
  const root = elements.appRoot as HTMLElement | null;
  if (!root) return;
  root.classList.add("is-skeleton");
  if (_openSkeletonTimer) window.clearTimeout(_openSkeletonTimer);
  _openSkeletonTimer = window.setTimeout(
    () => {
      root.classList.remove("is-skeleton");
      _openSkeletonTimer = null;
    },
    Math.max(200, durationMs),
  );
}

// ── UI helpers ────────────────────────────────────────────────────────────────

export function getInitials(name: string): string {
  if (!name) return "A";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function showAgentConnectedCard(name: string) {
  if (!elements.messagesContainer || state._joinCardShown) return;
  state._joinCardShown = true;
  const initial = getInitials(name);
  const card = document.createElement("div");
  card.className = "agent-join-card";
  card.innerHTML = `
    <div class="agent-join-avatar">${initial}</div>
    <div class="agent-join-info">
      <span class="agent-join-name">${escapeHtml(name)} joined the conversation</span>
      <span class="agent-join-role"><span class="agent-join-dot"></span>Live Support</span>
    </div>
  `;
  elements.messagesContainer.appendChild(card);
  scrollToBottom();
}

export function adjustTextareaHeight() {
  if (!elements.messageInput) return;
  elements.messageInput.style.height = "100%";
  elements.messageInput.style.maxHeight = "100%";
}

function reportConversationState(started: boolean) {
  if (!window.parent) return;
  window.parent.postMessage(
    {
      type: "CONVERSATION_STATE",
      version: PROTO_VERSION,
      payload: { started },
    },
    state.parentOrigin || "*",
  );
}

export function showWelcomeScreen() {
  document.documentElement.classList.add("is-new-chat");
  document.body.classList.add("is-new-chat");
  if (elements.welcomeScreen) elements.welcomeScreen.style.display = "flex";
  if (elements.suggestionsContainer)
    elements.suggestionsContainer.style.display = "";
  if (elements.messagesContainer)
    elements.messagesContainer.style.display = "none";
  reportConversationState(false);
}

export function hideWelcomeScreen() {
  document.documentElement.classList.remove("is-new-chat");
  document.body.classList.remove("is-new-chat");
  if (elements.welcomeScreen) elements.welcomeScreen.style.display = "none";
  if (elements.suggestionsContainer)
    elements.suggestionsContainer.style.display = "none";
  if (elements.messagesContainer)
    elements.messagesContainer.style.display = "flex";
  reportConversationState(true);
}

let _scrollFrameId: number | null = null;
let _scrollSettleTimer: number | null = null;

function setMessagesContainerToBottom() {
  const container = elements.messagesContainer;
  if (!container) return;

  const previousScrollBehavior = container.style.scrollBehavior;
  container.style.scrollBehavior = "auto";
  container.scrollTop = container.scrollHeight;
  container.style.scrollBehavior = previousScrollBehavior;
}

export function scrollToBottom() {
  if (!elements.messagesContainer) return;

  if (_scrollFrameId != null) {
    cancelAnimationFrame(_scrollFrameId);
  }
  if (_scrollSettleTimer != null) {
    window.clearTimeout(_scrollSettleTimer);
    _scrollSettleTimer = null;
  }

  _scrollFrameId = requestAnimationFrame(() => {
    _scrollFrameId = null;
    setMessagesContainerToBottom();

    requestAnimationFrame(() => {
      setMessagesContainerToBottom();
    });

    _scrollSettleTimer = window.setTimeout(() => {
      _scrollSettleTimer = null;
      setMessagesContainerToBottom();
    }, 80);
  });
}

export function renderMaximizeIcon() {
  if (!elements.maximizeBtn) return;
  if (state._isMaximized) {
    elements.maximizeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 14 10 14 10 20"></polyline>
        <polyline points="20 10 14 10 14 4"></polyline>
        <line x1="10" y1="14" x2="3" y2="21"></line>
        <line x1="21" y1="3" x2="14" y2="10"></line>
      </svg>
    `;
    elements.maximizeBtn.title = "Restore";
  } else {
    elements.maximizeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 3 21 3 21 9"></polyline>
        <polyline points="9 21 3 21 3 15"></polyline>
        <line x1="21" y1="3" x2="14" y2="10"></line>
        <line x1="3" y1="21" x2="10" y2="14"></line>
      </svg>
    `;
    elements.maximizeBtn.title = "Maximize";
  }
}

export function addSystemNotice(text: string) {
  const el = document.createElement("div");
  el.className = "system-notice";
  const plain = text.replace(/\*\*(.+?)\*\*/g, "$1");
  el.innerHTML =
    "<span>" + plain.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</span>";
  elements.messagesContainer?.appendChild(el);
  scrollToBottom();
}

export function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderAgentResponseIcon(senderName?: string) {
  const isHuman =
    state._escalationShown || (senderName && senderName !== "AI Assistant");
  if (isHuman && senderName) {
    if (senderName === "Support Team") {
      return `
        <div class="human-agent-avatar" aria-hidden="true" style="background: var(--vx-accent, #845C6C); color: #ffffff;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display: block;">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
          </svg>
        </div>
      `;
    }
    const initial = getInitials(senderName);
    return `
      <div class="human-agent-avatar" aria-hidden="true">
        ${initial}
      </div>
    `;
  }
  return `
    <div class="agent-response-icon" aria-hidden="true">
      ${INTERAONE_LOGO_SVG}
    </div>
  `;
}

export function addMessage(
  text: string,
  type: "user" | "agent",
  senderName: string,
  msgType: string = "text",
) {
  if (!elements.messagesContainer) return;
  hideWelcomeScreen();
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${type}`;
  if (msgType === "file-uploading")
    messageDiv.classList.add("upload-placeholder");

  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  let bodyHtml: string;
  if (
    msgType === "file" ||
    msgType === "file-uploading" ||
    msgType === "image"
  ) {
    bodyHtml = escapeHtml(text);
  } else if (type === "agent") {
    bodyHtml =
      '<div class="md">' +
      parseMarkdown(text) +
      '</div><div class="message-time">' +
      time +
      "</div>";
  } else {
    bodyHtml =
      escapeHtml(text) + '<div class="message-time">' + time + "</div>";
  }

  messageDiv.innerHTML =
    (type === "agent" ? renderAgentResponseIcon(senderName) : "") +
    '<div class="message-bubble">' +
    bodyHtml +
    "</div>";
  elements.messagesContainer.appendChild(messageDiv);
  scrollToBottom();
}

export function typeMessage(text: string, senderName?: string) {
  removeTypingDots();
  if (!elements.messagesContainer) return;
  hideWelcomeScreen();

  const messageDiv = document.createElement("div");
  messageDiv.className = "message agent";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  bubble.innerHTML =
    '<div class="md">' +
    parseMarkdown(text) +
    '</div><div class="message-time">' +
    time +
    "</div>";
  messageDiv.innerHTML = renderAgentResponseIcon(senderName);
  messageDiv.appendChild(bubble);
  elements.messagesContainer.appendChild(messageDiv);
  scrollToBottom();
}

export function formatHistoryDateTime(
  value: string | number | Date | undefined,
): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
