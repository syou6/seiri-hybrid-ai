# Seiri（整理）— Hybrid AI Organizer for Business Chats & Meeting Notes

> **Paste the chaos. Get the decisions.**
> A web app that turns messy Japanese business chat threads and meeting notes into
> structured minutes — summary, decisions, action items (owner / due / priority),
> open questions and risks — using **Firebase AI Logic hybrid inference**:
> on-device first (Gemini Nano in Chrome), cloud when it matters.

Built for **#BuildHybridAI 2026** (Devpost) — Web/Chrome platform category.

---

## Why hybrid? The routing *is* the product

Japanese teams live in chat. Every day, decisions and deadlines are buried in
LINE/Slack-style threads, and someone has to re-read everything to write the
minutes. Seiri automates that — but *where* the AI runs matters as much as
what it produces:

| Step | Route | Why |
| --- | --- | --- |
| **1. Triage** (classify: type / urgency / sensitivity) | **On-device first** (`PREFER_ON_DEVICE`) | Short prompt, needs to be instant. Runs offline, costs nothing, and the text never leaves the device. Falls back to the cloud automatically when no local model exists. |
| **2a. Quick extraction** (short inputs) | **On-device first** (`PREFER_ON_DEVICE`) | A 10-line chat does not need a data center. Structured on-device in well under a second. |
| **2b. Deep structuring** (long inputs, > 1,200 chars) | **Cloud** (`ONLY_IN_CLOUD`) | Long meeting notes need a bigger model and a strict JSON `responseSchema` for reliable minutes. |
| **Privacy mode** (user toggle) | **On-device only** (`ONLY_ON_DEVICE`) | For confidential threads. If the device has no local model, the request **fails closed** — nothing is silently uploaded. |

Every result shows a **routing log**: which step ran where (`ON_DEVICE` /
`IN_CLOUD`, read back from `response.inferenceSource`), with the model name and
latency. Hybrid inference you can *see*, not just claim.

All AI inference goes through **Firebase AI Logic**. The app never calls any
other model API directly.

## Features

- Paste any Japanese business chat / meeting notes, or use the 3 built-in samples
  (short chat → on-device path, long meeting → cloud path, launch-team chat).
- Structured output: title, summary, decisions, action-item table
  (task / owner / due / priority), open questions, risks.
- Triage card: input type, topic, urgency, sensitivity.
- Routing log with per-step route badge, model and latency.
- Privacy mode (on-device only, fail-closed).
- Export: copy as Markdown minutes, or download a `.md` file.
- **Mock mode**: with no Firebase key configured, the full UI and flow run
  against a built-in local heuristic engine (clearly badged `MOCK`), so anyone
  can try the complete product experience immediately.

## Tech stack

- Vite + TypeScript (vanilla, no framework — the product is the routing, not the bundler)
- Firebase JS SDK (`firebase/ai`) — AI Logic with `GoogleAIBackend`,
  `InferenceMode` (`PREFER_ON_DEVICE` / `ONLY_ON_DEVICE` / `ONLY_IN_CLOUD`),
  JSON `responseSchema` for cloud calls, `responseConstraint` for on-device calls
- Firebase App Check (reCAPTCHA v3 provider; debug token supported for development)

---

## Setup

### Prerequisites

- Node.js 20+
- For on-device inference: **Chrome 139+ on desktop** with Gemini Nano
  (the Firebase AI Logic SDK uses Chrome's Prompt API under the hood).
  Without it, hybrid mode transparently falls back to the cloud model.

### 1. Run it right away (mock mode — no keys needed)

```bash
npm install
npm run dev
# open http://localhost:5173
```

With no `.env`, the app starts in **mock mode**: pick a sample, press
**Organize with Hybrid AI**, and the full flow — triage card, routing log,
structured result, Markdown export — works end to end.

### 2. Create a Firebase project and plug in real keys

1. Go to the [Firebase Console](https://console.firebase.google.com/) and
   **Add project** (any name, e.g. `seiri-hybrid-ai`). Google Analytics is optional.
2. In the project, click the **Web** icon (`</>`) under "Add an app", register
   an app (e.g. `seiri-web`), and copy the `firebaseConfig` values shown.
3. In the left nav, open **Build → AI Logic** and click **Get started**.
   Choose the **Gemini Developer API** provider and let the console enable the
   required APIs. (Text inference is free within usage limits — fine for judging.)
4. **App Check** (required by AI Logic): open **Build → App Check**, register
   the web app with the **reCAPTCHA v3** provider, and copy the site key.
   - For local development you may skip this: the app then enables an App Check
     **debug token**. Copy the token the SDK prints to the browser console and
     register it under **App Check → Apps → ⋮ → Manage debug tokens**.
     (Debug tokens are accepted in hackathon submissions.)
5. Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

```ini
VITE_FIREBASE_API_KEY=AIza...            # from firebaseConfig.apiKey
VITE_FIREBASE_AUTH_DOMAIN=seiri-hybrid-ai.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=seiri-hybrid-ai
VITE_FIREBASE_STORAGE_BUCKET=seiri-hybrid-ai.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef...
VITE_FIREBASE_APPCHECK_SITE_KEY=6L...    # reCAPTCHA v3 site key (optional in dev)
VITE_CLOUD_MODEL=gemini-2.5-flash        # cloud model for deep structuring
VITE_MOCK_MODE=false
```

6. Restart `npm run dev`. The header badge switches to
   **“LIVE — Firebase AI Logic connected”**, and the routing log will show real
   `ON_DEVICE` / `IN_CLOUD` results.

> Tip: to test the on-device path, open the app in Chrome 139+ on a machine
> where Gemini Nano is downloaded (check `chrome://on-device-internals`).
> To force the cloud path, paste the long meeting sample (> 1,200 chars).
> To test fail-closed privacy behavior, enable Privacy mode in a browser
> *without* an on-device model.

### 3. Build / deploy

```bash
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build locally
```

Hosting is any static host; Firebase Hosting works out of the box
(`firebase init hosting`, public dir = `dist`).

## Project structure

```
src/
  config.ts            Env-based config; decides LIVE vs MOCK automatically
  types.ts             Shared types (Triage, OrganizedResult, StepReport, ...)
  samples.ts           3 built-in Japanese samples (short / long / chat)
  markdown.ts          Analysis -> Markdown minutes export
  main.ts              UI wiring and rendering
  style.css            Product UI styling
  ai/
    prompts.ts         Triage & organize prompts + JSON schemas
    firebaseBackend.ts Firebase AI Logic: App Check, hybrid models, JSON parsing
    mockBackend.ts     Local heuristic engine used in mock mode
    hybridClient.ts    The cascade router (the heart of the app)
docs/
  SUBMISSION_DRAFT.md  Devpost submission text + demo-video script outline
```

## How the cascade decides (src/ai/hybridClient.ts)

1. **Triage** always runs first with `PREFER_ON_DEVICE`
   (or `ONLY_ON_DEVICE` in Privacy mode).
2. **Organize**: input length ≤ 1,200 chars → `PREFER_ON_DEVICE`;
   longer → `ONLY_IN_CLOUD` with a JSON `responseSchema`;
   Privacy mode → `ONLY_ON_DEVICE` regardless of length.
3. Each step records `response.inferenceSource`, the model label and latency
   into the routing log shown in the UI and embedded in the Markdown export.

---

## Remaining work before submission (残作業)

- [x] **Real keys (wired, partially verified)**: the app now uses the existing
      Firebase project **`lp-projyect`** (Web app "Seiri Web"). Real values are
      in the local `.env` (gitignored — never commit them; `.env.example`
      keeps placeholders for the public repo). `npm run build` succeeds with
      the real config, the production bundle inlines the real values with
      `VITE_MOCK_MODE=false` (so the header badge renders
      "LIVE — Firebase AI Logic connected"), and a Node smoke test of
      `initializeApp` + `getAI` passes with this config.
  - [ ] Still to confirm in a real **Chrome 139+** browser (could not be run
        in the build sandbox): badge shows LIVE, routing log shows real
        `ON_DEVICE` / `IN_CLOUD` steps, and — on first Organize click — copy
        the App Check **debug token** printed to the browser console and
        register it under Firebase Console → App Check → Apps → ⋮ →
        Manage debug tokens for project `lp-projyect` (or set a reCAPTCHA v3
        site key in `VITE_FIREBASE_APPCHECK_SITE_KEY`).
- [ ] **Publish the repo** (not yet pushed — `gh` CLI is installed in the
      build environment but **not authenticated** there). Procedure:
      ```bash
      gh auth login                      # authenticate as syou6
      cd build-hybrid-ai
      git init && git add . && git commit -m "Seiri — Hybrid AI organizer"
      gh repo create syou6/seiri-hybrid-ai --public --source=. --push
      ```
      `.env` is covered by `.gitignore`, so real keys stay local. MIT
      `LICENSE` is included; make sure the license is detectable in the
      repo's About section, and add the hosted URL + a one-line description
      there.
- [ ] **Host the app** (strongly encouraged by the rules): deploy `dist/` to
      Firebase Hosting and put the live URL in the submission.
- [ ] **Demo video** (≤ 3 min, public on YouTube, English or English subtitles):
      script outline is in `docs/SUBMISSION_DRAFT.md`. Show the hybrid behavior
      early: short chat → `ON_DEVICE`, long meeting → `IN_CLOUD`,
      Privacy mode fail-closed in a non-Chrome browser.
- [ ] **Devpost submission**: paste the text from `docs/SUBMISSION_DRAFT.md`,
      select platform **Web/Chrome**, attach repo + video + hosted URL.
      Deadline: **Nov 30, 2026, 2:00 PM PT**.
- [ ] Optional, for Grand Prize consideration (multi-platform is scored
      favorably): port the same cascade to Android (Gemini Nano) or iOS
      (Apple Foundation Models) through Firebase AI Logic.
- [ ] Optional: request a Google Account Quota (Devpost page, Sprint 3 window
      closes Wed Nov 25, 10:00 AM PT) if image generation or higher limits
      are needed — not required for the current text-only app.

## License

MIT — see [LICENSE](./LICENSE).
