/** Tiền VND nguyên: 1234567 -> "1.234.567đ" */
export function formatMoney(amount: number): string {
  const n = Math.round(Number(amount) || 0)
  const sign = n < 0 ? '-' : ''
  return sign + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ'
}

/** Parse rõ ràng ISO "YYYY-MM-DD" (không dùng new Date(text) với chuỗi địa phương). */
export function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!match) return null
  return { y: +match[1], m: +match[2], d: +match[3] }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-12-09" -> "09/12/2026" */
export function formatDate(iso: string | null | undefined): string {
  const p = iso ? parseIsoDate(iso) : null
  return p ? `${pad(p.d)}/${pad(p.m)}/${p.y}` : ''
}

/** Dạng ngắn như app cũ ở thẻ đơn: "2026-09-24" -> "24/9/2026" */
export function formatDateShort(iso: string | null | undefined): string {
  const p = iso ? parseIsoDate(iso) : null
  return p ? `${p.d}/${p.m}/${p.y}` : ''
}

/** Parse input tiền: "100000", "100.000", "100,000" -> 100000. Trả null nếu không hợp lệ. */
export function parseMoneyInput(text: string): number | null {
  if (!text) return null
  const cleaned = text.trim().replace(/\./g, '').replace(/,/g, '')
  if (!/^\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Parse số công: "23.3" hoặc "23,3" -> 23.3. Trả null nếu không hợp lệ. */
export function parseWorkUnits(text: string): number | null {
  if (!text) return null
  const n = Number(text.trim().replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** "09/12/2026" -> "2026-12-09" (dd/MM/yyyy cố định) */
export function vnDateToIso(text: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim())
  if (!match) return null
  const [d, m, y] = [+match[1], +match[2], +match[3]]
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** Ngày hôm nay theo Asia/Ho_Chi_Minh dạng ISO. */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
}

/** Bỏ dấu tiếng Việt để tìm kiếm. */
export function fold(text: string): string {
  return (text || '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const WEEKDAYS = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

/** "Thứ 5, 08/10" theo giờ Việt Nam */
export function todayLabel(): string {
  const p = parseIsoDate(todayIso())!
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()
  return `${WEEKDAYS[wd]}, ${pad(p.d)}/${pad(p.m)}`
}
