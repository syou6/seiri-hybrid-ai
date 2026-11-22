import {
  appCheckSiteKey,
  cloudModel,
  firebaseConfig,
} from "../config";
import type {
  InferenceSourceLabel,
  OrganizedResult,
  Triage,
} from "../types";
import {
  ORGANIZE_SCHEMA,
  TRIAGE_SCHEMA,
  organizePrompt,
  triagePrompt,
} from "./prompts";

/**
 * Real backend: Firebase AI Logic (JS SDK, `firebase/ai`).
 *
 * ALL inference in this app goes through Firebase AI Logic — no direct calls
 * to any other model API. The hybrid behavior comes from `InferenceMode`:
 *
 *   - PREFER_ON_DEVICE : Gemini Nano in Chrome when available, automatic
 *                        fallback to the cloud model when it is not.
 *   - ONLY_ON_DEVICE   : privacy mode. Throws if no on-device model exists,
 *                        which the UI surfaces as "nothing left this device".
 *   - ONLY_IN_CLOUD    : deep structuring of long documents with the cloud
 *                        model and a JSON responseSchema.
 *
 * Which route actually served a request is read back from
 * `response.inferenceSource` (JS SDK >= 12.5.0) and shown in the UI.
 *
 * Per Firebase docs, model instances are created lazily, on/after a user
 * interaction (button click), which is a prerequisite for hybrid inference.
 */

export interface FirebaseReply<T> {
  data: T;
  source: InferenceSourceLabel;
  model: string;
  latencyMs: number;
}

type FirebaseAiModule = typeof import("firebase/ai");

let aiServicePromise: Promise<unknown> | null = null;

async function getAiService(): Promise<unknown> {
  if (!aiServicePromise) {
    aiServicePromise = (async () => {
      const { initializeApp } = await import("firebase/app");
      const { getAI, GoogleAIBackend } = await import("firebase/ai");

      const app = initializeApp(firebaseConfig);

      // App Check is required by Firebase AI Logic. With a reCAPTCHA v3 site
      // key we use the real provider; without one we register a debug token
      // (accepted for hackathon submissions — register the printed token in
      // Firebase Console > App Check > Apps > Manage debug tokens).
      try {
        const { initializeAppCheck, ReCaptchaV3Provider } = await import(
          "firebase/app-check"
        );
        if (appCheckSiteKey) {
          initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(appCheckSiteKey),
            isTokenAutoRefreshEnabled: true,
          });
        } else {
          (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean })[
            "FIREBASE_APPCHECK_DEBUG_TOKEN"
          ] = true;
          console.info(
            "[Seiri] App Check debug token mode: copy the debug token printed " +
              "by the SDK into Firebase Console > App Check > Manage debug tokens.",
          );
        }
      } catch (e) {
        console.warn("[Seiri] App Check initialization skipped:", e);
      }

      return getAI(app, { backend: new GoogleAIBackend() });
    })();
  }
  return aiServicePromise;
}

/** Tolerant JSON extraction: on-device models may wrap JSON in prose/fences. */
export function extractJson<T>(raw: string): T {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text) as T;
}

async function generateJson<T>(
  prompt: string,
  mode: FirebaseAiModule["InferenceMode"][keyof FirebaseAiModule["InferenceMode"]],
  schema: unknown,
): Promise<{ data: T; source: InferenceSourceLabel; model: string; latencyMs: number }> {
  const ai = (await getAiService()) as Parameters<
    FirebaseAiModule["getGenerativeModel"]
  >[0];
  const { getGenerativeModel } = await import("firebase/ai");

  const started = performance.now();
  // Model instance is created here — i.e. after the user's click on
  // "Organize" — as required for hybrid inference mode to take effect.
  const model = getGenerativeModel(ai, {
    mode,
    inCloudParams: {
      model: cloudModel,
      generationConfig: {
        responseMimeType: "application/json",
        // The SDK accepts a JSON Schema object here; cast keeps this stable
        // across SDK minor versions.
        responseSchema: schema as never,
      },
    },
    onDeviceParams: {
      // Ask Chrome's Prompt API to constrain on-device output to the schema.
      promptOptions: { responseConstraint: schema },
    },
  } as Parameters<FirebaseAiModule["getGenerativeModel"]>[1]);

  const result = await model.generateContent(prompt);
  const latencyMs = Math.round(performance.now() - started);

  const response = result.response as unknown as {
    text: () => string;
    inferenceSource?: string;
  };
  const source: InferenceSourceLabel =
    response.inferenceSource === "ON_DEVICE" ? "ON_DEVICE" : "IN_CLOUD";
  const modelLabel =
    source === "ON_DEVICE" ? "Gemini Nano (on-device)" : cloudModel;

  return {
    data: extractJson<T>(response.text()),
    source,
    model: modelLabel,
    latencyMs,
  };
}

export async function firebaseTriage(
  text: string,
  privacyMode: boolean,
): Promise<FirebaseReply<Triage>> {
  const { InferenceMode } = await import("firebase/ai");
  const mode = privacyMode
    ? InferenceMode.ONLY_ON_DEVICE
    : InferenceMode.PREFER_ON_DEVICE;
  const r = await generateJson<Triage>(triagePrompt(text), mode, TRIAGE_SCHEMA);
  return { data: r.data, source: r.source, model: r.model, latencyMs: r.latencyMs };
}

export type OrganizeRoute = "quick" | "deep" | "privacy";

export async function firebaseOrganize(
  text: string,
  route: OrganizeRoute,
): Promise<FirebaseReply<OrganizedResult>> {
  const { InferenceMode } = await import("firebase/ai");
  const mode =
    route === "privacy"
      ? InferenceMode.ONLY_ON_DEVICE
      : route === "deep"
        ? InferenceMode.ONLY_IN_CLOUD
        : InferenceMode.PREFER_ON_DEVICE;
  const r = await generateJson<OrganizedResult>(
    organizePrompt(text),
    mode,
    ORGANIZE_SCHEMA,
  );
  return { data: r.data, source: r.source, model: r.model, latencyMs: r.latencyMs };
}
