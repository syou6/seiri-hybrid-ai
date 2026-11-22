import { DEEP_THRESHOLD_CHARS, activeEngine } from "../config";
import type { AnalysisOutput, StepReport } from "../types";
import { firebaseOrganize, firebaseTriage } from "./firebaseBackend";
import { mockOrganize, mockTriage } from "./mockBackend";

/**
 * The hybrid cascade — the heart of Seiri.
 *
 *   Step 1  Triage        Short classification prompt.
 *                         -> On-device first (PREFER_ON_DEVICE): instant,
 *                            private, free; cloud fallback when unavailable.
 *   Step 2  Organize      Short input  -> on-device first (quick extraction).
 *                         Long input   -> cloud (ONLY_IN_CLOUD) with a JSON
 *                            responseSchema for reliable deep structuring.
 *   Privacy mode          Every step is ONLY_ON_DEVICE. If the device has no
 *                         local model, the request fails closed — the text
 *                         never leaves the device.
 *
 * Every step reports where it actually ran (`inferenceSource`), which the UI
 * renders as a routing log — hybrid inference you can see, not just claim.
 */

export class PrivacyUnavailableError extends Error {
  constructor() {
    super(
      "Privacy mode requires an on-device model (Chrome 139+ with Gemini Nano), " +
        "which is not available in this browser. Nothing was sent to the cloud. " +
        "Turn off Privacy mode to use the cloud fallback.",
    );
    this.name = "PrivacyUnavailableError";
  }
}

export async function analyze(
  text: string,
  privacyMode: boolean,
): Promise<AnalysisOutput> {
  const steps: StepReport[] = [];
  const inputChars = text.length;
  const deep = inputChars > DEEP_THRESHOLD_CHARS;

  if (activeEngine === "mock") {
    const triage = await mockTriage(text);
    steps.push({
      step: "1. Triage (classify)",
      route: "MOCK",
      model: "Local heuristic engine (mock mode)",
      latencyMs: triage.latencyMs,
      detail:
        "With a Firebase key configured, this step runs PREFER_ON_DEVICE " +
        "(Gemini Nano first, cloud fallback).",
    });

    const organized = await mockOrganize(text);
    steps.push({
      step: "2. Organize (extract)",
      route: "MOCK",
      model: "Local heuristic engine (mock mode)",
      latencyMs: organized.latencyMs,
      detail: deep
        ? `Input is ${inputChars} chars (> ${DEEP_THRESHOLD_CHARS}), so with Firebase ` +
          "this step escalates to ONLY_IN_CLOUD with a JSON responseSchema."
        : `Input is ${inputChars} chars, so with Firebase this step stays ` +
          "on-device first (PREFER_ON_DEVICE) for a quick extraction.",
    });

    return {
      triage: triage.data,
      result: organized.data,
      steps,
      inputChars,
      privacyMode,
    };
  }

  // ---- Real Firebase AI Logic path ----
  let triageReply;
  try {
    triageReply = await firebaseTriage(text, privacyMode);
  } catch (e) {
    if (privacyMode) throw new PrivacyUnavailableError();
    throw e;
  }
  steps.push({
    step: "1. Triage (classify)",
    route: triageReply.source,
    model: triageReply.model,
    latencyMs: triageReply.latencyMs,
    detail: privacyMode
      ? "Privacy mode: ONLY_ON_DEVICE — text never left this device."
      : triageReply.source === "ON_DEVICE"
        ? "Served by Gemini Nano on-device: instant, private, offline-capable."
        : "On-device model unavailable, fell back to the cloud model.",
  });

  const route = privacyMode ? "privacy" : deep ? "deep" : "quick";
  let organizeReply;
  try {
    organizeReply = await firebaseOrganize(text, route);
  } catch (e) {
    if (privacyMode) throw new PrivacyUnavailableError();
    throw e;
  }
  steps.push({
    step: "2. Organize (extract)",
    route: organizeReply.source,
    model: organizeReply.model,
    latencyMs: organizeReply.latencyMs,
    detail:
      route === "privacy"
        ? "Privacy mode: ONLY_ON_DEVICE for the full extraction as well."
        : route === "deep"
          ? `Long input (${inputChars} chars > ${DEEP_THRESHOLD_CHARS}): escalated to the ` +
            "cloud model with a JSON responseSchema for deep structuring."
          : `Short input (${inputChars} chars): quick extraction, on-device first.`,
  });

  return {
    triage: triageReply.data,
    result: organizeReply.data,
    steps,
    inputChars,
    privacyMode,
  };
}
