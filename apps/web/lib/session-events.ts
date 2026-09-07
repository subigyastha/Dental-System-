"use client";

export type SessionEndReason = "expired" | "signed-out";

export const SESSION_ENDED_EVENT = "clinicflow:session-ended";
const SESSION_CHANNEL_NAME = "clinicflow-session";

type SessionEndMessage = {
  type: "session-ended";
  version: 1;
  reason: SessionEndReason;
};

let sessionChannel: BroadcastChannel | null = null;
let sessionChannelListenerInstalled = false;

function isSessionEndMessage(value: unknown): value is SessionEndMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SessionEndMessage>;
  return (
    candidate.type === "session-ended" &&
    candidate.version === 1 &&
    (candidate.reason === "expired" || candidate.reason === "signed-out")
  );
}

function getSessionChannel() {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
    return null;
  }
  sessionChannel ??= new window.BroadcastChannel(SESSION_CHANNEL_NAME);
  if (!sessionChannelListenerInstalled) {
    sessionChannel.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (isSessionEndMessage(event.data)) {
        dispatchSessionEnd(event.data.reason);
      }
    });
    sessionChannelListenerInstalled = true;
  }
  return sessionChannel;
}

function dispatchSessionEnd(reason: SessionEndReason) {
  if (typeof window === "undefined") {
    return;
  }
  const event = new Event(SESSION_ENDED_EVENT);
  Object.defineProperty(event, "detail", { value: { reason } });
  window.dispatchEvent(event);
}

export function publishSessionEnd(reason: SessionEndReason) {
  dispatchSessionEnd(reason);
  getSessionChannel()?.postMessage({
    type: "session-ended",
    version: 1,
    reason,
  } satisfies SessionEndMessage);
}

export function subscribeToSessionEnd(
  listener: (reason: SessionEndReason) => void,
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleLocalEvent = (event: Event) => {
    const detail = (event as Event & { detail?: { reason?: unknown } }).detail;
    if (detail?.reason === "expired" || detail?.reason === "signed-out") {
      listener(detail.reason);
    }
  };
  window.addEventListener(SESSION_ENDED_EVENT, handleLocalEvent);
  getSessionChannel();

  return () => {
    window.removeEventListener(SESSION_ENDED_EVENT, handleLocalEvent);
  };
}
