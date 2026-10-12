/** Tiện ích parse cho màn "Thêm rập mới" — bám hành vi web Apps Script cũ. */

export const SIZE_ORDER = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL', '7XL', '8XL']

const SIZE_ALIASES: Record<string, string> = {
  '2X': '2XL', '3X': '3XL', '4X': '4XL', '5X': '5XL', '6X': '6XL', '7X': '7XL', '8X': '8XL',
  'XXL': '2XL', 'XXXL': '3XL',
}

/** Chuẩn hóa size về tên chuẩn: "2X" -> "2XL", "s" -> "S". */
export function normalizeSize(raw: string): string {
  const s = (raw || '').trim().toUpperCase()
  return SIZE_ALIASES[s] ?? s
}

export function sizeIndex(size: string): number {
  return SIZE_ORDER.indexOf(normalizeSize(size))
}

/** Trả về true nếu size đầu <= size cuối theo thứ tự chuẩn. */
export function validateSizeRange(from: string, to: string): boolean {
  const a = sizeIndex(from); const b = sizeIndex(to)
  if (a < 0 || b < 0) return false
  return a <= b
}

export type ColorLayers = { color: string; layers: number[] }

/**
 * Parse vùng "Màu / lớp" thành từng dòng.
 * Hỗ trợ: "CAM 10 20 30", "ĐEN 20 10 20", "VÀNG=10 20 30", "XANH: 5 5 5".
 * Trả về mảng các màu (gộp dòng trùng màu) và ném lỗi rõ dòng nào sai.
 */
export function parseColorLayers(text: string): ColorLayers[] {
  const result: ColorLayers[] = []
  const seen = new Map<string, ColorLayers>()
  const lines = (text || '').split(/\r?\n/)
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return
    // Tách tên màu (cho phép tiếng Việt có dấu, dấu gạch, khoảng trắng) khỏi phần số.
    const match = /^([A-Za-zÀ-ỹĐđ0-9 _-]+?)\s*[:=]?\s*([\d\s.,]+)$/.exec(trimmed)
    if (!match) {
      throw new Error(`Dòng ${index + 1} không hợp lệ: "${trimmed}". Đúng định dạng: "CAM 10 20 30".`)
    }
    const color = match[1].trim()
    const numberPart = match[2].trim()
    if (!color) {
      throw new Error(`Dòng ${index + 1} thiếu tên màu: "${trimmed}".`)
    }
    const layers = numberPart.split(/[\s,]+/).map(part => {
      const n = Number(part.replace(',', '.'))
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Dòng ${index + 1} có số lớp không hợp lệ: "${part}". Số lớp phải lớn hơn 0.`)
      }
      return n
    })
    if (!layers.length) {
      throw new Error(`Dòng ${index + 1} thiếu số lớp: "${trimmed}".`)
    }
    const key = color.toLowerCase()
    const existing = seen.get(key)
    if (existing) {
      existing.layers.push(...layers)
    } else {
      const entry: ColorLayers = { color, layers }
      seen.set(key, entry)
      result.push(entry)
    }
  })
  return result
}

/**
 * Parse biểu thức số lượng Khách đặt.
 * Hỗ trợ: "100x7=700", "100 x 7 = 700", "x=700", "700", "10+20+30".
 * Trả về planned_quantity; ném lỗi nếu phép nhân không khớp kết quả sau "=".
 */
export function parseQuantityExpression(text: string): number {
  const raw = (text || '').replace(/\s+/g, '')
  if (!raw) throw new Error('Chưa nhập số lớp / số lượng.')
  const multiply = /^(\d+(?:[.,]\d+)?)[xX×*](\d+(?:[.,]\d+)?)(?:=(\d+(?:[.,]\d+)?))?$/.exec(raw)
  if (multiply) {
    const a = Number(multiply[1].replace(',', '.'))
    const b = Number(multiply[2].replace(',', '.'))
    const stated = multiply[3] ? Number(multiply[3].replace(',', '.')) : null
    if (stated !== null && a * b !== stated) {
      throw new Error(`Kết quả sau dấu = không khớp phép nhân: ${a} × ${b} = ${a * b}, không phải ${stated}.`)
    }
    return a * b
  }
  const bareTotal = /^x=(\d+(?:[.,]\d+)?)$/.exec(raw)
  if (bareTotal) return Number(bareTotal[1].replace(',', '.'))
  if (/^\+?\d+(?:[.,]\d+)?(\+\d+(?:[.,]\d+)?)*$/.test(raw)) {
    return raw.split('+').reduce((sum, part) => sum + Number(part.replace(',', '.')), 0)
  }
  if (/^\d+(?:[.,]\d+)?$/.test(raw)) return Number(raw.replace(',', '.'))
  throw new Error('Biểu thức không hợp lệ. Hỗ trợ: 700, 10+20+30, 100x7=700 hoặc x=700.')
}
