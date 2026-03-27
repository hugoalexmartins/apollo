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

export function getEvidenceBundle(identifier) {
  if (!identifier || !fs.existsSync(EVIDENCE_DIR)) return null;
  const fileName = String(identifier).endsWith(".json") ? String(identifier) : `${String(identifier)}.json`;
  const directPath = path.join(EVIDENCE_DIR, fileName);
  if (fs.existsSync(directPath)) {
    return JSON.parse(fs.readFileSync(directPath, "utf8"));
  }

  const matches = fs.readdirSync(EVIDENCE_DIR)
    .filter((file) => file.endsWith(".json") && file.includes(String(identifier)));
  if (matches.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, matches[0]), "utf8"));
}
