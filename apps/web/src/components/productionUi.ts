export type SaveDialogState = { open: boolean; busy: boolean; error: string }

export function beginDialogSave(state: SaveDialogState): SaveDialogState {
  return { ...state, busy: true, error: '' }
}

export function finishDialogSave(state: SaveDialogState, succeeded: boolean, error = ''): SaveDialogState {
  return succeeded
    ? { open: false, busy: false, error: '' }
    : { ...state, open: true, busy: false, error }
}
