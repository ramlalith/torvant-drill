// One stored card text per unique request (task + command), shared by every queue.
// Written once by `npm run cards:unify`; the play path only reads it.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { StoredCardText } from "./card_text";

export const REQUEST_TEXT_PATH = path.resolve(process.cwd(), "data/request_text.json");

export interface RequestText extends StoredCardText {
  task: string;
  command: string;
}

export interface RequestTextFile {
  generated_at: string;
  model: string;
  requests: Record<string, RequestText>;
}

export function requestKey(task: string, command: string): string {
  return crypto.createHash("sha256").update(`${task}\n${command}`).digest("hex").slice(0, 16);
}

let cache: { mtimeMs: number; data: RequestTextFile | null } = { mtimeMs: -1, data: null };

export function loadRequestText(): RequestTextFile | null {
  try {
    const st = fs.statSync(REQUEST_TEXT_PATH);
    if (st.mtimeMs !== cache.mtimeMs) {
      cache = { mtimeMs: st.mtimeMs, data: JSON.parse(fs.readFileSync(REQUEST_TEXT_PATH, "utf-8")) };
    }
    return cache.data;
  } catch {
    return null;
  }
}

export function textForRequest(task: string, command: string): RequestText | undefined {
  return loadRequestText()?.requests[requestKey(task, command)];
}
