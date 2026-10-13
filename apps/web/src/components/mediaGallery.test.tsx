// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerOrderGalleryGroup } from '../api/client'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  mediaFetch: vi.fn(),
  downloadMedia: vi.fn(),
}))

vi.mock('../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: mocks.api }
})

vi.mock('../api/media', () => ({
  authenticatedMediaFetch: mocks.mediaFetch,
  downloadAuthenticatedMedia: mocks.downloadMedia,
}))

import { RecentImagesPage } from './RecentImagesPage'
import { OrderImagePasteArea } from './OrderImagePasteArea'

const gallery: CustomerOrderGalleryGroup[] = [{
  date: '13/10/2026',
  date_iso: '2026-10-13',
  orders: [{
    group_id: 'group-1',
    order_id: 'order-1',
    order_ids: ['order-1'],
    order_no: 'HD-1',
    order_numbers: ['HD-1'],
    customer_id: 'customer-1',
    customer_name: 'Khách A',
    customer_code: 'KH-1',
    created_at: null,
    order_date: '2026-10-13',
    note: '',
    status: 'NOT_PICKED',
    created_by_names: [],
    image_count: 1,
    images: [{
      id: 'media-1',
      url: '/api/v1/media/media-1/view',
      view_url: '/api/v1/media/media-1/view',
      original_name: 'mau.png',
      created_at: null,
      uploaded_by_name: null,
    }],
  }],
}]

let container: HTMLDivElement
let roots: Root[]

function renderGallery() {
  const root = createRoot(container)
  roots.push(root)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => root.render(
    createElement(QueryClientProvider, { client: queryClient },
      createElement(RecentImagesPage, { go: vi.fn() }),
    ),
  ))
  return root
}

async function waitFor(assertion: () => void) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion()
      return
    } catch {
      await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))
    }
  }
  assertion()
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  roots = []
  mocks.api.mockReset().mockResolvedValue({ data: gallery, meta: { summary: { orders_with_images: 1, total_images: 1 } } })
  mocks.mediaFetch.mockReset().mockResolvedValue({ blob: async () => new Blob(['image-bytes']) })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:authenticated-media') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  container.remove()
})

describe('authenticated media UI', () => {
  it('loads gallery images from view_url, opens the modal, and shows an error placeholder', async () => {
    renderGallery()

    await waitFor(() => expect(document.querySelector('.kho-anh-thumb img')?.getAttribute('src')).toBe('blob:authenticated-media'))
    expect(mocks.mediaFetch).toHaveBeenCalledWith('/api/v1/media/media-1/view')

    const thumbnail = document.querySelector<HTMLButtonElement>('.kho-anh-thumb')
    expect(thumbnail).not.toBeNull()
    act(() => thumbnail?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    await waitFor(() => expect(document.querySelector('.kho-anh-lightbox-photo img')).not.toBeNull())
    const largeImage = document.querySelector<HTMLImageElement>('.kho-anh-lightbox-photo img')
    expect(largeImage?.getAttribute('src')).toBe('blob:authenticated-media')
    act(() => largeImage?.dispatchEvent(new Event('error')))
    expect(document.querySelector('.kho-anh-lightbox-fallback')?.textContent).toContain('Ảnh lỗi')
  })

  it('passes pasted clipboard images to the upload workflow', () => {
    const onAdd = vi.fn()
    const root = createRoot(container)
    roots.push(root)
    act(() => root.render(createElement(OrderImagePasteArea, { images: [], onAdd, onRemove: vi.fn() })))

    const file = new File(['png'], 'clipboard.png', { type: 'image/png' })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
        files: [file],
      },
    })
    act(() => document.querySelector('[aria-label="Vùng dán ảnh đơn hàng"]')?.dispatchEvent(event))

    expect(onAdd).toHaveBeenCalledWith([file], 'clipboard')
  })
})
