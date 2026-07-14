import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { enforceRateLimit, __resetRateLimiters } from "@/lib/api/rate-limit";
import { TooManyRequests } from "@/lib/api/errors";

describe("enforceRateLimit — tradingBot buckets", () => {
  const prevRead = process.env.RATE_LIMIT_TRADING_BOT_READ_MAX;
  const prevWrite = process.env.RATE_LIMIT_TRADING_BOT_WRITE_MAX;

  beforeEach(() => {
    __resetRateLimiters();
    process.env.RATE_LIMIT_TRADING_BOT_READ_MAX = "2";
    process.env.RATE_LIMIT_TRADING_BOT_WRITE_MAX = "2";
  });

  afterEach(() => {
    if (prevRead === undefined) delete process.env.RATE_LIMIT_TRADING_BOT_READ_MAX;
    else process.env.RATE_LIMIT_TRADING_BOT_READ_MAX = prevRead;
    if (prevWrite === undefined) delete process.env.RATE_LIMIT_TRADING_BOT_WRITE_MAX;
    else process.env.RATE_LIMIT_TRADING_BOT_WRITE_MAX = prevWrite;
    __resetRateLimiters();
  });

  it("enforces the configured max for tradingBotRead, then blocks", () => {
    expect(() => enforceRateLimit("user-1", "tradingBotRead")).not.toThrow();
    expect(() => enforceRateLimit("user-1", "tradingBotRead")).not.toThrow();
    expect(() => enforceRateLimit("user-1", "tradingBotRead")).toThrow(TooManyRequests);
  });

  it("enforces the configured max for tradingBotWrite independently of tradingBotRead", () => {
    enforceRateLimit("user-1", "tradingBotRead");
    enforceRateLimit("user-1", "tradingBotRead");
    expect(() => enforceRateLimit("user-1", "tradingBotWrite")).not.toThrow();
  });

  it("isolates the tradingBotWrite budget per user", () => {
    enforceRateLimit("user-1", "tradingBotWrite");
    enforceRateLimit("user-1", "tradingBotWrite");
    expect(() => enforceRateLimit("user-2", "tradingBotWrite")).not.toThrow();
  });
});
