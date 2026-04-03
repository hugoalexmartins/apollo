import {
	getWalletTokenBalanceFromSnapshot,
	normalizeDeployAmounts,
} from "../runtime-helpers.js";
import { isBlacklisted } from "../token-blacklist.js";
import { evaluateSingleSidedSolDeployOrientation } from "./dlmm-position-context.js";

export function mergeOpenPositions(livePositions = [], trackedPositions = []) {
	const merged = new Map();
	for (const position of [...livePositions, ...trackedPositions]) {
		if (!position?.position) continue;
		merged.set(position.position, position);
	}
	return Array.from(merged.values());
}

export async function runSafetyChecksWithDeps(name, args, meta = {}, deps = {}) {
	const {
		generalApprovalRequiredTools,
		evaluateGeneralWriteApproval,
		validateRecordedRiskOpeningPreflight,
		getRuntimeHealth,
		getWalletBalancesRuntime,
		getPoolGovernanceMetadataRuntime,
		getMyPositionsRuntime,
		evaluatePortfolioGuard,
		buildOpenPositionPnlInputs,
		getTrackedPositions,
		evaluateDeployAdmission,
		getPoolDeployCooldown,
		config,
	} = deps;

	if (!meta.cycle_id && generalApprovalRequiredTools.has(name)) {
		const deployShape = name === "deploy_position"
			? normalizeDeployAmounts({
				amount_x: args.amount_x,
				amount_y: args.amount_y,
				amount_sol: args.amount_sol,
				defaultAmountY: 0,
			})
			: null;
		const amountSol = name === "deploy_position"
			? deployShape.amount_sol
			: name === "swap_token" && (args.output_mint === "SOL" || args.input_mint === "SOL")
				? Number(args.amount || 0)
				: null;
		const approval = evaluateGeneralWriteApproval({
			tool_name: name,
			pool_address: args.pool_address || null,
			position_address: args.position_address || null,
			amount_x: deployShape?.amount_x ?? null,
			amount_y: deployShape?.amount_y ?? null,
			amount_sol: amountSol,
		});
		if (!approval.pass) {
			return {
				pass: false,
				reason: approval.reason,
			};
		}
	}

		switch (name) {
			case "deploy_position": {
				const deployShape = normalizeDeployAmounts({
					amount_x: args.amount_x,
					amount_y: args.amount_y,
					amount_sol: args.amount_sol,
					defaultAmountY: 0,
				});
				if (deployShape.has_invalid_amounts) {
					return {
						pass: false,
						reason: `Invalid deploy amount input: ${deployShape.invalid_fields.join(", ")}`,
					};
				}
				if (!meta.cycle_id) {
					const preflight = validateRecordedRiskOpeningPreflight(getRuntimeHealth().preflight, {
						tool_name: name,
						pool_address: args.pool_address,
						amount_x: deployShape.amount_x,
						amount_y: deployShape.amount_y,
						amount_sol: deployShape.amount_sol,
					});
				if (!preflight.pass) {
					return {
						pass: false,
						reason: preflight.reason,
					};
				}
			}

				const balance = await getWalletBalancesRuntime();
				let walletTokenBalance = null;
				if (args?.pool_address) {
				const governanceMetadata = await getPoolGovernanceMetadataRuntime({
					pool_address: args.pool_address,
				});
				if (governanceMetadata?.error) {
					return {
						pass: false,
						reason: `Deploy governance metadata unavailable: ${governanceMetadata.error}`,
					};
				}
				args.base_mint = governanceMetadata.base_mint;
				args.risk_mint = governanceMetadata.risk_mint || governanceMetadata.base_mint;
				args.bin_step = governanceMetadata.bin_step;
				args.token_x_mint = governanceMetadata.token_x_mint || null;
				args.token_y_mint = governanceMetadata.token_y_mint || null;
				if (isBlacklisted(args.base_mint)) {
					return {
						pass: false,
						reason: `Base token ${args.base_mint} is blacklisted and cannot be deployed.`,
					};
				}
				const orientationGuard = evaluateSingleSidedSolDeployOrientation({
					amount_x: args.amount_x ?? 0,
					amount_y: args.amount_y,
					amount_sol: args.amount_sol,
					token_x_mint: governanceMetadata.token_x_mint,
					token_y_mint: governanceMetadata.token_y_mint,
					solMint: config.tokens?.SOL,
				});
					if (orientationGuard.blocked) {
						return {
							pass: false,
							reason: orientationGuard.message,
						};
					}
				if (deployShape.amount_x > 0) {
					walletTokenBalance = getWalletTokenBalanceFromSnapshot(
						balance,
						args.token_x_mint || args.risk_mint,
					);
					if (!Number.isFinite(walletTokenBalance)) {
						return {
							pass: false,
							reason: args.token_x_mint || args.risk_mint
								? `Unable to verify wallet balance for deploy token ${(args.token_x_mint || args.risk_mint)}.`
								: "Unable to verify wallet base-token readiness for token-funded deploy.",
						};
					}
				}
				}
			const positions = await getMyPositionsRuntime({ force: true });
			if (positions?.error) {
				return {
					pass: false,
					reason: `Unable to verify open positions: ${positions.error}`,
				};
			}
			if (!Array.isArray(positions?.positions)) {
				return {
					pass: false,
					reason: "Unable to verify open positions: positions payload missing positions array.",
				};
			}
			const portfolioGuard = evaluatePortfolioGuard({
				portfolioSnapshot: balance,
				openPositionPnls: buildOpenPositionPnlInputs(positions.positions),
			});
			const trackedPositions = getTrackedPositions(true);
			const combinedPositions = mergeOpenPositions(
				positions.positions,
				trackedPositions,
			);
				const deployAdmission = evaluateDeployAdmission({
					config,
					poolAddress: args.pool_address,
					baseMint: args.base_mint,
					riskMint: args.risk_mint,
					amountY: deployShape.amount_y,
					amountX: deployShape.amount_x,
					binStep: args.bin_step,
					walletTokenBalance,
					tokenMint: args.token_x_mint || args.risk_mint,
				positions: combinedPositions,
				positionsCount: combinedPositions.length,
				walletSol: balance.sol,
				portfolioGuard,
				poolCooldown: getPoolDeployCooldown({
					pool_address: args.pool_address,
				}),
			});

			return deployAdmission.pass
				? { pass: true }
				: { pass: false, reason: deployAdmission.message };
		}

		case "swap_token": {
			return { pass: true };
		}

		case "rebalance_on_exit": {
			if (!args?.position_address) {
				return {
					pass: false,
					reason: "position_address is required.",
				};
			}
			return { pass: true };
		}

		case "auto_compound_fees": {
			const portfolioGuard = evaluatePortfolioGuard();
			if (portfolioGuard.blocked) {
				return {
					pass: false,
					reason: `Portfolio guard active: ${portfolioGuard.reason}`,
				};
			}
			if (!args?.position_address) {
				return {
					pass: false,
					reason: "position_address is required.",
				};
			}
			return { pass: true };
		}

		case "claim_fees":
		case "close_position": {
			if (!args?.position_address) {
				return {
					pass: false,
					reason: "position_address is required.",
				};
			}

			const positions = await getMyPositionsRuntime({ force: true });
			if (positions?.error) {
				return {
					pass: false,
					reason: `Unable to verify open positions: ${positions.error}`,
				};
			}
			if (!Array.isArray(positions?.positions)) {
				return {
					pass: false,
					reason: "Unable to verify open positions: positions payload missing positions array.",
				};
			}
			const openPosition = positions.positions?.find(
				(position) => position.position === args.position_address,
			);
			if (!openPosition) {
				return {
					pass: false,
					reason: `Position ${args.position_address} is not currently open.`,
				};
			}

			return { pass: true };
		}

		default:
			return { pass: true };
	}
}
