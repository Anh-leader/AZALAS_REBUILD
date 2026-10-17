// Bảng dịch thuần UI: role code / permission key nội bộ -> tiếng Việt.
// KHÔNG đổi key backend, KHÔNG gửi label này về API.

export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Chủ hệ thống',
  ADMIN: 'Quản trị viên',
  KE_TOAN: 'Kế toán',
  KHO: 'Kho / Soạn hàng',
  MEMBER: 'Nhân viên',
  NHAN_SU: 'Nhân sự',
}

export function roleLabel(code: string, fallback?: string | null): string {
  return ROLE_LABELS[code] ?? fallback ?? code
}

export const PERMISSION_LABELS: Record<string, string> = {
  'admin.roles': 'Quản lý vai trò',
  'admin.users': 'Quản lý tài khoản',

  'hr.manage': 'Quản lý nhân sự',
  'hr.payroll.approve': 'Duyệt lương',
  'hr.view': 'Xem nhân sự',

  'materials.manage': 'Quản lý phụ liệu / mua hàng',
  'materials.settle': 'Chốt công nợ phụ liệu',
  'materials.view': 'Xem phụ liệu / mua hàng',

  'order.delete': 'Xóa đơn hàng',

  'production.manage': 'Quản lý sản xuất',
  'production.settle': 'Chốt sản xuất',
  'production.view': 'Xem sản xuất',

  'reports.audit': 'Xem nhật ký hệ thống',
  'reports.picker': 'Xem hiệu suất soạn hàng',
  'reports.view': 'Xem báo cáo',

  'sales.create': 'Tạo đơn',
  'sales.debt.adjust': 'Điều chỉnh công nợ khách hàng',
  'sales.invoice': 'Quản lý hóa đơn',
  'sales.pick': 'Soạn hàng',
  'sales.returns': 'Quản lý hàng trả',
  'sales.ship': 'Quản lý vận chuyển',
  'sales.view': 'Xem dữ liệu bán hàng',
}

export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'admin.roles': 'Tạo, sửa và phân quyền cho các vai trò trong hệ thống.',
  'admin.users': 'Tạo, khóa, chỉnh sửa và quản lý tài khoản nhân viên.',

  'hr.manage': 'Thêm, sửa và quản lý hồ sơ nhân sự.',
  'hr.payroll.approve': 'Duyệt bảng lương và các dữ liệu liên quan đến lương.',
  'hr.view': 'Chỉ xem thông tin nhân sự, không được chỉnh sửa.',

  'materials.manage': 'Nhập, chỉnh sửa và quản lý dữ liệu phụ liệu.',
  'materials.settle': 'Thực hiện chốt công nợ và thanh toán với nhà cung cấp.',
  'materials.view': 'Chỉ xem dữ liệu phụ liệu và mua hàng.',

  'order.delete': 'Xóa đơn hàng chưa phát sinh hóa đơn, thanh toán hoặc sản xuất.',

  'production.manage': 'Quản lý tiến độ, xưởng, rập và dữ liệu sản xuất.',
  'production.settle': 'Xác nhận và chốt dữ liệu sản xuất.',
  'production.view': 'Chỉ xem dữ liệu sản xuất.',

  'reports.audit': 'Xem lịch sử thao tác và thay đổi của người dùng.',
  'reports.picker': 'Xem thống kê hiệu suất của nhân viên soạn hàng.',
  'reports.view': 'Xem các báo cáo tổng hợp của hệ thống.',

  'sales.create': 'Tạo đơn hàng mới cho khách.',
  'sales.debt.adjust': 'Tăng hoặc giảm công nợ khách hàng và tạo lịch sử điều chỉnh.',
  'sales.invoice': 'Xem, lập, chỉnh sửa và chốt hóa đơn.',
  'sales.pick': 'Nhận đơn, soạn hàng, giữ tồn và nhả đơn.',
  'sales.returns': 'Tạo và xử lý các đơn hàng trả.',
  'sales.ship': 'Theo dõi và cập nhật trạng thái giao hàng.',
  'sales.view': 'Xem đơn hàng, khách hàng và dữ liệu bán hàng.',
}

export const PERMISSION_GROUPS: Array<{ title: string; codes: string[] }> = [
  { title: 'Quản trị', codes: ['admin.roles', 'admin.users'] },
  { title: 'Bán hàng', codes: ['sales.view', 'sales.create', 'sales.pick', 'sales.ship', 'sales.invoice', 'sales.returns', 'sales.debt.adjust', 'order.delete'] },
  { title: 'Sản xuất', codes: ['production.view', 'production.manage', 'production.settle'] },
  { title: 'Mua hàng / Phụ liệu', codes: ['materials.view', 'materials.manage', 'materials.settle'] },
  { title: 'Nhân sự', codes: ['hr.view', 'hr.manage', 'hr.payroll.approve'] },
  { title: 'Báo cáo', codes: ['reports.view', 'reports.picker', 'reports.audit'] },
]

export function permissionLabel(code: string): string {
  return PERMISSION_LABELS[code] ?? code
}

export function permissionDescription(code: string): string {
  return PERMISSION_DESCRIPTIONS[code] ?? ''
}
