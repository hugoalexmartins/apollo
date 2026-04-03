function toNullableFiniteNumber(value) {
	const num = Number(value);
	return Number.isFinite(num) ? num : null;
}

const DEFAULT_SOL_MINT = "So11111111111111111111111111111111111111112";

function normalizeMintLabel(mint) {
	return typeof mint === "string" ? mint.trim() : "";
}

function isSolMintLabel(mint, solMint = DEFAULT_SOL_MINT) {
	const normalizedMint = normalizeMintLabel(mint);
	const normalizedSolMint = normalizeMintLabel(solMint || DEFAULT_SOL_MINT);
	return Boolean(normalizedMint)
		&& (normalizedMint === normalizedSolMint
			|| normalizedMint === "SOL"
			|| normalizedMint === "native");
}

function findTokenBalanceByMint(walletBalances, mint, normalizeMint) {
	if (!mint || !walletBalances || !Array.isArray(walletBalances.tokens)) return null;
	const normalizedMint = normalizeMint(mint);
	return walletBalances.tokens.find((token) => normalizeMint(token.mint) === normalizedMint) || null;
}

function getWalletBalanceByMint(walletBalances, mint, { normalizeMint, solMint }) {
	const normalizedMint = normalizeMint(mint);
	if (normalizedMint === solMint) {
		return toNullableFiniteNumber(walletBalances?.sol);
	}

	const token = findTokenBalanceByMint(walletBalances, normalizedMint, normalizeMint);
	if (!token) return 0;
	return toNullableFiniteNumber(token.balance);
}

export async function captureBalanceSnapshotForMints({
	token_x_mint,
	token_y_mint,
	phase,
	getWalletBalances,
	normalizeMint,
	solMint,
}) {
	const balances = await getWalletBalances();
	if (balances?.error) {
		return {
			error: `Unable to load wallet balances ${phase}: ${balances.error}`,
		};
	}

	const tokenXAmount = getWalletBalanceByMint(balances, token_x_mint, {
		normalizeMint,
		solMint,
	});
	const tokenYAmount = getWalletBalanceByMint(balances, token_y_mint, {
		normalizeMint,
		solMint,
	});

	if (tokenXAmount == null || tokenYAmount == null) {
		return {
			error: `Unable to read token balances ${phase} for pool token mints`,
		};
	}

	return {
		token_x_mint: normalizeMint(token_x_mint),
		token_y_mint: normalizeMint(token_y_mint),
		amount_x: tokenXAmount,
		amount_y: tokenYAmount,
		sampled_at: new Date().toISOString(),
	};
}

export async function resolvePoolTokenMints({ poolAddress, getPool }) {
	if (!poolAddress) return null;
	try {
		const pool = await getPool(poolAddress);
		return {
			token_x_mint: pool?.lbPair?.tokenXMint?.toString() || null,
			token_y_mint: pool?.lbPair?.tokenYMint?.toString() || null,
		};
	} catch (error) {
		return { error: error.message };
	}
}

export function resolveCanonicalPoolIdentity({
	token_x_mint = null,
	token_y_mint = null,
	solMint = null,
} = {}) {
	const tokenXMint = normalizeMintLabel(token_x_mint);
	const tokenYMint = normalizeMintLabel(token_y_mint);
	const normalizedSolMint = normalizeMintLabel(solMint || DEFAULT_SOL_MINT);
	const tokenXIsSol = isSolMintLabel(tokenXMint, normalizedSolMint);
	const tokenYIsSol = isSolMintLabel(tokenYMint, normalizedSolMint);

	let riskMint = null;
	let riskTokenSide = null;
	if (tokenXIsSol && tokenYIsSol) {
		riskMint = null;
		riskTokenSide = null;
	} else if (tokenXMint && !tokenXIsSol && (!tokenYMint || tokenYIsSol)) {
		riskMint = tokenXMint;
		riskTokenSide = "token_x";
	} else if (tokenYMint && !tokenYIsSol && (!tokenXMint || tokenXIsSol)) {
		riskMint = tokenYMint;
		riskTokenSide = "token_y";
	} else if (tokenXMint) {
		riskMint = tokenXIsSol && !tokenYMint ? null : tokenXMint;
		riskTokenSide = riskMint ? "token_x" : null;
	} else if (tokenYMint) {
		riskMint = tokenYIsSol ? null : tokenYMint;
		riskTokenSide = riskMint ? "token_y" : null;
	}

	const counterMint = riskTokenSide === "token_x"
		? tokenYMint || null
		: riskTokenSide === "token_y"
			? tokenXMint || null
			: null;
	const orientation = resolveSingleSidedSolPoolOrientation({
		token_x_mint: tokenXMint,
		token_y_mint: tokenYMint,
		solMint: normalizedSolMint,
	});

	return {
		token_x_mint: tokenXMint || null,
		token_y_mint: tokenYMint || null,
		token_x_is_sol: tokenXIsSol,
		token_y_is_sol: tokenYIsSol,
		risk_mint: riskMint,
		risk_token_side: riskTokenSide,
		counter_mint: counterMint,
		sol_pool: tokenXIsSol || tokenYIsSol,
		sol_side: orientation.sol_side,
		orientation_status: orientation.status,
		orientation,
	};
}

export function resolveCanonicalPoolTokenView({
	token_x = null,
	token_y = null,
	solMint = null,
} = {}) {
	const identity = resolveCanonicalPoolIdentity({
		token_x_mint: token_x?.address ?? token_x?.mint ?? null,
		token_y_mint: token_y?.address ?? token_y?.mint ?? null,
		solMint,
	});
	const riskToken = identity.risk_token_side === "token_y"
		? token_y || null
		: identity.risk_token_side === "token_x"
			? token_x || null
			: null;
	const counterToken = identity.risk_token_side === "token_y"
		? token_x || null
		: identity.risk_token_side === "token_x"
			? token_y || null
			: null;

	return {
		...identity,
		risk_token: riskToken,
		counter_token: counterToken,
	};
}

export function resolveSingleSidedSolPoolOrientation({
	token_x_mint = null,
	token_y_mint = null,
	solMint = null,
} = {}) {
	const tokenXMint = normalizeMintLabel(token_x_mint);
	const tokenYMint = normalizeMintLabel(token_y_mint);
	const normalizedSolMint = normalizeMintLabel(solMint || DEFAULT_SOL_MINT);

	if (!tokenXMint || !tokenYMint || !normalizedSolMint) {
		return {
			status: "unknown",
			compatible: false,
			sol_side: null,
			required_amount_field: null,
			token_x_mint: tokenXMint || null,
			token_y_mint: tokenYMint || null,
		};
	}

	const tokenXIsSol = isSolMintLabel(tokenXMint, normalizedSolMint);
	const tokenYIsSol = isSolMintLabel(tokenYMint, normalizedSolMint);

	if (tokenXIsSol && tokenYIsSol) {
		return {
			status: "ambiguous",
			compatible: false,
			sol_side: "both",
			required_amount_field: null,
			token_x_mint: tokenXMint,
			token_y_mint: tokenYMint,
		};
	}

	if (tokenYIsSol && !tokenXIsSol) {
		return {
			status: "compatible",
			compatible: true,
			sol_side: "token_y",
			required_amount_field: "amount_y",
			token_x_mint: tokenXMint,
			token_y_mint: tokenYMint,
		};
	}

	if (tokenXIsSol && !tokenYIsSol) {
		return {
			status: "wrong_side",
			compatible: false,
			sol_side: "token_x",
			required_amount_field: "amount_x",
			token_x_mint: tokenXMint,
			token_y_mint: tokenYMint,
		};
	}

	return {
		status: "not_sol_pool",
		compatible: false,
		sol_side: null,
		required_amount_field: null,
		token_x_mint: tokenXMint,
		token_y_mint: tokenYMint,
	};
}

export function evaluateSingleSidedSolDeployOrientation({
	amount_x = null,
	amount_y = null,
	amount_sol = null,
	token_x_mint = null,
	token_y_mint = null,
	solMint = null,
} = {}) {
	const amountX = toNullableFiniteNumber(amount_x) ?? 0;
	const amountY = toNullableFiniteNumber(amount_y ?? amount_sol) ?? 0;
	const applies = amountY > 0 && amountX <= 0;
	if (!applies) {
		return {
			applies: false,
			blocked: false,
			reason_code: null,
			message: null,
			orientation: null,
			amount_x: amountX,
			amount_y: amountY,
		};
	}

	const orientation = resolveSingleSidedSolPoolOrientation({
		token_x_mint,
		token_y_mint,
		solMint,
	});
	const reasonByStatus = {
		wrong_side: "single_sided_sol_requires_token_y_sol",
		unknown: "single_sided_sol_orientation_unknown",
		not_sol_pool: "single_sided_sol_pool_not_sol_quoted",
		ambiguous: "single_sided_sol_orientation_ambiguous",
	};
	const messageByStatus = {
		wrong_side:
			"Single-sided SOL deploy requires SOL to be token_y/quote side for current amount_y semantics.",
		unknown:
			"Single-sided SOL deploy blocked because pool token order is unavailable.",
		not_sol_pool:
			"Single-sided SOL deploy blocked because target pool is not SOL-quoted.",
		ambiguous:
			"Single-sided SOL deploy blocked because pool token order is ambiguous.",
	};

	return {
		applies: true,
		blocked: !orientation.compatible,
		reason_code: orientation.compatible ? null : reasonByStatus[orientation.status],
		message: orientation.compatible ? null : messageByStatus[orientation.status],
		orientation,
		amount_x: amountX,
		amount_y: amountY,
	};
}

export function buildTrackedPositionFallback(position_address, { getTrackedPosition }) {
	const tracked = getTrackedPosition(position_address);
	if (!tracked || tracked.closed) return null;

	return {
		position: tracked.position,
		pool: tracked.pool,
		pair: tracked.pool_name || tracked.pool?.slice(0, 8) || null,
		pool_name: tracked.pool_name || null,
		strategy: tracked.strategy || null,
		bin_step: tracked.bin_step ?? null,
		volatility: tracked.volatility ?? null,
		fee_tvl_ratio: tracked.fee_tvl_ratio ?? null,
		organic_score: tracked.organic_score ?? null,
		lower_bin: tracked.bin_range?.min ?? null,
		upper_bin: tracked.bin_range?.max ?? null,
		active_bin: tracked.active_bin_at_deploy ?? null,
		in_range: !tracked.out_of_range_since,
		unclaimed_fees_usd: 0,
		total_value_usd: tracked.initial_value_usd ?? 0,
		source: "state_fallback",
	};
}

export async function getPositionExecutionContext(position_address, {
	getMyPositions,
	getPositionPnl,
	buildTrackedFallback,
	resolveBinSnapshot,
	classifyRangeLocation,
	isDryRun,
}) {
	const positionsResult = await getMyPositions({ force: true });
	if (positionsResult?.error) {
		if (isDryRun) {
			const fallbackPosition = buildTrackedFallback(position_address);
			if (fallbackPosition) {
				const binSnapshot = resolveBinSnapshot(fallbackPosition, null);
				const rangeLocation = classifyRangeLocation(binSnapshot);
				return {
					position: fallbackPosition,
					pnl: null,
					bin_snapshot: binSnapshot,
					range_location: rangeLocation,
					in_range: binSnapshot.inRange,
					context_source: "state_fallback",
				};
			}
		}
		return {
			error: `Unable to load open positions: ${positionsResult.error}`,
			positions: positionsResult.positions || [],
		};
	}

	const position = (positionsResult.positions || []).find((item) => item.position === position_address);
	if (!position) {
		if (isDryRun) {
			const fallbackPosition = buildTrackedFallback(position_address);
			if (fallbackPosition) {
				const binSnapshot = resolveBinSnapshot(fallbackPosition, null);
				const rangeLocation = classifyRangeLocation(binSnapshot);
				return {
					position: fallbackPosition,
					pnl: null,
					bin_snapshot: binSnapshot,
					range_location: rangeLocation,
					in_range: binSnapshot.inRange,
					context_source: "state_fallback",
				};
			}
		}
		return {
			error: `Position ${position_address} was not found in open positions`,
			positions: positionsResult.positions || [],
		};
	}

	let pnl = null;
	try {
		pnl = await getPositionPnl({ pool_address: position.pool, position_address });
	} catch (error) {
		pnl = { error: error.message };
	}

	const binSnapshot = resolveBinSnapshot(position, pnl);
	const rangeLocation = classifyRangeLocation(binSnapshot);

	return {
		position,
		pnl,
		bin_snapshot: binSnapshot,
		range_location: rangeLocation,
		in_range: binSnapshot.inRange,
	};
}
