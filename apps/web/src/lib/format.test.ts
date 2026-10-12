import { describe, expect, it } from 'vitest'
import { fold, formatDate, formatDateShort, formatMoney, parseMoneyInput, parseWorkUnits, vnDateToIso } from './format'

describe('format', () => {
  it('formatMoney', () => {
    expect(formatMoney(8360489)).toBe('8.360.489đ')
    expect(formatMoney(0)).toBe('0đ')
    expect(formatMoney(-2914480)).toBe('-2.914.480đ')
  })

  it('dd/MM/yyyy, không hiểu theo kiểu Mỹ', () => {
    expect(formatDate('2026-12-09')).toBe('09/12/2026')
    expect(vnDateToIso('09/12/2026')).toBe('2026-12-09')
    expect(vnDateToIso('31/02x/2026')).toBeNull()
    expect(formatDateShort('2026-09-04')).toBe('4/9/2026')
  })

  it('fold bỏ dấu', () => {
    expect(fold('Cường Âu Cơ')).toBe('cuong au co')
    expect(fold('Đoàn')).toBe('doan')
  })

  it('parseWorkUnits chấp nhận 23.3 và 23,3', () => {
    expect(parseWorkUnits('23.3')).toBe(23.3)
    expect(parseWorkUnits('23,3')).toBe(23.3)
    expect(parseWorkUnits('30')).toBe(30)
    expect(parseWorkUnits('')).toBeNull()
    expect(parseWorkUnits('-5')).toBeNull()
    expect(parseWorkUnits('abc')).toBeNull()
  })

  it('parseMoneyInput bỏ dấu phân cách ngàn', () => {
    expect(parseMoneyInput('100000')).toBe(100000)
    expect(parseMoneyInput('100.000')).toBe(100000)
    expect(parseMoneyInput('100,000')).toBe(100000)
    expect(parseMoneyInput('abc')).toBeNull()
  })
})
