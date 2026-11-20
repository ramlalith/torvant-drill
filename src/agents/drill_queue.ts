// Pure rules for drill queues. No model, no network, nothing is ever run.
// Used by the queue-builder agent's tools and by the play screen.

import { risk_flags } from "../risk_rules";

export const RISK_TYPES = [
  "destructive",
  "exposure",
  "secrets leaving",
  "access rights",
  "unsafe shortcut",
  "unknown software"
] as const;
export type RiskType = (typeof RISK_TYPES)[number];

export const RISK_TYPE_LINES: Record<RiskType, string> = {
  destructive: "data or backups are deleted and cannot be brought back",
  exposure: "something private is opened to everyone",
  "secrets leaving": "keys or credentials are sent outside",
  "access rights": "far more rights are granted than the task needs",
  "unsafe shortcut": "a check, a test or a shared branch is overridden",
  "unknown software": "a package or script of unknown origin is installed or run"
};

export interface SessionRequest {
  request_id: string; // e.g. "S3"
  task: string;
  command: string;
  hint: string;
  time: string;
}

export interface PlantedRequest {
  after_request_id: string;
  task: string;
  command: string;
  risk_type: RiskType;
  why_deny: string;
}

export interface QueueCard {
  id: string; // unique inside the queue, e.g. "Q2-5"
  task: string;
  command: string;
  isRisky: boolean;
  risk_type?: RiskType;
  denialReason?: string;
  source: "session" | "planted";
  source_id: string; // session request id, or "P1"/"P2"
}

// Names that belong to the real project. A drill must never name them.
const REAL_NAME_PATTERNS = [/gen-lang-client/i, /\btorvant\b/i, /GEMINI_API_KEY/i, /437479686342/, /ramlalith/i];

function hostsIn(command: string): string[] {
  const hosts: string[] = [];
  const url = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^@\/\s"']*@)?([^\/\s"':?#]+)/gi;
  let m: RegExpMatchArray | null;
  for (m of command.matchAll(url)) hosts.push(m[1].toLowerCase());
  // Bare domain names such as files.example.com (not file names like price.ts).
  const bare = /\b((?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|in|co|ai|cloud|xyz|info|biz|me|sh|site|online))\b/gi;
  for (m of command.matchAll(bare)) hosts.push(m[1].toLowerCase());
  return hosts;
}

/** Checks one planted request. Returns problems; empty means accepted. */
export function validatePlant(
  p: Partial<PlantedRequest>,
  session: SessionRequest[],
  planted: PlantedRequest[],
  requiredTypes?: RiskType[]
): string[] {
  const problems: string[] = [];
  if (requiredTypes && !requiredTypes.includes(p.risk_type as RiskType)) {
    problems.push(`this queue must use the risk types ${requiredTypes.join(" and ")}`);
  }
  const command = String(p.command || "");
  const task = String(p.task || "");

  if (!RISK_TYPES.includes(p.risk_type as RiskType)) problems.push(`unknown risk type "${p.risk_type}"`);
  if (!session.some((r) => r.request_id === p.after_request_id)) problems.push(`no session request "${p.after_request_id}"`);
  if (!session.some((r) => r.task === task)) problems.push("task is not a task from this session");
  if (!command.trim()) problems.push("empty command");
  if (command.length > 300) problems.push("command too long");
  if (!/^[\x20-\x7E]*$/.test(command)) problems.push("command has hidden or non-printable characters");
  if (/[A-Za-z0-9+\/]{40,}={0,2}/.test(command) || /\\x[0-9a-f]{2}|%[0-9a-f]{2}/i.test(command)) {
    problems.push("command has encoded text");
  }
  if (/\bbase64\b|\beval\b|\bxxd\b|\|\s*(ba|z)?sh\b|\$\(|`/.test(command)) {
    problems.push("command hides what it runs");
  }
  for (const host of hostsIn(command)) {
    const allowedServiceAccount = /^[a-z0-9-]+@?kaveri[a-z0-9-]*\.iam\.gserviceaccount\.com$/.test(host) ||
      /^kaveri[a-z0-9-]*\.iam\.gserviceaccount\.com$/.test(host);
    if (!host.endsWith(".example.invalid") && !allowedServiceAccount) problems.push(`real looking host "${host}"`);
  }
  for (const re of REAL_NAME_PATTERNS) if (re.test(command)) problems.push("names something from the real project");
  const projectArgs = [...command.matchAll(/--project[= ]([\w-]+)|projects\s+[\w-]+\s+([\w-]+)/g)].map((m) => m[1] || m[2]);
  for (const proj of projectArgs) if (proj && !/^kaveri-/.test(proj)) problems.push(`project "${proj}" is not a Kaveri project`);

  const why = String(p.why_deny || "").trim();
  if (!why) problems.push("why_deny missing");
  if (why.split(/\s+/).length > 30) problems.push("why_deny too long");

  if (planted.length >= 2) problems.push("already two planted requests");
  if (planted.some((x) => x.risk_type === p.risk_type)) problems.push("same risk type as the other planted request");
  if (planted.some((x) => x.command === command) || session.some((r) => r.command === command)) {
    problems.push("command is not new");
  }
  return problems;
}

export const MAX_CARD_COMMAND_LENGTH = 110;

/** Session requests fit for a drill card: not high risk, short enough to read on a phone, no repeats. */
export function usableRequests(session: SessionRequest[]): SessionRequest[] {
  const seen = new Set<string>();
  return session.filter((r) => {
    const key = r.command.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return key.length <= MAX_CARD_COMMAND_LENGTH && !key.includes("\n") && risk_flags(r.task, r.command).level !== "high";
  });
}

/**
 * Builds the queue: six requests from the session and two planted ones, each
 * planted request right after the request it resembles, so never first.
 * Session cards are readable, distinct and spread over the tasks. When it can,
 * it keeps a normal card after the last planted one, so the last card is not
 * always the risky one.
 */
export function finalizeQueue(queueId: string, session: SessionRequest[], planted: PlantedRequest[]): QueueCard[] {
  if (planted.length !== 2) throw new Error("a queue needs exactly two planted requests");
  const usable = usableRequests(session);
  const order = (r: SessionRequest) => usable.indexOf(r);
  const anchors = new Set(planted.map((p) => p.after_request_id));
  for (const a of anchors) {
    if (!usable.some((r) => r.request_id === a)) {
      throw new Error(`planted request follows "${a}", which is not a usable session card (repeat, too long or high risk)`);
    }
  }
  const chosen: SessionRequest[] = usable.filter((r) => anchors.has(r.request_id));
  const tasksCovered = new Set(chosen.map((r) => r.task));
  for (const r of usable) {
    if (chosen.length >= 6) break;
    if (!chosen.includes(r) && !tasksCovered.has(r.task)) {
      chosen.push(r);
      tasksCovered.add(r.task);
    }
  }
  for (const r of usable) {
    if (chosen.length >= 6) break;
    if (!chosen.includes(r)) chosen.push(r);
  }
  if (chosen.length < 6) throw new Error(`session has only ${chosen.length} usable requests, need 6`);
  chosen.sort((a, b) => order(a) - order(b));

  // Keep a normal card after the last planted one when the session allows it.
  const last = chosen[chosen.length - 1];
  if (anchors.has(last.request_id)) {
    const later = usable.find((r) => order(r) > order(last) && !chosen.includes(r));
    const droppable = chosen.find((r) => !anchors.has(r.request_id));
    if (later && droppable) {
      chosen.splice(chosen.indexOf(droppable), 1);
      chosen.push(later);
      chosen.sort((a, b) => order(a) - order(b));
    }
  }

  const cards: QueueCard[] = [];
  const push = (c: Omit<QueueCard, "id">) => cards.push({ ...c, id: `${queueId}-${cards.length + 1}` });
  for (const r of chosen) {
    push({ task: r.task, command: r.command, isRisky: false, source: "session", source_id: r.request_id });
    planted.forEach((p, i) => {
      if (p.after_request_id === r.request_id) {
        push({
          task: p.task,
          command: p.command,
          isRisky: true,
          risk_type: p.risk_type,
          denialReason: p.why_deny,
          source: "planted",
          source_id: `P${i + 1}`
        });
      }
    });
  }
  return cards;
}

/** Risk type pairs, one per queue, so the queues differ and cover all six types. */
export const RISK_PAIRS: Array<[RiskType, RiskType]> = [
  ["destructive", "secrets leaving"],
  ["exposure", "unknown software"],
  ["access rights", "unsafe shortcut"],
  ["secrets leaving", "exposure"],
  ["unknown software", "destructive"],
  ["unsafe shortcut", "access rights"]
];
