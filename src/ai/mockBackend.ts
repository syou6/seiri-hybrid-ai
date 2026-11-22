import type {
  ActionItem,
  OrganizedResult,
  Triage,
  Urgency,
} from "../types";

/**
 * Mock engine: a deterministic, fully local heuristic extractor.
 *
 * It implements the same triage/organize contract as the Firebase backend so
 * the entire product flow (input -> cascade -> structured result -> export)
 * works with no API key and no network. It is intentionally rule-based:
 * Japanese business writing is highly formulaic (〜します / お願いします /
 * 決定 / 確定 / 〜まで), which makes speaker, decision, task, owner and
 * deadline extraction reliable enough for a convincing offline demo.
 */

export interface BackendReply<T> {
  data: T;
  latencyMs: number;
}

function simulateLatency(base: number): Promise<number> {
  const ms = base + Math.floor(Math.random() * 220);
  return new Promise((resolve) => setTimeout(() => resolve(ms), ms));
}

interface Line {
  speaker: string;
  body: string;
}

function parseLines(text: string): Line[] {
  return text
    .split(/\r?\n/)
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => {
      const m = raw.match(/^(.{1,14}?)[：:]\s*(.+)$/);
      if (m) return { speaker: m[1].trim(), body: m[2].trim() };
      return { speaker: "", body: raw };
    });
}

function sentencesOf(lines: Line[]): { speaker: string; text: string }[] {
  const out: { speaker: string; text: string }[] = [];
  for (const line of lines) {
    const parts = line.body
      .split(/(?<=。)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const p of parts) out.push({ speaker: line.speaker, text: p });
  }
  return out;
}

const DUE_PATTERNS: RegExp[] = [
  /\d{1,2}月\d{1,2}日まで/,
  /\d{1,2}\/\d{1,2}まで/,
  /来週[月火水木金土日]曜(?:日)?まで/,
  /今週[月火水木金土日]曜(?:日)?まで/,
  /[月火水木金土日]曜(?:日)?まで/,
  /明日まで/,
  /今日中/,
  /今月中/,
  /来月末まで/,
  /月末まで/,
];

function findDue(text: string): string {
  for (const re of DUE_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0].replace(/まで$/, "");
  }
  if (/明日/.test(text)) return "明日";
  if (/来週/.test(text)) return "来週";
  return "未定";
}

function findOwner(sentence: string, speaker: string): string {
  // Names are kanji/katakana runs directly before さん — restricting the
  // character class keeps particles (は/では/の) out of the captured name.
  const named = sentence.match(/([一-龥ァ-ヶ]{1,4})さん/);
  if (named) return named[1];
  if (speaker) return speaker;
  return "未定";
}

function priorityOf(text: string, due: string): Urgency {
  if (/至急|今日中|緊急|重要/.test(text) || due === "今日中" || due === "明日") {
    return "high";
  }
  if (due !== "未定") return "medium";
  return "low";
}

const TASK_HINTS =
  /(作成します|担当します|送ります|作ります|対応します|発注|お願いします|取ってください|準備します|確認します|共有します|提出します|手配します|終わらせます|完了させます|実施します)/;
const DECISION_HINTS = /(決定|確定|で確定|に決定|承認されました|合意|決定しました)/;
const QUESTION_HINTS = /(？|\?|どうしますか|誰が|でしょうか|未定|決まっていません|まだ決まって|次回.*決め)/;
const RISK_HINTS = /(不安|リスク|懸念|心配|遅れ|間に合わ|難しい|問題|トラブル)/;

/** Section headers like "■ 決定事項" or "【会議メモ】" are structure, not content. */
function isHeader(text: string): boolean {
  return /^■/.test(text) || /^【.*】$/.test(text.trim());
}

function ensurePeriod(s: string): string {
  return /[。！？]$/.test(s) ? s : s + "。";
}

export async function mockTriage(text: string): Promise<BackendReply<Triage>> {
  const latencyMs = await simulateLatency(120);
  const lines = parseLines(text);
  const speakerCount = new Set(lines.map((l) => l.speaker).filter(Boolean)).size;

  let kind: Triage["kind"] = "memo";
  if (/議事録|出席者|会議メモ|【[^】]*会議/.test(text)) kind = "meeting";
  else if (speakerCount >= 2) kind = "chat";
  else if (/件名|様$|お世話になっております/m.test(text)) kind = "email";

  const urgency: Urgency = /至急|今日中|緊急|明日まで/.test(text)
    ? "high"
    : /まで|期限|締切/.test(text)
      ? "medium"
      : "low";

  const sensitivity: Triage["sensitivity"] = /社外秘|機密|個人情報|パスワード|給与|人事評価/.test(text)
    ? "confidential"
    : speakerCount >= 1 || kind === "meeting"
      ? "internal"
      : "general";

  const topicMatch = text.match(/(「[^」]{2,20}」)/);
  const projectMatch = text.match(/([一-龥ァ-ヶA-Za-z]{1,6}プロジェクト)/);
  const topic = topicMatch
    ? topicMatch[1].replace(/[「」]/g, "")
    : projectMatch
      ? projectMatch[1]
      : "業務連絡";
  const firstContent = lines.find((l) => l.body.length > 8)?.body ?? "";
  const gist =
    firstContent.length > 60 ? firstContent.slice(0, 60) + "…" : firstContent;

  return {
    data: { kind, topic, urgency, sensitivity, gist },
    latencyMs,
  };
}

export async function mockOrganize(
  text: string,
): Promise<BackendReply<OrganizedResult>> {
  const latencyMs = await simulateLatency(320);
  const lines = parseLines(text);
  const sentences = sentencesOf(lines);

  const decisions: string[] = [];
  const actionItems: ActionItem[] = [];
  const openQuestions: string[] = [];
  const risks: string[] = [];
  const seenTasks = new Set<string>();

  for (const s of sentences) {
    const t = s.text;
    if (isHeader(t)) continue;
    if (DECISION_HINTS.test(t) && !QUESTION_HINTS.test(t)) {
      decisions.push(t);
      continue;
    }
    if (QUESTION_HINTS.test(t)) {
      openQuestions.push(t);
      continue;
    }
    if (RISK_HINTS.test(t)) risks.push(t);
    if (TASK_HINTS.test(t)) {
      const task = t
        .replace(/^(では|それでは)/, "")
        .replace(/お願いします。?$/, "")
        .trim();
      const key = task.slice(0, 24);
      if (!seenTasks.has(key) && task.length > 3) {
        seenTasks.add(key);
        const due = findDue(t);
        actionItems.push({
          task,
          owner: findOwner(t, s.speaker),
          due,
          priority: priorityOf(t, due),
        });
      }
    }
  }

  const topicMatch = text.match(/(「[^」]{2,20}」)/);
  const title = topicMatch
    ? `${topicMatch[1].replace(/[「」]/g, "")}に関する整理`
    : "チャット／会議メモの整理";

  const summaryParts: string[] = [];
  summaryParts.push(
    `全${lines.length}件の発言を整理しました。決定事項${decisions.length}件、アクションアイテム${actionItems.length}件、未決事項${openQuestions.length}件を抽出しています。`,
  );
  if (decisions.length > 0) summaryParts.push(ensurePeriod(`主な決定: ${decisions[0]}`));
  if (actionItems.length > 0) {
    const urgent = actionItems.find((a) => a.priority === "high");
    if (urgent) {
      summaryParts.push(
        `優先度が高いのは「${urgent.task}」（担当: ${urgent.owner}、期限: ${urgent.due}）です。`,
      );
    }
  }
  if (risks.length > 0) summaryParts.push(ensurePeriod(`懸念点として「${risks[0]}」が挙がっています`));

  return {
    data: {
      title,
      summary: summaryParts.join(""),
      decisions,
      actionItems,
      openQuestions,
      risks,
    },
    latencyMs,
  };
}
