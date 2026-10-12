export type InvoiceSelectionOrder = {
  id: string
  has_active_items?: boolean
}

export function partitionSelectedInvoiceOrders<T extends InvoiceSelectionOrder>(
  orders: T[],
  selectedIds: string[],
): { selected: T[]; eligible: T[]; missingItems: T[] } {
  const selected = orders.filter(order => selectedIds.includes(order.id))
  return {
    selected,
    eligible: selected.filter(order => order.has_active_items !== false),
    missingItems: selected.filter(order => order.has_active_items === false),
  }
}
