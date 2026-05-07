export const QUIT_GUARD_CANCEL_BUTTON = 0;
export const QUIT_GUARD_CONFIRM_BUTTON = 1;

export function shouldConfirmTerminalQuit(activeSessionCount: number): boolean {
  return activeSessionCount > 0;
}

export function didCancelTerminalQuit(buttonIndex: number): boolean {
  return buttonIndex !== QUIT_GUARD_CONFIRM_BUTTON;
}
