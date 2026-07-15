/**
 * Shared pause reminder state — used by main.ts and ipc.ts
 * Extracted to avoid circular dependency between the two.
 */

let pauseReminderShowing = false;

export function isPauseReminderShowing(): boolean {
  return pauseReminderShowing;
}

export function setPauseReminderShowing(value: boolean): void {
  pauseReminderShowing = value;
}

export function clearPauseReminderFlag(): void {
  pauseReminderShowing = false;
}
