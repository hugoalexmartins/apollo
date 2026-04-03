import assert from "node:assert/strict";
import test from "node:test";

import {
	evaluatePostClaimSettlementObservation,
	evaluatePostCloseSettlementObservation,
	waitForPostClaimSettlement,
	waitForPostCloseSettlement,
} from "./tools/dlmm-settlement.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

test("settlement observation treats position disappearance alone as weak signal", () => {
	const result = evaluatePostCloseSettlementObservation({
		previousBaseBalance: 0.25,
		observedBaseBalance: 0,
		positionStillOpen: false,
	});

	assert.equal(result.settled, false);
	assert.equal(result.weak_signal, true);
	assert.equal(result.signal, "position_absent_from_open_positions");
	assert.equal(result.reason, "position_absent_without_balance_settlement");
});

test("settlement observation requires a positive recovered base-token delta", () => {
	const result = evaluatePostCloseSettlementObservation({
		previousBaseBalance: 0.25,
		observedBaseBalance: 0.42,
		positionStillOpen: true,
	});

	assert.equal(result.settled, true);
	assert.equal(result.signal, "base_balance_delta_observed");
	assert.ok(Math.abs(result.observed_balance_delta - 0.17) < 1e-9);
});

test("settlement observation remains unsettled without either signal", () => {
	const result = evaluatePostCloseSettlementObservation({
		previousBaseBalance: 0.25,
		observedBaseBalance: 0,
		positionStillOpen: true,
	});

	assert.equal(result.settled, false);
	assert.equal(result.reason, "settlement_signal_not_observed");
});

test("claim settlement observation accepts token delta on any claimed mint", () => {
	const result = evaluatePostClaimSettlementObservation({
		previousBalancesByMint: {
			"mint-x": 0.25,
			"mint-y": 0.4,
		},
		observedBalancesByMint: {
			"mint-x": 0.25,
			"mint-y": 0.65,
		},
		previousUnclaimedFeeUsd: 12,
		observedUnclaimedFeeUsd: 12,
	});

	assert.equal(result.settled, true);
	assert.equal(result.signal, "token_balance_delta_observed");
	assert.equal(result.observed_mint, "mint-y");
	assert.ok(Math.abs(result.observed_amount_received - 0.25) < 1e-9);
});

test("claim settlement observation treats unclaimed fee drop alone as weak signal", () => {
	const result = evaluatePostClaimSettlementObservation({
		previousBalancesByMint: {
			"mint-x": 0.25,
		},
		observedBalancesByMint: {
			"mint-x": 0.25,
		},
		previousUnclaimedFeeUsd: 12,
		observedUnclaimedFeeUsd: 1.5,
	});

	assert.equal(result.settled, false);
	assert.equal(result.weak_signal, true);
	assert.equal(result.signal, "unclaimed_fee_drop_observed");
	assert.equal(result.observed_unclaimed_fee_delta, 10.5);
	assert.equal(result.reason, "unclaimed_fee_drop_without_token_settlement");
});

test("claim settlement observation remains unsettled without delta or fee drop", () => {
	const result = evaluatePostClaimSettlementObservation({
		previousBalancesByMint: {
			"mint-x": 0.25,
		},
		observedBalancesByMint: {
			"mint-x": 0.25,
		},
		previousUnclaimedFeeUsd: 12,
		observedUnclaimedFeeUsd: 12,
	});

	assert.equal(result.settled, false);
	assert.equal(result.reason, "claim_settlement_signal_not_observed");
});

test("waitForPostCloseSettlement returns observed balance delta once it appears", async () => {
	let balanceChecks = 0;
	const result = await waitForPostCloseSettlement({
		walletPubkey: "wallet-1",
		baseMint: USDC_MINT,
		positionAddress: "pos-1",
		previousBaseBalance: 0.25,
		maxAttempts: 2,
		delayMs: 0,
		getConnection: () => ({
			getParsedTokenAccountsByOwner: async () => {
				balanceChecks += 1;
				return {
					value: [
						{
							account: {
								data: {
									parsed: {
										info: {
											tokenAmount: {
												uiAmount: balanceChecks === 1 ? 0.25 : 0.5,
											},
										},
									},
								},
							},
						},
					],
				};
			},
		}),
		getMyPositions: async () => ({ positions: [{ position: "pos-1" }] }),
		log: () => {},
	});

	assert.equal(result.settled, true);
	assert.equal(result.signal, "base_balance_delta_observed");
	assert.equal(result.attempts, 2);
	assert.ok(Math.abs(result.observed_balance_delta - 0.25) < 1e-9);
});

test("waitForPostClaimSettlement returns token delta once it appears", async () => {
	let balanceChecks = 0;
	const result = await waitForPostClaimSettlement({
		walletPubkey: "wallet-1",
		observedMints: [SOL_MINT],
		positionAddress: "pos-1",
		previousBalancesByMint: { [SOL_MINT]: 0.4 },
		previousUnclaimedFeeUsd: 12,
		maxAttempts: 2,
		delayMs: 0,
		getConnection: () => ({
			getParsedTokenAccountsByOwner: async () => {
				balanceChecks += 1;
				return {
					value: [
						{
							account: {
								data: {
									parsed: {
										info: {
											tokenAmount: {
												uiAmount: balanceChecks === 1 ? 0.4 : 0.7,
											},
										},
									},
								},
							},
						},
					],
				};
			},
		}),
		getMyPositions: async () => ({ positions: [{ position: "pos-1", unclaimed_fees_usd: 12 }] }),
		log: () => {},
	});

	assert.equal(result.settled, true);
	assert.equal(result.signal, "token_balance_delta_observed");
	assert.equal(result.observed_mint, SOL_MINT);
	assert.equal(result.attempts, 2);
	assert.ok(Math.abs(result.observed_amount_received - 0.3) < 1e-9);
});

test("waitForPostCloseSettlement returns weak signal when only position absence is observed", async () => {
	const result = await waitForPostCloseSettlement({
		walletPubkey: "wallet-1",
		baseMint: USDC_MINT,
		positionAddress: "pos-1",
		previousBaseBalance: 0.25,
		maxAttempts: 1,
		delayMs: 0,
		getConnection: () => ({
			getParsedTokenAccountsByOwner: async () => ({
				value: [
					{
						account: {
							data: {
								parsed: {
									info: {
										tokenAmount: {
											uiAmount: 0.25,
										},
									},
								},
							},
						},
					},
				],
			}),
		}),
		getMyPositions: async () => ({ positions: [] }),
		log: () => {},
	});

	assert.equal(result.settled, false);
	assert.equal(result.weak_signal, true);
	assert.equal(result.signal, "position_absent_from_open_positions");
	assert.equal(result.reason, "position_absent_without_balance_settlement");
});

test("waitForPostClaimSettlement returns weak signal when only fee drop is observed", async () => {
	const result = await waitForPostClaimSettlement({
		walletPubkey: "wallet-1",
		observedMints: [SOL_MINT],
		positionAddress: "pos-1",
		previousBalancesByMint: { [SOL_MINT]: 0.4 },
		previousUnclaimedFeeUsd: 12,
		maxAttempts: 1,
		delayMs: 0,
		getConnection: () => ({
			getParsedTokenAccountsByOwner: async () => ({
				value: [
					{
						account: {
							data: {
								parsed: {
									info: {
										tokenAmount: {
											uiAmount: 0.4,
										},
									},
								},
							},
						},
					},
				],
			}),
		}),
		getMyPositions: async () => ({ positions: [{ position: "pos-1", unclaimed_fees_usd: 1 }] }),
		log: () => {},
	});

	assert.equal(result.settled, false);
	assert.equal(result.weak_signal, true);
	assert.equal(result.signal, "unclaimed_fee_drop_observed");
	assert.equal(result.reason, "unclaimed_fee_drop_without_token_settlement");
});
