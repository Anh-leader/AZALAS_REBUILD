import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))

vi.mock('./client', async importOriginal => {
  const actual = await importOriginal<typeof import('./client')>()
  return { ...actual, api: apiMock }
})

import { uploadMediaFile } from './media'

describe('uploadMediaFile', () => {
  beforeEach(() => apiMock.mockReset())

  it('sends the selected file and module through the authenticated media API', async () => {
    const uploaded = { id: 'media-1', view_url: '/api/v1/media/media-1/view', url: '/api/v1/media/media-1/view', content_type: 'image/png' }
    apiMock.mockResolvedValue({ data: uploaded })
    const file = new File(['png'], 'clipboard.png', { type: 'image/png' })

    await expect(uploadMediaFile(file, 'orders')).resolves.toEqual(uploaded)

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith('/media/upload', expect.objectContaining({
      method: 'POST',
      query: { module: 'orders' },
    }))
    const options = apiMock.mock.calls[0][1]
    expect(options.body).toBeInstanceOf(FormData)
    expect((options.body as FormData).get('file')).toBe(file)
  })
})
