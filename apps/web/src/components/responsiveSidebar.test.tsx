// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { AppShell, type Page } from '../App'
import type { User } from '../api/client'

const user: User = {
  id: 'user-1',
  username: 'trangha',
  display_name: 'Trang Hà',
  role: 'Admin',
  roles: ['OWNER'],
  permissions: ['sales.view', 'sales.create', 'sales.invoice', 'production.view', 'materials.view', 'hr.view', 'reports.view', 'admin.users'],
  phone: null,
  status: 'ACTIVE',
}

function Harness() {
  const [page, setPage] = useState<Page>('dashboard')
  return createElement(AppShell, { user, page, setPage, logout: vi.fn() },
    createElement('div', { 'data-testid': 'page-content' }, page),
  )
}

let container: HTMLDivElement
let root: Root

function renderShell() {
  root = createRoot(container)
  act(() => root.render(createElement(Harness)))
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('responsive sidebar', () => {
  it('starts closed on mobile with an accessible menu button and desktop sidebar styles', () => {
    renderShell()

    expect(container.querySelector('.pc-kiot-sidebar')?.classList.contains('is-open')).toBe(false)
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Mở menu"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.pc-kiot-nav')).not.toBeNull()

    const css = readFileSync('src/styles/app.css', 'utf8')
    expect(css).toMatch(/\.pc-kiot-sidebar\s*\{[^}]*position:\s*fixed/s)
    expect(css).toMatch(/@media\s*\(max-width:\s*1023px\)[\s\S]*?\.pc-kiot-sidebar\.is-open/)
    expect(css).toMatch(/@media\s*\(max-width:\s*1023px\)[\s\S]*?\.app-container\s*\{\s*width:\s*100%;\s*margin-left:\s*0/)
    expect(css).toMatch(/body\s*\{\s*overflow-x:\s*hidden/)
  })

  it('opens from the menu button and closes from the overlay and close button', () => {
    renderShell()

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Mở menu"]')?.click())
    expect(container.querySelector('.pc-kiot-sidebar')?.classList.contains('is-open')).toBe(true)
    expect(container.querySelector('[aria-label="Đóng menu"]')).not.toBeNull()
    act(() => container.querySelector<HTMLButtonElement>('.pc-kiot-overlay')?.click())
    expect(container.querySelector('.pc-kiot-sidebar')?.classList.contains('is-open')).toBe(false)

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Mở menu"]')?.click())
    act(() => container.querySelector<HTMLButtonElement>('.pc-kiot-close')?.click())
    expect(container.querySelector('.pc-kiot-sidebar')?.classList.contains('is-open')).toBe(false)
  })

  it('closes on Escape and after selecting a menu item while preserving the active state', () => {
    renderShell()

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Mở menu"]')?.click())
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(container.querySelector('.pc-kiot-sidebar')?.classList.contains('is-open')).toBe(false)

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Mở menu"]')?.click())
    const gallery = Array.from(container.querySelectorAll<HTMLButtonElement>('.pc-kiot-link')).find(button => button.textContent?.includes('Kho ảnh'))
    act(() => gallery?.click())
    expect(container.querySelector('[data-testid="page-content"]')?.textContent).toBe('images')
    expect(gallery?.getAttribute('aria-current')).toBe('page')
    expect(container.querySelector('.pc-kiot-sidebar')?.classList.contains('is-open')).toBe(false)
  })
})
