import { io } from "socket.io-client";
import { state, API_BASE_URL, type StreamingMessage } from "./config";
import {
  elements,
  addMessage,
  addSystemNotice,
  typeMessage,
  removeTypingDots,
  scrollToBottom,
  showTyping,
  hideTyping,
  showAgentConnectedCard,
  renderAgentResponseIcon,
  createToolStepsPanel,
  addToolStep,
  completeToolStep,
  removeToolStepsPanel,
  showWelcomeScreen,
} from "./ui";
import {
  parseMarkdown,
  parseStreamingMarkdown,
  scanStreamingMarkdownBlocks,
  renderMarkdownBlock,
} from "./utils/markdown";
import { showOutcomeOverlay } from "./events";

let authRetryCount = 0;
const MAX_AUTH_RETRIES = 3;

type ConversationVisualState =
  | "human"
  | "closed"
  | "pending"
  | "open"
  | "resolved";

export function setAiResponding(responding: boolean) {
  state._aiResponding = responding;
  const inputArea = document.querySelector(".input-area") as HTMLElement | null;
  if (inputArea) inputArea.classList.toggle("is-disabled", responding);
  if (elements.messageInput) {
    elements.messageInput.disabled = responding;
    if (responding) {
      elements.messageInput.placeholder = "AI is responding...";
    } else {
      elements.messageInput.placeholder = "Type your message...";
    }
  }
  if (elements.sendBtn) {
    elements.sendBtn.classList.toggle("is-processing", responding);
    elements.sendBtn.setAttribute("aria-busy", responding ? "true" : "false");
    elements.sendBtn.disabled =
      responding || !elements.messageInput?.value.trim();
  }
}

function getStateBanner(): HTMLElement | null {
  return document.getElementById("conversationStateBanner");
}

function resetStreamState() {
  state._streamBubbleEl = null;
  state._streamMessageId = null;
  setAiResponding(false);
}

// Track the current tool step element so we can complete it
let _currentToolStepEl: HTMLElement | null = null;

function releaseToolSteps() {
  const panels =
    elements.messagesContainer?.querySelectorAll<HTMLElement>(
      ".tool-call-block",
    );
  const targets =
    panels && panels.length > 0
      ? Array.from(panels)
      : state._toolStepsEl
        ? [state._toolStepsEl]
        : [];

  targets.forEach((panel) => {
    const title = panel.querySelector(".tool-call-title");
    if (title) title.textContent = "Steps completed";

    // Complete any step that might still be marked as loading
    const activeSteps = panel.querySelectorAll(".tool-step.is-loading");
    activeSteps.forEach((step) => {
      step.classList.remove("is-loading");
      step.classList.add("is-done");
    });
  });

  state._toolStepsEl = null;
  _currentToolStepEl = null;
}

function findLatestToolStepsPanel(messageId: string): HTMLElement | null {
  const panels =
    elements.messagesContainer?.querySelectorAll<HTMLElement>(
      ".tool-call-block",
    );
  return (
    Array.from(panels || [])
      .reverse()
      .find((panel) => panel.dataset.streamMessageId === messageId) || null
  );
}

function markToolPanelCompleted(panel: HTMLElement) {
  if (panel.querySelector(".tool-step.is-loading")) return;

  const title = panel.querySelector(".tool-call-title");
  if (title) title.textContent = "Steps completed";
}

function getResponseFlow(messageElement: HTMLElement): HTMLElement | null {
  const bubble = messageElement.querySelector<HTMLElement>(".message-bubble");
  if (!bubble) return null;

  let flow = bubble.querySelector<HTMLElement>(".response-flow");
  if (!flow) {
    flow = document.createElement("div");
    flow.className = "response-flow";
    const time = bubble.querySelector<HTMLElement>(".message-time");
    if (time) {
      bubble.insertBefore(flow, time);
    } else {
      bubble.appendChild(flow);
    }
  }

  return flow;
}

type StreamTextSegment = NonNullable<StreamingMessage["textSegments"]>[number];

function reconcileDOM(segment: StreamTextSegment) {
  const blocks = scanStreamingMarkdownBlocks(segment.content);
  segment.renderedBlocks ||= [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockHtml = renderMarkdownBlock(block);
    const existing = segment.renderedBlocks[i];

    if (!existing) {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = blockHtml;
      const el =
        (tempDiv.firstElementChild as HTMLElement) ||
        document.createElement("div");
      if (blockHtml === "") {
        el.style.display = "none";
      }
      segment.element.appendChild(el);
      segment.renderedBlocks.push({ blockHtml, element: el });
    } else {
      if (existing.blockHtml !== blockHtml) {
        if (blockHtml === "") {
          existing.element.style.display = "none";
        } else {
          existing.element.style.display = "";
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = blockHtml;
          const newEl = tempDiv.firstElementChild as HTMLElement;
          if (newEl) {
            if (existing.element.tagName !== newEl.tagName) {
              segment.element.replaceChild(newEl, existing.element);
              existing.element = newEl;
            } else {
              existing.element.innerHTML = newEl.innerHTML;
            }
          }
        }
        existing.blockHtml = blockHtml;
      }
    }
  }

  while (segment.renderedBlocks.length > blocks.length) {
    const extra = segment.renderedBlocks.pop();
    if (extra && extra.element.isConnected) {
      segment.element.removeChild(extra.element);
    }
  }
}

function addResponseTextSegment(
  stream: StreamingMessage,
): StreamTextSegment | null {
  const flow = getResponseFlow(stream.element);
  if (!flow) return null;

  const element = document.createElement("div");
  element.className = "response-content md";
  flow.appendChild(element);

  const segment: StreamTextSegment = { element, content: "" };
  stream.textSegments ||= [];
  stream.textSegments.push(segment);
  stream.currentTextSegment = segment;
  return segment;
}

function scheduleStreamSegmentRender(
  stream: StreamingMessage,
  segment: StreamTextSegment,
) {
  const dirtySegments = (stream.dirtyTextSegments ||= []);
  if (!dirtySegments.includes(segment)) {
    dirtySegments.push(segment);
  }

  if (stream.renderFrameId != null) return;

  stream.renderFrameId = requestAnimationFrame(() => {
    stream.renderFrameId = null;
    const segmentsToRender = stream.dirtyTextSegments?.splice(0) || [];
    segmentsToRender.forEach((dirtySegment) => {
      if (!dirtySegment.element.isConnected) return;
      reconcileDOM(dirtySegment);
    });
    scrollToBottom();
  });
}

function cancelScheduledStreamRender(stream: StreamingMessage) {
  if (stream.renderFrameId != null) {
    cancelAnimationFrame(stream.renderFrameId);
    stream.renderFrameId = null;
  }
  if (stream.dirtyTextSegments) {
    stream.dirtyTextSegments.length = 0;
  }
}

function appendStreamChunk(
  stream: StreamingMessage,
  chunk: string,
  renderImmediately = false,
) {
  let segment = stream.currentTextSegment;
  if (!segment || !segment.element.isConnected) {
    segment = addResponseTextSegment(stream);
  }
  if (!segment) return;

  segment.content += chunk;
  if (renderImmediately) {
    reconcileDOM(segment);
  } else {
    scheduleStreamSegmentRender(stream, segment);
  }
  if (stream.currentToolPanel && chunk.trim().length > 0) {
    stream.hasTextAfterToolPanel = true;
  }
}

function renderFinalStreamContent(
  stream: StreamingMessage,
  finalContent: string,
) {
  cancelScheduledStreamRender(stream);
  const segments = stream.textSegments || [];

  if (!stream.hasToolSteps) {
    let segment: StreamTextSegment | undefined = segments[0];
    if (!segment) {
      segment = addResponseTextSegment(stream) || undefined;
    }
    if (segment) {
      segment.content = finalContent;
      segment.element.innerHTML = parseMarkdown(finalContent);
    }
    return;
  }

  if (finalContent && finalContent !== stream.content) {
    if (finalContent.startsWith(stream.content)) {
      const suffix = finalContent.slice(stream.content.length);
      if (suffix) appendStreamChunk(stream, suffix, true);
    } else if (stream.content.endsWith(finalContent)) {
      // The final saved message is the last streamed section; keep earlier
      // streamed sections around their tool panels and only finalize parsing.
    } else if (segments.length === 1) {
      segments[0].content = finalContent;
    } else {
      const segment = segments.at(-1) || addResponseTextSegment(stream);
      if (segment) {
        segment.content = finalContent;
      }
    }
  }

  (stream.textSegments || []).forEach((segment) => {
    segment.element.innerHTML = parseMarkdown(segment.content);
  });
}

function placeToolStepsInResponse(panel: HTMLElement, messageId: string) {
  const container = elements.messagesContainer;
  if (!container) return;

  const agentMessages = Array.from(
    container.querySelectorAll<HTMLElement>(".message.agent"),
  );
  const response =
    state._streamBubbleEl ||
    agentMessages.find((message) => message.dataset.messageId === messageId) ||
    container.querySelector<HTMLElement>(
      '.message.agent[data-status="streaming"]',
    ) ||
    (state._completedStreamMessageIds.has(messageId)
      ? agentMessages.at(-1) || null
      : null);

  const flow = response ? getResponseFlow(response) : null;
  if (flow) {
    if (panel.parentElement !== flow) {
      flow.appendChild(panel);
    }
  } else if (panel.parentElement !== container) {
    container.appendChild(panel);
  }
}

function createToolPanelForStream(stream: StreamingMessage, messageId: string) {
  const panel = createToolStepsPanel();
  panel.dataset.streamMessageId = messageId;
  (panel as any)._activeSteps = [];
  stream.currentToolPanel = panel;
  stream.hasTextAfterToolPanel = false;
  placeToolStepsInResponse(panel, messageId);
  return panel;
}

function createStreamingMessage(messageId: string): StreamingMessage {
  const element = document.createElement("div");
  element.className = "message agent";
  element.dataset.messageId = messageId;
  element.dataset.status = "streaming";
  element.innerHTML = `
    ${renderAgentResponseIcon()}
    <div class="message-bubble" style="min-width: 250px;">
      <div class="response-flow"></div>
      <div class="message-time"></div>
    </div>`;

  const stream: StreamingMessage = {
    content: "",
    element,
    lastSequence: 0,
    status: "streaming" as const,
    textSegments: [],
    currentTextSegment: null,
    dirtyTextSegments: [],
    renderFrameId: null,
    hasToolSteps: false,
    currentToolPanel: null,
    hasTextAfterToolPanel: false,
  };
  state._streamMessages.set(messageId, stream);
  state._streamMessageId = messageId;
  state._streamBubbleEl = element;
  elements.messagesContainer?.appendChild(element);
  return stream;
}

function removeStateBanner() {
  const banner = getStateBanner();
  if (banner) banner.remove();
}

function getBannerIcon(stateType: ConversationVisualState): string {
  switch (stateType) {
    case "human":
      return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
    case "pending":
      return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
    case "resolved":
      return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    case "closed":
      return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
    default:
      return "";
  }
}

function showStateBanner(
  stateType: ConversationVisualState,
  title: string,
  subtitle?: string,
) {
  const app = document.getElementById("app");
  const topbar = document.querySelector(".widget-topbar");
  if (!app || !topbar) return;

  let banner = getStateBanner();
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "conversationStateBanner";
    banner.className = "conversation-state-banner";
    topbar.insertAdjacentElement("afterend", banner);
  }

  banner.className = `conversation-state-banner state-${stateType}`;
  const iconHtml = getBannerIcon(stateType);

  banner.innerHTML = `
    <div class="state-banner-inner" style="display: flex; gap: 12px; align-items: flex-start;">
      ${iconHtml ? `<div class="state-icon-wrapper" style="flex-shrink: 0; margin-top: 1px;">${iconHtml}</div>` : ""}
      <div class="state-content" style="flex-grow: 1; text-align: left;">
        <div class="state-main" style="display: flex; align-items: center; gap: 8px;">
          <span class="state-title">${title}</span>
        </div>
        ${subtitle ? `<div class="state-subtitle">${subtitle}</div>` : ""}
      </div>
    </div>
  `;
}

function setComposerEnabled(enabled: boolean, placeholder?: string) {
  const inputArea = document.querySelector(".input-area") as HTMLElement | null;
  if (inputArea) inputArea.classList.toggle("is-disabled", !enabled);

  if (elements.messageInput) {
    elements.messageInput.disabled = !enabled;
    if (placeholder) elements.messageInput.placeholder = placeholder;
  }

  if (elements.sendBtn) {
    elements.sendBtn.classList.remove("is-processing");
    elements.sendBtn.setAttribute("aria-busy", "false");
    if (!enabled) {
      elements.sendBtn.disabled = true;
    } else {
      elements.sendBtn.disabled = !elements.messageInput?.value.trim();
    }
  }
}

function clearOutcomePanel() {
  const panel = document.getElementById("conv-closed-banner");
  if (panel) panel.remove();
}

function resetConversationToNew() {
  clearOutcomePanel();
  removeStateBanner();
  state.chatId = null;
  state.isConnected = false;
  state._escalationShown = false;
  resetStreamState();
  state._streamMessages.clear();
  state._completedStreamMessageIds.clear();

  if (elements.messagesContainer) {
    elements.messagesContainer.innerHTML = "";
  }
  showWelcomeScreen();

  setComposerEnabled(true, "Type your message...");
  if (elements.messageInput) {
    elements.messageInput.value = "";
    elements.messageInput.focus();
  }
}

function showOutcomePanel() {
  clearOutcomePanel();
  const messagesContainer = elements.messagesContainer;
  if (!messagesContainer) return;

  const panel = document.createElement("div");
  panel.className = "conv-outcome-panel closed";
  panel.id = "conv-closed-banner";
  panel.innerHTML = `
    <div class="outcome-icon">🔒</div>
    <div class="outcome-content">
      <div class="outcome-title">Conversation closed</div>
      <div class="outcome-sub">You can start a fresh chat anytime if you need more help.</div>
    </div>
    <button class="outcome-cta" id="bannerNewChatBtn">Start new chat</button>
  `;

  messagesContainer.appendChild(panel);
  scrollToBottom();

  document
    .getElementById("bannerNewChatBtn")
    ?.addEventListener("click", resetConversationToNew, { once: true });
}

export function initializeSocket() {
  if (!state.widgetToken) {
    console.error("Missing widget token, cannot connect");
    return;
  }

  state.socket = io(API_BASE_URL, {
    auth: { token: state.widgetToken, origin: state.parentOrigin },
    transports: ["websocket", "polling"],
  });

  state.socket.on("connect_error", (err: any) => {
    console.error("Socket connection error:", err.message);
    if (
      err.message.includes("Authentication error") &&
      state.InteraOnePublicKey
    ) {
      if (authRetryCount >= MAX_AUTH_RETRIES) {
        console.error(
          "Socket: Max auth retries reached. Stopping reconnection loop.",
        );
        return;
      }
      authRetryCount++;
      const backoffDelay = Math.min(
        1000 * Math.pow(2, authRetryCount - 1),
        8000,
      );

      setTimeout(() => {
        fetch(`${API_BASE_URL}/api/v1/widget/auth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            InteraOnePublicKey: state.InteraOnePublicKey,
            origin: state.parentOrigin,
          }),
        })
          .then((response) => response.json())
          .then((data) => {
            if (data.success && data.data.token) {
              state.widgetToken = data.data.token;
              state.socket?.disconnect();
              setTimeout(() => {
                state.socket = io(API_BASE_URL, {
                  auth: {
                    token: state.widgetToken,
                    origin: state.parentOrigin,
                  },
                  transports: ["websocket", "polling"],
                });
                bindSocketEvents();
              }, 1000);
            }
          })
          .catch(() => {});
      }, backoffDelay);
    }
  });

  bindSocketEvents();
}

function bindSocketEvents() {
  if (!state.socket) return;
  const socket = state.socket;

  socket.off("connect");
  socket.on("connect", () => {
    authRetryCount = 0;
    console.log("Socket connected for widget user with ID:", socket.id);
    if (state.chatId) {
      socket.emit("join_conversation", state.chatId);
    }
  });

  socket.off("disconnect");
  socket.on("disconnect", () => {
    console.log("Socket disconnected");
  });

  socket.off("new_message");
  socket.on("new_message", (data: any) => {
    if (data.conversationId !== state.chatId) return;
    if (data.message?.metadata?.source === "widget") return;
    const finalStreamMessageId = data.streamMessageId
      ? String(data.streamMessageId)
      : null;
    if (finalStreamMessageId) {
      state._completedStreamMessageIds.add(finalStreamMessageId);
    }

    // Ensure human connection card is shown before any human message is rendered
    const isHumanMsg =
      data.message?.metadata?.source === "web" ||
      data.message?.metadata?.source === "agent";
    if (isHumanMsg && !state._joinCardShown) {
      state._escalationShown = true;
      const name = data.message?.metadata?.senderName || "Support Agent";
      showStateBanner(
        "human",
        "Live human support connected",
        `You are now chatting with ${name}`,
      );
      showAgentConnectedCard(name);
      removeToolStepsPanel();
    }

    try {
      // Preserve the execution history, then release it for the next response.
      releaseToolSteps();

      if (data.message?.metadata?.source === "system") {
        removeTypingDots();
        hideTyping();
        addSystemNotice(data.message.content);
        return;
      }

      if (data.message?.type === "file" || data.message?.type === "image") {
        removeTypingDots();
        hideTyping();
        addMessage(data.message.content, "agent", "Support Agent", "file");
        return;
      }

      if (state._streamBubbleEl) {
        const streamId = finalStreamMessageId || state._streamMessageId;
        const stream = streamId
          ? state._streamMessages.get(streamId)
          : undefined;
        if (stream) {
          renderFinalStreamContent(stream, data.message.content);
        } else {
          const responseContent =
            state._streamBubbleEl.querySelector(".response-content");
          if (responseContent)
            responseContent.innerHTML = parseMarkdown(data.message.content);
        }
        state._streamBubbleEl.dataset.status = "completed";
        if (stream && streamId) {
          stream.content = data.message.content;
          stream.status = "completed";
          state._completedStreamMessageIds.add(streamId);
          state._streamMessages.delete(streamId);
        }

        removeTypingDots();
        hideTyping();
        resetStreamState();
      } else {
        removeTypingDots();
        hideTyping();
        typeMessage(data.message.content, data.message.metadata?.senderName);
      }
    } finally {
      // new_message is the completion signal for both streamed and regular replies.
      setAiResponding(false);
    }
  });

  socket.off("ai_stream_chunk");
  socket.on("ai_stream_chunk", (data: any) => {
    if (data.conversationId !== state.chatId) return;
    const streamMessageId = String(
      data.messageId || `conversation:${data.conversationId}`,
    );

    // ── Handle tool events ────────────────────────────────────────────────
    if (data.toolEvent) {
      const ev = data.toolEvent;
      let stream = state._streamMessages.get(streamMessageId);

      if (!stream && !state._completedStreamMessageIds.has(streamMessageId)) {
        removeTypingDots();
        hideTyping();
        setAiResponding(true);
        stream = createStreamingMessage(streamMessageId);
      }

      let panel =
        stream?.currentToolPanel || findLatestToolStepsPanel(streamMessageId);
      const shouldStartNewToolPanel =
        ev.type === "start" && (!panel || !!stream?.hasTextAfterToolPanel);

      if (stream && shouldStartNewToolPanel) {
        panel = createToolPanelForStream(stream, streamMessageId);
      } else if (!panel) {
        panel = createToolStepsPanel();
        panel.dataset.streamMessageId = streamMessageId;
        (panel as any)._activeSteps = [];
        placeToolStepsInResponse(panel, streamMessageId);
      }

      if (stream) {
        stream.hasToolSteps = true;
        stream.currentToolPanel = panel;
        if (ev.type === "start") {
          stream.currentTextSegment = null;
          stream.hasTextAfterToolPanel = false;
        }
      }
      state._toolStepsEl = panel;

      const sequence = Number(data.seq);
      const lastToolSequence = Number(panel.dataset.lastSequence || 0);
      if (Number.isFinite(sequence)) {
        if (sequence <= lastToolSequence) return;
        panel.dataset.lastSequence = String(sequence);
      }

      if (ev.type === "start") {
        const step = addToolStep(panel, ev.label);
        const activeSteps = ((panel as any)._activeSteps ||=
          []) as HTMLElement[];
        activeSteps.push(step);
        _currentToolStepEl = step;
        scrollToBottom();
        return;
      }

      if (ev.type === "complete") {
        const activeSteps = ((panel as any)._activeSteps ||=
          []) as HTMLElement[];
        const step =
          activeSteps.shift() ||
          _currentToolStepEl ||
          panel.querySelector<HTMLElement>(".tool-step.is-loading") ||
          addToolStep(panel, ev.label);
        if (step) {
          completeToolStep(step, ev.detail, ev.status === "failed");
          markToolPanelCompleted(panel);
        }
        _currentToolStepEl = null;
        scrollToBottom();
        return;
      }

      return;
    }

    if (state._completedStreamMessageIds.has(streamMessageId)) return;

    // Empty text and thought/status events never enter the visible answer.
    if (
      data.isThought ||
      typeof data.chunk !== "string" ||
      data.chunk.length === 0
    )
      return;

    // ── Handle text streaming ─────────────────────────────────────────────
    let stream = state._streamMessages.get(streamMessageId);
    if (!stream) {
      removeTypingDots();
      hideTyping();

      setAiResponding(true);
      stream = createStreamingMessage(streamMessageId);
    }

    // Sequence numbers make replayed/retried socket events idempotent.
    const sequence = Number(data.seq);
    if (Number.isFinite(sequence)) {
      if (sequence <= stream.lastSequence) return;
      stream.lastSequence = sequence;
    }

    stream.content += data.chunk;
    appendStreamChunk(stream, data.chunk);

    const timeContainer = stream.element.querySelector(".message-time");
    if (timeContainer && !timeContainer.textContent) {
      timeContainer.textContent = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  });

  socket.off("agent_typing");
  socket.on("agent_typing", (data: any) => {
    if (data.conversationId !== state.chatId) return;
    // Don't show typing dots if we're already streaming or if AI is responding
    if (state._streamBubbleEl || state._aiResponding) return;
    showTyping();
  });

  socket.off("agent_stopped_typing");
  socket.on("agent_stopped_typing", (data: any) => {
    if (data.conversationId === state.chatId) hideTyping();
  });

  socket.off("conversation_escalated");
  socket.on("conversation_escalated", (data: any) => {
    if (data.conversationId !== state.chatId) return;
    removeTypingDots();
    hideTyping();
    setAiResponding(false);
    clearOutcomePanel();
    removeToolStepsPanel();
    setComposerEnabled(
      true,
      data.agent?.name
        ? `Reply to ${data.agent.name}...`
        : "Reply to support...",
    );
    if (data.agent?.name) {
      state._escalationShown = true;
      const name = data.agent.name;
      showStateBanner(
        "human",
        "Live human support connected",
        `You are now chatting with ${name}`,
      );
      showAgentConnectedCard(name);
    } else {
      state._escalationShown = true;
      showStateBanner("human", "Live human support connected");
      addSystemNotice(
        "👋 A support agent has joined and will assist you shortly.",
      );
    }
  });

  socket.off("message_sent");
  // Delivery acknowledgement is not response completion; keep the composer
  // locked until the assistant's final new_message event arrives.

  socket.off("status_updated");
  socket.on("status_updated", (data: any) => {
    if (data.conversationId?.toString() !== state.chatId?.toString()) return;
    const status = data.status;

    if (status === "closed") {
      addSystemNotice("🔒 This conversation has been closed");
      showStateBanner(
        "closed",
        "Conversation closed",
        "Start a new chat if you need more help",
      );
      setComposerEnabled(false, "Conversation closed. Start a new chat.");
      showOutcomeOverlay("closed");
    } else if (status === "pending") {
      showStateBanner(
        "pending",
        "Waiting for support team",
        "Your chat is in queue. We will be with you shortly.",
      );
      addSystemNotice(
        "⏳ Your query is pending review — we'll be right with you",
      );
    } else if (status === "open") {
      removeTypingDots();
      hideTyping();
      setAiResponding(false);

      // Mark as escalation active so subsequent messages do not lock the composer
      state._escalationShown = true;

      const banner = document.getElementById("conversationStateBanner");
      const wasClosedOrResolved =
        banner &&
        (banner.classList.contains("state-closed") ||
          banner.classList.contains("state-resolved"));

      clearOutcomePanel();
      // Remove overlay if present
      document.getElementById("vx-outcome-overlay")?.remove();
      const chatInputBox = document.getElementById("chatInputBox");
      if (chatInputBox) chatInputBox.style.display = "";

      showStateBanner(
        "human",
        "Connecting with support",
        "Our team will be with you shortly...",
      );
      setComposerEnabled(true, "Reply to support...");

      if (wasClosedOrResolved) {
        addSystemNotice("🔄 This conversation has been reopened");
      }
    } else if (status === "resolved") {
      addSystemNotice("✅ This conversation has been resolved");
      showStateBanner(
        "resolved",
        "Conversation resolved",
        "Start a new chat if you need more help",
      );
      setComposerEnabled(false, "Conversation resolved. Start a new chat.");
      showOutcomeOverlay("resolved");
    }
  });
}
