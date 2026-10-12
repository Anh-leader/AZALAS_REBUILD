import { describe, expect, it } from 'vitest'
import { beginDialogSave, finishDialogSave } from './productionUi'

describe('production modal lifecycle', () => {
  it('keeps entered modal open when save fails and closes only after success', () => {
    const saving = beginDialogSave({ open: true, busy: false, error: 'old' })
    expect(saving).toEqual({ open: true, busy: true, error: '' })
    const failed = finishDialogSave(saving, false, 'Xung đột phiên bản')
    expect(failed.open).toBe(true)
    expect(failed.error).toBe('Xung đột phiên bản')
    expect(finishDialogSave(failed, true).open).toBe(false)
  })
})
