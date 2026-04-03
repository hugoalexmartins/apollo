export function getRequiredSolBalance({ deployAmountSol = 0, gasReserve = 0 }) {
  const required = Number(deployAmountSol) + Number(gasReserve);
  return Number(required.toFixed(3));
}

function normalizeNonNegativeAmountField(value, fieldName) {
	const provided = !(value == null || value === "");
	if (!provided) {
		return {
			provided: false,
			value: 0,
			invalid_field: null,
		};
	}
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric < 0) {
		return {
			provided: true,
			value: 0,
			invalid_field: fieldName,
		};
	}
	return {
		provided: true,
		value: numeric,
		invalid_field: null,
	};
}

export function normalizeDeployAmounts({
	amount_x = null,
	amount_y = null,
	amount_sol = null,
	defaultAmountY = 0,
	additionalInvalidFields = [],
} = {}) {
	const parsedAmountX = normalizeNonNegativeAmountField(amount_x, "amount_x");
	const parsedAmountY = normalizeNonNegativeAmountField(amount_y, "amount_y");
	const parsedAmountSol = normalizeNonNegativeAmountField(amount_sol, "amount_sol");
	const aliasConflict = parsedAmountY.provided
		&& parsedAmountSol.provided
		&& !parsedAmountY.invalid_field
		&& !parsedAmountSol.invalid_field
		&& parsedAmountY.value !== parsedAmountSol.value;
	let amountY = parsedAmountY.provided
		? parsedAmountY.value
		: parsedAmountSol.provided
			? parsedAmountSol.value
			: parsedAmountX.value <= 0
				? Number(defaultAmountY) || 0
				: 0;
	if (!Number.isFinite(amountY) || amountY < 0) amountY = 0;
	const invalid_fields = [
		parsedAmountX.invalid_field,
		parsedAmountY.invalid_field,
		parsedAmountSol.invalid_field,
		aliasConflict ? "amount_y_vs_amount_sol" : null,
		...additionalInvalidFields,
	].filter(Boolean);
	return {
		amount_x: Number(parsedAmountX.value.toFixed(9)),
		amount_y: Number(amountY.toFixed(9)),
		amount_sol: Number(amountY.toFixed(9)),
		invalid_fields,
		has_invalid_amounts: invalid_fields.length > 0,
	};
}

export function getWalletTokenBalanceFromSnapshot(walletSnapshot = null, mint = null) {
	if (!walletSnapshot || !mint) return null;
	const tokens = Array.isArray(walletSnapshot.tokens) ? walletSnapshot.tokens : null;
	if (!tokens) return null;
	const entry = tokens.find((token) => token?.mint === mint);
	if (!entry) return 0;
	const balance = Number(entry.balance);
	return Number.isFinite(balance) ? balance : null;
}

export function getEffectiveMinSolToOpen({
  minSolToOpen = 0,
  deployAmountSol = 0,
  gasReserve = 0,
}) {
  return Math.max(Number(minSolToOpen) || 0, getRequiredSolBalance({ deployAmountSol, gasReserve }));
}

export function getScreeningThresholdSummary(screening) {
  return [
    ["minFeeActiveTvlRatio", screening.minFeeActiveTvlRatio],
    ["minTokenFeesSol", screening.minTokenFeesSol],
    ["maxBundlersPct", screening.maxBundlersPct],
    ["maxTop10Pct", screening.maxTop10Pct],
    ["minOrganic", screening.minOrganic],
    ["minHolders", screening.minHolders],
    ["minVolume", screening.minVolume],
    ["minTokenAgeHours", screening.minTokenAgeHours],
    ["maxTokenAgeHours", screening.maxTokenAgeHours],
    ["timeframe", screening.timeframe],
  ];
}

export function buildOpenPositionPnlInputs(positions = []) {
	return (Array.isArray(positions) ? positions : [])
		.map((position) => ({
			pnl_usd: position?.pnl_usd,
			pnl_pct: position?.pnl_pct,
			unknown:
				position?.pnl_missing === true ||
				position?.pnl_unavailable === true ||
				position?.stale === true ||
				position?.status === "stale",
		}))
		.filter((position) => position.unknown || Number.isFinite(Number(position.pnl_usd)) || Number.isFinite(Number(position.pnl_pct)));
}

export function normalizeOptionalNonNegativeNumber(value, fallback = null) {
  if (value == null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return num;
}

export function estimateInitialValueUsd({ amountSol = 0, solPrice = 0, amountToken = 0, activePrice = 0 }) {
  const solLeg = Number(amountSol) || 0;
  const tokenLeg = Number(amountToken) || 0;
  const price = Number(activePrice) || 0;
  const usdPerSol = Number(solPrice) || 0;

  if (usdPerSol <= 0) return 0;
  if (solLeg > 0) return Math.round(solLeg * usdPerSol * 100) / 100;
  if (tokenLeg > 0 && price > 0) {
    const estimatedSol = tokenLeg / price;
    return Math.round(estimatedSol * usdPerSol * 100) / 100;
  }
  return 0;
}

export function computeAdaptiveDeployAmount({
  walletSol = 0,
  reserve = 0,
  floor = 0,
  ceil = Number.POSITIVE_INFINITY,
  positionSizePct = 0,
  regimeMultiplier = 1,
  performanceMultiplier = 1,
  riskMultiplier = 1,
  skipBelowFloor = true,
} = {}) {
  const normalizedWalletSol = Number(walletSol);
  const normalizedReserve = Number(reserve);
  const normalizedFloor = Number(floor);
  const normalizedCeil = Number(ceil);
  const normalizedPct = Number(positionSizePct);
  const normalizedRegimeMultiplier = Number(regimeMultiplier);
  const normalizedPerformanceMultiplier = Number(performanceMultiplier);
  const normalizedRiskMultiplier = Number(riskMultiplier);

  if (!Number.isFinite(normalizedWalletSol) || normalizedWalletSol <= 0) return 0;
  if (!Number.isFinite(normalizedReserve) || normalizedReserve < 0) return 0;
  if (!Number.isFinite(normalizedFloor) || normalizedFloor < 0) return 0;
  if (!Number.isFinite(normalizedCeil) || normalizedCeil <= 0) return 0;
  if (!Number.isFinite(normalizedPct) || normalizedPct <= 0) return 0;
  if (!Number.isFinite(normalizedRegimeMultiplier) || normalizedRegimeMultiplier <= 0) return 0;
  if (!Number.isFinite(normalizedPerformanceMultiplier) || normalizedPerformanceMultiplier <= 0) return 0;
  if (!Number.isFinite(normalizedRiskMultiplier) || normalizedRiskMultiplier <= 0) return 0;

  const deployable = Math.max(0, normalizedWalletSol - normalizedReserve);
  if (deployable <= 0) return 0;

  const scaled = deployable
    * normalizedPct
    * normalizedRegimeMultiplier
    * normalizedPerformanceMultiplier
    * normalizedRiskMultiplier;

  const cappedScaled = Math.min(deployable, normalizedCeil, Math.max(0, scaled));
  if (skipBelowFloor && deployable < normalizedFloor) return 0;

  const floored = Math.max(normalizedFloor, cappedScaled);
  const result = Math.min(deployable, normalizedCeil, floored);

  if (!Number.isFinite(result) || result <= 0) return 0;
  return Number(result.toFixed(2));
}
