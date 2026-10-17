import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { Customer } from '../api/client'

type CustomerOption = Pick<Customer, 'id' | 'name' | 'customer_code' | 'phone'>

export function searchCustomers(customers: CustomerOption[], query: string, limit = 25): CustomerOption[] {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return customers.slice(0, limit)
  return customers
    .filter(customer => [customer.name, customer.phone, customer.customer_code]
      .some(value => value?.toLocaleLowerCase().includes(term)))
    .slice(0, limit)
}

export function CustomerCombobox({
  customers,
  value,
  onChange,
  disabled = false,
  excludeIds = [],
}: {
  customers: CustomerOption[]
  value: string
  onChange: (customerId: string) => void
  disabled?: boolean
  excludeIds?: string[]
}) {
  const id = useId().replace(/:/g, '')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const preserveQueryOnClear = useRef(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const selected = customers.find(customer => customer.id === value)
  const selectedLabel = selected
    ? `${selected.name}${selected.phone ? ` · ${selected.phone}` : ''} · ${selected.customer_code}`
    : ''
  const matches = searchCustomers(customers, query)
  const visible = matches.filter(customer => !excludeIds.includes(customer.id) || customer.id === value)
  const activeCustomer = visible[activeIndex]

  useEffect(() => {
    if (!preserveQueryOnClear.current) setQuery(selectedLabel)
    preserveQueryOnClear.current = false
  }, [value, selectedLabel])

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])

  function select(customer: CustomerOption) {
    onChange(customer.id)
    setQuery(`${customer.name}${customer.phone ? ` · ${customer.phone}` : ''} · ${customer.customer_code}`)
    setOpen(false)
    setActiveIndex(0)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (visible.length) {
        setActiveIndex(index => event.key === 'ArrowDown'
          ? (index < 0 ? 0 : (index + 1) % visible.length)
          : (index < 0 ? visible.length - 1 : (index - 1 + visible.length) % visible.length))
      }
      return
    }
    if (event.key === 'Enter' && open && activeCustomer) {
      event.preventDefault()
      select(activeCustomer)
    }
  }

  return <div className="customer-combobox" ref={rootRef}>
    <input
      ref={inputRef}
      className="form-control"
      role="combobox"
      aria-label="Tìm khách hàng"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={`${id}-listbox`}
      aria-activedescendant={open && activeCustomer ? `${id}-option-${activeIndex}` : undefined}
      autoComplete="off"
      disabled={disabled}
      placeholder="Tìm theo tên, số điện thoại hoặc mã khách"
      value={query}
      onFocus={event => {
        setOpen(true)
        setActiveIndex(-1)
        if (value) event.currentTarget.select()
      }}
      onChange={event => {
        const next = event.target.value
        setQuery(next)
        setOpen(true)
        setActiveIndex(-1)
        if (value) {
          preserveQueryOnClear.current = true
          onChange('')
        }
      }}
      onKeyDown={onKeyDown}
    />
    {open && <div className="customer-combobox-list" id={`${id}-listbox`} role="listbox">
      {visible.length
        ? visible.map((customer, index) => <button
          type="button"
          id={`${id}-option-${index}`}
          className={`customer-combobox-option${index === activeIndex ? ' active' : ''}`}
          key={customer.id}
          role="option"
          aria-selected={customer.id === value}
          onMouseEnter={() => setActiveIndex(index)}
          onMouseDown={event => event.preventDefault()}
          onClick={() => select(customer)}
        >
          <strong>{customer.name}</strong>
          <span>{customer.phone || 'Không có số điện thoại'} · {customer.customer_code}</span>
        </button>)
        : <div className="customer-combobox-empty" role="status">Không tìm thấy khách hàng.</div>}
    </div>}
  </div>
}
