import type { RecentImage, RecentImageGroup } from '../api/client'

/** Gộp các nhóm ngày thành một mảng ảnh phẳng, giữ đúng thứ tự để
 *  lightbox điều hướng prev/next qua toàn bộ ảnh đang hiển thị. */
export function flattenImageGroups(groups: RecentImageGroup[]): RecentImage[] {
  const out: RecentImage[] = []
  for (const group of groups) out.push(...group.images)
  return out
}
