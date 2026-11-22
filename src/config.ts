/**
 * Central configuration.
 *
 * All Firebase values come from Vite environment variables (see .env.example).
 * If the API key is missing or still a placeholder, `isFirebaseConfigured`
 * is false and the app automatically falls back to MOCK MODE, in which the
 * full UI and flow run against a local heuristic engine with no network calls.
 * This lets judges (and developers) try the complete product experience
 * before any Firebase project exists.
 */

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const env = import.meta.env;

export const firebaseConfig: FirebaseWebConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: env.VITE_FIREBASE_APP_ID ?? "",
};

/** reCAPTCHA v3 site key for App Check. Empty string = use debug token (dev). */
export const appCheckSiteKey: string = env.VITE_FIREBASE_APPCHECK_SITE_KEY ?? "";

/** Cloud model used for deep structuring through Firebase AI Logic. */
export const cloudModel: string = env.VITE_CLOUD_MODEL ?? "gemini-3.8-flash";

/** Hard switch: force mock mode even when Firebase is configured. */
export const forceMock: boolean = env.VITE_MOCK_MODE === "true";

function looksReal(value: string): boolean {
  return (
    value.length > 8 &&
    !value.includes("YOUR_") &&
    !value.includes("your-project") &&
    !value.startsWith("0000")
  );
}

export const isFirebaseConfigured: boolean =
  looksReal(firebaseConfig.apiKey) && looksReal(firebaseConfig.projectId);

/** The engine that will actually serve requests right now. */
export const activeEngine: "firebase" | "mock" =
  isFirebaseConfigured && !forceMock ? "firebase" : "mock";

/** Inputs longer than this are routed to the cloud for deep structuring. */
export const DEEP_THRESHOLD_CHARS = 1200;
