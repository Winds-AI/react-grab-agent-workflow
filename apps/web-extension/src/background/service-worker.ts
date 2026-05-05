import { AGENT_ENDPOINT_STORAGE_KEY, DEFAULT_AGENT_ENDPOINT } from "../constants.js";

const STORAGE_KEY = "react_grab_enabled";

interface ReactGrabCommentPayload {
  id: string;
  content: string;
  commentText: string;
  context?: {
    targets?: Array<{
      bounds?: unknown;
    }>;
  };
}

interface ReactGrabFeedbackPayload {
  comments: ReactGrabCommentPayload[];
  combinedContent: string;
  sentAt: number;
}

interface AgentFeedbackMessage {
  type: "REACT_GRAB_AGENT_FEEDBACK";
  action: "create" | "status";
  payload: unknown;
}

const getGlobalEnabled = async (): Promise<boolean> => {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const enabled = result[STORAGE_KEY] ?? true;
  return enabled;
};

const setGlobalEnabled = async (enabled: boolean): Promise<void> => {
  await chrome.storage.local.set({ [STORAGE_KEY]: enabled });
};

const getAgentEndpoint = async (): Promise<string> => {
  const result = await chrome.storage.local.get(AGENT_ENDPOINT_STORAGE_KEY);
  return result[AGENT_ENDPOINT_STORAGE_KEY] ?? DEFAULT_AGENT_ENDPOINT;
};

const updateActionIcon = async (tabId: number, enabled: boolean): Promise<void> => {
  const title = enabled ? "React Grab (Active)" : "React Grab (Inactive)";
  const badgeText = enabled ? "" : "OFF";
  const badgeColor = "#FF40E0";

  await chrome.action.setTitle({ tabId, title });
  await chrome.action.setBadgeText({ tabId, text: badgeText });
  if (badgeText) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_STATE") {
    getGlobalEnabled().then((enabled) => {
      sendResponse({ enabled });
    });
    return true;
  }

  if (message.type === "REACT_GRAB_AGENT_FEEDBACK") {
    handleAgentFeedbackMessage(message as AgentFeedbackMessage, _sender)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Agent feedback request failed",
        });
      });
    return true;
  }

  return false;
});

const createAgentPayload = async (
  payload: ReactGrabFeedbackPayload,
  sender: chrome.runtime.MessageSender,
) => {
  const windowId = sender.tab?.windowId;
  if (typeof windowId !== "number") {
    throw new Error("Cannot capture screenshot without an active tab window");
  }

  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });

  return {
    sentAt: payload.sentAt,
    source: "react-grab-extension",
    tab: {
      id: sender.tab?.id,
      url: sender.tab?.url,
      title: sender.tab?.title,
      windowId,
    },
    comments: payload.comments.map((comment, index) => ({
      id: comment.id,
      userFeedback: comment.commentText,
      generatedContext: {
        text: comment.content,
      },
      context: comment.context,
      screenshot: {
        kind: "visible-tab",
        mimeType: "image/png",
        dataUrl: screenshotDataUrl,
        bounds: comment.context?.targets?.[0]?.bounds,
        index,
      },
    })),
    combinedGeneratedContext: payload.combinedContent,
  };
};

const postAgentFeedback = async (
  payload: ReactGrabFeedbackPayload,
  sender: chrome.runtime.MessageSender,
) => {
  const endpoint = await getAgentEndpoint();
  const agentPayload = await createAgentPayload(payload, sender);
  const response = await fetch(`${endpoint}/__react-grab-agent-feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(agentPayload),
  });

  if (!response.ok) {
    throw new Error(`Failed to send feedback (${response.status})`);
  }

  return response.json();
};

const getAgentFeedbackStatus = async (jobId: string) => {
  const endpoint = await getAgentEndpoint();
  const response = await fetch(`${endpoint}/__react-grab-agent-feedback/${encodeURIComponent(jobId)}`);

  if (!response.ok) {
    throw new Error(`Failed to read feedback status (${response.status})`);
  }

  return response.json();
};

const handleAgentFeedbackMessage = async (
  message: AgentFeedbackMessage,
  sender: chrome.runtime.MessageSender,
) => {
  if (message.action === "create") {
    return postAgentFeedback(message.payload as ReactGrabFeedbackPayload, sender);
  }

  if (message.action === "status") {
    const { jobId } = message.payload as { jobId?: string };
    if (!jobId) throw new Error("Missing jobId");
    return getAgentFeedbackStatus(jobId);
  }

  throw new Error(`Unknown feedback action: ${message.action}`);
};

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  const currentEnabled = await getGlobalEnabled();
  const newEnabled = !currentEnabled;
  await setGlobalEnabled(newEnabled);

  await updateActionIcon(tab.id, newEnabled);

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "REACT_GRAB_TOGGLE",
      enabled: newEnabled,
    });
  } catch {
    // HACK: Content script may not be ready yet
  }

  const allTabs = await chrome.tabs.query({});
  for (const otherTab of allTabs) {
    if (otherTab.id && otherTab.id !== tab.id) {
      await updateActionIcon(otherTab.id, newEnabled);
      try {
        await chrome.tabs.sendMessage(otherTab.id, {
          type: "REACT_GRAB_TOGGLE",
          enabled: newEnabled,
        });
      } catch {
        // Tab may not have content script loaded
      }
    }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    const enabled = await getGlobalEnabled();
    await updateActionIcon(tabId, enabled);
  }
});
