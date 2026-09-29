/**
 * Shared native-cap thresholds. Tuned so medium files and noisy greps
 * shrink before they hit the conversation, while tiny targeted reads pass.
 */
export type CapProfile = "safe" | "balanced" | "aggressive";

export interface CapLimits {
  smallFileBytes: number;
  readLineLimit: number;
  grepHeadLimit: number;
  grepContextMax: number;
  shellLineLimit: number;
}

const PROFILES: Record<CapProfile, CapLimits> = {
  safe: {
    smallFileBytes: 12_000,
    readLineLimit: 200,
    grepHeadLimit: 40,
    grepContextMax: 5,
    shellLineLimit: 200,
  },
  balanced: {
    smallFileBytes: 4_000,
    readLineLimit: 100,
    grepHeadLimit: 20,
    grepContextMax: 2,
    shellLineLimit: 120,
  },
  aggressive: {
    smallFileBytes: 2_000,
    readLineLimit: 60,
    grepHeadLimit: 12,
    grepContextMax: 1,
    shellLineLimit: 80,
  },
};

export function resolveCapProfile(
  env: NodeJS.ProcessEnv = process.env,
): CapProfile {
  const raw = (
    env.CURSORY_CAP_PROFILE ??
    env.CURSORY_MODE ??
    "balanced"
  )
    .trim()
    .toLowerCase();
  if (raw === "safe" || raw === "conservative") return "safe";
  if (raw === "aggressive") return "aggressive";
  return "balanced";
}

export function getCapLimits(
  profile: CapProfile = resolveCapProfile(),
): CapLimits {
  return PROFILES[profile];
}
