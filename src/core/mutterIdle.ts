export function parseMutterIdleTimeMs(output: string): number | null {
  const match = output.match(/\buint64\s+(\d+)\b/);
  if (!match) return null;

  const idleTimeMs = Number(match[1]);
  return Number.isSafeInteger(idleTimeMs) && idleTimeMs >= 0 ? idleTimeMs : null;
}

export function parseGnomeScreenLocked(output: string): boolean | null {
  const match = output.trim().match(/^\((true|false),\)$/);
  return match ? match[1] === 'true' : null;
}

export function getIdlePollAction(
  wasIdle: boolean,
  idleSeconds: number,
  thresholdSeconds: number,
  screenLocked: boolean,
): 'idle' | 'active' | null {
  if (screenLocked || idleSeconds >= thresholdSeconds) return 'idle';
  return wasIdle ? 'active' : null;
}
