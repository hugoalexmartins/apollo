import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	appendJsonlRecordSync,
	readJsonSnapshotWithBackupSync,
	writeJsonSnapshotAtomicSync,
} from "./durable-store.js";

test("durable store falls back to backup when primary snapshot is corrupt", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-durable-store-snapshot-test-"));
	const filePath = path.join(tempDir, "state.json");

	try {
		writeJsonSnapshotAtomicSync(filePath, { version: 1 });
		writeJsonSnapshotAtomicSync(filePath, { version: 2 });
		assert.equal(fs.existsSync(`${filePath}.bak`), true);

		fs.writeFileSync(filePath, "{bad json");
		const snapshot = readJsonSnapshotWithBackupSync(filePath);
		assert.equal(snapshot.source, "backup");
		assert.equal(snapshot.value.version, 1);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("durable store appends parseable jsonl records", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-durable-store-jsonl-test-"));
	const filePath = path.join(tempDir, "events.jsonl");

	try {
		appendJsonlRecordSync(filePath, { id: 1, status: "ok" });
		appendJsonlRecordSync(filePath, { id: 2, status: "done" });
		const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
		assert.deepEqual(lines, [
			{ id: 1, status: "ok" },
			{ id: 2, status: "done" },
		]);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
