import { describe, expect, it } from 'vitest'
import { flattenImageGroups } from './khoAnh'
import type { RecentImage, RecentImageGroup } from '../api/client'

function img(id: string): RecentImage {
  return {
    id, order_id: `order-${id}`, order_no: `HD-${id}`, customer_id: 'cust',
    customer_name: 'Khách', order_date: '2026-10-10', created_at: '2026-10-10T00:00:00+07:00',
    url: `/api/v1/media/${id}/view`,
  }
}

describe('flattenImageGroups', () => {
  it('flattens groups preserving image order', () => {
    const groups: RecentImageGroup[] = [
      { date: '10/10/2026', date_iso: '2026-10-10', images: [img('a'), img('b')] },
      { date: '09/10/2026', date_iso: '2026-10-09', images: [img('c')] },
    ]
    expect(flattenImageGroups(groups).map(i => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns empty array for empty groups', () => {
    expect(flattenImageGroups([])).toEqual([])
  })
})
