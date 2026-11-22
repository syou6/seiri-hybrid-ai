/**
 * Prompts for the two stages of the hybrid cascade.
 *
 * Stage 1 (triage) is a short, cheap classification prompt — ideal for the
 * on-device model (Gemini Nano via the Chrome Prompt API, through Firebase
 * AI Logic). Stage 2 (organize) asks for full structured minutes; short
 * inputs also run it on-device, long inputs are escalated to the cloud model.
 *
 * Both prompts demand a single JSON object so results can be rendered as a
 * structured product UI instead of a wall of text. The parser in
 * firebaseBackend.ts is tolerant of code fences / extra prose because the
 * on-device model does not guarantee schema-perfect output.
 */

export function triagePrompt(text: string): string {
  return [
    "あなたはビジネス文書の振り分け担当です。以下のテキストを分析し、JSONだけを出力してください。",
    "",
    "出力形式（このJSONのみ、説明文やコードフェンスは不要）:",
    '{"kind":"chat | meeting | email | memo のいずれか",',
    ' "topic":"話題を10文字程度で",',
    ' "urgency":"high | medium | low のいずれか",',
    ' "sensitivity":"confidential | internal | general のいずれか",',
    ' "gist":"全体の要点を一文で"}',
    "",
    "判定基準:",
    "- urgency: 今日中・至急・明日まで等の期限が迫っていれば high",
    "- sensitivity: 社外秘・個人情報・金額の詳細・人事の話が含まれれば confidential、社内の業務連絡なら internal、それ以外は general",
    "",
    "テキスト:",
    text.slice(0, 4000),
  ].join("\n");
}

export function organizePrompt(text: string): string {
  return [
    "あなたは優秀な議事録・チャット整理の専門家です。以下の日本のビジネスチャット／会議メモを整理し、JSONだけを出力してください。",
    "",
    "出力形式（このJSONのみ、説明文やコードフェンスは不要）:",
    "{",
    '  "title": "内容を表す短いタイトル",',
    '  "summary": "3〜5文の要約",',
    '  "decisions": ["決定事項を簡潔に"],',
    '  "actionItems": [{"task": "やること", "owner": "担当者名（不明なら 未定）", "due": "期限（不明なら 未定）", "priority": "high | medium | low"}],',
    '  "openQuestions": ["未決事項・確認が必要なこと"],',
    '  "risks": ["リスク・懸念点（なければ空配列）"]',
    "}",
    "",
    "ルール:",
    "- 原文にない事実を作らないこと。担当者や期限が読み取れない場合は「未定」とすること",
    "- 固有名詞・数値・日付は原文の表記をそのまま使うこと",
    "- actionItems は重複をまとめ、実行可能な粒度にすること",
    "",
    "テキスト:",
    text,
  ].join("\n");
}

/** JSON Schema used as the cloud model's responseSchema (structured output). */
export const ORGANIZE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    decisions: { type: "array", items: { type: "string" } },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task: { type: "string" },
          owner: { type: "string" },
          due: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["task", "owner", "due", "priority"],
      },
    },
    openQuestions: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
  },
  required: ["title", "summary", "decisions", "actionItems", "openQuestions", "risks"],
} as const;

export const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["chat", "meeting", "email", "memo"] },
    topic: { type: "string" },
    urgency: { type: "string", enum: ["high", "medium", "low"] },
    sensitivity: { type: "string", enum: ["confidential", "internal", "general"] },
    gist: { type: "string" },
  },
  required: ["kind", "topic", "urgency", "sensitivity", "gist"],
} as const;
