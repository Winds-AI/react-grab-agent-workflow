// This script runs in ISOLATED world and bridges chrome.runtime messages to MAIN world

interface AgentFeedbackBridgeRequest {
  type: "__REACT_GRAB_AGENT_FEEDBACK_REQUEST__";
  requestId: string;
  action: "create" | "status";
  payload: unknown;
}

const postAgentFeedbackResponse = (
  requestId: string,
  response: { ok: boolean; result?: unknown; error?: string },
) => {
  window.postMessage(
    {
      type: "__REACT_GRAB_AGENT_FEEDBACK_RESPONSE__",
      requestId,
      ok: response.ok,
      result: response.result,
      error: response.error,
    },
    "*",
  );
};

chrome.storage.onChanged.addListener((changes) => {
  if (changes.react_grab_enabled) {
    const newEnabled = changes.react_grab_enabled.newValue ?? true;
    window.postMessage({ type: "__REACT_GRAB_EXTENSION_TOGGLE__", enabled: newEnabled }, "*");
  }

  if (changes.react_grab_toolbar_state) {
    const newState = changes.react_grab_toolbar_state.newValue;
    if (newState) {
      window.postMessage({ type: "__REACT_GRAB_TOOLBAR_STATE_CHANGE__", state: newState }, "*");
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "REACT_GRAB_TOGGLE") {
    window.postMessage({ type: "__REACT_GRAB_EXTENSION_TOGGLE__", enabled: message.enabled }, "*");
    sendResponse({ success: true });
  }

  if (message.type === "GET_STATE") {
    sendResponse({ enabled: true });
  }

  return true;
});

window.addEventListener("message", (event) => {
  if (event.data?.type === "__REACT_GRAB_QUERY_STATE__") {
    chrome.storage.local.get(["react_grab_enabled", "react_grab_toolbar_state"], (result) => {
      const enabled = result.react_grab_enabled ?? true;
      const toolbarState = result.react_grab_toolbar_state ?? null;

      window.postMessage(
        {
          type: "__REACT_GRAB_STATE_RESPONSE__",
          enabled,
          toolbarState,
        },
        "*",
      );
    });
  }

  if (event.data?.type === "__REACT_GRAB_TOOLBAR_STATE_SAVE__") {
    chrome.storage.local.set({ react_grab_toolbar_state: event.data.state });
  }

  if (event.source === window && event.data?.type === "__REACT_GRAB_AGENT_FEEDBACK_REQUEST__") {
    const request = event.data as AgentFeedbackBridgeRequest;
    try {
      chrome.runtime.sendMessage(
        {
          type: "REACT_GRAB_AGENT_FEEDBACK",
          action: request.action,
          payload: request.payload,
        },
        (response) => {
          const runtimeError = chrome.runtime.lastError;
          postAgentFeedbackResponse(request.requestId, {
            ok: runtimeError ? false : (response?.ok ?? false),
            result: response?.result,
            error: runtimeError?.message ?? response?.error,
          });
        },
      );
    } catch (error) {
      postAgentFeedbackResponse(request.requestId, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Chrome extension runtime is unavailable. Reload the page after reloading the extension.",
      });
    }
  }
});
