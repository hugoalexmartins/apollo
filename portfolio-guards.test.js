import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { config } from "./config.js";
import { clearPortfolioGuardPause, evaluatePortfolioGuard, getPortfolioGuardStatus } from "./portfolio-guards.js";

test("portfolio guard pauses after stop-loss streak", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-portfolio-guard-test-"));
  const originalProtections = { ...config.protections };

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    fs.writeFileSync("lessons.json", JSON.stringify({
      lessons: [],
      performance: [
        { recorded_at: new Date().toISOString(), pnl_usd: -12, close_reason: "STOP_LOSS: hit threshold" },
        { recorded_at: new Date().toISOString(), pnl_usd: -10, close_reason: "STOP_LOSS: second" },
        { recorded_at: new Date().toISOString(), pnl_usd: -8, close_reason: "STOP_LOSS: third" },
      ],
    }, null, 2));

    Object.assign(config.protections, {
      enabled: true,
      maxRecentRealizedLossUsd: 9999,
      recentLossWindowHours: 24,
      stopLossStreakLimit: 3,
      pauseMinutes: 180,
      maxReviewedCloses: 10,
    });

    const result = evaluatePortfolioGuard();
    assert.equal(result.blocked, true);
    assert.equal(result.reason_code, "STOP_LOSS_STREAK");
    assert.equal(result.metrics.stop_loss_streak, 3);

    const status = getPortfolioGuardStatus();
    assert.equal(status.active, true);
  } finally {
    Object.assign(config.protections, originalProtections);
    clearPortfolioGuardPause({ reason: "test cleanup" });
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("portfolio guard pauses after realized loss limit", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-portfolio-loss-guard-test-"));
  const originalProtections = { ...config.protections };

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    fs.writeFileSync("lessons.json", JSON.stringify({
      lessons: [],
      performance: [
        { recorded_at: new Date().toISOString(), pnl_usd: -60, close_reason: "manual close" },
        { recorded_at: new Date().toISOString(), pnl_usd: -50, close_reason: "low liquidity" },
      ],
    }, null, 2));

    Object.assign(config.protections, {
      enabled: true,
      maxRecentRealizedLossUsd: 100,
      recentLossWindowHours: 24,
      stopLossStreakLimit: 99,
      pauseMinutes: 180,
      maxReviewedCloses: 10,
    });

    const result = evaluatePortfolioGuard();
    assert.equal(result.blocked, true);
    assert.equal(result.reason_code, "REALIZED_LOSS_LIMIT");
    assert.equal(result.metrics.recent_loss_usd, 110);
  } finally {
    Object.assign(config.protections, originalProtections);
    clearPortfolioGuardPause({ reason: "test cleanup" });
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("portfolio guard pauses on drawdown from equity high watermark", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-portfolio-drawdown-guard-test-"));
  const originalProtections = { ...config.protections };

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    fs.writeFileSync("lessons.json", JSON.stringify({ lessons: [], performance: [] }, null, 2));
    fs.mkdirSync(path.join(tempDir, "data"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "data", "portfolio-guards.json"), JSON.stringify({
      metrics: {
        equity_high_watermark_usd: 200,
      },
      equity_snapshots: [],
    }, null, 2));

    Object.assign(config.protections, {
      enabled: true,
      maxRecentRealizedLossUsd: 9999,
      recentLossWindowHours: 24,
      stopLossStreakLimit: 99,
      maxDrawdownPct: 20,
      maxOpenUnrealizedLossUsd: 9999,
      pauseMinutes: 180,
      maxReviewedCloses: 10,
    });

    const result = evaluatePortfolioGuard({
      portfolioSnapshot: { sol_usd: 140, tokens: [] },
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason_code, "PORTFOLIO_DRAWDOWN_LIMIT");
    assert.equal(result.metrics.drawdown_pct, 30);
  } finally {
    Object.assign(config.protections, originalProtections);
    clearPortfolioGuardPause({ reason: "test cleanup" });
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("portfolio guard pauses on open unrealized risk", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenith-portfolio-open-risk-guard-test-"));
  const originalProtections = { ...config.protections };

  try {
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    fs.writeFileSync("lessons.json", JSON.stringify({ lessons: [], performance: [] }, null, 2));

    Object.assign(config.protections, {
      enabled: true,
      maxRecentRealizedLossUsd: 9999,
      recentLossWindowHours: 24,
      stopLossStreakLimit: 99,
      maxDrawdownPct: 99,
      maxOpenUnrealizedLossUsd: 50,
      pauseMinutes: 180,
      maxReviewedCloses: 10,
    });

    const result = evaluatePortfolioGuard({
      portfolioSnapshot: { sol_usd: 300, tokens: [] },
      openPositionPnls: [{ pnl_usd: -30 }, { pnl_usd: -25 }, { pnl_usd: 20 }],
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason_code, "OPEN_RISK_LIMIT");
    assert.equal(result.metrics.open_unrealized_loss_usd, 55);
  } finally {
    Object.assign(config.protections, originalProtections);
    clearPortfolioGuardPause({ reason: "test cleanup" });
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
