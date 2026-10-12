import { describe, expect, it } from 'vitest'
import { normalizeSize, parseColorLayers, parseQuantityExpression, validateSizeRange } from './rpParse'

describe('parseColorLayers', () => {
  it('tách màu và số lớp', () => {
    const result = parseColorLayers('CAM 10 20 30\nĐEN 20 10 20')
    expect(result).toEqual([
      { color: 'CAM', layers: [10, 20, 30] },
      { color: 'ĐEN', layers: [20, 10, 20] },
    ])
  })

  it('hỗ trợ dấu = và : cùng tiếng Việt có dấu', () => {
    const result = parseColorLayers('VÀNG=10 20 30\nXANH: 5 5 5')
    expect(result).toEqual([
      { color: 'VÀNG', layers: [10, 20, 30] },
      { color: 'XANH', layers: [5, 5, 5] },
    ])
  })

  it('gộp dòng trùng màu', () => {
    const result = parseColorLayers('CAM 10\ncam 20')
    expect(result).toEqual([{ color: 'CAM', layers: [10, 20] }])
  })

  it('báo lỗi rõ dòng nào sai', () => {
    expect(() => parseColorLayers('CAM 10\nĐEN abc')).toThrow(/Dòng 2/)
    expect(() => parseColorLayers('CAM 0')).toThrow(/lớn hơn 0/)
  })
})

describe('parseQuantityExpression', () => {
  it('phép nhân', () => {
    expect(parseQuantityExpression('100x7=700')).toBe(700)
    expect(parseQuantityExpression('100 x 7 = 700')).toBe(700)
    expect(parseQuantityExpression('100x7')).toBe(700)
  })

  it('tổng trực tiếp và cộng', () => {
    expect(parseQuantityExpression('x=700')).toBe(700)
    expect(parseQuantityExpression('700')).toBe(700)
    expect(parseQuantityExpression('10+20+30')).toBe(60)
  })

  it('từ chối kết quả sai', () => {
    expect(() => parseQuantityExpression('100x7=600')).toThrow(/không khớp/)
  })
})

describe('size', () => {
  it('chuẩn hóa alias', () => {
    expect(normalizeSize('2X')).toBe('2XL')
    expect(normalizeSize('s')).toBe('S')
  })

  it('validate size đầu <= cuối', () => {
    expect(validateSizeRange('M', '3XL')).toBe(true)
    expect(validateSizeRange('3XL', 'M')).toBe(false)
  })
})
