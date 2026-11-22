import "./style.css";
import { DEEP_THRESHOLD_CHARS, activeEngine } from "./config";
import { analyze, PrivacyUnavailableError } from "./ai/hybridClient";
import { SAMPLES } from "./samples";
import { toMarkdown } from "./markdown";
import type { AnalysisOutput, OrganizedResult } from "./types";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const inputEl = $<HTMLTextAreaElement>("input");
const charCountEl = $("char-count");
const routeHintEl = $("route-hint");
const privacyEl = $<HTMLInputElement>("privacy-mode");
const analyzeBtn = $<HTMLButtonElement>("analyze-btn");
const statusEl = $("status");
const errorEl = $("error");
const emptyStateEl = $("empty-state");
const resultEl = $("result");
const triageCardEl = $("triage-card");
const routingLogEl = $("routing-log");
const organizedEl = $("organized");
const copyStatusEl = $("copy-status");
const engineBadge = $("engine-badge");

let lastOutput: AnalysisOutput | null = null;

/* ---------- engine badge ---------- */
if (activeEngine === "mock") {
  engineBadge.textContent = "MOCK MODE — add a Firebase key in .env to go live";
  engineBadge.classList.add("mock");
} else {
  engineBadge.textContent = "LIVE — Firebase AI Logic connected";
  engineBadge.classList.add("live");
}

/* ---------- samples ---------- */
const samplesEl = $("samples");
for (const sample of SAMPLES) {
  const btn = document.createElement("button");
  btn.className = "sample-btn";
  btn.type = "button";
  const strong = document.createElement("strong");
  strong.textContent = sample.label;
  const span = document.createElement("span");
  span.textContent = sample.description;
  btn.append(strong, span);
  btn.addEventListener("click", () => {
    inputEl.value = sample.text;
    updateMeta();
    inputEl.focus();
  });
  samplesEl.appendChild(btn);
}

/* ---------- input meta ---------- */
function updateMeta(): void {
  const n = inputEl.value.length;
  charCountEl.textContent = `${n.toLocaleString()} chars`;
  routeHintEl.textContent =
    n === 0
      ? ""
      : n > DEEP_THRESHOLD_CHARS
        ? `Long input → triage on-device, structuring escalates to the cloud`
        : `Short input → the whole cascade can stay on-device`;
}
inputEl.addEventListener("input", updateMeta);
updateMeta();

/* ---------- rendering ---------- */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const KIND_LABEL: Record<string, string> = {
  chat: "Chat チャット",
  meeting: "Meeting 会議",
  email: "Email メール",
  memo: "Memo メモ",
};
const SENS_LABEL: Record<string, string> = {
  confidential: "Confidential 社外秘級",
  internal: "Internal 社内",
  general: "General 一般",
};

function listHtml(title: string, titleJp: string, items: string[]): string {
  const body =
    items.length > 0
      ? `<ul class="result-list">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
      : `<p class="none">— none found —</p>`;
  return `<div class="card"><h3>${title} <span class="h3-jp">${titleJp}</span></h3>${body}</div>`;
}

function render(output: AnalysisOutput): void {
  const { triage, result, steps } = output;

  triageCardEl.innerHTML = `
    <h3>Triage <span class="h3-jp">振り分け</span></h3>
    <dl class="triage-grid">
      <div><dt>Type</dt><dd>${esc(KIND_LABEL[triage.kind] ?? triage.kind)}</dd></div>
      <div><dt>Topic</dt><dd>${esc(triage.topic)}</dd></div>
      <div><dt>Urgency</dt><dd>${esc(triage.urgency)}</dd></div>
      <div><dt>Sensitivity</dt><dd>${esc(SENS_LABEL[triage.sensitivity] ?? triage.sensitivity)}</dd></div>
      <div><dt>Input</dt><dd>${output.inputChars.toLocaleString()} chars</dd></div>
    </dl>
    <p class="triage-gist">${esc(triage.gist)}</p>`;

  routingLogEl.innerHTML = steps
    .map(
      (s) => `
      <li>
        <span class="route-badge route-${s.route}">${s.route.replace("_", "-")}</span>
        <span><strong>${esc(s.step)}</strong>
          <span class="routing-meta">· ${esc(s.model)} · ${s.latencyMs.toLocaleString()} ms</span></span>
        <span class="routing-detail">${esc(s.detail)}</span>
      </li>`,
    )
    .join("");

  organizedEl.innerHTML = renderOrganized(result);
}

function renderOrganized(r: OrganizedResult): string {
  const actions =
    r.actionItems.length > 0
      ? `<div class="card"><h3>Action items <span class="h3-jp">アクションアイテム</span></h3>
         <table class="actions">
           <thead><tr><th>Task やること</th><th>Owner 担当</th><th>Due 期限</th><th>Priority</th></tr></thead>
           <tbody>
             ${r.actionItems
               .map(
                 (a) => `<tr>
                   <td>${esc(a.task)}</td>
                   <td>${esc(a.owner)}</td>
                   <td>${esc(a.due)}</td>
                   <td><span class="prio prio-${esc(a.priority)}">${esc(a.priority)}</span></td>
                 </tr>`,
               )
               .join("")}
           </tbody>
         </table></div>`
      : listHtml("Action items", "アクションアイテム", []);

  return `
    <div class="card">
      <h3 class="result-title">${esc(r.title)}</h3>
      <p class="summary-text">${esc(r.summary)}</p>
    </div>
    ${listHtml("Decisions", "決定事項", r.decisions)}
    ${actions}
    ${listHtml("Open questions", "未決事項", r.openQuestions)}
    ${r.risks.length > 0 ? listHtml("Risks", "リスク・懸念", r.risks) : ""}`;
}

/* ---------- analyze ---------- */
analyzeBtn.addEventListener("click", async () => {
  const text = inputEl.value.trim();
  errorEl.hidden = true;
  copyStatusEl.textContent = "";
  if (text.length < 10) {
    errorEl.textContent = "Please paste at least a few lines of chat or meeting notes first.";
    errorEl.hidden = false;
    return;
  }

  analyzeBtn.disabled = true;
  statusEl.textContent =
    activeEngine === "mock"
      ? "Running the cascade in mock mode (local heuristic engine)…"
      : "Running the hybrid cascade — triage on-device first…";

  try {
    const output = await analyze(text, privacyEl.checked);
    lastOutput = output;
    emptyStateEl.hidden = true;
    resultEl.hidden = false;
    render(output);
    statusEl.textContent = privacyEl.checked
      ? "Done — Privacy mode: every step ran on-device (or in the local mock engine)."
      : "Done. Check the routing log to see where each step actually ran.";
  } catch (e) {
    const message =
      e instanceof PrivacyUnavailableError
        ? e.message
        : `Something went wrong: ${e instanceof Error ? e.message : String(e)}`;
    errorEl.textContent = message;
    errorEl.hidden = false;
    statusEl.textContent = "";
  } finally {
    analyzeBtn.disabled = false;
  }
});

/* ---------- export ---------- */
$("copy-md").addEventListener("click", async () => {
  if (!lastOutput) return;
  await navigator.clipboard.writeText(toMarkdown(lastOutput));
  copyStatusEl.textContent = "Copied!";
  setTimeout(() => (copyStatusEl.textContent = ""), 2000);
});

$("download-md").addEventListener("click", () => {
  if (!lastOutput) return;
  const blob = new Blob([toMarkdown(lastOutput)], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${lastOutput.result.title.replace(/[\\/:*?"<>|]/g, "_") || "seiri-minutes"}.md`;
  a.click();
  URL.revokeObjectURL(url);
});
