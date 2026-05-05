import type { CommentItem, AgentFeedbackStatusName } from "../types.js";

export interface AgentFeedbackPayload {
  comments: CommentItem[];
  combinedContent: string;
  sentAt: number;
}

export interface AgentFeedbackStartResponse {
  jobId: string;
  state?: AgentFeedbackStatusName;
}

export interface AgentFeedbackPollResponse {
  jobId: string;
  state: AgentFeedbackStatusName;
  error?: string;
}

const EXTENSION_REQUEST_TIMEOUT_MS = 15000;

declare global {
  interface Window {
    __REACT_GRAB_EXTENSION_AGENT_FEEDBACK__?: boolean;
  }
}

const requestViaExtension = <T>(action: string, payload: unknown): Promise<T> => {
  if (typeof window === "undefined" || !window.__REACT_GRAB_EXTENSION_AGENT_FEEDBACK__) {
    throw new Error("React Grab agent feedback requires the Chrome extension");
  }

  return new Promise((resolve, reject) => {
    const requestId = `react-grab-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("Timed out waiting for extension response"));
    }, EXTENSION_REQUEST_TIMEOUT_MS);

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.type !== "__REACT_GRAB_AGENT_FEEDBACK_RESPONSE__") return;
      if (event.data.requestId !== requestId) return;

      clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);

      if (event.data.ok) {
        resolve(event.data.result as T);
      } else {
        reject(new Error(event.data.error ?? "Extension feedback request failed"));
      }
    };

    window.addEventListener("message", handleMessage);
    window.postMessage(
      {
        type: "__REACT_GRAB_AGENT_FEEDBACK_REQUEST__",
        requestId,
        action,
        payload,
      },
      "*",
    );
  });
};

export const sendAgentFeedback = async (
  payload: AgentFeedbackPayload,
): Promise<AgentFeedbackStartResponse> => {
  return requestViaExtension<AgentFeedbackStartResponse>("create", payload);
};

export const getAgentFeedbackStatus = async (
  jobId: string,
): Promise<AgentFeedbackPollResponse> => {
  return requestViaExtension<AgentFeedbackPollResponse>("status", { jobId });
};
