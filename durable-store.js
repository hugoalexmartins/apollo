import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function ensureParentDir(filePath) {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function getBackupPath(filePath) {
	return `${filePath}.bak`;
}

export function writeJsonSnapshotAtomicSync(
	filePath,
	value,
	{ trailingNewline = false } = {},
) {
	ensureParentDir(filePath);
	const dir = path.dirname(filePath);
	const base = path.basename(filePath);
	const tmpPath = path.join(
		dir,
		`.${base}.${process.pid}.${crypto.randomUUID()}.tmp`,
	);
	const backupPath = getBackupPath(filePath);
	const payload = JSON.stringify(value, null, 2) + (trailingNewline ? "\n" : "");
	const fd = fs.openSync(tmpPath, "w");
	try {
		fs.writeFileSync(fd, payload, "utf8");
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}

	if (fs.existsSync(filePath)) {
		if (fs.existsSync(backupPath)) {
			fs.rmSync(backupPath, { force: true });
		}
		fs.renameSync(filePath, backupPath);
	}

	try {
		fs.renameSync(tmpPath, filePath);
	} catch (error) {
		if (fs.existsSync(backupPath) && !fs.existsSync(filePath)) {
			fs.renameSync(backupPath, filePath);
		}
		if (fs.existsSync(tmpPath)) {
			fs.rmSync(tmpPath, { force: true });
		}
		throw error;
	}
}

export function readJsonSnapshotWithBackupSync(filePath) {
	const backupPath = getBackupPath(filePath);
	const errors = [];
	for (const candidate of [filePath, backupPath]) {
		if (!fs.existsSync(candidate)) continue;
		try {
			return {
				value: JSON.parse(fs.readFileSync(candidate, "utf8")),
				source: candidate === filePath ? "primary" : "backup",
			};
		} catch (error) {
			errors.push(`${path.basename(candidate)}: ${error.message}`);
		}
	}
	return {
		value: null,
		source: null,
		error: errors.length > 0 ? errors.join(" | ") : null,
	};
}

export function appendJsonlRecordSync(filePath, record, { fsync = true } = {}) {
	ensureParentDir(filePath);
	const fd = fs.openSync(filePath, "a");
	try {
		fs.writeSync(fd, `${JSON.stringify(record)}\n`, undefined, "utf8");
		if (fsync) {
			fs.fsyncSync(fd);
		}
	} finally {
		fs.closeSync(fd);
	}
}
