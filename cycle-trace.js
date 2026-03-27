import fs from "node:fs";
import path from "node:path";

const TRACE_DIR = "./logs";

export function createCycleId(cycleType) {
  return `${cycleType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createActionId(cycleId, toolName, index = 0) {
  return `${cycleId}:${toolName}:${index + 1}`;
}

export function appendReplayEnvelope(envelope) {
  if (!fs.existsSync(TRACE_DIR)) {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
  }
  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split("T")[0];
  const file = path.join(TRACE_DIR, `replay-${dateStr}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify({ timestamp, ...envelope })}\n`);
}

export function readReplayEnvelopes() {
  if (!fs.existsSync(TRACE_DIR)) return [];
  const files = fs.readdirSync(TRACE_DIR)
    .filter((file) => /^replay-.*\.jsonl$/.test(file))
    .sort();
  const envelopes = [];

  for (const file of files) {
    const fullPath = path.join(TRACE_DIR, file);
    const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        envelopes.push(JSON.parse(line));
      } catch {
        // ignore malformed replay lines in read path
      }
    }
  }

  return envelopes;
}

export function getReplayEnvelope(cycleId) {
  return readReplayEnvelopes().find((envelope) => envelope.cycle_id === cycleId) || null;
}
