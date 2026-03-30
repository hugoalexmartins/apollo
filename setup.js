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
    minHolders:            200,
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
    minHolders:            500,
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
    minHolders:            1000,
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

const rpcUrl = await ask(
  "RPC URL",
  e("rpcUrl", process.env.RPC_URL || "https://api.mainnet-beta.solana.com")
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
  p("minHolders", 500),
  { min: 1 }
);

const maxMcap = await askNum(
  "Max token market cap USD",
  p("maxMcap", 10_000_000),
  { min: 100_000 }
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
	e("managementModel", e("screeningModel", e("generalModel", e("llmModel", process.env.LLM_MODEL || "nousresearch/hermes-3-llama-3.1-405b")))),
);

const dryRun = await ask(
  "Dry run mode? (true = no real transactions)",
  e("dryRun", "false")
);

rl.close();

// ─── Save ──────────────────────────────────────────────────────────────────────
const userConfig = {
  rpcUrl,
  deployAmountSol,
  maxPositions,
  maxDeployAmount,
  gasReserve,
  minSolToOpen: getEffectiveMinSolToOpen({ minSolToOpen, deployAmountSol, gasReserve }),
  timeframe,
  minOrganic,
  minHolders,
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

Wallet private key saved to .env (not user-config.json)
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
