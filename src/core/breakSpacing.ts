/** Returns whether a previous break is still inside the configured work-time gap. */
export function isWithinBreakGap(
  currentWorkTimeMs: number,
  previousBreakAtWorkTimeMs: number,
  minimumGapMs: number,
): boolean {
  return minimumGapMs > 0
    && previousBreakAtWorkTimeMs > 0
    && currentWorkTimeMs >= previousBreakAtWorkTimeMs
    && currentWorkTimeMs - previousBreakAtWorkTimeMs < minimumGapMs;
}
