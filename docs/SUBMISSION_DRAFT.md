# Devpost submission draft — #BuildHybridAI 2026

> Copy/paste into the Devpost submission form. Fill the bracketed fields after
> publishing the repo, hosting the app and recording the video.
> Platform to select: **Web/Chrome**. Deadline: **Nov 30, 2026, 2:00 PM PT**.

- **Project name:** Seiri — Hybrid AI Organizer for Business Chats & Meeting Notes
- **Repo:** [GitHub URL]
- **Live demo:** [Firebase Hosting URL]
- **Video:** [YouTube URL, ≤ 3 min]

---

## Elevator pitch

Paste the chaos. Get the decisions. Seiri turns messy Japanese business chat
threads and meeting notes into structured minutes — summary, decisions, action
items with owners and deadlines, open questions and risks — and it routes every
inference deliberately: quick, private work stays on-device with Gemini Nano,
long documents escalate to the cloud, and Privacy mode never lets text leave
the device.

## Inspiration

In Japanese companies, the real meeting happens in chat. Decisions, deadlines
and owners are scattered across dozens of short messages, and afterwards
someone burns 30 minutes re-reading the thread to write minutes. Existing AI
summarizers send everything to the cloud — including threads that contain
salaries, customer names and unreleased product dates. We wanted an organizer
that is fast for the small stuff, powerful for the big stuff, and honest about
where your words are processed. That is exactly the shape of Firebase AI
Logic's hybrid inference.

## What it does

1. Paste a chat thread or meeting notes (or try the built-in samples).
2. **Triage** classifies the input — type, topic, urgency, sensitivity.
3. **Organize** extracts a structured result: title, summary, decisions,
   an action-item table (task / owner / due date / priority), open questions
   and risks.
4. A **routing log** shows, for every step, where inference actually ran —
   `ON_DEVICE` or `IN_CLOUD` (from `response.inferenceSource`) — plus the
   model and latency.
5. Export the minutes as Markdown (copy or download).

## How we used Firebase AI Logic

All inference goes through Firebase AI Logic (`firebase/ai`, GoogleAIBackend);
no other model API is called. The cascade uses three `InferenceMode`s:

- `PREFER_ON_DEVICE` for triage and for short-input extraction — Gemini Nano
  in Chrome via the Prompt API, with automatic cloud fallback.
- `ONLY_IN_CLOUD` for long documents (> 1,200 chars), with a JSON
  `responseSchema` on the cloud model (`gemini-2.5-flash`) for reliable
  structured minutes; on-device calls use `responseConstraint` with the same
  schema.
- `ONLY_ON_DEVICE` for Privacy mode — if no local model exists, the request
  fails closed with an explicit message instead of silently uploading text.

App Check is wired in (reCAPTCHA v3 provider, debug-token flow for local dev).
Model instances are created lazily on the user's click, as required for hybrid
inference mode to engage. A tolerant JSON extractor handles the on-device
model's less predictable formatting.

## Challenges

- On-device output is single-turn and not schema-guaranteed: we designed
  prompts that demand a single JSON object and parse defensively (fence/prose
  stripping), while the cloud path uses a strict `responseSchema`.
- Making hybrid behavior *legible*: judges can't score what they can't see,
  so every step reports its real `inferenceSource` in the UI and in the
  exported minutes.
- Testing without keys: a mock mode with a local heuristic engine reproduces
  the entire flow (badged clearly as MOCK) so the product can be evaluated
  before any Firebase project exists.

## What's next

- Android (Gemini Nano) and iOS (Apple Foundation Models) clients sharing the
  same cascade — the multi-platform story Firebase AI Logic is built for.
- Firestore sync of organized minutes and a team workspace; Remote Config for
  the length threshold and model selection.
- Calendar/task-tool export for action items.

---

## Demo video script outline (≤ 3:00)

Judges may evaluate from the video alone — show hybrid behavior early.

| Time | Scene |
| --- | --- |
| 0:00–0:20 | Problem: a long, messy chat thread on screen. "The decisions are in here somewhere." Introduce Seiri. |
| 0:20–0:50 | Paste **Sample 3 (short chat)** → Organize → routing log shows `ON_DEVICE` for both steps; action items appear. |
| 0:50–1:30 | Paste **Sample 1 (launch chat)** → triage card (urgency/sensitivity), decisions + action-item table with owners and due dates. Export Markdown. |
| 1:30–2:15 | Paste **Sample 2 (long meeting)** → routing log: triage `ON_DEVICE`, organize `IN_CLOUD` — explain the length-based escalation and the JSON schema. |
| 2:15–2:45 | **Privacy mode**: enable it in a browser without Gemini Nano → request fails closed, "nothing was sent to the cloud". Then in Chrome, show it succeeding fully on-device. |
| 2:45–3:00 | Wrap: one SDK, three modes, visible routing. Repo + live URL on screen. |

Recording notes: English voiceover or English subtitles (required). Keep the
routing-log badges large/zoomed — they are the proof of hybrid inference.
