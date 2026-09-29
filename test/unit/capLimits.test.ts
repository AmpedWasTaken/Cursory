import { describe, expect, it } from "vitest";
import {
  getCapLimits,
  resolveCapProfile,
} from "../../src/hooks/capLimits.js";

describe("cap profiles", () => {
  it("defaults to balanced and maps aliases", () => {
    expect(resolveCapProfile({} as NodeJS.ProcessEnv)).toBe("balanced");
    expect(
      resolveCapProfile({ CURSORY_CAP_PROFILE: "aggressive" } as NodeJS.ProcessEnv),
    ).toBe("aggressive");
    expect(
      resolveCapProfile({ CURSORY_MODE: "conservative" } as NodeJS.ProcessEnv),
    ).toBe("safe");
  });

  it("makes aggressive stricter than balanced and safe", () => {
    const safe = getCapLimits("safe");
    const balanced = getCapLimits("balanced");
    const aggressive = getCapLimits("aggressive");
    expect(balanced.smallFileBytes).toBeLessThan(safe.smallFileBytes);
    expect(aggressive.readLineLimit).toBeLessThan(balanced.readLineLimit);
    expect(aggressive.grepHeadLimit).toBeLessThan(balanced.grepHeadLimit);
  });
});
