import fs from "node:fs";
import path from "node:path";

const JOURNAL_DIR = "./data";
const DEFAULT_JOURNAL_FILE = "workflow-actions.jsonl";
const LIFECYCLE_STATES = new Set([
  "intent",
  "close_observed_pending_redeploy",
  "completed",
  "manual_review",
]);

let journalPathOverride = null;

export function getActionJournalPath() {
  if (journalPathOverride) return journalPathOverride;
  return path.join(JOURNAL_DIR, DEFAULT_JOURNAL_FILE);
}

export function setActionJournalPathForTests(filePath = null) {
  journalPathOverride = filePath;
}

export function appendActionLifecycle(record) {
  if (!record || typeof record !== "object") {
    throw new Error("action journal record must be an object");
  }
  if (!LIFECYCLE_STATES.has(record.lifecycle)) {
    throw new Error(`invalid lifecycle state: ${record.lifecycle}`);
  }

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...record,
  });

  const targetPath = getActionJournalPath();
  const parentDir = path.dirname(targetPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  fs.appendFileSync(targetPath, `${line}\n`);
}

export function readActionJournal() {
  const targetPath = getActionJournalPath();
  if (!fs.existsSync(targetPath)) {
    return { entries: [], parse_errors: [] };
  }

  const raw = fs.readFileSync(targetPath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const entries = [];
  const parseErrors = [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    try {
      const parsed = JSON.parse(lines[index]);
      entries.push(parsed);
    } catch (error) {
      parseErrors.push({ line: lineNumber, error: error.message });
    }
  }

  return {
    entries,
    parse_errors: parseErrors,
  };
}

export function foldActionJournal(entries) {
  const workflows = new Map();

  for (const entry of entries || []) {
    if (!entry || typeof entry !== "object") continue;
    if (!entry.workflow_id) continue;
    if (!LIFECYCLE_STATES.has(entry.lifecycle)) continue;

    const current = workflows.get(entry.workflow_id) || {
      workflow_id: entry.workflow_id,
      first_ts: entry.ts || null,
      last_ts: entry.ts || null,
      tool: entry.tool || null,
      cycle_id: entry.cycle_id || null,
      action_id: entry.action_id || null,
      position_address: entry.position_address || null,
      pool_address: entry.pool_address || null,
      lifecycle: entry.lifecycle,
      history: [],
    };

    current.tool = entry.tool || current.tool;
    current.cycle_id = entry.cycle_id || current.cycle_id;
    current.action_id = entry.action_id || current.action_id;
    current.position_address = entry.position_address || current.position_address;
    current.pool_address = entry.pool_address || current.pool_address;
    current.last_ts = entry.ts || current.last_ts;
    current.lifecycle = entry.lifecycle;
    current.history.push({
      ts: entry.ts || null,
      lifecycle: entry.lifecycle,
      reason: entry.reason || null,
    });

    workflows.set(entry.workflow_id, current);
  }

  return Array.from(workflows.values());
}

export function listActionJournalEntries(limit = 20) {
  const journal = readActionJournal();
  return journal.entries.slice(-limit).reverse();
}
