// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerCombobox } from './CustomerCombobox'
import { OrderImagePasteArea, type PendingOrderImage } from './OrderImagePasteArea'

const customers = [
  { id: 'customer-hanh', name: 'AD HANH', phone: '0901234567', customer_code: 'KH-001' },
  { id: 'customer-lan', name: 'Bình Lan', phone: '0912345678', customer_code: 'KH-002' },
]

let container: HTMLDivElement
let root: Root
let objectUrlCount: number

function ComboboxHarness() {
  const [customerId, setCustomerId] = useState('')
  return createElement('div', null,
    createElement(CustomerCombobox, { customers, value: customerId, onChange: setCustomerId }),
    createElement('output', { 'data-testid': 'customer-id' }, customerId),
  )
}

function PasteHarness({ onParentPaste }: { onParentPaste?: () => void }) {
  const [images, setImages] = useState<PendingOrderImage[]>([])
  return createElement('form', { onPaste: onParentPaste },
    createElement(OrderImagePasteArea, {
      images,
      onAdd: (files, source, fingerprints) => setImages(current => [
        ...current,
        ...files.map((file, index) => ({
          key: `${current.length}-${index}`,
          file,
          source,
          fingerprint: fingerprints[index],
          preview: URL.createObjectURL(file),
        })),
      ]),
      onRemove: key => setImages(current => current.filter(image => image.key !== key)),
    }),
  )
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function dispatchPaste(files: File[]) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      files,
    },
  })
  act(() => document.querySelector('[aria-label="Vùng dán ảnh đơn hàng"]')?.dispatchEvent(event))
  return event
}

async function flushPaste() {
  await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  objectUrlCount = 0
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:test-${++objectUrlCount}`),
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('order creation customer picker', () => {
  it('finds AD HANH with a case-insensitive name search and keeps its customer ID', () => {
    act(() => root.render(createElement(ComboboxHarness)))
    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!
    act(() => { input.focus(); setInputValue(input, 'hanh') })

    const option = Array.from(container.querySelectorAll('[role="option"]'))
      .find(element => element.textContent?.includes('AD HANH'))
    expect(option).toBeTruthy()
    act(() => option?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('[data-testid="customer-id"]')?.textContent).toBe('customer-hanh')
  })

  it('searches by phone number and customer code', () => {
    act(() => root.render(createElement(ComboboxHarness)))
    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!
    act(() => { input.focus(); setInputValue(input, '0912345678') })
    expect(container.querySelector('[role="option"]')?.textContent).toContain('Bình Lan')
    act(() => setInputValue(input, 'KH-002'))
    expect(container.querySelector('[role="option"]')?.textContent).toContain('Bình Lan')
  })

  it('supports arrow/enter selection and Escape dismissal', () => {
    act(() => root.render(createElement(ComboboxHarness)))
    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!
    act(() => {
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(container.querySelector('[data-testid="customer-id"]')?.textContent).toBe('customer-hanh')
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('order image paste deduplication', () => {
  it('adds one preview for a paste and skips the same image on a later paste', async () => {
    act(() => root.render(createElement(PasteHarness)))
    const image = new File(['same-image'], 'clipboard.png', { type: 'image/png', lastModified: 123 })

    dispatchPaste([image])
    await flushPaste()
    expect(container.querySelectorAll('.upload-preview')).toHaveLength(1)
    expect(objectUrlCount).toBe(1)

    dispatchPaste([new File(['same-image'], 'renamed-copy.png', { type: 'image/png', lastModified: 456 })])
    await flushPaste()
    expect(container.querySelectorAll('.upload-preview')).toHaveLength(1)
    expect(objectUrlCount).toBe(1)
  })

  it('adds two different images from one paste exactly once', async () => {
    act(() => root.render(createElement(PasteHarness)))
    const images = [
      new File(['first'], 'first.png', { type: 'image/png', lastModified: 1 }),
      new File(['second'], 'second.png', { type: 'image/png', lastModified: 2 }),
    ]
    dispatchPaste(images)
    await flushPaste()
    expect(container.querySelectorAll('.upload-preview')).toHaveLength(2)
    expect(objectUrlCount).toBe(2)
  })

  it('deduplicates unnamed clipboard images by content checksum', async () => {
    act(() => root.render(createElement(PasteHarness)))
    dispatchPaste([new File(['same-unnamed-image'], '', { type: 'image/png' })])
    await flushPaste()
    dispatchPaste([new File(['same-unnamed-image'], '', { type: 'image/png' })])
    await flushPaste()
    expect(container.querySelectorAll('.upload-preview')).toHaveLength(1)
    expect(objectUrlCount).toBe(1)
  })

  it('stops a paste from bubbling to a second form-level handler', async () => {
    const onParentPaste = vi.fn()
    act(() => root.render(createElement(PasteHarness, { onParentPaste })))
    const image = new File(['one'], 'one.png', { type: 'image/png', lastModified: 1 })

    const event = dispatchPaste([image])
    await flushPaste()
    expect(event.defaultPrevented).toBe(true)
    expect(onParentPaste).not.toHaveBeenCalled()
    expect(container.querySelectorAll('.upload-preview')).toHaveLength(1)
  })
})
