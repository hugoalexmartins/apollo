import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR = "./logs/evidence";

export function writeEvidenceBundle(bundle) {
  if (!bundle?.cycle_id) return null;
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  const safeCycleId = String(bundle.cycle_id).replace(/[^a-zA-Z0-9:_-]/g, "_");
  const filePath = path.join(EVIDENCE_DIR, `${safeCycleId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2));
  return filePath;
}

export function listEvidenceBundles(limit = 5) {
  if (!fs.existsSync(EVIDENCE_DIR)) return [];
  return fs.readdirSync(EVIDENCE_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit)
    .map((file) => {
      const fullPath = path.join(EVIDENCE_DIR, file);
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      return {
        file,
        cycle_id: parsed.cycle_id,
        cycle_type: parsed.cycle_type,
        status: parsed.status,
        reason_code: parsed.reason_code || null,
        error: parsed.error || null,
        written_at: parsed.written_at || null,
      };
    });
}
