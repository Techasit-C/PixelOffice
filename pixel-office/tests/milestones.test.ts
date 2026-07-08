import { describe, it, expect } from "vitest";
import {
  computeMilestones,
  synthesizeMilestones,
} from "@/lib/portfolio/milestones";

describe("synthesizeMilestones", () => {
  it("produces 25/50/75/100% of the top target", () => {
    const m = synthesizeMilestones(1_000_000);
    expect(m.map((x) => x.targetThb?.toString())).toEqual([
      "250000",
      "500000",
      "750000",
      "1000000",
    ]);
  });
});

describe("computeMilestones", () => {
  it("marks crossed milestones reached and computes progress to top target", () => {
    const s = computeMilestones(500_000, synthesizeMilestones(1_000_000));
    expect(s.target).toBe("1000000");
    expect(s.pct).toBe(50);
    expect(s.milestones.map((m) => m.reached)).toEqual([true, true, false, false]);
  });

  it("caps pct at 100 when value exceeds the target", () => {
    const s = computeMilestones(2_000_000, synthesizeMilestones(1_000_000));
    expect(s.pct).toBe(100);
    expect(s.milestones.every((m) => m.reached)).toBe(true);
  });

  it("zero value -> 0% and nothing reached", () => {
    const s = computeMilestones(0, synthesizeMilestones(1_000_000));
    expect(s.pct).toBe(0);
    expect(s.milestones.some((m) => m.reached)).toBe(false);
  });
});
