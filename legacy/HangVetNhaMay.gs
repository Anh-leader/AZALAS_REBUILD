/** Hàng vét giao sau khi mâm nhà may đã chốt. Giữ nguyên bảng kê gốc. */
var HV_HEADERS_ = [
  'MaPhieu','NgayNhap','MaMam','MaRap','NhaMay','MaChotGoc',
  'SoLuong','DonGia','ThanhTien','NguoiNhap','GhiChu','ClientToken',
  'MaChotBoSung','TrangThai','SoLuongTruoc','SoLuongSau',
  'ThanhTienTruoc','ThanhTienSau'
];

function hvText_(v) { return String(v == null ? '' : v).trim(); }
function hvNum_(v) { return Number(v) || 0; }

function hvSheet_() {
  var ss = getSS_('RAP');
  var sh = ss.getSheetByName('tbl_NhaMay_HangVet');
  if (!sh) {
    sh = ss.insertSheet('tbl_NhaMay_HangVet');
    sh.getRange(1,1,1,HV_HEADERS_.length).setValues([HV_HEADERS_]);
    sh.setFrozenRows(1);
  } else {
    var header = sh.getRange(1,1,1,HV_HEADERS_.length).getDisplayValues()[0];
    HV_HEADERS_.forEach(function(h,i) {
      if (header[i] !== h) throw new Error('Tiêu đề tbl_NhaMay_HangVet không khớp cột ' + (i+1));
    });
  }
  return sh;
}

function hvRows_(sh) {
  sh = sh || hvSheet_();
  return sh.getLastRow() < 2 ? [] :
    sh.getRange(2,1,sh.getLastRow()-1,HV_HEADERS_.length).getValues();
}

function hvFindChot_(sh, maChot) {
  if (sh.getLastRow() < 2) return -1;
  var ids = sh.getRange(2,1,sh.getLastRow()-1,1).getDisplayValues();
  for (var i=0;i<ids.length;i++) if (hvText_(ids[i][0]) === maChot) return i+2;
  return -1;
}

function hvGetOne_(maMam) {
  var sh = rapEnsureRapDonHangSheet_();
  var rowNum = rapFindRowIndexByMaMam_(sh, maMam);
  if (rowNum < 2) throw new Error('Không tìm thấy mâm ' + maMam);
  var row = sh.getRange(rowNum,1,1,Math.max(sh.getLastColumn(),RAP_DON_HEADERS.length)).getValues()[0];
  return { sh:sh, rowNum:rowNum, don:rapMapDonHangRow_(row) };
}

/** Lưu phiếu vật lý trước; token cho phép gọi lại an toàn khi mạng mất kết nối. */
function hvNhapHangVet(data) {
  data = data || {};
  var maMam = hvText_(data.maMam);
  var token = hvText_(data.clientToken);
  var qty = Number(data.soLuong);
  var price = Number(data.donGia);
  var ngayNhap = hvText_(data.ngayNhap);
  if (!maMam || !/^[A-Za-z0-9_-]{8,120}$/.test(token)) throw new Error('Thiếu mã mâm hoặc mã lưu trùng.');
  if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 100000000) throw new Error('Số lượng hàng vét phải là số nguyên dương.');
  if (!Number.isFinite(price) || price <= 0 || price > 100000000) throw new Error('Đơn giá hàng vét không hợp lệ.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngayNhap) || isNaN(new Date(ngayNhap+'T12:00:00+07:00').getTime())) {
    throw new Error('Ngày giao hàng vét không hợp lệ.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = hvSheet_();
    var rows = hvRows_(sh);
    var i = rows.findIndex(function(r){ return hvText_(r[11]) === token; });
    var eventRow;
    var sheetRow;
    var one = hvGetOne_(maMam);
    var don = one.don;
    if (don.layoutRap !== 'MOI_AF') throw new Error('Mâm này dùng cấu trúc dữ liệu cũ; cần chuyển mâm trước khi nhập hàng vét.');
    if (!hvText_(don.maChotNhaMay)) throw new Error('Mâm chưa chốt; hãy dùng phiếu NHẬP thông thường.');

    if (i >= 0) {
      sheetRow = i+2;
      eventRow = rows[i];
      if (hvText_(eventRow[2]) !== maMam || hvNum_(eventRow[6]) !== qty || hvNum_(eventRow[7]) !== price) {
        throw new Error('Mã lưu đã được dùng cho phiếu khác.');
      }
      if (hvText_(eventRow[13]) !== 'DANG_GHI') return {
        ok:true, duplicate:true, maPhieu:hvText_(eventRow[0]), thanhTien:hvNum_(eventRow[8])
      };
    } else {
      var maChotGoc = hvText_(don.maChotNhaMay);
      var chot = getSheet_('RAP','tbl_NhaMay_ChotDon');
      var chotRow = hvFindChot_(chot, maChotGoc);
      if (chotRow < 2 || !rapSameName_(chot.getRange(chotRow,3).getValue(), don.nhaMay)) {
        throw new Error('Không xác định được bảng kê gốc của mâm này.');
      }
      var beforeQty = hvNum_(don.soLuongGiao);
      var beforeMoney = hvNum_(don.thanhTien);
      eventRow = [
        'HV-'+Utilities.getUuid(), ngayNhap, maMam, hvText_(don.maRap), hvText_(don.nhaMay), maChotGoc,
        qty, price, qty*price, hvText_(data.nguoiNhap).slice(0,120) || 'Không rõ',
        hvText_(data.ghiChu).slice(0,500), token, '', 'DANG_GHI',
        beforeQty, beforeQty+qty, beforeMoney, beforeMoney+qty*price
      ];
      sheetRow = sh.getLastRow()+1;
      sh.getRange(sheetRow,1,1,HV_HEADERS_.length).setValues([eventRow]);
      SpreadsheetApp.flush();
    }

    var history = rapEnsureLichSuNhap_();
    var marker = '[HV:'+token+']';
    var exists = false;
    if (history.getLastRow() >= 2) {
      var notes = history.getRange(2,5,history.getLastRow()-1,1).getDisplayValues();
      exists = notes.some(function(r){return String(r[0]).indexOf(marker) >= 0;});
    }
    if (!exists) history.appendRow([
      new Date(),eventRow[3],qty,eventRow[9],
      'Hàng vét giao ngày '+eventRow[1]+' '+marker+' '+eventRow[10],maMam,'',''
    ]);

    var oldQty = hvNum_(one.sh.getRange(one.rowNum,RAP_DON_COL.TONG_DA_GIAO+1).getValue());
    if (oldQty === hvNum_(eventRow[14])) {
      one.sh.getRange(one.rowNum,RAP_DON_COL.TONG_DA_GIAO+1).setValue(eventRow[15]);
    } else if (oldQty !== hvNum_(eventRow[15])) {
      throw new Error('Số lượng mâm đã đổi trong lúc ghi phiếu; cần đối soát phiếu '+eventRow[0]);
    }
    var oldMoney = hvNum_(one.sh.getRange(one.rowNum,RAP_DON_COL.THANH_TIEN_NHA_MAY+1).getValue());
    if (oldMoney === hvNum_(eventRow[16])) {
      one.sh.getRange(one.rowNum,RAP_DON_COL.THANH_TIEN_NHA_MAY+1).setValue(eventRow[17]);
    } else if (oldMoney !== hvNum_(eventRow[17])) {
      throw new Error('Thành tiền mâm đã đổi trong lúc ghi phiếu; cần đối soát phiếu '+eventRow[0]);
    }
    var total = hvNum_(don.tongSoLuong);
    var after = hvNum_(eventRow[15]);
    one.sh.getRange(one.rowNum,RAP_DON_COL.TONG_CON_THIEU+1).setValue(Math.max(total-after,0));
    one.sh.getRange(one.rowNum,RAP_DON_COL.TRANG_THAI_NHAN_HANG+1)
      .setValue(rapTinhTrangNhanHang_(total,after));
    one.sh.getRange(one.rowNum,RAP_DON_COL.CAP_NHAT_CUOI+1).setValue(nowVN_());
    sh.getRange(sheetRow,14).setValue('CHO_CHOT');
    SpreadsheetApp.flush();
    return {ok:true,maPhieu:hvText_(eventRow[0]),thanhTien:hvNum_(eventRow[8])};
  } finally { lock.releaseLock(); }
}

function hvLayHangVetChoChot() {
  return hvRows_().filter(function(r){
    return hvText_(r[13]) === 'CHO_CHOT' || hvText_(r[13]) === 'DANG_CHOT';
  }).map(function(r){return {
    maPhieu:hvText_(r[0]), ngayNhap:r[1] instanceof Date ? Utilities.formatDate(r[1],'GMT+7','dd/MM/yyyy') : hvText_(r[1]).replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3/$2/$1'),
    maMam:hvText_(r[2]),maRap:hvText_(r[3]),nhaMay:hvText_(r[4]),maChotGoc:hvText_(r[5]),
    soLuong:hvNum_(r[6]),donGia:hvNum_(r[7]),thanhTien:hvNum_(r[8]),
    ghiChu:hvText_(r[10]),maChotBoSung:hvText_(r[12]),trangThai:hvText_(r[13])
  };});
}

/** Danh sách mâm đã có bảng kê để nút Thêm dòng chọn đúng mâm gốc. */
function hvLayMamDaChotNhaMay(tenNhaMay) {
  tenNhaMay = hvText_(tenNhaMay);
  if (!tenNhaMay) throw new Error('Thiếu tên nhà may.');

  var sh = rapEnsureRapDonHangSheet_();
  if (sh.getLastRow() < 2) return [];
  var rows = sh.getRange(
    2, 1, sh.getLastRow() - 1,
    Math.max(sh.getLastColumn(), RAP_DON_HEADERS.length)
  ).getValues();
  var result = [];

  rows.forEach(function(row) {
    var don = rapMapDonHangRow_(row);
    var maMam = hvText_(don.maMam || don.thoiGianTao);
    if (!maMam || don.layoutRap !== 'MOI_AF') return;
    if (!hvText_(don.maChotNhaMay) || !rapSameName_(don.nhaMay, tenNhaMay)) return;
    result.push({
      maMam: maMam,
      maRap: hvText_(don.maRap),
      tenSp: hvText_(don.tenSp),
      nhaMay: hvText_(don.nhaMay),
      maChotGoc: hvText_(don.maChotNhaMay),
      soLuongDaNhan: hvNum_(don.soLuongGiao),
      donGia: hvNum_(don.donGia),
      capNhatCuoi: hvText_(don.capNhatCuoi)
    });
  });

  // Mâm mới cập nhật nằm trên để người nhập không phải tìm lâu.
  return result.reverse();
}

/** Chốt riêng khoản vét; bảng kê gốc và các lần trả trước không bị sửa. */
function hvChotHangVet(tenNhaMay, maPhieuList, nguoiChot) {
  tenNhaMay = hvText_(tenNhaMay);
  maPhieuList = Array.isArray(maPhieuList) ? maPhieuList.map(hvText_) : [];
  if (!tenNhaMay || !maPhieuList.length || new Set(maPhieuList).size !== maPhieuList.length) {
    throw new Error('Chọn nhà may và ít nhất một phiếu hàng vét hợp lệ.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = hvSheet_();
    var rows = hvRows_(sh);
    var picked = maPhieuList.map(function(id){
      var i = rows.findIndex(function(r){return hvText_(r[0]) === id;});
      if (i < 0) throw new Error('Không tìm thấy phiếu hàng vét '+id);
      var r = rows[i];
      if (!rapSameName_(r[4],tenNhaMay) || ['CHO_CHOT','DANG_CHOT','DA_CHOT'].indexOf(hvText_(r[13])) < 0) {
        throw new Error('Phiếu '+id+' không thuộc nhóm chờ chốt của xưởng này.');
      }
      return {rowNum:i+2,r:r};
    });
    var reserved = picked.filter(function(x){return hvText_(x.r[12]);});
    var maChot = reserved.length ? hvText_(reserved[0].r[12]) : 'CNM-HV-'+Utilities.getUuid();
    if (reserved.some(function(x){return hvText_(x.r[12]) !== maChot;}) ||
        (reserved.length && reserved.length !== picked.length)) {
      throw new Error('Có phiếu đang chốt dở. Hãy thử lại đúng nhóm phiếu đã chọn.');
    }
    if (picked.every(function(x){return hvText_(x.r[13]) === 'DA_CHOT';})) {
      rapCapNhatNoNhaMay_(tenNhaMay);
      return {ok:true,duplicate:true,maChot:maChot};
    }
    picked.forEach(function(x){
      if (!hvText_(x.r[12])) sh.getRange(x.rowNum,13,1,2).setValues([[maChot,'DANG_CHOT']]);
    });
    SpreadsheetApp.flush();

    var soLuong = picked.reduce(function(s,x){return s+hvNum_(x.r[6]);},0);
    var tongTien = picked.reduce(function(s,x){return s+hvNum_(x.r[8]);},0);
    if (!(tongTien > 0)) throw new Error('Tổng tiền hàng vét phải lớn hơn 0.');
    var chot = getSheet_('RAP','tbl_NhaMay_ChotDon');
    if (hvFindChot_(chot,maChot) < 2) {
      chot.appendRow([
        maChot,dateVN_(),tenNhaMay,soLuong,'',tongTien,0,tongTien,
        'Còn nợ','Bổ sung hàng vét '+picked.length+' phiếu; liên kết mâm gốc',
        hvText_(nguoiChot) || 'Không rõ'
      ]);
      SpreadsheetApp.flush();
    }
    picked.forEach(function(x){sh.getRange(x.rowNum,14).setValue('DA_CHOT');});
    rapCapNhatNoNhaMay_(tenNhaMay);
    SpreadsheetApp.flush();
    return {ok:true,maChot:maChot,tongTien:tongTien,soLuong:soLuong};
  } finally {lock.releaseLock();}
}

/** Trả chi tiết đúng ảnh chụp bảng kê: số hàng vét chỉ nằm ở bảng kê bổ sung. */
function hvChiTietBangKe_(maBangKe, rapRows) {
  var events = hvRows_().filter(function(r){return hvText_(r[13]) !== 'DANG_GHI';});
  var original = [];
  (rapRows || []).forEach(function(row){
    var don = rapMapDonHangRow_(row);
    if (hvText_(don.maChotNhaMay) !== maBangKe) return;
    var maMam = hvText_(don.maMam || don.thoiGianTao);
    var extra = events.filter(function(r){return hvText_(r[2]) === maMam;});
    var qty = hvNum_(don.soLuongGiao) - extra.reduce(function(s,r){return s+hvNum_(r[6]);},0);
    var money = hvNum_(don.thanhTien) - extra.reduce(function(s,r){return s+hvNum_(r[8]);},0);
    original.push({maRap:don.maRap,tenSp:don.tenSp,soLop:don.soLop,
      soLuongGiao:qty,donGia:hvNum_(don.donGia),thanhTien:money,
      soLopSua:don.soLopSua || '',maMam:maMam});
  });
  events.filter(function(r){return hvText_(r[12]) === maBangKe && hvText_(r[13]) === 'DA_CHOT';})
    .forEach(function(r){original.push({maRap:hvText_(r[3])+' (hàng vét)',
      tenSp:'Bổ sung mâm '+hvText_(r[2])+' từ '+hvText_(r[5]),
      soLop:'Bổ sung',soLuongGiao:hvNum_(r[6]),donGia:hvNum_(r[7]),
      thanhTien:hvNum_(r[8]),soLopSua:'',maMam:hvText_(r[2])});});
  return original;
}
