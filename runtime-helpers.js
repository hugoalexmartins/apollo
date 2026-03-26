export function getRequiredSolBalance({ deployAmountSol = 0, gasReserve = 0 }) {
  const required = Number(deployAmountSol) + Number(gasReserve);
  return Number(required.toFixed(3));
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
    ["timeframe", screening.timeframe],
  ];
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
