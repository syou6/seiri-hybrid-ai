/** Where a piece of inference actually ran. Mirrors Firebase AI Logic's
 *  `response.inferenceSource` values, plus MOCK for the offline demo engine. */
export type InferenceSourceLabel = "ON_DEVICE" | "IN_CLOUD" | "MOCK";

export type InputKind = "chat" | "meeting" | "email" | "memo";
export type Urgency = "high" | "medium" | "low";
export type Sensitivity = "confidential" | "internal" | "general";

export interface Triage {
  kind: InputKind;
  topic: string;
  urgency: Urgency;
  sensitivity: Sensitivity;
  /** One-line gist of the whole input. */
  gist: string;
}

export interface ActionItem {
  task: string;
  owner: string;
  due: string;
  priority: Urgency;
}

export interface OrganizedResult {
  title: string;
  summary: string;
  decisions: string[];
  actionItems: ActionItem[];
  openQuestions: string[];
  risks: string[];
}

/** One executed step of the hybrid cascade, shown in the routing log UI. */
export interface StepReport {
  step: string;
  route: InferenceSourceLabel;
  model: string;
  latencyMs: number;
  detail: string;
}

export interface AnalysisOutput {
  triage: Triage;
  result: OrganizedResult;
  steps: StepReport[];
  inputChars: number;
  privacyMode: boolean;
}
