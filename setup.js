/**
 * Interactive setup wizard.
 * Runs before the agent starts. Saves settings to user-config.json.
 * Run: npm run setup
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { getMutableConfigEntry } from "./config-registry.js";
import { buildDefaultHeliusRpcUrl } from "./rpc-config.js";
import { getEffectiveMinSolToOpen } from "./runtime-helpers.js";
import { buildIntervalCron } from "./schedule-runtime.js";
import { readUserConfigSnapshot, writeUserConfigSnapshot } from "./user-config-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, ".env");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultVal) {
  return new Promise((resolve) => {
    const hint = defaultVal !== undefined ? ` (default: ${defaultVal})` : "";
    rl.question(`${question}${hint}: `, (ans) => {
      const trimmed = ans.trim();
      resolve(trimmed === "" ? defaultVal : trimmed);
    });
  });
}

function askOptional(question, { defaultVal, blankHint = null } = {}) {
	return new Promise((resolve) => {
		const hint = defaultVal !== undefined
			? ` (default: ${defaultVal})`
			: blankHint
				? ` (${blankHint})`
				: "";
		rl.question(`${question}${hint}: `, (ans) => {
			const trimmed = ans.trim();
			resolve(trimmed === "" ? defaultVal : trimmed);
		});
	});
}

function askSecret(question, { hasExisting = false } = {}) {
  return new Promise((resolve) => {
    const hint = hasExisting ? " (leave blank to keep existing value)" : "";
    const originalWrite = rl._writeToOutput;
    rl.stdoutMuted = true;
    rl._writeToOutput = function writeMasked(stringToWrite) {
      if (!rl.stdoutMuted) {
        originalWrite.call(rl, stringToWrite);
        return;
      }
      if (stringToWrite.includes(": ")) {
        originalWrite.call(rl, stringToWrite);
        return;
      }
      originalWrite.call(rl, "*");
    };

    rl.question(`${question}${hint}: `, (ans) => {
      rl.stdoutMuted = false;
      rl._writeToOutput = originalWrite;
      process.stdout.write("\n");
      resolve(ans.trim());
    });
  });
}

async function askRequiredSecret(question, { existingValue = "" } = {}) {
	while (true) {
		const answer = await askSecret(question, { hasExisting: Boolean(existingValue) });
		const finalValue = String(answer || existingValue || "").trim();
		if (finalValue) return finalValue;
		console.log("  ⚠ This value is required.");
	}
}

function askNum(question, defaultVal, { min, max } = {}) {
  return (async () => {
    while (true) {
      const raw = await ask(question, defaultVal);
      const n = parseFloat(raw);
      if (Number.isNaN(n))                 { console.log(`  ⚠ Please enter a number.`); continue; }
      if (min !== undefined && n < min)    { console.log(`  ⚠ Minimum is ${min}.`);     continue; }
      if (max !== undefined && n > max)    { console.log(`  ⚠ Maximum is ${max}.`);     continue; }
      return n;
    }
  })();
}

function askChoice(question, choices) {
  return (async () => {
    const labels = choices.map((c, i) => `  ${i + 1}. ${c.label}`).join("\n");
    while (true) {
      console.log(`\n${question}`);
      console.log(labels);
      const raw = await ask("Enter number", "");
      const idx = parseInt(raw, 10) - 1;
      if (idx >= 0 && idx < choices.length) return choices[idx];
      console.log("  ⚠ Invalid choice.");
    }
  })();
}

function askEnum(question, defaultVal, values) {
	return (async () => {
		while (true) {
			const raw = await ask(question, defaultVal);
			if (values.includes(raw)) return raw;
			console.log(`  ⚠ Allowed values: ${values.join(", ")}`);
		}
	})();
}

function askScheduleInterval(question, defaultVal) {
	return (async () => {
		while (true) {
			const raw = await askNum(question, defaultVal, { min: 1, max: 1440 });
			try {
				buildIntervalCron(raw);
				return raw;
			} catch (error) {
				console.log(`  ⚠ ${error.message}`);
			}
		}
	})();
}

function askOptionalNumber(question, { defaultVal, blankHint = null, min, max } = {}) {
	return (async () => {
		while (true) {
			const hint = defaultVal != null
				? ` (default: ${defaultVal})`
				: blankHint
					? ` (${blankHint})`
					: "";
			const raw = await new Promise((resolve) => rl.question(`${question}${hint}: `, (ans) => resolve(ans.trim())));
			if (raw === "") return defaultVal ?? null;
			const n = parseFloat(raw);
			if (Number.isNaN(n)) { console.log("  ⚠ Please enter a number or leave blank."); continue; }
			if (min !== undefined && n < min) { console.log(`  ⚠ Minimum is ${min}.`); continue; }
			if (max !== undefined && n > max) { console.log(`  ⚠ Maximum is ${max}.`); continue; }
			return n;
		}
	})();
}

function askStringArray(question, { defaultVal = [], blankHint = null } = {}) {
	return (async () => {
		const normalizedDefault = Array.isArray(defaultVal) ? defaultVal.filter((value) => typeof value === "string" && value.trim().length > 0) : [];
		const hint = normalizedDefault.length > 0
			? ` (default: ${normalizedDefault.join(", ")})`
			: blankHint
				? ` (${blankHint})`
				: "";
		const raw = await new Promise((resolve) => rl.question(`${question}${hint}: `, (ans) => resolve(ans.trim())));
		if (raw === "") return normalizedDefault;
		return [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
	})();
}

function upsertEnvValue(key, value) {
  const safeValue = String(value || "").trim();
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const nextLine = `${key}=${safeValue}`;
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = nextLine;
  } else {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push(nextLine);
  }
  fs.writeFileSync(ENV_PATH, `${lines.join("\n").replace(/\n*$/, "")}\n`);
}

// ─── Presets ──────────────────────────────────────────────────────────────────
const PRESETS = {
  degen: {
    label:                 "🔥 Degen",
    timeframe:             "30m",
    minOrganic:            60,
    minHolders:            400,
    maxMcap:               5_000_000,
    takeProfitFeePct:      10,
    outOfRangeWaitMinutes: 15,
    managementIntervalMin: 5,
    screeningIntervalMin:  15,
    description: "30m timeframe, pumping tokens allowed, fast cycles. High risk/reward.",
  },
  moderate: {
    label:                 "⚖️  Moderate",
    timeframe:             "4h",
    minOrganic:            65,
    minHolders:            750,
    maxMcap:               10_000_000,
    takeProfitFeePct:      5,
    outOfRangeWaitMinutes: 30,
    managementIntervalMin: 10,
    screeningIntervalMin:  30,
    description: "4h timeframe, balanced risk/reward. Recommended for most users.",
  },
  safe: {
    label:                 "🛡️  Safe",
    timeframe:             "24h",
    minOrganic:            75,
    minHolders:            1200,
    maxMcap:               10_000_000,
    takeProfitFeePct:      3,
    outOfRangeWaitMinutes: 60,
    managementIntervalMin: 15,
    screeningIntervalMin:  60,
    description: "24h timeframe, stable pools only, avoids pumps. Lower yield, lower risk.",
  },
};

// Load existing config
const existingSnapshot = readUserConfigSnapshot();
if (!existingSnapshot.ok) {
	throw new Error(existingSnapshot.error);
}
const existing = existingSnapshot.value;

const e = (key, fallback) => existing[key] ?? fallback;

console.log(`
╔═══════════════════════════════════════════╗
║       DLMM LP Agent — Setup Wizard        ║
╚═══════════════════════════════════════════╝
`);

// ─── Preset selection ─────────────────────────────────────────────────────────
const presetChoice = await askChoice("Select a risk preset:", [
  { label: `Degen    — ${PRESETS.degen.description}`,    key: "degen"    },
  { label: `Moderate — ${PRESETS.moderate.description}`, key: "moderate" },
  { label: `Safe     — ${PRESETS.safe.description}`,     key: "safe"     },
  { label: "Custom   — Configure every setting manually", key: "custom"  },
]);

const preset = presetChoice.key === "custom" ? null : PRESETS[presetChoice.key];

console.log(preset
  ? `\n✓ Using ${preset.label} preset. You can still override individual values below.\n`
  : `\nCustom mode — configure everything manually.\n`
);

const p = (key, fallback) => preset?.[key] ?? e(key, fallback);

// ─── Wallet & RPC ─────────────────────────────────────────────────────────────
console.log("── Wallet & RPC ──────────────────────────────");

const existingHeliusApiKey = process.env.HELIUS_API_KEY || "";
const finalHeliusApiKey = await askRequiredSecret(
	"Helius API key (required for wallet balances/startup health)",
	{ existingValue: existingHeliusApiKey },
);
const rpcUrl = await askOptional(
	"RPC URL override",
		e("rpcUrl", process.env.RPC_URL)
			? { defaultVal: e("rpcUrl", process.env.RPC_URL) }
			: {
				blankHint: `leave blank to use default Helius Gatekeeper beta RPC (${buildDefaultHeliusRpcUrl(finalHeliusApiKey)})`,
			},
);

const existingWalletPrivateKey = process.env.WALLET_PRIVATE_KEY || "";
const walletPrivateKeyInput = await askSecret("Wallet private key (base58)", { hasExisting: Boolean(existingWalletPrivateKey) });
const finalWalletPrivateKey = walletPrivateKeyInput || existingWalletPrivateKey;

// ─── Deployment ───────────────────────────────────────────────────────────────
console.log("\n── Deployment ────────────────────────────────");

const deployAmountSol = await askNum(
  "SOL to deploy per position",
  e("deployAmountSol", 0.3),
  { min: 0.01, max: 50 }
);

const maxPositions = await askNum(
  "Max concurrent positions",
  e("maxPositions", 3),
  { min: 1, max: 10 }
);

const minSolToOpen = await askNum(
  "Min SOL balance to open a new position",
  e("minSolToOpen", getEffectiveMinSolToOpen({ minSolToOpen: 0.55, deployAmountSol, gasReserve: 0.2 })),
  { min: 0.05 }
);

const maxDeployAmount = await askNum(
  "Max SOL per single position (safety cap)",
  e("maxDeployAmount", 50),
  { min: deployAmountSol }
);

const gasReserve = await askNum(
	"SOL gas reserve to keep free",
	e("gasReserve", 0.2),
	{ min: 0 }
);

// ─── Risk ─────────────────────────────────────────────────────────────────────
console.log("\n── Risk & Filters ────────────────────────────");

const timeframe = await askEnum(
	"Pool discovery timeframe",
	p("timeframe", "4h"),
	getMutableConfigEntry("timeframe").values,
);

const minOrganic = await askNum(
  "Min organic score (0-100)",
  p("minOrganic", 65),
  { min: 0, max: 100 }
);

const minHolders = await askNum(
  "Min token holders",
	 p("minHolders", 750),
  { min: 1 }
);

const maxMcap = await askNum(
  "Max token market cap USD",
  p("maxMcap", 10_000_000),
  { min: 100_000 }
);

const maxBotHoldersPct = await askOptionalNumber(
	"Max bot-holder percentage (blank = disabled)",
	{ defaultVal: e("maxBotHoldersPct", undefined), blankHint: "leave blank to disable", min: 0, max: 100 },
);

const athFilterPct = await askOptionalNumber(
	"ATH filter percentage (blank = disabled, -20 means at least 20% below ATH)",
	{ defaultVal: e("athFilterPct", undefined), blankHint: "leave blank to disable", min: -100, max: 0 },
);

const blockedLaunchpads = await askStringArray(
	"Blocked launchpads (comma-separated, blank = none)",
	{ defaultVal: e("blockedLaunchpads", []), blankHint: "leave blank for none" },
);

// ─── Exit ─────────────────────────────────────────────────────────────────────
console.log("\n── Exit Rules ────────────────────────────────");

const takeProfitFeePct = await askNum(
  "Take profit when fees earned >= X% of deployed capital",
  p("takeProfitFeePct", 5),
  { min: 0.1, max: 100 }
);

const outOfRangeWaitMinutes = await askNum(
  "Minutes out-of-range before closing",
  p("outOfRangeWaitMinutes", 30),
  { min: 1 }
);

// ─── Scheduling ───────────────────────────────────────────────────────────────
console.log("\n── Scheduling ────────────────────────────────");

const managementIntervalMin = await askScheduleInterval(
  "Management cycle interval (minutes)",
  p("managementIntervalMin", 10),
);

const screeningIntervalMin = await askScheduleInterval(
  "Screening cycle interval (minutes)",
  p("screeningIntervalMin", 30),
);

const healthCheckIntervalMin = await askScheduleInterval(
	"Health check interval (minutes)",
	e("healthCheckIntervalMin", 60),
);

// ─── LLM ──────────────────────────────────────────────────────────────────────
console.log("\n── LLM ───────────────────────────────────────");

const defaultModel = await ask(
	"Default LLM model for management/screening/general",
	e("managementModel", e("screeningModel", e("generalModel", e("llmModel", process.env.LLM_MODEL || "qwen/qwen3.6-plus:free")))),
);

const dryRun = await ask(
  "Dry run mode? (true = no real transactions)",
  e("dryRun", "false")
);

rl.close();

// ─── Save ──────────────────────────────────────────────────────────────────────
const userConfig = {
  ...(rpcUrl ? { rpcUrl } : {}),
  deployAmountSol,
  maxPositions,
  maxDeployAmount,
  gasReserve,
  minSolToOpen: getEffectiveMinSolToOpen({ minSolToOpen, deployAmountSol, gasReserve }),
  timeframe,
	minOrganic,
	minHolders,
	maxTop10Pct: p("maxTop10Pct", 30),
	maxBotHoldersPct,
	blockedLaunchpads,
	athFilterPct,
	minTokenAgeHours: p("minTokenAgeHours", 24),
	maxTokenAgeHours: p("maxTokenAgeHours", 240),
	maxMcap,
	takeProfitFeePct,
  outOfRangeWaitMinutes,
  managementIntervalMin,
  screeningIntervalMin,
  healthCheckIntervalMin,
		managementModel: defaultModel,
		screeningModel: defaultModel,
		generalModel: defaultModel,
  dryRun: dryRun === "true",
};

writeUserConfigSnapshot(userConfig);
if (finalWalletPrivateKey) {
  upsertEnvValue("WALLET_PRIVATE_KEY", finalWalletPrivateKey);
}
upsertEnvValue("HELIUS_API_KEY", finalHeliusApiKey);

const presetName = preset ? preset.label : "Custom";

console.log(`
╔═══════════════════════════════════════════╗
║           Configuration Saved             ║
╚═══════════════════════════════════════════╝

Preset:       ${presetName}
Timeframe:    ${timeframe}

  Deploy:     ${deployAmountSol} SOL/position  |  Max: ${maxPositions} positions
  Min balance: ${minSolToOpen} SOL to open
  Take profit: fees >= ${takeProfitFeePct}%
  Organic:     min ${minOrganic}
  Holders:     min ${minHolders}

Wallet private key + Helius API key saved to .env (not user-config.json)
  RPC:         ${rpcUrl || "default Helius via HELIUS_API_KEY"}
  Max mcap:    $${maxMcap.toLocaleString()}
  Gas reserve: ${gasReserve} SOL
  OOR close:   after ${outOfRangeWaitMinutes} min
  Mgmt:        every ${managementIntervalMin} min
  Screening:   every ${screeningIntervalMin} min
  Health:      every ${healthCheckIntervalMin} min
		Model:       ${defaultModel}
  Dry run:     ${dryRun}

Run "npm start" to launch the agent.
`);
