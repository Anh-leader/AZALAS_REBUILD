/**
 * QL Rập – theo dõi phụ liệu giao cho từng mâm/đơn.
 * Tạo sheet tbl_Rap_GiaoPhuLieu trong file RAP khi sử dụng lần đầu.
 * Mỗi lần giao là một dòng lịch sử; không ghi đè phiếu cũ hoặc trừ tồn kho.
 */
var RAP_VATTU_HEADERS_ = [
  'MaPhieu', 'NgayGiao', 'MaMam', 'MaRap', 'NhaMay', 'TenPhuLieu',
  'SoLuongGiao', 'TongCan', 'HinhThuc', 'NguoiGiao', 'GhiChu', 'ClientToken'
];

function rapVatTuText_(value) {
  return String(value == null ? '' : value).trim();
}

function rapVatTuSheet_() {
  var ss = getSS_('RAP');
  var sh = ss.getSheetByName('tbl_Rap_GiaoPhuLieu');
  if (!sh) {
    sh = ss.insertSheet('tbl_Rap_GiaoPhuLieu');
    sh.getRange(1, 1, 1, RAP_VATTU_HEADERS_.length).setValues([RAP_VATTU_HEADERS_]);
    sh.setFrozenRows(1);
  } else {
    var first = sh.getRange(1, 1, 1, RAP_VATTU_HEADERS_.length).getDisplayValues()[0];
    for (var i = 0; i < RAP_VATTU_HEADERS_.length; i++) {
      if (first[i] !== RAP_VATTU_HEADERS_[i]) {
        throw new Error('Sheet tbl_Rap_GiaoPhuLieu có tiêu đề không khớp tại cột ' + (i + 1));
      }
    }
  }
  return sh;
}

function rapVatTuOrder_(maMam) {
  maMam = rapVatTuText_(maMam);
  if (!maMam) throw new Error('Thiếu mã mâm/đơn.');
  var sh = rapEnsureRapDonHangSheet_();
  if (sh.getLastRow() < 2) throw new Error('Chưa có đơn Rập.');
  var values = sh.getRange(2, 1, sh.getLastRow() - 1,
    Math.max(sh.getLastColumn(), RAP_DON_HEADERS.length)).getValues();
  for (var i = 0; i < values.length; i++) {
    var don = rapMapDonHangRow_(values[i]);
    if (rapVatTuText_(don && (don.maMam || don.thoiGianTao)) === maMam) {
      return {
        maMam: maMam,
        maRap: rapVatTuText_(don.maRap),
        nhaMay: rapVatTuText_(don.nhaMay),
        tenSp: rapVatTuText_(don.tenSp),
        tongHang: Number(don.tongSoLuong || don.tongKeHoach) || 0
      };
    }
  }
  throw new Error('Không tìm thấy mâm ' + maMam + ' trong tbl_Rap_DonHang.');
}

function rapVatTuCatalog_(rows) {
  var defaults = ['Dây kéo', 'Dây luồn', 'Thun', 'Sợi bún',
    'Nút chân', 'Thêu', 'Đục lỗ', 'In', 'Phụ liệu khác'];
  var seen = {};
  var names = [];
  function add(name) {
    name = rapVatTuText_(name);
    if (!name || name.length > 120) return;
    var key = name.toLocaleLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    names.push(name);
  }
  defaults.forEach(add);
  (rows || []).forEach(function(r) { add(r[5]); });
  // Lấy cả tên dây kéo đã có trong danh mục/nhập; nếu file cũ không có,
  // form vẫn dùng được với các tên mặc định và tên tự nhập.
  try {
    var dm = getSheet_('PHU_LIEU', 'tbl_PhuLieu_DanhMuc').getDataRange().getValues();
    for (var i = 1; i < dm.length && names.length < 200; i++) {
      if (/dây kéo|day keo|khóa|khoa/i.test(rapVatTuText_(dm[i][2]) + ' ' + rapVatTuText_(dm[i][1]))) add(dm[i][1]);
    }
  } catch (eDm) {}
  try {
    var nhap = getSheet_('PHU_LIEU', 'tbl_DayKeo_Nhap').getDataRange().getValues();
    for (var j = 1; j < nhap.length && names.length < 200; j++) {
      var ten = rapVatTuText_(nhap[j][3]);
      if (ten && !/^__.*__$/.test(ten)) add(ten);
    }
  } catch (eNhap) {}
  return names;
}

function rapVatTuRead_(sh, maMam) {
  if (sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, RAP_VATTU_HEADERS_.length).getValues();
  return rows.filter(function(r) { return rapVatTuText_(r[2]) === maMam; });
}

function rapVatTuSummary_(don, rows) {
  var sums = {};
  var events = [];
  rows.forEach(function(r) {
    var ten = rapVatTuText_(r[5]);
    if (!ten) return;
    var key = ten.toLocaleLowerCase();
    if (!sums[key]) sums[key] = { ten: ten, daGiao: 0, tongCan: 0 };
    sums[key].daGiao += Number(r[6]) || 0;
    sums[key].tongCan = Number(r[7]) || 0; // Mức cần mới nhất khi ghi lần sau.
    events.push({
      maPhieu: rapVatTuText_(r[0]), ngayGiao: rapVatTuText_(r[1]),
      ten: ten, soLuong: Number(r[6]) || 0, tongCan: Number(r[7]) || 0,
      hinhThuc: rapVatTuText_(r[8]), nguoiGiao: rapVatTuText_(r[9]),
      ghiChu: rapVatTuText_(r[10])
    });
  });
  return { ok: true, don: don, tenVatTu: rapVatTuCatalog_(rows),
    tongHop: Object.keys(sums).map(function(k) { return sums[k]; }),
    lichSu: events.reverse() };
}

function rapVatTuGet(maMam) {
  var don = rapVatTuOrder_(maMam);
  var sh = rapVatTuSheet_();
  return rapVatTuSummary_(don, rapVatTuRead_(sh, don.maMam));
}

function rapVatTuSave(data) {
  data = data || {};
  var maMam = rapVatTuText_(data.maMam);
  var items = Array.isArray(data.items) ? data.items : [];
  if (!items.length || items.length > 100) throw new Error('Chọn ít nhất 1 phụ liệu để giao (tối đa 100).');
  var token = rapVatTuText_(data.clientToken);
  if (!token || token.length > 120) throw new Error('Thiếu mã chống lưu trùng.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var don = rapVatTuOrder_(maMam);
    var sh = rapVatTuSheet_();
    var old = rapVatTuRead_(sh, maMam);
    if (old.some(function(r) { return rapVatTuText_(r[11]) === token; })) {
      var duplicate = rapVatTuSummary_(don, old);
      duplicate.duplicate = true;
      return duplicate;
    }
    var byName = {};
    old.forEach(function(r) {
      var k = rapVatTuText_(r[5]).toLocaleLowerCase();
      if (!byName[k]) byName[k] = 0;
      byName[k] += Number(r[6]) || 0;
    });
    var batchNames = {};
    var prepared = items.map(function(item) {
      var ten = rapVatTuText_(item.ten);
      var key = ten.toLocaleLowerCase();
      var can = Number(item.tongCan);
      var daGiao = byName[key] || 0;
      var con = can - daGiao;
      if (!ten || ten.length > 120 || batchNames[key]) throw new Error('Tên phụ liệu bị trống, trùng hoặc quá dài.');
      batchNames[key] = true;
      if (!Number.isSafeInteger(can) || can <= 0 || can > 100000000 || can < daGiao) {
        throw new Error(ten + ': SL cần không hợp lệ hoặc nhỏ hơn số đã giao.');
      }
      var full = item.giaoDu === true;
      var soLuong = full ? con : Number(item.soLuong);
      if (!Number.isSafeInteger(soLuong) || soLuong <= 0 || soLuong > con) {
        throw new Error(ten + ': số giao phải từ 1 đến ' + con + '.');
      }
      return { ten: ten, tongCan: can, soLuong: soLuong, hinhThuc: full ? 'Giao đủ phần còn thiếu' : 'Giao một phần' };
    });
    var now = Utilities.formatDate(new Date(), 'GMT+7', 'dd/MM/yyyy HH:mm:ss');
    var id = 'GPL-' + Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 100000);
    var nguoiGiao = rapVatTuText_(data.nguoiGiao).slice(0, 120) || 'Không rõ';
    var ghiChu = rapVatTuText_(data.ghiChu).slice(0, 500);
    var values = prepared.map(function(x) {
      return [id, now, maMam, don.maRap, don.nhaMay, x.ten, x.soLuong,
        x.tongCan, x.hinhThuc, nguoiGiao, ghiChu, token];
    });
    sh.getRange(sh.getLastRow() + 1, 1, values.length, RAP_VATTU_HEADERS_.length).setValues(values);
    SpreadsheetApp.flush();
    return rapVatTuSummary_(don, old.concat(values));
  } finally {
    lock.releaseLock();
  }
}
