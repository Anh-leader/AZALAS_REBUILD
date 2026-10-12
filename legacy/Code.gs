// AZALAS TEST OPT V1 - TỐI ƯU HIỆU NĂNG TRÊN ĐÚNG BẢN TEST 2026-09-23
// Giữ nguyên AZALAS_ENV=TEST, ID dữ liệu test, giao diện và nghiệp vụ chính.
// AZALAS V81 - CHỈ THÊM CHÀNH XE + SĐT CHÀNH XE CHO KHÁCH HÀNG.
// Tự thêm cột nếu thiếu; không thay đổi logic các module khác.
// AZALAS V80 - CHỈ FIX CHỐNG TẠO ĐƠN TRÙNG MaHoaDon.
// Không sửa điều hướng, hóa đơn, công nợ, rập, kho, nhân sự hay chức năng khác.
const AZALAS_ENV = "TEST";

const AZALAS_DATA_FILES = {
  SYSTEM: "1OjBHRBraGjVzP2R9gUTEqZoEHNLi0WVwRLaP6ggkohw",
  SALES: "1ukrYZhJ6C-slnQlXPtg8T1Jb-tlFVuTzmEkQLDb9i_w",
  KHO: "140_SmVXg2b8o5wJy9dvH6Q_nkM4985iZr-MHbwJ7K_4",
  RAP: "14fRkUx8xOv52zn6FyOpCbZgKp32za5xYxiFIJrrZRGY",
  PHU_LIEU: "1HTkPdWWVr0kh6L36Ac31dyL3FLF6CPxLTCnHR1TiECQ",
  TAI_CHINH: "1g6QIVUBJsidXCSS7kdx5-GlmAJk7D5U5ZKrZChHXPFs",
  NHAN_SU: "1ErwPOFHYsc2MjW27o1VHWmX_-W66E0lSZ38FWSGhFxc",
  BAO_CAO: "1LHtT_U0AyiyxojZ97bRi4TZvRdXfgLgnvhT3CIg5f6s"
};

const AZALAS_DRIVE_FOLDERS = {
  ANH_DON_ZALO: "1hyY8lsyW7Yt0nvC6S6KK-kfezvj9J0wI",
  ANH_SAN_PHAM: "1-7guTqtDBfQs15qCoRCr2YXGNp5iET0l",
  HOA_DON_CHUP: "1oKI-d_ztuaxELc6gEtgmeXtbdaIZVKWJ",
  PHIEU_NHAP_XUONG: "1Y-MLC4AW9saXV7odUUYuteGsDHWYZgCi",
  FILE_PHU_LIEU: "11VbVE32l5QOLWvXz_e0iEZ50VaNp2yFH",
  BACKUP_DU_LIEU_CU: "1nSZwbvwsznfXCiTcARSmtfEYKBsBKOT3"
};
/****************************************************
* AZALAS WEBAPP - DATA FILE CONFIG
* Dữ liệu mới: mỗi nhóm nghiệp vụ nằm ở 1 file riêng
****************************************************/

// ===== AZ_OPT_TEST_V1: TỐI ƯU HANDLE + ĐỌC SHEET =====
// Chỉ cache object Spreadsheet/Sheet/Folder; KHÔNG cache dữ liệu ô tại đây.
var AZ_EXEC_CACHE_ = {
  ss: Object.create(null),
  sheet: Object.create(null),
  folder: Object.create(null)
};

function getSS_(key) {
  if (!AZALAS_DATA_FILES[key]) {
    throw new Error("Không tìm thấy mã file dữ liệu: " + key);
  }
  if (!AZ_EXEC_CACHE_.ss[key]) {
    AZ_EXEC_CACHE_.ss[key] = SpreadsheetApp.openById(AZALAS_DATA_FILES[key]);
  }
  return AZ_EXEC_CACHE_.ss[key];
}

function getSheet_(fileKey, sheetName) {
  var cacheKey = fileKey + "|" + sheetName;
  if (AZ_EXEC_CACHE_.sheet[cacheKey]) return AZ_EXEC_CACHE_.sheet[cacheKey];

  var ss = getSS_(fileKey);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    throw new Error("Không tìm thấy sheet '" + sheetName + "' trong file " + fileKey);
  }
  AZ_EXEC_CACHE_.sheet[cacheKey] = sh;
  return sh;
}

function getFolder_(folderKey) {
  if (!AZALAS_DRIVE_FOLDERS[folderKey]) {
    throw new Error("Không tìm thấy mã folder: " + folderKey);
  }
  if (!AZ_EXEC_CACHE_.folder[folderKey]) {
    AZ_EXEC_CACHE_.folder[folderKey] = DriveApp.getFolderById(AZALAS_DRIVE_FOLDERS[folderKey]);
  }
  return AZ_EXEC_CACHE_.folder[folderKey];
}

function azReadCols_(sheet, numCols) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];
  return sheet.getRange(1, 1, lastRow, Math.min(numCols, lastCol)).getValues();
}

// Tìm dòng theo 1 cột. TextFinder chạy phía Sheets; fallback chỉ quét đúng 1 cột
// để vẫn nhận dữ liệu cũ có khoảng trắng thừa.
function azFindExactRow_(sheet, colIndex1Based, value, caseInsensitive) {
  var target = String(value === null || value === undefined ? "" : value).trim();
  var lastRow = sheet.getLastRow();
  if (!target || lastRow < 2) return -1;

  var range = sheet.getRange(2, colIndex1Based, lastRow - 1, 1);
  try {
    var found = range.createTextFinder(target)
      .matchEntireCell(true)
      .matchCase(!caseInsensitive)
      .findNext();
    if (found) return found.getRow();
  } catch (e) {}

  var vals = range.getValues();
  var targetCmp = caseInsensitive ? target.toLowerCase() : target;
  for (var i = 0; i < vals.length; i++) {
    var v = String(vals[i][0] === null || vals[i][0] === undefined ? "" : vals[i][0]).trim();
    if ((caseInsensitive ? v.toLowerCase() : v) === targetCmp) return i + 2;
  }
  return -1;
}

function outJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function outText_(text) {
  return ContentService
    .createTextOutput(String(text))
    .setMimeType(ContentService.MimeType.TEXT);
}

function nowVN_() {
  return Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
}

function normalizeText_(v) {
  return String(v || "").trim();
}

function roleAllowedList_() {
  return ["OWNER", "ADMIN", "MEMBER", "BAN_HANG", "KHO", "RAP", "KE_TOAN", "NHAN_SU", "BAO_CAO"];
}

function roleRawList_(roleText) {
  var text = normalizeText_(roleText || "MEMBER").toUpperCase();

  // Cho phép ghi nhiều quyền bằng nhiều kiểu:
  // OWNER,ADMIN | OWNER ADMIN | OWNER/ADMIN | OWNER;ADMIN
  // Bản cũ xóa khoảng trắng nên "OWNER ADMIN" bị dính thành "OWNERADMIN" và rớt về MEMBER.
  text = text
    .replace(/[;|\/\\]+/g, ",")
    .replace(/\s+/g, ",")
    .replace(/,+/g, ",")
    .replace(/^,+|,+$/g, "");

  if (!text) text = "MEMBER";
  return text.split(",").map(function(x) { return normalizeText_(x); }).filter(function(x) { return !!x; });
}

function normalizeRoles_(roleText) {
  var allowed = roleAllowedList_();
  var raw = roleRawList_(roleText);
  var seen = {};
  var out = [];

  raw.forEach(function(role) {
    if (allowed.indexOf(role) !== -1 && !seen[role]) {
      seen[role] = true;
      out.push(role);
    }
  });

  if (!out.length) out.push("MEMBER");

  // Giữ thứ tự cố định để dữ liệu trong sheet dễ nhìn.
  out.sort(function(a, b) {
    return allowed.indexOf(a) - allowed.indexOf(b);
  });

  return out;
}

function normalizeRole_(role) {
  return normalizeRoles_(role).join(",");
}

function hasAppRole_(roleText, roleNeedle) {
  roleNeedle = normalizeText_(roleNeedle).toUpperCase();
  return normalizeRoles_(roleText).indexOf(roleNeedle) !== -1;
}

function isOwnerAdminRole_(roleText) {
  return hasAppRole_(roleText, "OWNER") || hasAppRole_(roleText, "ADMIN");
}

function isValidAppRole_(role) {
  var raw = roleRawList_(role);
  if (!raw.length) return false;

  var allowed = roleAllowedList_();
  for (var i = 0; i < raw.length; i++) {
    if (allowed.indexOf(raw[i]) === -1) return false;
  }
  return true;
}

function roleLabel_(role) {
  var labels = {
    OWNER: "Chủ hệ thống",
    ADMIN: "Quản lý toàn quyền",
    MEMBER: "Nhân viên cơ bản",
    BAN_HANG: "Bán hàng",
    KHO: "Kho thành phẩm",
    RAP: "QL Rập / xưởng",
    KE_TOAN: "Kế toán / công nợ",
    NHAN_SU: "Nhân sự",
    BAO_CAO: "Báo cáo"
  };

  return normalizeRoles_(role).map(function(r) {
    return labels[r] || r;
  }).join(" + ");
}

function rolePermissionSummary_(role) {
  if (hasAppRole_(role, "OWNER")) return "Toàn quyền cao nhất";
  if (hasAppRole_(role, "ADMIN")) return "Toàn quyền quản lý hệ thống";

  var summaries = {
    MEMBER: "Quyền cơ bản",
    BAN_HANG: "Bán hàng: tạo đơn, khách hàng, vận chuyển, xem tồn khả dụng",
    KHO: "Kho: tồn kho, nhập/xuất, chuyển kho, khách trả, kiểm kê, cảnh báo",
    RAP: "Rập/xưởng: QL Rập, nhà may, thợ cắt, đối soát rập",
    KE_TOAN: "Kế toán: hóa đơn, công nợ, thanh toán, báo cáo tiền",
    NHAN_SU: "Nhân sự: nhân viên và tài khoản theo quyền được cấp",
    BAO_CAO: "Báo cáo: xem báo cáo tổng hợp, không sửa dữ liệu"
  };

  return normalizeRoles_(role).map(function(r) {
    return summaries[r] || r;
  }).join(" | ");
}

function getPermissionMatrix_() {
  return roleAllowedList_().map(function(role) {
    return {
      role: role,
      label: roleLabel_(role),
      summary: rolePermissionSummary_(role)
    };
  });
}
function dateVN_() {
  return Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy");
}

function makeId_(prefix) {
  return prefix + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMddHHmmss") + "-" + Math.floor(Math.random() * 1000);
}

function safeParseJson_(text, fallback) {
  try {
    if (!text) return fallback;
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}



/****************************************************
 * HÀNG TRẢ - GLOBAL HELPERS
 * Fix lỗi getHangTraDetails: htText_ is not defined
 * Các hàm này đặt cấp ngoài để mọi API hàng trả đều gọi được.
 ****************************************************/
function htText_(v) {
  return String(v === null || v === undefined ? "" : v).trim();
}

function htNum_(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  var s = String(v)
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");
  var n = Number(s);
  return isNaN(n) ? 0 : n;
}

function htStatus_(v) {
  var s = htText_(v);
  var lower = s.toLowerCase();

  if (!s) return "Mới";
  if (lower === "xóa" || lower === "xoa" || lower === "đã xóa" || lower === "da xoa") return "Xóa";
  if (lower.indexOf("duyệt") > -1 || lower.indexOf("duyet") > -1) return "Đã duyệt";

  return "Mới";
}

function htFindCustomer_(sheetKH, maKH, tenKhach) {
  maKH = htText_(maKH);
  tenKhach = htText_(tenKhach);

  var rowIndex = -1;
  if (maKH) rowIndex = azFindExactRow_(sheetKH, 1, maKH, false);
  if (rowIndex === -1 && tenKhach) rowIndex = azFindExactRow_(sheetKH, 2, tenKhach, true);

  if (rowIndex !== -1) {
    var row = sheetKH.getRange(rowIndex, 1, 1, 5).getValues()[0];
    return {
      found: true,
      rowIndex: rowIndex,
      maKH: htText_(row[0]),
      tenKhach: htText_(row[1]),
      noHienTai: htNum_(row[4])
    };
  }
  return { found: false, rowIndex: -1, maKH: "", tenKhach: tenKhach, noHienTai: 0 };
}

function htFindHangTra_(sheetHT, maPhieu) {
  maPhieu = htText_(maPhieu);
  var rowIndex = azFindExactRow_(sheetHT, 1, maPhieu, false);
  if (rowIndex !== -1) {
    var row = sheetHT.getRange(rowIndex, 1, 1, 10).getValues()[0];
    return {
      found: true, rowIndex: rowIndex, row: row,
      maPhieu: htText_(row[0]), ngayTra: row[1] || "",
      tenKhach: htText_(row[2]), tongTienTra: htNum_(row[3]),
      nguoiKiem: htText_(row[4]), trangThai: htStatus_(row[5]),
      ghiChu: htText_(row[6]), maKH: htText_(row[7]),
      maHoaDonGoc: htText_(row[8]), capNhatCuoi: row[9] || ""
    };
  }
  return { found: false };
}



function htAppendCongNoTongHop_(sheetCNTH, maKH, tenKhach, psTang, psGiam, noMoi, now) {
  try {
    var rowCN = azFindExactRow_(sheetCNTH, 1, maKH, false);
    if (rowCN === -1) {
      sheetCNTH.appendRow([maKH, tenKhach, "KHACH_HANG", 0, psTang || 0, psGiam || 0, noMoi || 0, now || nowVN_()]);
    } else {
      var current = sheetCNTH.getRange(rowCN, 2, 1, 7).getValues()[0]; // B:H
      current[0] = tenKhach;
      current[1] = "KHACH_HANG";
      current[3] = htNum_(current[3]) + (psTang || 0); // E
      current[4] = htNum_(current[4]) + (psGiam || 0); // F
      current[5] = noMoi || 0;                         // G
      current[6] = now || nowVN_();                    // H
      sheetCNTH.getRange(rowCN, 2, 1, 7).setValues([current]);
    }
  } catch (err) {
    // Không chặn duyệt hàng trả nếu bảng tổng hợp công nợ khác cấu trúc.
  }
}

function uploadOrderImages_(imagesJson, maHoaDon) {
  var urls = [];
  if (!imagesJson) return urls;

  var images = safeParseJson_(imagesJson, []);
  if (!images || !images.length) return urls;

  var folder = getFolder_("ANH_DON_ZALO");

  images.forEach(function (base64, index) {
    if (!base64 || base64.indexOf(",") === -1) return;

    var content = base64.split(",")[1];
    var decoded = Utilities.base64Decode(content);
    var blob = Utilities.newBlob(decoded, "image/jpeg", maHoaDon + "_" + (index + 1) + ".jpg");
    var file = folder.createFile(blob);

    urls.push(file.getUrl());
  });

  return urls;
}

/****************************************************
 * HÓA ĐƠN - LƯU ẢNH CHỤP THEO FOLDER KHÁCH V52
 * Folder tổng: AZALAS_DRIVE_FOLDERS.HOA_DON_CHUP
 ****************************************************/
function azHoaDonChupTextV52_(v) {
  return String(v === null || v === undefined ? "" : v).trim();
}

function azHoaDonChupNormalizeNameV52_(v) {
  return azHoaDonChupTextV52_(v)
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function azHoaDonChupSafeNameV52_(v, fallback) {
  var name = azHoaDonChupTextV52_(v) || fallback || "KHACH_KHONG_TEN";
  name = name.replace(/[\\\/:*?"<>|#%\{\}\[\]\^~`]+/g, " ").replace(/\s+/g, " ").trim();
  return name || fallback || "KHACH_KHONG_TEN";
}

function azGetOrCreateHoaDonKhachFolderV52_(tenKhach) {
  var parent = getFolder_("HOA_DON_CHUP");
  var folderName = azHoaDonChupSafeNameV52_(tenKhach, "KHACH_KHONG_TEN");

  var exact = parent.getFoldersByName(folderName);
  if (exact.hasNext()) return exact.next();

  var targetKey = azHoaDonChupNormalizeNameV52_(folderName);
  var folders = parent.getFolders();

  while (folders.hasNext()) {
    var f = folders.next();
    if (azHoaDonChupNormalizeNameV52_(f.getName()) === targetKey) {
      return f;
    }
  }

  return parent.createFolder(folderName);
}

function azSaveHoaDonChupV52(payload) {
  payload = payload || {};

  var dataUrl = azHoaDonChupTextV52_(payload.dataUrl);
  if (!dataUrl || dataUrl.indexOf(",") === -1) {
    throw new Error("Thiếu dữ liệu ảnh hóa đơn.");
  }

  var tenKhach = azHoaDonChupSafeNameV52_(payload.tenKhach, "KHACH_KHONG_TEN");
  var maHoaDon = azHoaDonChupSafeNameV52_(payload.maHoaDon, "HOA_DON");
  var nguoiChup = azHoaDonChupSafeNameV52_(payload.nguoiChup, "APP");

  var mime = "image/png";
  try {
    var head = dataUrl.substring(5, dataUrl.indexOf(";"));
    if (head) mime = head;
  } catch (e) {}

  var ext = mime.indexOf("jpeg") !== -1 || mime.indexOf("jpg") !== -1 ? ".jpg" : ".png";
  var base64 = dataUrl.split(",")[1];
  var bytes = Utilities.base64Decode(base64);

  var folder = azGetOrCreateHoaDonKhachFolderV52_(tenKhach);
  var timeKey = Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd_HHmmss");
  var fileName = azHoaDonChupSafeNameV52_(maHoaDon, "HOA_DON") + "_" + timeKey + ext;

  var blob = Utilities.newBlob(bytes, mime, fileName);
  var file = folder.createFile(blob);

  return {
    ok: true,
    fileId: file.getId(),
    fileName: file.getName(),
    fileUrl: file.getUrl(),
    folderId: folder.getId(),
    folderName: folder.getName(),
    folderUrl: folder.getUrl(),
    maHoaDon: maHoaDon,
    tenKhach: tenKhach,
    nguoiChup: nguoiChup
  };
}



/****************************************************
 * KHO THÀNH PHẨM - DATA MỚI PHẦN 1
 * 03_DATA_KHO_THANH_PHAM
 * Chức năng bước 1:
 * - Xem tồn nhanh theo mã rập / mẫu / màu / size / kho
 * - Nhập kho thủ công thành phẩm
 * - Tự tạo hàng hóa + biến thể nếu chưa có
 * - Ghi phiếu nhập, chi tiết nhập, thẻ kho, tồn kho
 ****************************************************/
function khoText_(v) {
  return String(v === null || v === undefined ? "" : v).trim();
}

function khoNum_(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  var s = String(v).replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  var n = Number(s);
  return isNaN(n) ? 0 : n;
}

function khoMakeId_(prefix) {
  return prefix + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + "-" + Math.floor(Math.random() * 1000);
}

function khoBuildMaSP_(maRap, hieu, tenSP) {
  maRap = khoText_(maRap).toUpperCase() || "SP";
  hieu = khoText_(hieu).toUpperCase() || "AZ";
  var raw = (maRap + "-" + hieu + "-" + khoText_(tenSP).toUpperCase())
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return raw.substring(0, 45) || khoMakeId_("SP-");
}

function khoBuildMaHangNoiBo_(maRap, hieu, mau, size) {
  var raw = [maRap, hieu, mau, size].map(function(x) {
    return khoText_(x).toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/Đ/g, "D")
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }).filter(function(x) { return x; }).join("-");
  return raw.substring(0, 60) || khoMakeId_("MH-");
}

function khoFindRow_(sheet, colIndex1Based, value) {
  value = khoText_(value);
  if (!value || sheet.getLastRow() < 2) return -1;
  var values = sheet.getRange(2, colIndex1Based, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (khoText_(values[i][0]) === value) return i + 2;
  }
  return -1;
}

function khoGetOrCreateHangHoa_(info, now) {
  var shHH = getSheet_("KHO", "tbl_Kho_HangHoa");
  var maSP = khoText_(info.maSP) || khoBuildMaSP_(info.maRap, info.hieu, info.tenSP || info.mauSanPham);
  var row = khoFindRow_(shHH, 1, maSP);
  if (row === -1) {
    shHH.appendRow([
      maSP,                              // A MaSP
      khoText_(info.maRap),              // B MaRap
      khoText_(info.mauSanPham || info.tenSP), // C MauSanPham
      khoText_(info.hieu || "AZALAS"),   // D Hieu
      khoText_(info.tenSP || info.mauSanPham), // E TenSanPham
      khoText_(info.nhomHang || "Thành phẩm"), // F NhomHang
      khoText_(info.gioiTinh || "Nam/Nữ"),     // G GioiTinh
      khoText_(info.chatLieu),           // H ChatLieu
      "Đang bán",                       // I TrangThai
      khoText_(info.ghiChu),             // J GhiChu
      now,                               // K NgayTao
      now                                // L CapNhatCuoi
    ]);
  } else {
    shHH.getRange(row, 12).setValue(now); // L CapNhatCuoi
  }
  return maSP;
}

function khoGetOrCreateBienThe_(info, maSP) {
  var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
  var maHangNoiBo = khoText_(info.maHangNoiBo) || khoBuildMaHangNoiBo_(info.maRap, info.hieu, info.mau, info.size);
  var row = khoFindRow_(shBT, 1, maHangNoiBo);
  var maBanHang = khoText_(info.maBanHang) || maHangNoiBo;
  if (row === -1) {
    shBT.appendRow([
      maHangNoiBo,                       // A MaHangNoiBo
      maBanHang,                         // B MaBanHang
      maSP,                              // C MaSP
      khoText_(info.maRap),              // D MaRap
      khoText_(info.mauSanPham || info.tenSP), // E MauSanPham
      khoText_(info.hieu || "AZALAS"),   // F Hieu
      khoText_(info.mau),                // G Mau
      khoText_(info.size),               // H Size
      khoText_(info.tenHienThi || ((info.tenSP || info.mauSanPham || info.maRap) + " " + info.mau + " " + info.size)), // I TenHienThi
      "Có",                              // J CoBan
      khoText_(info.ghiChu)              // K GhiChu
    ]);
  }
  return {
    maHangNoiBo: maHangNoiBo,
    maBanHang: maBanHang
  };
}

function khoUpdateTon_(info, bienThe, soLuong, now, maChungTu, nguoi, ghiChu) {
  var shTon = getSheet_("KHO", "tbl_Kho_Ton");
  var shTheKho = getSheet_("KHO", "tbl_Kho_TheKho");
  var data = shTon.getDataRange().getValues();
  var rowTon = -1;
  var kho = khoText_(info.kho || info.khoNhap || "KHO CHÍNH");
  var viTri = khoText_(info.viTri);
  var qty = khoNum_(soLuong);
  var trangThaiRaw = khoText_(info.trangThaiHang || info.trangThai || "Hàng tốt");
  var trangThaiKey = trangThaiRaw
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D");

  var isCho = trangThaiKey.indexOf("CHO") !== -1 || trangThaiKey.indexOf("HOAN THIEN") !== -1 || trangThaiKey.indexOf("KIEM") !== -1;
  var isLoi = trangThaiKey.indexOf("LOI") !== -1 || trangThaiKey.indexOf("HONG") !== -1;
  var loaiNhap = isLoi ? "NHAP_HANG_LOI" : (isCho ? "NHAP_CHO_KIEM" : "NHAP_KHO");

  for (var i = 1; i < data.length; i++) {
    if (
      khoText_(data[i][0]) === bienThe.maHangNoiBo &&
      khoText_(data[i][2]) === kho &&
      khoText_(data[i][3]) === viTri
    ) {
      rowTon = i + 1;
      break;
    }
  }

  var tonThucTe = 0;
  var tonGiu = 0;
  var choHoanThien = 0;
  var daCotRi = 0;
  var hangLoi = 0;

  if (rowTon !== -1) {
    tonThucTe = khoNum_(shTon.getRange(rowTon, 9).getValue());  // I
    tonGiu = khoNum_(shTon.getRange(rowTon, 10).getValue());    // J
    choHoanThien = khoNum_(shTon.getRange(rowTon, 12).getValue()); // L
    daCotRi = khoNum_(shTon.getRange(rowTon, 13).getValue());   // M
    hangLoi = khoNum_(shTon.getRange(rowTon, 14).getValue());   // N
  }

  if (isLoi) {
    hangLoi += qty;
  } else if (isCho) {
    choHoanThien += qty;
  } else {
    tonThucTe += qty;
  }

  if (tonThucTe < 0) tonThucTe = 0;
  if (tonGiu < 0) tonGiu = 0;
  if (choHoanThien < 0) choHoanThien = 0;
  if (daCotRi < 0) daCotRi = 0;
  if (hangLoi < 0) hangLoi = 0;

  var khaDung = Math.max(tonThucTe - tonGiu, 0);

  if (rowTon === -1) {
    shTon.appendRow([
      bienThe.maHangNoiBo,               // A MaHangNoiBo
      bienThe.maBanHang,                 // B MaBanHang
      kho,                               // C Kho
      viTri,                             // D ViTri
      khoText_(info.maRap),              // E MaRap
      khoText_(info.hieu || "AZALAS"),   // F Hieu
      khoText_(info.mau),                // G Mau
      khoText_(info.size),               // H Size
      tonThucTe,                         // I TonThucTe - chỉ hàng tốt mới vào tồn bán
      tonGiu,                            // J TonGiu
      khaDung,                           // K KhaDung
      choHoanThien,                      // L ChoHoanThien
      daCotRi,                           // M DaCotRi
      hangLoi,                           // N HangLoi
      now                                // O CapNhatCuoi
    ]);
  } else {
    shTon.getRange(rowTon, 9).setValue(tonThucTe);
    shTon.getRange(rowTon, 10).setValue(tonGiu);
    shTon.getRange(rowTon, 11).setValue(khaDung);
    shTon.getRange(rowTon, 12).setValue(choHoanThien);
    shTon.getRange(rowTon, 13).setValue(daCotRi);
    shTon.getRange(rowTon, 14).setValue(hangLoi);
    shTon.getRange(rowTon, 15).setValue(now);
  }

  shTheKho.appendRow([
    khoMakeId_("TK-"),                   // A MaGiaoDichKho
    now,                                 // B ThoiGian
    qty >= 0 ? loaiNhap : "DIEU_CHINH_TON", // C LoaiGiaoDich
    maChungTu,                           // D MaChungTu
    bienThe.maHangNoiBo,                 // E MaHangNoiBo
    bienThe.maBanHang,                   // F MaBanHang
    kho,                                 // G Kho
    qty,                                 // H SoLuongThayDoi
    isLoi ? hangLoi : (isCho ? choHoanThien : tonThucTe), // I TonSau của đúng nhóm vừa nhập
    nguoi || "app",                      // J NguoiThaoTac
    (ghiChu || "") + (trangThaiRaw ? (" | Trạng thái nhập: " + trangThaiRaw) : "")
  ]);

  return tonThucTe;
}


/****************************************************
 * KHO THÀNH PHẨM - GÁN ẢNH MÃ BÁN HÀNG PHẦN 14
 * - Ảnh gắn theo MaBanHang
 * - Không ảnh hưởng tồn / giữ / trừ tồn
 ****************************************************/
function khoEnsureAnhSanPhamSheet_() {
  var headers = [
    "MaAnhSP", "MaBanHang", "MaSP", "MaRap", "Hieu", "Mau",
    "LinkAnhChinh", "LinkAnhPhu", "AnhCoMa", "TrangThai", "GhiChu", "NgayTao"
  ];
  var ss = getSS_("KHO");
  var sh = ss.getSheetByName("tbl_Kho_AnhSanPham");
  if (!sh) sh = ss.insertSheet("tbl_Kho_AnhSanPham");
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var emptyHeader = first.every(function(v) { return !khoText_(v); });
  if (emptyHeader) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function khoDriveThumbnailUrl_(fileId, size) {
  fileId = khoText_(fileId).replace(/[^a-zA-Z0-9_-]/g, "");
  size = size || "w600";
  return fileId ? ("https://drive.google.com/thumbnail?id=" + fileId + "&sz=" + size) : "";
}

function khoSaveImageDataToDrive_(dataUrl, fileNamePrefix) {
  dataUrl = khoText_(dataUrl);
  if (!dataUrl || dataUrl.indexOf(",") === -1) return null;

  var contentType = "image/jpeg";
  try {
    contentType = dataUrl.substring(5, dataUrl.indexOf(";")) || "image/jpeg";
  } catch (e) {}

  var bytes = Utilities.base64Decode(dataUrl.split(",")[1]);
  var ext = contentType.indexOf("png") !== -1 ? ".png" : (contentType.indexOf("webp") !== -1 ? ".webp" : ".jpg");
  var cleanName = khoText_(fileNamePrefix || "ANH_MA_BAN_HANG")
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D")
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "ANH_MA_BAN_HANG";

  var blob = Utilities.newBlob(bytes, contentType, cleanName + "_" + new Date().getTime() + ext);
  var file = getFolder_("ANH_SAN_PHAM").createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (eShare) {}

  var fileId = file.getId();
  return {
    fileId: fileId,
    fileUrl: file.getUrl(),
    thumbUrl: khoDriveThumbnailUrl_(fileId, "w600")
  };
}

function khoGetAnhMaBanHangMap_() {
  var map = {};
  try {
    var sh = khoEnsureAnhSanPhamSheet_();
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var maBH = khoText_(rows[i][1]);
      if (!maBH) continue;
      map[maBH] = {
        row: i + 1,
        maAnhSP: khoText_(rows[i][0]),
        maBanHang: maBH,
        maSP: khoText_(rows[i][2]),
        maRap: khoText_(rows[i][3]),
        hieu: khoText_(rows[i][4]),
        mau: khoText_(rows[i][5]),
        linkAnhChinh: khoText_(rows[i][6]),
        linkAnhPhu: khoText_(rows[i][7]),
        anhCoMa: khoText_(rows[i][8]),
        trangThai: khoText_(rows[i][9]),
        ghiChu: khoText_(rows[i][10]),
        ngayTao: khoText_(rows[i][11])
      };
    }
  } catch (err) {}
  return map;
}

function khoHandleDataMoi_(data) {
  var type = khoText_(data && data.type);
  var khoTypes = {
    khoGetTonList: true,
    khoGetPhieuXuatList: true,
    khoGetBaoCaoBanHang: true,
    khoGetGoiYSanXuat: true,
    khoGetBaoCaoTonLau: true,
    khoGetBienTheManager: true,
    khoGetKiemKeList: true,
    khoDieuChinhKiemKe: true,
    khoGetNhatKyKhoList: true,
    khoGetHangDangGiu: true,
    khoGetAnhMaBanHangList: true,
    khoGetAnhThieuTheoRap: true,
    khoSaveAnhMaBanHang: true,
    khoXuLyLoiCho: true,
    khoSaveNhapKho: true,
    khoSavePhieuXuatManual: true,
    khoGetDashboardKhoTongHop: true,
    khoSaveBienTheInfo: true,
    khoSetMaBanHangStatus: true,
    khoMergeMaBanHang: true,
    khoSaveChuyenKhoNoiBo: true,
    khoGetChuyenKhoNoiBoList: true,
    khoSaveKhachTraHang: true,
    khoGetKhachTraHangList: true,
    donCreateYeuCauSuaSauXuat: true,
    donGetYeuCauSuaSauXuatList: true,
    donUpdateYeuCauSuaSauXuat: true,
    khoGetDanhMuc: true
  };

  if (!khoTypes[type]) return null;

  try {

    // AZALAS FIX 2026-06-24:
    // Mở lại nhập kho thủ công và xử lý bằng batch, không đọc tbl_Kho_Ton trong từng item.
    if (type === "khoSaveNhapKho") {
      return khoSaveNhapKho_(data);
    }

    if (type === "donCreateYeuCauSuaSauXuat") {
      return donCreateYeuCauSuaSauXuat_(data);
    }

    if (type === "donGetYeuCauSuaSauXuatList") {
      return donGetYeuCauSuaSauXuatList_(data);
    }

    if (type === "donUpdateYeuCauSuaSauXuat") {
      return donUpdateYeuCauSuaSauXuat_(data);
    }

    if (type === "khoSavePhieuXuatManual") {
      return khoSavePhieuXuatManual_(data);
    }

    if (type === "khoGetDashboardKhoTongHop") {
      return khoGetDashboardKhoTongHop_(data);
    }

    if (type === "khoSaveBienTheInfo") {
      return khoSaveBienTheInfo_(data);
    }

    if (type === "khoSetMaBanHangStatus") {
      return khoSetMaBanHangStatus_(data);
    }

    if (type === "khoMergeMaBanHang") {
      return khoMergeMaBanHang_(data);
    }

    if (type === "khoSaveChuyenKhoNoiBo") {
      return khoSaveChuyenKhoNoiBo_(data);
    }

    if (type === "khoGetChuyenKhoNoiBoList") {
      return khoGetChuyenKhoNoiBoList_(data);
    }

    if (type === "khoSaveKhachTraHang") {
      return khoSaveKhachTraHang_(data);
    }

    if (type === "khoGetKhachTraHangList") {
      return khoGetKhachTraHangList_(data);
    }

    if (type === "khoGetKiemKeList") {
      return khoGetKiemKeList_(data);
    }

    if (type === "khoGetNhatKyKhoList") {
      return khoGetNhatKyKhoList_(data);
    }

    if (type === "khoDieuChinhKiemKe") {
      return khoDieuChinhKiemKe_(data);
    }

    if (type === "khoGetBienTheManager") {
      return khoGetBienTheManager_(data);
    }

    if (type === "khoXuLyLoiCho") {
      var maHangNoiBoXL = khoText_(data.maHangNoiBo);
      var actionXL = khoText_(data.action);
      var qtyXL = khoNum_(data.soLuong);
      var nguoiXL = khoText_(data.nguoi || data.user || data.actorUser || "app");
      var ghiChuXL = khoText_(data.ghiChu);
      var khoXL = khoText_(data.kho);
      var viTriXL = khoText_(data.viTri);

      if (!maHangNoiBoXL) return outJson_({ ok:false, message:"Thiếu mã hàng nội bộ" });
      if (qtyXL <= 0) return outJson_({ ok:false, message:"Số lượng xử lý phải lớn hơn 0" });
      if (["CHO_TO_TOT", "CHO_TO_LOI", "LOI_TO_TOT"].indexOf(actionXL) === -1) {
        return outJson_({ ok:false, message:"Kiểu xử lý không hợp lệ" });
      }

      var shTonXL = getSheet_("KHO", "tbl_Kho_Ton");
      var shTheXL = getSheet_("KHO", "tbl_Kho_TheKho");
      var rowsXL = shTonXL.getDataRange().getValues();
      var nowXL = nowVN_();
      var remainingXL = qtyXL;
      var processedXL = 0;
      var detailsXL = [];

      function sourceQty_(r) {
        if (actionXL === "CHO_TO_TOT" || actionXL === "CHO_TO_LOI") return khoNum_(r[11]); // L ChoHoanThien
        if (actionXL === "LOI_TO_TOT") return khoNum_(r[13]); // N HangLoi
        return 0;
      }

      // Kiểm tra đủ số lượng trước khi cập nhật, tránh cập nhật nửa chừng.
      var totalAvailableXL = 0;
      for (var preXL = 1; preXL < rowsXL.length; preXL++) {
        var preRXL = rowsXL[preXL];
        if (khoText_(preRXL[0]) !== maHangNoiBoXL) continue;
        if (khoXL && khoText_(preRXL[2]) !== khoXL) continue;
        if (viTriXL && khoText_(preRXL[3]) !== viTriXL) continue;
        totalAvailableXL += sourceQty_(preRXL);
      }
      if (totalAvailableXL < qtyXL) {
        return outJson_({ ok:false, message:"Không đủ số lượng để xử lý. Hiện có " + totalAvailableXL + "/" + qtyXL + " cái." });
      }

      for (var iXL = 1; iXL < rowsXL.length && remainingXL > 0; iXL++) {
        var rXL = rowsXL[iXL];
        if (khoText_(rXL[0]) !== maHangNoiBoXL) continue;
        if (khoXL && khoText_(rXL[2]) !== khoXL) continue;
        if (viTriXL && khoText_(rXL[3]) !== viTriXL) continue;

        var availableXL = sourceQty_(rXL);
        if (availableXL <= 0) continue;
        var takeXL = Math.min(availableXL, remainingXL);
        var rowIndexXL = iXL + 1;

        var tonThucTeXL = khoNum_(rXL[8]);
        var tonGiuXL = khoNum_(rXL[9]);
        var choXL = khoNum_(rXL[11]);
        var hangLoiXL = khoNum_(rXL[13]);
        var loaiGDXL = "";
        var ghiChuDongXL = "";

        if (actionXL === "CHO_TO_TOT") {
          choXL -= takeXL;
          tonThucTeXL += takeXL;
          loaiGDXL = "CHO_KIEM_THANH_HANG_TOT";
          ghiChuDongXL = "Chờ kiểm → Hàng tốt";
        } else if (actionXL === "CHO_TO_LOI") {
          choXL -= takeXL;
          hangLoiXL += takeXL;
          loaiGDXL = "CHO_KIEM_THANH_HANG_LOI";
          ghiChuDongXL = "Chờ kiểm → Hàng lỗi";
        } else if (actionXL === "LOI_TO_TOT") {
          hangLoiXL -= takeXL;
          tonThucTeXL += takeXL;
          loaiGDXL = "HANG_LOI_SUA_XONG_THANH_HANG_TOT";
          ghiChuDongXL = "Hàng lỗi → Hàng tốt";
        }

        if (choXL < 0) choXL = 0;
        if (hangLoiXL < 0) hangLoiXL = 0;
        var khaDungXL = Math.max(tonThucTeXL - tonGiuXL, 0);

        shTonXL.getRange(rowIndexXL, 9).setValue(tonThucTeXL);   // I TonThucTe
        shTonXL.getRange(rowIndexXL, 11).setValue(khaDungXL);    // K KhaDung
        shTonXL.getRange(rowIndexXL, 12).setValue(choXL);        // L ChoHoanThien
        shTonXL.getRange(rowIndexXL, 14).setValue(hangLoiXL);    // N HangLoi
        shTonXL.getRange(rowIndexXL, 15).setValue(nowXL);        // O CapNhatCuoi

        shTheXL.appendRow([
          khoMakeId_("TK-"),
          nowXL,
          loaiGDXL,
          khoMakeId_("XL-"),
          maHangNoiBoXL,
          khoText_(rXL[1]),
          khoText_(rXL[2]),
          (actionXL === "CHO_TO_LOI") ? 0 : takeXL,
          tonThucTeXL,
          nguoiXL,
          ghiChuDongXL + ": " + takeXL + " cái" + (ghiChuXL ? ". " + ghiChuXL : "")
        ]);

        processedXL += takeXL;
        remainingXL -= takeXL;
        detailsXL.push({ kho: khoText_(rXL[2]), viTri: khoText_(rXL[3]), soLuong: takeXL });
      }

      if (processedXL <= 0) {
        return outJson_({ ok:false, message:"Không tìm thấy số lượng phù hợp để xử lý" });
      }
      if (remainingXL > 0) {
        return outJson_({ ok:false, message:"Không đủ số lượng để xử lý. Đã tìm thấy " + processedXL + "/" + qtyXL + " cái. Chưa cập nhật đủ, vui lòng kiểm tra lại." });
      }

      SpreadsheetApp.flush();
      return outJson_({ ok:true, message:"Đã xử lý " + processedXL + " cái", processed: processedXL, details: detailsXL });
    }

    if (type === "khoGetDanhMuc") {
      var shHH = getSheet_("KHO", "tbl_Kho_HangHoa");
      var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
      var shMS = getSheet_("KHO", "tbl_MauSac");
      var shVT = getSheet_("KHO", "tbl_Kho_ViTri");

      function getRows_(sh) {
        var values = sh.getDataRange().getValues();
        values.shift();
        return values.filter(function(r) { return khoText_(r[0]); });
      }

      return outJson_({
        ok: true,
        hangHoa: getRows_(shHH),
        bienThe: getRows_(shBT),
        mauSac: getRows_(shMS),
        viTri: getRows_(shVT)
      });
    }


    if (type === "khoGetBaoCaoTonLau") {
      return khoGetBaoCaoTonLau_(data);
    }

    if (type === "khoGetGoiYSanXuat") {
      return khoGetGoiYSanXuat_(data);
    }

    if (type === "khoGetBaoCaoBanHang") {
      var qBCBH = khoText_(data.q).toLowerCase();
      var limitBCBH = khoNum_(data.limit || 80);
      if (limitBCBH <= 0) limitBCBH = 80;
      if (limitBCBH > 200) limitBCBH = 200;

      var nguongChamBCBH = khoNum_(data.nguongCham || 5);       // Bán <= ngưỡng này coi là chậm
      var nguongTonBCBH = khoNum_(data.nguongTon || 40);        // Khả dụng >= ngưỡng này mới đưa vào tồn nhiều bán chậm

      function parseDateBCBH_(v) {
        if (!v) return null;
        if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
        var s = String(v || "").trim();
        if (!s) return null;
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
          var p = s.substring(0, 10).split("-");
          return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
        }
        var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        var d = new Date(s);
        if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        return null;
      }

      var todayBCBH = new Date();
      todayBCBH = new Date(todayBCBH.getFullYear(), todayBCBH.getMonth(), todayBCBH.getDate());
      var fromBCBH = parseDateBCBH_(data.from);
      var toBCBH = parseDateBCBH_(data.to);
      if (!toBCBH) toBCBH = todayBCBH;
      if (!fromBCBH) {
        fromBCBH = new Date(toBCBH.getTime());
        fromBCBH.setDate(fromBCBH.getDate() - 30);
      }
      fromBCBH.setHours(0, 0, 0, 0);
      toBCBH.setHours(23, 59, 59, 999);

      function fmtDateBCBH_(d) {
        return Utilities.formatDate(d, "GMT+7", "dd/MM/yyyy");
      }

      function badOrderStatusBCBH_(s) {
        s = khoText_(s).toLowerCase();
        return s.indexOf("xóa") !== -1 || s.indexOf("xoá") !== -1 || s.indexOf("hủy") !== -1 || s.indexOf("huỷ") !== -1;
      }

      function normalizeSearchBCBH_(x) {
        return khoText_(x).toLowerCase();
      }

      function parseFromMaBHBCBH_(maBH) {
        var parts = khoText_(maBH).split("-").filter(function(x) { return x; });
        return {
          maRap: parts[0] || "",
          hieu: parts[1] || "",
          mau: parts.slice(2).join("-") || ""
        };
      }

      var hhMapBCBH = {};
      try {
        var shHHBCBH = getSheet_("KHO", "tbl_Kho_HangHoa");
        var hhBCBH = shHHBCBH.getDataRange().getValues();
        for (var ihh = 1; ihh < hhBCBH.length; ihh++) {
          var maSPHH = khoText_(hhBCBH[ihh][0]);
          if (!maSPHH) continue;
          hhMapBCBH[maSPHH] = {
            maSP: maSPHH,
            maRap: khoText_(hhBCBH[ihh][1]),
            mauSanPham: khoText_(hhBCBH[ihh][2]),
            hieu: khoText_(hhBCBH[ihh][3]),
            tenSP: khoText_(hhBCBH[ihh][4])
          };
        }
      } catch (eHHBCBH) {}

      var btMapByNBBCBH = {};
      var btMapByBHBCBH = {};
      try {
        var shBTBCBH = getSheet_("KHO", "tbl_Kho_BienThe");
        var btBCBH = shBTBCBH.getDataRange().getValues();
        for (var ibt = 1; ibt < btBCBH.length; ibt++) {
          var maNBbt = khoText_(btBCBH[ibt][0]);
          var maBHbt = khoText_(btBCBH[ibt][1]);
          var maSPbt = khoText_(btBCBH[ibt][2]);
          var hhInfo = hhMapBCBH[maSPbt] || {};
          var infoBT = {
            maHangNoiBo: maNBbt,
            maBanHang: maBHbt,
            maSP: maSPbt,
            maRap: khoText_(btBCBH[ibt][3] || hhInfo.maRap),
            mauSanPham: khoText_(btBCBH[ibt][4] || hhInfo.mauSanPham),
            hieu: khoText_(btBCBH[ibt][5] || hhInfo.hieu),
            mau: khoText_(btBCBH[ibt][6]),
            size: khoText_(btBCBH[ibt][7]),
            tenSP: khoText_(hhInfo.tenSP || btBCBH[ibt][8] || btBCBH[ibt][4])
          };
          if (maNBbt) btMapByNBBCBH[maNBbt] = infoBT;
          if (maBHbt && !btMapByBHBCBH[maBHbt]) btMapByBHBCBH[maBHbt] = infoBT;
        }
      } catch (eBTBCBH) {}

      var tenMapBCBH = {};
      try {
        var shCTTenBCBH = getSheet_("SALES", "tbl_ChiTietDonHang");
        var ctTenBCBH = shCTTenBCBH.getDataRange().getValues();
        for (var iten = 1; iten < ctTenBCBH.length; iten++) {
          var tenBH = khoText_(ctTenBCBH[iten][2]); // C TenSP
          var maBHten = khoText_(ctTenBCBH[iten][6]); // G MaBanHang
          var maNBten = khoText_(ctTenBCBH[iten][7]); // H MaHangNoiBo
          if (maBHten && tenBH && !tenMapBCBH[maBHten]) tenMapBCBH[maBHten] = tenBH;
          if (maNBten && tenBH && !tenMapBCBH[maNBten]) tenMapBCBH[maNBten] = tenBH;
        }
      } catch (eTenBCBH) {}

      var groupMapBCBH = {};
      function ensureGroupBCBH_(info) {
        info = info || {};
        var maBH = khoText_(info.maBanHang || info.maHangNoiBo || "KHONG_RO");
        var parsed = parseFromMaBHBCBH_(maBH);
        var btInfo = btMapByBHBCBH[maBH] || btMapByNBBCBH[khoText_(info.maHangNoiBo)] || {};
        var key = maBH;
        if (!groupMapBCBH[key]) {
          groupMapBCBH[key] = {
            maBanHang: maBH,
            maRap: khoText_(info.maRap || btInfo.maRap || parsed.maRap),
            hieu: khoText_(info.hieu || btInfo.hieu || parsed.hieu),
            mau: khoText_(info.mau || btInfo.mau || parsed.mau),
            tenSP: khoText_(info.tenSP || tenMapBCBH[maBH] || btInfo.tenSP || btInfo.mauSanPham || parsed.maRap || maBH),
            soLuongBan: 0,
            doanhThu: 0,
            soDon: 0,
            donMap: {},
            tonThucTe: 0,
            tonGiu: 0,
            khaDung: 0,
            hangLoi: 0,
            choHoanThien: 0,
            sizes: {}
          };
        }
        var g = groupMapBCBH[key];
        if (!g.maRap && (info.maRap || btInfo.maRap || parsed.maRap)) g.maRap = khoText_(info.maRap || btInfo.maRap || parsed.maRap);
        if (!g.hieu && (info.hieu || btInfo.hieu || parsed.hieu)) g.hieu = khoText_(info.hieu || btInfo.hieu || parsed.hieu);
        if (!g.mau && (info.mau || btInfo.mau || parsed.mau)) g.mau = khoText_(info.mau || btInfo.mau || parsed.mau);
        if ((!g.tenSP || g.tenSP === maBH) && (info.tenSP || tenMapBCBH[maBH] || btInfo.tenSP)) g.tenSP = khoText_(info.tenSP || tenMapBCBH[maBH] || btInfo.tenSP);
        return g;
      }

      // Tồn hiện tại: đưa cả mã chưa bán vào group để soi bán chậm / tồn nhiều.
      try {
        var shTonBCBH = getSheet_("KHO", "tbl_Kho_Ton");
        var tonBCBH = shTonBCBH.getDataRange().getValues();
        for (var iton = 1; iton < tonBCBH.length; iton++) {
          var maNBton = khoText_(tonBCBH[iton][0]);
          var maBHton = khoText_(tonBCBH[iton][1]) || (btMapByNBBCBH[maNBton] ? btMapByNBBCBH[maNBton].maBanHang : maNBton);
          if (!maBHton && !maNBton) continue;
          var btTon = btMapByNBBCBH[maNBton] || btMapByBHBCBH[maBHton] || {};
          var gTon = ensureGroupBCBH_({
            maBanHang: maBHton,
            maHangNoiBo: maNBton,
            maRap: khoText_(tonBCBH[iton][4] || btTon.maRap),
            hieu: khoText_(tonBCBH[iton][5] || btTon.hieu),
            mau: khoText_(tonBCBH[iton][6] || btTon.mau),
            tenSP: btTon.tenSP
          });
          gTon.tonThucTe += khoNum_(tonBCBH[iton][8]);
          gTon.tonGiu += khoNum_(tonBCBH[iton][9]);
          gTon.khaDung += khoNum_(tonBCBH[iton][10]);
          gTon.choHoanThien += khoNum_(tonBCBH[iton][11]);
          gTon.hangLoi += khoNum_(tonBCBH[iton][13]);
          var sizeTon = khoText_(tonBCBH[iton][7] || btTon.size || "?");
          if (!gTon.sizes[sizeTon]) gTon.sizes[sizeTon] = { size: sizeTon, ban: 0, khaDung: 0, tonThucTe: 0 };
          gTon.sizes[sizeTon].khaDung += khoNum_(tonBCBH[iton][10]);
          gTon.sizes[sizeTon].tonThucTe += khoNum_(tonBCBH[iton][8]);
        }
      } catch (eTonBCBH) {}

      var orderMapBCBH = {};
      var shDHBCBH = getSheet_("SALES", "tbl_DonHang");
      var dhBCBH = shDHBCBH.getDataRange().getValues();
      for (var idh = 1; idh < dhBCBH.length; idh++) {
        var maHDdh = khoText_(dhBCBH[idh][0]);
        if (!maHDdh) continue;
        var stDon = khoText_(dhBCBH[idh][6]);
        var stBill = khoText_(dhBCBH[idh][13]);
        if (badOrderStatusBCBH_(stDon) || badOrderStatusBCBH_(stBill)) continue;
        var dDH = parseDateBCBH_(dhBCBH[idh][1]);
        if (!dDH) continue;
        dDH.setHours(12, 0, 0, 0);
        if (dDH < fromBCBH || dDH > toBCBH) continue;
        orderMapBCBH[maHDdh] = {
          ngay: dDH,
          tenKhach: khoText_(dhBCBH[idh][2]),
          maKH: khoText_(dhBCBH[idh][8])
        };
      }

      var totalQtyBCBH = 0;
      var totalRevenueBCBH = 0;
      var shSizeBCBH = getSheet_("SALES", "tbl_DonHang_CT_Size");
      var sizeRowsBCBH = shSizeBCBH.getDataRange().getValues();
      for (var isz = 1; isz < sizeRowsBCBH.length; isz++) {
        var maHDsz = khoText_(sizeRowsBCBH[isz][0]);
        var orderInfo = orderMapBCBH[maHDsz];
        if (!orderInfo) continue;
        var trangThaiXuatBCBH = khoText_(sizeRowsBCBH[isz][12]);
        if (trangThaiXuatBCBH !== "Đã xuất" && trangThaiXuatBCBH !== "Đã trừ tồn") continue;
        var slBan = khoNum_(sizeRowsBCBH[isz][9]);
        if (slBan <= 0) continue;
        var maNBsz = khoText_(sizeRowsBCBH[isz][3]);
        var maBHsz = khoText_(sizeRowsBCBH[isz][2]) || (btMapByNBBCBH[maNBsz] ? btMapByNBBCBH[maNBsz].maBanHang : maNBsz);
        var btSz = btMapByNBBCBH[maNBsz] || btMapByBHBCBH[maBHsz] || {};
        var gBan = ensureGroupBCBH_({
          maBanHang: maBHsz,
          maHangNoiBo: maNBsz,
          maRap: khoText_(sizeRowsBCBH[isz][5] || btSz.maRap),
          hieu: btSz.hieu,
          mau: khoText_(sizeRowsBCBH[isz][6] || btSz.mau),
          tenSP: tenMapBCBH[maBHsz] || btSz.tenSP
        });
        var tienBan = khoNum_(sizeRowsBCBH[isz][11]);
        if (!tienBan) tienBan = slBan * khoNum_(sizeRowsBCBH[isz][10]);
        gBan.soLuongBan += slBan;
        gBan.doanhThu += tienBan;
        totalQtyBCBH += slBan;
        totalRevenueBCBH += tienBan;
        if (!gBan.donMap[maHDsz]) {
          gBan.donMap[maHDsz] = true;
          gBan.soDon += 1;
        }
        var sizeBan = khoText_(sizeRowsBCBH[isz][7] || btSz.size || "?");
        if (!gBan.sizes[sizeBan]) gBan.sizes[sizeBan] = { size: sizeBan, ban: 0, khaDung: 0, tonThucTe: 0 };
        gBan.sizes[sizeBan].ban += slBan;
      }

      var allBCBH = Object.keys(groupMapBCBH).map(function(k) {
        var g = groupMapBCBH[k];
        g.sizes = Object.keys(g.sizes).map(function(sz) { return g.sizes[sz]; }).sort(function(a, b) {
          return String(a.size).localeCompare(String(b.size), "vi", { numeric: true });
        });
        g.searchText = normalizeSearchBCBH_([g.maBanHang, g.maRap, g.hieu, g.mau, g.tenSP].join(" "));
        return g;
      }).filter(function(g) {
        return !qBCBH || g.searchText.indexOf(qBCBH) !== -1;
      });

      var fastBCBH = allBCBH.filter(function(g) { return g.soLuongBan > 0; }).sort(function(a, b) {
        if (b.soLuongBan !== a.soLuongBan) return b.soLuongBan - a.soLuongBan;
        return b.doanhThu - a.doanhThu;
      }).slice(0, limitBCBH);

      var slowBCBH = allBCBH.filter(function(g) {
        return (g.khaDung >= nguongTonBCBH) && (g.soLuongBan <= nguongChamBCBH);
      }).sort(function(a, b) {
        if (a.soLuongBan !== b.soLuongBan) return a.soLuongBan - b.soLuongBan;
        return b.khaDung - a.khaDung;
      }).slice(0, limitBCBH);

      return outJson_({
        ok: true,
        from: fmtDateBCBH_(fromBCBH),
        to: fmtDateBCBH_(toBCBH),
        params: { nguongCham: nguongChamBCBH, nguongTon: nguongTonBCBH, q: qBCBH },
        summary: {
          tongSoLuongBan: totalQtyBCBH,
          tongDoanhThu: totalRevenueBCBH,
          soMaCoBan: allBCBH.filter(function(g) { return g.soLuongBan > 0; }).length,
          soMaBanCham: slowBCBH.length,
          soMaKhongBan: slowBCBH.filter(function(g) { return g.soLuongBan <= 0; }).length,
          tongMaTheoLoc: allBCBH.length
        },
        fast: fastBCBH,
        slow: slowBCBH
      });
    }


    if (type === "khoGetAnhMaBanHangList") {
      var qAnh = khoText_(data.q).toLowerCase();
      var limitAnh = khoNum_(data.limit || 80);
      if (limitAnh <= 0) limitAnh = 80;
      if (limitAnh > 200) limitAnh = 200;

      var shBTAnh = getSheet_("KHO", "tbl_Kho_BienThe");
      var btAnh = shBTAnh.getDataRange().getValues();
      var hhMapAnh = {};
      var anhMapAnh = khoGetAnhMaBanHangMap_();

      try {
        var shHHAnh = getSheet_("KHO", "tbl_Kho_HangHoa");
        var hhAnh = shHHAnh.getDataRange().getValues();
        for (var ha = 1; ha < hhAnh.length; ha++) {
          var maSPAnh = khoText_(hhAnh[ha][0]);
          if (!maSPAnh) continue;
          hhMapAnh[maSPAnh] = {
            maSP: maSPAnh,
            maRap: khoText_(hhAnh[ha][1]),
            mauSanPham: khoText_(hhAnh[ha][2]),
            hieu: khoText_(hhAnh[ha][3]),
            tenSanPham: khoText_(hhAnh[ha][4]),
            nhomHang: khoText_(hhAnh[ha][5])
          };
        }
      } catch (eHHAnh) {}

      var groupedAnh = {};
      var orderAnh = [];
      var tongMaRawAnh = 0;

      for (var ba = 1; ba < btAnh.length; ba++) {
        var maHangNoiBoAnh = khoText_(btAnh[ba][0]);
        var maBanHangAnh = khoText_(btAnh[ba][1]);
        var maSPAnh2 = khoText_(btAnh[ba][2]);
        if (!maBanHangAnh) continue;

        var hhInfoAnh = hhMapAnh[maSPAnh2] || {};
        var maRapAnh = khoText_(btAnh[ba][3] || hhInfoAnh.maRap);
        var hieuAnh = khoText_(btAnh[ba][5] || hhInfoAnh.hieu);
        var mauAnh = khoText_(btAnh[ba][6]);
        var tenSPAnh = khoText_(hhInfoAnh.tenSanPham || btAnh[ba][4] || btAnh[ba][8] || maSPAnh2);
        var mauSanPhamAnh = khoText_(hhInfoAnh.mauSanPham || btAnh[ba][4]);
        var sizeAnh = khoText_(btAnh[ba][7]);

        var searchTextAnh = [maBanHangAnh, maHangNoiBoAnh, maSPAnh2, maRapAnh, hieuAnh, mauAnh, tenSPAnh, mauSanPhamAnh, sizeAnh].join(" ").toLowerCase();
        if (qAnh && searchTextAnh.indexOf(qAnh) === -1) continue;

        if (!groupedAnh[maBanHangAnh]) {
          // Nếu không nhập tìm kiếm, chỉ lấy một số mã đầu để tránh Apps Script bị treo vì trả quá nhiều dữ liệu.
          if (!qAnh && orderAnh.length >= limitAnh) continue;
          groupedAnh[maBanHangAnh] = {
            maBanHang: maBanHangAnh,
            maSP: maSPAnh2,
            maRap: maRapAnh,
            hieu: hieuAnh,
            mau: mauAnh,
            tenSP: tenSPAnh,
            mauSanPham: mauSanPhamAnh,
            sizes: [],
            sku: 0,
            linkAnhChinh: "",
            linkAnhPhu: "",
            trangThaiAnh: "Chưa có ảnh",
            ghiChuAnh: ""
          };
          orderAnh.push(maBanHangAnh);
        }

        if (groupedAnh[maBanHangAnh]) {
          groupedAnh[maBanHangAnh].sku++;
          if (maHangNoiBoAnh && sizeAnh && groupedAnh[maBanHangAnh].sizes.indexOf(sizeAnh) === -1) {
            groupedAnh[maBanHangAnh].sizes.push(sizeAnh);
          }
        }
      }

      Object.keys(groupedAnh).forEach(function(maBH) {
        tongMaRawAnh++;
        var img = anhMapAnh[maBH] || {};
        if (img.linkAnhChinh || img.linkAnhPhu) {
          groupedAnh[maBH].linkAnhChinh = img.linkAnhChinh;
          groupedAnh[maBH].linkAnhPhu = img.linkAnhPhu;
          groupedAnh[maBH].trangThaiAnh = img.trangThai || "Đã có ảnh";
          groupedAnh[maBH].ghiChuAnh = img.ghiChu || "";
        }
      });

      var listAnh = Object.keys(groupedAnh).map(function(k) { return groupedAnh[k]; });
      listAnh.sort(function(a, b) {
        // Ưu tiên mã chưa có ảnh lên trước để thao tác nhanh.
        var aa = (a.linkAnhChinh ? "1" : "0") + (a.maRap || "") + (a.hieu || "") + (a.mau || "");
        var bb = (b.linkAnhChinh ? "1" : "0") + (b.maRap || "") + (b.hieu || "") + (b.mau || "");
        return aa.localeCompare(bb);
      });

      if (listAnh.length > limitAnh) listAnh = listAnh.slice(0, limitAnh);

      var summaryAnh = {
        tongMaBanHang: listAnh.length,
        daCoAnh: listAnh.filter(function(x) { return !!x.linkAnhChinh; }).length,
        chuaCoAnh: listAnh.filter(function(x) { return !x.linkAnhChinh; }).length,
        gioiHan: limitAnh,
        q: qAnh,
        note: qAnh ? "Kết quả theo từ khóa" : "Đang hiển thị nhanh một phần danh sách. Nhập mã/tên/màu để tìm chính xác hơn."
      };

      return outJson_({ ok: true, data: listAnh, summary: summaryAnh });
    }

    if (type === "khoGetAnhThieuTheoRap") {
      return khoGetAnhThieuTheoRap_(data);
    }

    if (type === "khoSaveAnhMaBanHang") {
      var maBanHangSave = khoText_(data.maBanHang);
      if (!maBanHangSave) return outJson_({ ok: false, message: "Thiếu mã bán hàng" });

      var imageData = khoText_(data.imageData);
      var linkAnhChinhSave = khoText_(data.linkAnhChinh);
      var linkAnhPhuSave = khoText_(data.linkAnhPhu);

      if (imageData) {
        var uploadedAnh = khoSaveImageDataToDrive_(imageData, "MBH_" + maBanHangSave);
        if (uploadedAnh) {
          linkAnhChinhSave = uploadedAnh.thumbUrl;
          linkAnhPhuSave = uploadedAnh.fileUrl;
        }
      }

      if (!linkAnhChinhSave && !linkAnhPhuSave) {
        return outJson_({ ok: false, message: "Chưa có ảnh để lưu" });
      }

      var shAnhSave = khoEnsureAnhSanPhamSheet_();
      var rowsAnhSave = shAnhSave.getDataRange().getValues();
      var rowSave = -1;
      for (var rs = 1; rs < rowsAnhSave.length; rs++) {
        if (khoText_(rowsAnhSave[rs][1]) === maBanHangSave) { rowSave = rs + 1; break; }
      }

      var nowAnh = nowVN_();
      var rowValuesAnh = [
        rowSave > -1 ? khoText_(shAnhSave.getRange(rowSave, 1).getValue()) || khoMakeId_("ANH-") : khoMakeId_("ANH-"),
        maBanHangSave,
        khoText_(data.maSP),
        khoText_(data.maRap),
        khoText_(data.hieu),
        khoText_(data.mau),
        linkAnhChinhSave,
        linkAnhPhuSave,
        khoText_(data.anhCoMa || "Có"),
        "Đã có ảnh",
        khoText_(data.ghiChu),
        nowAnh
      ];

      if (rowSave > -1) {
        shAnhSave.getRange(rowSave, 1, 1, rowValuesAnh.length).setValues([rowValuesAnh]);
      } else {
        shAnhSave.appendRow(rowValuesAnh);
      }

      SpreadsheetApp.flush();
      return outJson_({
        ok: true,
        message: "Đã lưu ảnh cho " + maBanHangSave,
        maBanHang: maBanHangSave,
        linkAnhChinh: linkAnhChinhSave,
        linkAnhPhu: linkAnhPhuSave
      });
    }


    if (type === "khoGetPhieuXuatList") {
      var qPX = khoText_(data.q).toLowerCase();
      var fromPX = khoDateKeyPX_(data.from);
      var toPX = khoDateKeyPX_(data.to);
      var limitPX = khoNum_(data.limit || 100);
      if (limitPX <= 0) limitPX = 100;
      if (limitPX > 300) limitPX = 300;

      function khoDateKeyPX_(v) {
        if (!v) return 0;
        try {
          if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
            return Number(Utilities.formatDate(v, "GMT+7", "yyyyMMdd"));
          }
          var s = khoText_(v);
          if (!s) return 0;
          var m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
          if (m1) return Number(m1[1] + ("0" + m1[2]).slice(-2) + ("0" + m1[3]).slice(-2));
          var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (m2) return Number(m2[3] + ("0" + m2[2]).slice(-2) + ("0" + m2[1]).slice(-2));
        } catch (eDatePX) {}
        return 0;
      }

      var btMapPX = {};
      var hhMapPX = {};
      try {
        var shBTPX = getSheet_("KHO", "tbl_Kho_BienThe");
        var btRowsPX = shBTPX.getDataRange().getValues();
        for (var bpx = 1; bpx < btRowsPX.length; bpx++) {
          var maNBPX = khoText_(btRowsPX[bpx][0]);
          if (!maNBPX) continue;
          btMapPX[maNBPX] = {
            maHangNoiBo: maNBPX,
            maBanHang: khoText_(btRowsPX[bpx][1]),
            maSP: khoText_(btRowsPX[bpx][2]),
            maRap: khoText_(btRowsPX[bpx][3]),
            mauSanPham: khoText_(btRowsPX[bpx][4]),
            hieu: khoText_(btRowsPX[bpx][5]),
            mau: khoText_(btRowsPX[bpx][6]),
            size: khoText_(btRowsPX[bpx][7]),
            tenHienThi: khoText_(btRowsPX[bpx][8])
          };
        }
      } catch (eBTPX) {}

      try {
        var shHHPX = getSheet_("KHO", "tbl_Kho_HangHoa");
        var hhRowsPX = shHHPX.getDataRange().getValues();
        for (var hpx = 1; hpx < hhRowsPX.length; hpx++) {
          var maSPPX = khoText_(hhRowsPX[hpx][0]);
          if (!maSPPX) continue;
          hhMapPX[maSPPX] = {
            maSP: maSPPX,
            maRap: khoText_(hhRowsPX[hpx][1]),
            mauSanPham: khoText_(hhRowsPX[hpx][2]),
            hieu: khoText_(hhRowsPX[hpx][3]),
            tenSanPham: khoText_(hhRowsPX[hpx][4]),
            nhomHang: khoText_(hhRowsPX[hpx][5])
          };
        }
      } catch (eHHPX) {}

      var shThePX = getSheet_("KHO", "tbl_Kho_TheKho");
      var theRowsPX = shThePX.getDataRange().getValues();
      var groupMapPX = {};
      var orderPX = [];
      var totalRowsPX = 0;
      var totalQtyPX = 0;

      for (var ipx = 1; ipx < theRowsPX.length; ipx++) {
        var rpx = theRowsPX[ipx];
        var loaiPX = khoText_(rpx[2]);
        var soThayDoiPX = khoNum_(rpx[7]);
        if (loaiPX.toUpperCase().indexOf("XUAT") === -1 && soThayDoiPX >= 0) continue;

        var ngayKeyPX = khoDateKeyPX_(rpx[1]);
        if (fromPX && ngayKeyPX && ngayKeyPX < fromPX) continue;
        if (toPX && ngayKeyPX && ngayKeyPX > toPX) continue;

        var maNBPX2 = khoText_(rpx[4]);
        var btPX = btMapPX[maNBPX2] || {};
        var hhPX = hhMapPX[btPX.maSP] || {};
        var maBanHangPX = khoText_(rpx[5] || btPX.maBanHang);
        var maChungTuPX = khoText_(rpx[3]) || "PX-KHONG-RO";
        var tenSPPX = khoText_(hhPX.tenSanPham || btPX.mauSanPham || btPX.tenHienThi || maNBPX2);
        var maRapPX = khoText_(btPX.maRap || hhPX.maRap);
        var hieuPX = khoText_(btPX.hieu || hhPX.hieu);
        var mauPX = khoText_(btPX.mau);
        var sizePX = khoText_(btPX.size);
        var khoPX = khoText_(rpx[6]);
        var qtyPX = Math.abs(soThayDoiPX);

        var searchTextPX = [
          maChungTuPX, loaiPX, maNBPX2, maBanHangPX, khoPX,
          maRapPX, hieuPX, mauPX, sizePX, tenSPPX,
          rpx[1], rpx[9], rpx[10]
        ].join(" ").toLowerCase();
        if (qPX && searchTextPX.indexOf(qPX) === -1) continue;

        if (!groupMapPX[maChungTuPX]) {
          groupMapPX[maChungTuPX] = {
            maPhieuXuat: maChungTuPX,
            thoiGian: khoText_(rpx[1]),
            ngayKey: ngayKeyPX,
            nguoiThaoTac: khoText_(rpx[9]),
            ghiChu: khoText_(rpx[10]),
            tongSL: 0,
            soDong: 0,
            khoList: [],
            loaiList: [],
            items: []
          };
          orderPX.push(maChungTuPX);
        }

        var gPX = groupMapPX[maChungTuPX];
        if (ngayKeyPX && (!gPX.ngayKey || ngayKeyPX > gPX.ngayKey)) {
          gPX.ngayKey = ngayKeyPX;
          gPX.thoiGian = khoText_(rpx[1]);
        }
        if (khoPX && gPX.khoList.indexOf(khoPX) === -1) gPX.khoList.push(khoPX);
        if (loaiPX && gPX.loaiList.indexOf(loaiPX) === -1) gPX.loaiList.push(loaiPX);
        gPX.tongSL += qtyPX;
        gPX.soDong += 1;
        gPX.items.push({
          maGiaoDichKho: khoText_(rpx[0]),
          thoiGian: khoText_(rpx[1]),
          loaiGiaoDich: loaiPX,
          maChungTu: maChungTuPX,
          maHangNoiBo: maNBPX2,
          maBanHang: maBanHangPX,
          maSP: khoText_(btPX.maSP),
          tenSP: tenSPPX,
          maRap: maRapPX,
          hieu: hieuPX,
          mau: mauPX,
          size: sizePX,
          kho: khoPX,
          soLuong: qtyPX,
          soLuongThayDoi: soThayDoiPX,
          tonSau: khoNum_(rpx[8]),
          nguoiThaoTac: khoText_(rpx[9]),
          ghiChu: khoText_(rpx[10])
        });
        totalRowsPX += 1;
        totalQtyPX += qtyPX;
      }

      var listPX = orderPX.map(function(k) { return groupMapPX[k]; });
      listPX.sort(function(a, b) {
        if ((b.ngayKey || 0) !== (a.ngayKey || 0)) return (b.ngayKey || 0) - (a.ngayKey || 0);
        return String(b.thoiGian || "").localeCompare(String(a.thoiGian || ""));
      });
      listPX = listPX.slice(0, limitPX);

      return outJson_({
        ok: true,
        data: listPX,
        summary: {
          soPhieu: listPX.length,
          tongSoLuong: totalQtyPX,
          tongDong: totalRowsPX
        }
      });
    }

    if (type === "khoGetTonList") {
      var shTon = getSheet_("KHO", "tbl_Kho_Ton");
      var rowsTon = azReadCols_(shTon, 15);
      rowsTon.shift();

      var q = khoText_(data.q).toLowerCase();
      var khoFilter = khoText_(data.kho).toLowerCase();

      // Bổ sung tên sản phẩm / mẫu từ danh mục để màn tồn kho gom cấp dễ nhìn hơn.
      var btMap = {};
      var hhMap = {};
      var anhMap = {};

      try {
        var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
        var btRows = azReadCols_(shBT, 9);
        for (var b = 1; b < btRows.length; b++) {
          var maNB = khoText_(btRows[b][0]);
          if (!maNB) continue;
          btMap[maNB] = {
            maHangNoiBo: maNB,
            maBanHang: khoText_(btRows[b][1]),
            maSP: khoText_(btRows[b][2]),
            maRap: khoText_(btRows[b][3]),
            mauSanPham: khoText_(btRows[b][4]),
            hieu: khoText_(btRows[b][5]),
            mau: khoText_(btRows[b][6]),
            size: khoText_(btRows[b][7]),
            tenHienThi: khoText_(btRows[b][8])
          };
        }
      } catch (eBT) {}

      try {
        var shHH = getSheet_("KHO", "tbl_Kho_HangHoa");
        var hhRows = azReadCols_(shHH, 8);
        for (var h = 1; h < hhRows.length; h++) {
          var maSP = khoText_(hhRows[h][0]);
          if (!maSP) continue;
          hhMap[maSP] = {
            maSP: maSP,
            maRap: khoText_(hhRows[h][1]),
            mauSanPham: khoText_(hhRows[h][2]),
            hieu: khoText_(hhRows[h][3]),
            tenSanPham: khoText_(hhRows[h][4]),
            nhomHang: khoText_(hhRows[h][5]),
            gioiTinh: khoText_(hhRows[h][6]),
            chatLieu: khoText_(hhRows[h][7])
          };
        }
      } catch (eHH) {}

      // Ảnh sản phẩm gắn theo MaBanHang. Nếu chưa có ảnh thì frontend sẽ hiện ô ảnh tạm.
      try {
        var shAnh = getSheet_("KHO", "tbl_Kho_AnhSanPham");
        var anhRows = azReadCols_(shAnh, 8);
        for (var a = 1; a < anhRows.length; a++) {
          var aMaBanHang = khoText_(anhRows[a][1]);
          var aMaSP = khoText_(anhRows[a][2]);
          var aMau = khoText_(anhRows[a][5]);
          var aLink = khoText_(anhRows[a][6] || anhRows[a][7]);
          if (!aLink) continue;
          if (aMaBanHang && !anhMap[aMaBanHang]) anhMap[aMaBanHang] = aLink;
          if (aMaSP && aMau && !anhMap[aMaSP + "__" + aMau]) anhMap[aMaSP + "__" + aMau] = aLink;
        }
      } catch (eAnh) {}

      var list = rowsTon.filter(function(r) {
        if (!khoText_(r[0])) return false;
        var bt0 = btMap[khoText_(r[0])] || {};
        var hh0 = hhMap[bt0.maSP] || {};
        var text = [
          r[0], r[1], r[2], r[4], r[5], r[6], r[7],
          bt0.maSP, bt0.maBanHang, bt0.tenHienThi, bt0.mauSanPham,
          hh0.tenSanPham, hh0.mauSanPham, hh0.nhomHang
        ].join(" ").toLowerCase();
        if (q && text.indexOf(q) === -1) return false;
        if (khoFilter && khoText_(r[2]).toLowerCase() !== khoFilter) return false;
        return true;
      }).map(function(r) {
        var maNB2 = khoText_(r[0]);
        var bt = btMap[maNB2] || {};
        var hh = hhMap[bt.maSP] || {};
        var maSP2 = khoText_(bt.maSP);
        var maRap2 = khoText_(bt.maRap || r[4]);
        var hieu2 = khoText_(bt.hieu || r[5]);
        var mau2 = khoText_(bt.mau || r[6]);
        var size2 = khoText_(bt.size || r[7]);
        var maBanHang2 = khoText_(r[1] || bt.maBanHang);
        var tenSP2 = khoText_(hh.tenSanPham || bt.mauSanPham || bt.tenHienThi || maRap2);
        var linkAnh2 = khoText_(anhMap[maBanHang2] || anhMap[maSP2 + "__" + mau2] || "");

        return {
          maHangNoiBo: maNB2,
          maBanHang: maBanHang2,
          maSP: maSP2,
          tenSP: tenSP2,
          mauSanPham: khoText_(hh.mauSanPham || bt.mauSanPham),
          tenHienThi: khoText_(bt.tenHienThi),
          nhomHang: khoText_(hh.nhomHang),
          linkAnhChinh: linkAnh2,
          kho: r[2],
          viTri: r[3],
          maRap: maRap2,
          hieu: hieu2,
          mau: mau2,
          size: size2,
          tonThucTe: khoNum_(r[8]),
          tonGiu: khoNum_(r[9]),
          khaDung: khoNum_(r[10]),
          choHoanThien: khoNum_(r[11]),
          daCotRi: khoNum_(r[12]),
          hangLoi: khoNum_(r[13]),
          capNhatCuoi: r[14]
        };
      });

      list.sort(function(a, b) {
        return String((a.maRap || '') + (a.tenSP || '') + (a.hieu || '') + (a.mau || '') + (a.size || ''))
          .localeCompare(String((b.maRap || '') + (b.tenSP || '') + (b.hieu || '') + (b.mau || '') + (b.size || '')));
      });

      return outJson_({
        ok: true,
        data: list
      });
    }


    if (type === "khoGetHangDangGiu") {
      var shTonGiu = getSheet_("KHO", "tbl_Kho_Ton");
      var shSizeGiu = getSheet_("SALES", "tbl_DonHang_CT_Size");
      var shDonGiu = getSheet_("SALES", "tbl_DonHang");

      var qGiu = khoText_(data.q).toLowerCase();
      var tonRowsGiu = shTonGiu.getDataRange().getValues();
      var sizeRowsGiu = shSizeGiu.getDataRange().getValues();
      var donRowsGiu = shDonGiu.getDataRange().getValues();

      var tonMapGiu = {};
      for (var tg = 1; tg < tonRowsGiu.length; tg++) {
        var tgMaNB = khoText_(tonRowsGiu[tg][0]);
        if (!tgMaNB) continue;
        if (!tonMapGiu[tgMaNB]) {
          tonMapGiu[tgMaNB] = {
            tonThucTe: 0,
            tonGiu: 0,
            khaDung: 0,
            khoList: []
          };
        }
        var tgKho = khoText_(tonRowsGiu[tg][2]);
        var tgTon = khoNum_(tonRowsGiu[tg][8]);
        var tgGiu = khoNum_(tonRowsGiu[tg][9]);
        var tgKhaDung = khoNum_(tonRowsGiu[tg][10]);
        tonMapGiu[tgMaNB].tonThucTe += tgTon;
        tonMapGiu[tgMaNB].tonGiu += tgGiu;
        tonMapGiu[tgMaNB].khaDung += tgKhaDung;
        if (tgGiu > 0) tonMapGiu[tgMaNB].khoList.push(tgKho + ": giữ " + tgGiu);
      }

      var orderMapGiu = {};
      for (var dg = 1; dg < donRowsGiu.length; dg++) {
        var dgMaHD = khoText_(donRowsGiu[dg][0]);
        if (!dgMaHD) continue;
        orderMapGiu[dgMaHD] = {
          maHoaDon: dgMaHD,
          ngayTao: donRowsGiu[dg][1],
          tenKhach: khoText_(donRowsGiu[dg][2]),
          loaiDon: khoText_(donRowsGiu[dg][3]),
          trangThai: khoText_(donRowsGiu[dg][6]),
          maKH: khoText_(donRowsGiu[dg][8]),
          nguoiSoan: khoText_(donRowsGiu[dg][9]),
          tongTien: khoNum_(donRowsGiu[dg][11]),
          trangThaiHoaDon: khoText_(donRowsGiu[dg][13]),
          gioSoanXong: khoText_(donRowsGiu[dg][15]),
          capNhatCuoi: khoText_(donRowsGiu[dg][21])
        };
      }

      var listGiu = [];
      var orderSeenGiu = {};
      var skuSeenGiu = {};
      var totalQtyGiu = 0;

      for (var sg2 = 1; sg2 < sizeRowsGiu.length; sg2++) {
        var maHDGiu = khoText_(sizeRowsGiu[sg2][0]);       // A MaHoaDon
        var maKHGiu = khoText_(sizeRowsGiu[sg2][1]);       // B MaKH
        var maBHGiu = khoText_(sizeRowsGiu[sg2][2]);       // C MaBanHang
        var maNBGiu = khoText_(sizeRowsGiu[sg2][3]);       // D MaHangNoiBo
        var maSPGiu = khoText_(sizeRowsGiu[sg2][4]);       // E MaSP
        var maRapGiu = khoText_(sizeRowsGiu[sg2][5]);      // F MaRap
        var mauGiu = khoText_(sizeRowsGiu[sg2][6]);        // G Mau
        var sizeGiu = khoText_(sizeRowsGiu[sg2][7]);       // H Size
        var soLuongGiu = khoNum_(sizeRowsGiu[sg2][9]);     // J SoLuong
        var donGiaGiu = khoNum_(sizeRowsGiu[sg2][10]);     // K DonGia
        var thanhTienGiu = khoNum_(sizeRowsGiu[sg2][11]);  // L ThanhTien
        var trangThaiXuatGiu = khoText_(sizeRowsGiu[sg2][12]); // M TrangThaiXuat
        var maGiuHangGiu = khoText_(sizeRowsGiu[sg2][13]); // N MaGiuHang
        var ghiChuGiu = khoText_(sizeRowsGiu[sg2][14]);    // O GhiChu

        if (!maHDGiu || !maNBGiu || soLuongGiu <= 0) continue;
        if (!maGiuHangGiu) continue;
        if (trangThaiXuatGiu === "Đã xuất" || trangThaiXuatGiu === "Đã trừ tồn" || trangThaiXuatGiu === "Đã hoàn tồn" || trangThaiXuatGiu === "Đã trả giữ") continue;

        var donInfoGiu = orderMapGiu[maHDGiu] || {};
        var trangThaiDonLower = khoText_(donInfoGiu.trangThai).toLowerCase();
        var trangThaiHoaDonLower = khoText_(donInfoGiu.trangThaiHoaDon).toLowerCase();
        if (trangThaiDonLower.indexOf("hủy") !== -1 || trangThaiHoaDonLower.indexOf("hủy") !== -1) continue;

        var tonInfoGiu = tonMapGiu[maNBGiu] || { tonThucTe: 0, tonGiu: 0, khaDung: 0, khoList: [] };
        var searchTextGiu = [maHDGiu, maKHGiu, donInfoGiu.tenKhach, maBHGiu, maNBGiu, maSPGiu, maRapGiu, mauGiu, sizeGiu, donInfoGiu.nguoiSoan].join(" ").toLowerCase();
        if (qGiu && searchTextGiu.indexOf(qGiu) === -1) continue;

        listGiu.push({
          maHoaDon: maHDGiu,
          maKH: maKHGiu || donInfoGiu.maKH || "",
          tenKhach: donInfoGiu.tenKhach || "",
          ngayTao: donInfoGiu.ngayTao || "",
          gioSoanXong: donInfoGiu.gioSoanXong || "",
          nguoiSoan: donInfoGiu.nguoiSoan || "",
          trangThaiDon: donInfoGiu.trangThai || "",
          trangThaiHoaDon: donInfoGiu.trangThaiHoaDon || "",
          maBanHang: maBHGiu,
          maHangNoiBo: maNBGiu,
          maSP: maSPGiu,
          maRap: maRapGiu,
          mau: mauGiu,
          size: sizeGiu,
          soLuongGiu: soLuongGiu,
          donGia: donGiaGiu,
          thanhTien: thanhTienGiu,
          trangThaiXuat: trangThaiXuatGiu,
          maGiuHang: maGiuHangGiu,
          ghiChu: ghiChuGiu,
          tonThucTe: tonInfoGiu.tonThucTe,
          tonGiu: tonInfoGiu.tonGiu,
          khaDung: tonInfoGiu.khaDung,
          khoGiuText: tonInfoGiu.khoList.join(" | ")
        });

        totalQtyGiu += soLuongGiu;
        orderSeenGiu[maHDGiu] = true;
        skuSeenGiu[maNBGiu] = true;
      }

      listGiu.sort(function(a, b) {
        return String(b.gioSoanXong || b.ngayTao || "").localeCompare(String(a.gioSoanXong || a.ngayTao || "")) ||
          String(a.maBanHang + a.size).localeCompare(String(b.maBanHang + b.size));
      });

      return outJson_({
        ok: true,
        data: listGiu,
        summary: {
          soDongGiu: listGiu.length,
          soDonDangGiu: Object.keys(orderSeenGiu).length,
          soMaHangDangGiu: Object.keys(skuSeenGiu).length,
          tongSoLuongGiu: totalQtyGiu
        }
      });
    }

    // if (type === "khoSaveNhapKho") {
    //   return outJson_({
    //     ok: false,
    //     message: "Đã tắt nhập kho thủ công. Hàng thành phẩm chỉ được nhập vào tồn kho từ QL Rập → Xem đơn → Nhập kho."
    //   });
    // }

    return null;

  } catch (err) {
    return outText_("Lỗi KHO: " + err.message);
  }
}


/****************************************************
 * PHIẾU NHẬP RẬP HÀNG NHÀ - PHẦN 1
 * - Lấy danh mục từ kho/rập
 * - Upload ảnh chụp bảng preview
 * - Lưu phiếu vào tbl_Rap_PhieuNhap, tbl_Rap_DonHang, tbl_Rap_SizeKeHoach
 ****************************************************/
function rapHNText_(v) {
  return String(v === null || v === undefined ? "" : v).trim();
}

function rapHNNum_(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  var s = String(v).replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  var n = Number(s);
  return isNaN(n) ? 0 : n;
}

function rapHNSlug_(v) {
  return rapHNText_(v).toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function rapHNMakeId_(prefix) {
  return prefix + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + "-" + Math.floor(Math.random() * 1000);
}

function rapHNBuildMaBanHang_(maSP, mau) {
  var ma = [rapHNSlug_(maSP), rapHNSlug_(mau)].filter(function(x) { return x; }).join("-");
  return ma || rapHNMakeId_("MBH-");
}

function rapHNBuildMaHangNoiBo_(maSP, mau, size) {
  var ma = [rapHNSlug_(maSP), rapHNSlug_(mau), rapHNSlug_(size)].filter(function(x) { return x; }).join("-");
  return ma || rapHNMakeId_("MH-");
}

function rapHNEnsureHeader_(fileKey, sheetName, headers) {
  var ss = getSS_(fileKey);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  return sh;
}

var RAP_HN_PHIEU_HEADERS = [
  "MaPhieuNhapRap", "NgayTao", "NguoiTao", "NgayCat", "NhaMay", "ThoCat", "MaRap",
  "SizeChung", "TiLeChung", "TongSoMau", "TongSoMauMau", "TongSLKeHoach",
  "LinkAnhPhieuNhap", "TrangThaiPhieu", "GhiChu", "CapNhatCuoi"
];

var RAP_HN_SIZE_HEADERS = [
  "MaMam", "MaRap", "Mau", "Size", "SoLop", "TyLe", "SLKeHoach", "GhiChu",
  "MaPhieuNhapRap", "MaSP", "MaBanHang", "MaHangNoiBo", "Hieu", "TenSP", "KhoNhapDuKien"
];

function rapHNEnsurePhieuSheet_() {
  return rapHNEnsureHeader_("RAP", "tbl_Rap_PhieuNhap", RAP_HN_PHIEU_HEADERS);
}

function rapHNEnsureSizeKeHoachSheet_() {
  return rapHNEnsureHeader_("RAP", "tbl_Rap_SizeKeHoach", RAP_HN_SIZE_HEADERS);
}

function rapHNFindMaBanHang_(maSP, mau) {
  maSP = rapHNText_(maSP);
  mau = rapHNText_(mau).toUpperCase();
  if (!maSP || !mau) return "";

  try {
    var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
    var bt = shBT.getDataRange().getValues();
    for (var i = 1; i < bt.length; i++) {
      if (rapHNText_(bt[i][2]) === maSP && rapHNText_(bt[i][6]).toUpperCase() === mau) {
        return rapHNText_(bt[i][1]);
      }
    }
  } catch (err) {}

  try {
    var shAnh = getSheet_("KHO", "tbl_Kho_AnhSanPham");
    var anh = shAnh.getDataRange().getValues();
    for (var j = 1; j < anh.length; j++) {
      if (rapHNText_(anh[j][2]) === maSP && rapHNText_(anh[j][5]).toUpperCase() === mau) {
        return rapHNText_(anh[j][1]);
      }
    }
  } catch (err2) {}

  return "";
}


function rapHNUploadPreviewImage(base64, maRap) {
  try {
    if (!base64 || String(base64).indexOf(",") === -1) {
      return { ok: false, message: "Không có dữ liệu ảnh preview" };
    }
    var folder = getFolder_("PHIEU_NHAP_XUONG");
    var parts = String(base64).split(",");
    var meta = parts[0];
    var content = parts[1];
    var mime = meta.indexOf("image/jpeg") > -1 ? "image/jpeg" : "image/png";
    var ext = mime === "image/jpeg" ? ".jpg" : ".png";
    var fileName = "PHIEU_NHAP_RAP_" + rapHNSlug_(maRap || "RAP") + "_" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd_HHmmss") + ext;
    var blob = Utilities.newBlob(Utilities.base64Decode(content), mime, fileName);
    var file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (shareErr) {}
    return { ok: true, url: file.getUrl(), id: file.getId(), name: fileName };
  } catch (err) {
    return { ok: false, message: "Lỗi upload ảnh phiếu nhập rập: " + err.message };
  }
}

function rapHNSavePhieuNhap(payload) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    hasLock = lock.tryLock(1200);
    if (!hasLock) {
      return { ok: false, message: "Hệ thống đang lưu phiếu khác. Vui lòng bấm lưu lại sau vài giây." };
    }

    payload = payload || {};
    var items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) throw new Error("Chưa có dòng mẫu/màu để lưu");

    var now = nowVN_();
    var nguoiTao = rapHNText_(payload.nguoiTao || payload.user || payload.actorUser || "app");
    var ngayCat = rapHNText_(payload.ngayCat);
    var nhaMay = rapHNText_(payload.nhaMay);
    var thoCat = rapHNText_(payload.thoCat);
    var maRap = rapHNText_(payload.maRap).toUpperCase();
    var donGiaNhaMay = rapHNNum_(payload.donGiaNhaMay || payload.donGiaMay || payload.donGiaNhaMayMacDinh || 0);

    // TASK 06O: nếu không nhập đơn giá, tự lấy giá cũ gần nhất theo đúng Nhà may + Mã rập.
    if (!donGiaNhaMay && maRap && nhaMay) {
      donGiaNhaMay = rapHNGetLastDonGiaNhaMay_(maRap, nhaMay);
    }

    // Giữ tương thích dữ liệu cũ nếu trước đây từng lưu DonGiaNhaMay ở sheet MaRap.
    if (!donGiaNhaMay && maRap) {
      try {
        var infoDG = rapDMGetMaRapInfo_(getSS_("RAP"));
        for (var dg = 0; dg < infoDG.length; dg++) {
          if (rapHNText_(infoDG[dg].maRap).toUpperCase() === maRap) {
            donGiaNhaMay = rapHNNum_(infoDG[dg].donGiaNhaMay);
            break;
          }
        }
      } catch (eDG) {}
    }
    var khoNhap = rapHNText_(payload.khoNhapDuKien || payload.khoNhap || "KHO CHÍNH");
    var linkAnh = rapHNText_(payload.linkAnhPhieuNhap);
    var ghiChu = rapHNText_(payload.ghiChu);
    var colorMode = rapHNText_(payload.colorMode || (items[0] && items[0].colorMode));

    if (!ngayCat) throw new Error("Thiếu ngày cắt");
    if (!nhaMay) throw new Error("Thiếu nhà may");
    if (!thoCat) throw new Error("Thiếu thợ cắt");
    if (!maRap) throw new Error("Thiếu mã rập");
    if (!linkAnh) throw new Error("Chưa có ảnh chụp bảng preview");

    var maPhieu = rapHNText_(payload.maPhieuNhapRap) || rapHNMakeId_("PNR-");
    var maMamChung = rapHNMakeId_("MAM-");

    function normSize_(s) {
      s = rapHNText_(s).toUpperCase();
      return s.replace(/^2XL$/, "2X").replace(/^3XL$/, "3X").replace(/^4XL$/, "4X")
              .replace(/^5XL$/, "5X").replace(/^6XL$/, "6X").replace(/^7XL$/, "7X").replace(/^8XL$/, "8X");
    }
    function addUnique_(arr, value) {
      value = rapHNText_(value);
      if (value && arr.indexOf(value) === -1) arr.push(value);
    }

    var sizeOrder = ["S", "M", "L", "XL", "2X", "3X", "4X", "5X", "6X", "7X", "8X"];
    var uniqueMaSP = [], uniqueTenSP = [], uniqueMauSanPham = [], uniqueHieu = [], uniqueMau = [], uniqueSizeRange = [], uniqueTiLe = [];
    var modelRatioMap = {};
    var detailCompact = [];
    var sizeRows = [];
    var tongSLPhieu = 0;
    var tongLopTheoDong = 0;
    var commonColorMap = {};

    items.forEach(function(item, idx) {
      var tenSP = rapHNText_(item.tenSP || item.tenSanPham || item.mauSanPham);
      var mauSanPham = rapHNText_(item.mauSanPham || item.tenSP || item.tenSanPham || maRap);
      var hieu = rapHNText_(item.hieu);
      var mau = rapHNText_(item.mau).toUpperCase();
      var maSP = rapHNText_(item.maSP) || [maRap, rapHNSlug_(hieu)].filter(function(x) { return x; }).join("-");
      var maBanHang = rapHNText_(item.maBanHang) || rapHNBuildMaBanHang_(maSP, mau);
      var sizeRange = rapHNText_(item.sizeRange || item.size);
      var tiLeSize = rapHNText_(item.tiLeSize);
      var soLop = rapHNNum_(item.soLop);
      var qtyBySize = item.qtyBySize || item.soLuongSize || {};
      var ratioBySize = item.ratioBySize || {};
      var sizes = Array.isArray(item.sizes) ? item.sizes.map(normSize_) : Object.keys(qtyBySize).map(normSize_);
      var tong = rapHNNum_(item.tong);

      if (!sizes.length) sizes = Object.keys(qtyBySize).map(normSize_);
      if (!tong) {
        Object.keys(qtyBySize).forEach(function(sz) { tong += rapHNNum_(qtyBySize[sz]); });
      }
      if (!tenSP || !mau || !sizeRange || !tiLeSize || !soLop || !tong || !sizes.length) {
        throw new Error("Dòng " + (idx + 1) + " thiếu thông tin mẫu/màu/size. Hãy xem preview lại trước khi lưu.");
      }

      tongSLPhieu += tong;
      tongLopTheoDong += soLop;
      if (colorMode === "common" && commonColorMap[mau] === undefined) commonColorMap[mau] = soLop;

      addUnique_(uniqueMaSP, maSP);
      addUnique_(uniqueTenSP, tenSP);
      addUnique_(uniqueMauSanPham, mauSanPham);
      addUnique_(uniqueHieu, hieu);
      addUnique_(uniqueMau, mau);
      addUnique_(uniqueSizeRange, sizeRange);
      addUnique_(uniqueTiLe, tiLeSize);

      if (!modelRatioMap[maSP]) {
        var cleanRatio = {};
        sizes.forEach(function(s) {
          var key = normSize_(s);
          cleanRatio[key] = rapHNNum_(ratioBySize[s] !== undefined ? ratioBySize[s] : ratioBySize[key]);
        });
        modelRatioMap[maSP] = { sizes: sizes, ratioBySize: cleanRatio, sizeRange: sizeRange, tiLeSize: tiLeSize };
      }

      detailCompact.push({ maSP: maSP, hieu: hieu, tenSP: tenSP, mau: mau, sizeRange: sizeRange, tiLeSize: tiLeSize, soLop: soLop, tong: tong });

      sizes.forEach(function(size) {
        var key = normSize_(size);
        var sl = rapHNNum_(qtyBySize[size] !== undefined ? qtyBySize[size] : qtyBySize[key]);
        if (sl <= 0) return;
        var tyLe = ratioBySize[size] !== undefined ? rapHNNum_(ratioBySize[size]) :
          (ratioBySize[key] !== undefined ? rapHNNum_(ratioBySize[key]) : (soLop ? sl / soLop : ""));
        var maHangNoiBo = rapHNText_(item.maHangNoiBoMap && (item.maHangNoiBoMap[size] || item.maHangNoiBoMap[key])) || rapHNBuildMaHangNoiBo_(maSP, mau, key);
        sizeRows.push([
          maMamChung, maRap, mau, key, soLop, tyLe, sl, "Kế hoạch hàng nhà",
          maPhieu, maSP, maBanHang, maHangNoiBo, hieu, tenSP, khoNhap
        ]);
      });
    });

    if (!sizeRows.length) throw new Error("Không có chi tiết size hợp lệ để lưu");

    var sizeChung = rapHNText_(payload.sizeChung);
    var tiLeChung = rapHNText_(payload.tiLeChung);

    if (colorMode === "common") {
      var minIdx = 999, maxIdx = -1, ratioSum = {};
      Object.keys(modelRatioMap).forEach(function(maSPKey) {
        var mr = modelRatioMap[maSPKey];
        mr.sizes.forEach(function(s) {
          var key = normSize_(s);
          var idx = sizeOrder.indexOf(key);
          if (idx >= 0) {
            minIdx = Math.min(minIdx, idx);
            maxIdx = Math.max(maxIdx, idx);
          }
          ratioSum[key] = rapHNNum_(ratioSum[key]) + rapHNNum_(mr.ratioBySize[key]);
        });
      });
      if (minIdx <= maxIdx) {
        var chungSizes = sizeOrder.slice(minIdx, maxIdx + 1);
        sizeChung = chungSizes[0] + "-" + chungSizes[chungSizes.length - 1];
        tiLeChung = chungSizes.map(function(s) { return rapHNNum_(ratioSum[s]); }).join("");
      }
    }

    var tongSoMau = rapHNNum_(payload.tongSoMau) || uniqueMaSP.length;
    var tongSoMauMau = rapHNNum_(payload.tongSoMauMau) || items.length;
    var tongLopHienThi = 0;

    if (colorMode === "common") {
      if (payload.sourceSummary && Array.isArray(payload.sourceSummary.common)) {
        payload.sourceSummary.common.forEach(function(c) { tongLopHienThi += rapHNNum_(c.soLop); });
      }
      if (!tongLopHienThi) {
        Object.keys(commonColorMap).forEach(function(mauKey) { tongLopHienThi += rapHNNum_(commonColorMap[mauKey]); });
      }
    } else {
      tongLopHienThi = tongLopTheoDong;
    }
    if (!tongLopHienThi) tongLopHienThi = tongLopTheoDong;

    var hieuText = uniqueHieu.join("/");
    var mauText = uniqueMau.join("/");
    var tenSPChung = "";
    if (uniqueMauSanPham.length === 1 && hieuText) {
      tenSPChung = uniqueMauSanPham[0] + " " + hieuText;
    } else if (uniqueTenSP.length <= 2) {
      tenSPChung = uniqueTenSP.join(" + ");
    } else {
      tenSPChung = uniqueTenSP.slice(0, 2).join(" + ") + " + " + (uniqueTenSP.length - 2) + " mẫu";
    }

    var chiTietJson = JSON.stringify({
      kieuNhap: colorMode,
      maPhieuNhapRap: maPhieu,
      sizeChung: sizeChung,
      tiLeChung: tiLeChung,
      tongLop: tongLopHienThi,
      tongSL: tongSLPhieu,
      soDongMauSize: detailCompact.length,
      chiTiet: detailCompact
    });

    var rowSummary = [];
    rowSummary[RAP_DON_COL.MA_MAM] = maMamChung;
    rowSummary[RAP_DON_COL.NGAY_TAO] = now;
    rowSummary[RAP_DON_COL.NGUOI_TAO] = nguoiTao;
    rowSummary[RAP_DON_COL.NGAY_CAT] = ngayCat;
    rowSummary[RAP_DON_COL.NHA_MAY] = nhaMay;
    rowSummary[RAP_DON_COL.MA_RAP] = maRap;
    rowSummary[RAP_DON_COL.TEN_SP] = tenSPChung || maRap;
    rowSummary[RAP_DON_COL.SIZE] = sizeChung || uniqueSizeRange.join(" | ");
    rowSummary[RAP_DON_COL.TI_LE_SIZE] = tiLeChung || uniqueTiLe.join(" | ");
    rowSummary[RAP_DON_COL.SO_LOP] = tongLopHienThi;
    rowSummary[RAP_DON_COL.TONG_KE_HOACH] = tongSLPhieu;
    rowSummary[RAP_DON_COL.TONG_DA_GIAO] = 0;
    rowSummary[RAP_DON_COL.TONG_CON_THIEU] = tongSLPhieu;
    rowSummary[RAP_DON_COL.NGAY_GIAO_DU_KIEN] = "";
    rowSummary[RAP_DON_COL.LOAI_MAM] = "Hàng nhà";
    rowSummary[RAP_DON_COL.TEN_KHACH] = "";
    rowSummary[RAP_DON_COL.MA_KH] = "";
    rowSummary[RAP_DON_COL.MA_HOA_DON_DONG_BO] = "";
    rowSummary[RAP_DON_COL.THO_CAT] = thoCat;
    rowSummary[RAP_DON_COL.DON_GIA_NHA_MAY] = donGiaNhaMay;
    rowSummary[RAP_DON_COL.THANH_TIEN_NHA_MAY] = donGiaNhaMay * tongSLPhieu;
    rowSummary[RAP_DON_COL.TRANG_THAI_SAN_XUAT] = "Đang cắt";
    rowSummary[RAP_DON_COL.TRANG_THAI_NHAN_HANG] = "Chưa nhận";
    rowSummary[RAP_DON_COL.TRANG_THAI_THANH_TOAN] = "Chưa thanh toán";
    rowSummary[RAP_DON_COL.MA_CHOT_NHA_MAY] = "";
    rowSummary[RAP_DON_COL.MA_CHOT_THO_CAT] = "";
    rowSummary[RAP_DON_COL.LINK_ANH] = linkAnh;
    rowSummary[RAP_DON_COL.SO_LOP_CU] = "";
    rowSummary[RAP_DON_COL.NGUOI_SUA_LOP] = "";
    rowSummary[RAP_DON_COL.TG_SUA_LOP] = "";
    rowSummary[RAP_DON_COL.GHI_CHU] = ghiChu;
    rowSummary[RAP_DON_COL.CAP_NHAT_CUOI] = now;
    rowSummary[RAP_DON_COL.MA_PHIEU_NHAP_RAP] = maPhieu;
    rowSummary[RAP_DON_COL.MA_SP] = uniqueMaSP.join(" | ");
    rowSummary[RAP_DON_COL.MA_BAN_HANG] = "THEO_PHIEU";
    rowSummary[RAP_DON_COL.HIEU] = hieuText;
    rowSummary[RAP_DON_COL.MAU] = mauText;
    rowSummary[RAP_DON_COL.SIZE_CHUNG] = sizeChung;
    rowSummary[RAP_DON_COL.TI_LE_CHUNG] = tiLeChung;
    rowSummary[RAP_DON_COL.SO_LUONG_SIZE_JSON] = chiTietJson;
    rowSummary[RAP_DON_COL.LINK_ANH_PHIEU_NHAP] = linkAnh;
    rowSummary[RAP_DON_COL.KHO_NHAP_DU_KIEN] = khoNhap;
    rowSummary[RAP_DON_COL.TRANG_THAI_NHAP_KHO] = "Chưa nhập kho";

    for (var c = 0; c < RAP_DON_HEADERS.length; c++) {
      if (rowSummary[c] === undefined) rowSummary[c] = "";
    }

    var shPN, shDH, shSize;
    try { shPN = getSheet_("RAP", "tbl_Rap_PhieuNhap"); } catch(e1) { shPN = rapHNEnsurePhieuSheet_(); }
    try { shDH = getSheet_("RAP", "tbl_Rap_DonHang"); } catch(e2) { shDH = rapEnsureRapDonHangSheet_(); }
    try { shSize = getSheet_("RAP", "tbl_Rap_SizeKeHoach"); } catch(e3) { shSize = rapHNEnsureSizeKeHoachSheet_(); }

    shPN.getRange(shPN.getLastRow() + 1, 1, 1, RAP_HN_PHIEU_HEADERS.length).setValues([[
      maPhieu, now, nguoiTao, ngayCat, nhaMay, thoCat, maRap,
      sizeChung, tiLeChung, tongSoMau, tongSoMauMau, tongSLPhieu,
      linkAnh, "Mới tạo", ghiChu, now
    ]]);
    shDH.getRange(shDH.getLastRow() + 1, 1, 1, RAP_DON_HEADERS.length).setValues([rowSummary]);
    shSize.getRange(shSize.getLastRow() + 1, 1, sizeRows.length, RAP_HN_SIZE_HEADERS.length).setValues(sizeRows);

    return { ok: true, maPhieuNhapRap: maPhieu, tongSLKeHoach: tongSLPhieu, soDongMau: 1, soDongSize: sizeRows.length, message: "Đã lưu phiếu nhập rập hàng nhà" };
  } catch (err) {
    return { ok: false, message: "Lỗi lưu phiếu nhập rập hàng nhà: " + err.message };
  } finally {
    try { if (hasLock) lock.releaseLock(); } catch (e) {}
  }
}

function rapHangNhaHandleDataMoi_(data) {
  var type = rapHNText_(data && data.type);
  if (!type) return null;
  try {
    if (type === "rapHNGetMasterData") return outJson_(rapHNGetMasterData());
    if (type === "rapHNUploadPreviewImage") return outJson_(rapHNUploadPreviewImage(data.base64, data.maRap));
    if (type === "rapHNSavePhieuNhap") return outJson_(rapHNSavePhieuNhap(data));
    return null;
  } catch (err) {
    return outJson_({ ok: false, message: "Lỗi RAP Hàng Nhà: " + err.message });
  }
}


/****************************************************
 * BƯỚC 3 - KHAI SIZE THIẾU / NHẬP KHO THÀNH PHẨM
 * Ý tưởng:
 * - Nhà may đã giao tổng số lượng quần ở bước NHẬP.
 * - Nếu thiếu, người dùng chỉ khai size nào thiếu bao nhiêu.
 * - Hệ thống tự lấy kế hoạch size - size thiếu để nhập kho thành phẩm.
 ****************************************************/
function rapKhoNormSize_(s) {
  s = normalizeText_(s).toUpperCase();
  return s.replace(/^2XL$/, "2X").replace(/^3XL$/, "3X").replace(/^4XL$/, "4X")
          .replace(/^5XL$/, "5X").replace(/^6XL$/, "6X").replace(/^7XL$/, "7X").replace(/^8XL$/, "8X");
}

function rapKhoGetDonRowById_(idMam) {
  var shDH = rapEnsureRapDonHangSheet_();
  var rowIndex = rapFindRowIndexByMaMam_(shDH, idMam);
  if (rowIndex < 2) throw new Error("Không tìm thấy mâm rập trong tbl_Rap_DonHang");
  var lastCol = Math.max(shDH.getLastColumn(), RAP_DON_HEADERS.length);
  var row = shDH.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var don = rapMapDonHangRow_(row);
  return { sheet: shDH, rowIndex: rowIndex, row: row, don: don };
}

function rapKhoLayChiTietSize_(maPhieuNhapRap) {
  maPhieuNhapRap = normalizeText_(maPhieuNhapRap);
  if (!maPhieuNhapRap) throw new Error("Mâm này chưa có MaPhieuNhapRap để lấy chi tiết size");

  var shSize = getSheet_("RAP", "tbl_Rap_SizeKeHoach");
  var values = shSize.getDataRange().getValues();
  var out = [];

  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (normalizeText_(r[8]) !== maPhieuNhapRap) continue; // I MaPhieuNhapRap
    var slKeHoach = rapGetNum_(r[6]);
    if (slKeHoach <= 0) continue;
    out.push({
      rowIndex: i + 1,
      maMam: normalizeText_(r[0]),
      maRap: normalizeText_(r[1]),
      mau: normalizeText_(r[2]).toUpperCase(),
      size: rapKhoNormSize_(r[3]),
      soLop: rapGetNum_(r[4]),
      tyLe: rapGetNum_(r[5]),
      slKeHoach: slKeHoach,
      ghiChu: normalizeText_(r[7]),
      maPhieuNhapRap: normalizeText_(r[8]),
      maSP: normalizeText_(r[9]),
      maBanHang: normalizeText_(r[10]),
      maHangNoiBo: normalizeText_(r[11]),
      hieu: normalizeText_(r[12]),
      tenSP: normalizeText_(r[13]),
      khoNhapDuKien: normalizeText_(r[14])
    });
  }

  if (!out.length) throw new Error("Không tìm thấy chi tiết size trong tbl_Rap_SizeKeHoach cho phiếu " + maPhieuNhapRap);
  return out;
}

function rapKhoLayKeHoachNhapKho(idMam) {
  try {
    idMam = normalizeText_(idMam);
    if (!idMam) throw new Error("Thiếu mã mâm");

    var pack = rapKhoGetDonRowById_(idMam);
    var don = pack.don;
    var maPhieu = normalizeText_(don.maPhieuNhapRap);
    var details = rapKhoLayChiTietSize_(maPhieu);

    var planBySize = {};
    var totalPlanDetail = 0;
    details.forEach(function(d) {
      var sz = rapKhoNormSize_(d.size);
      planBySize[sz] = (planBySize[sz] || 0) + rapGetNum_(d.slKeHoach);
      totalPlanDetail += rapGetNum_(d.slKeHoach);
    });

    var tongKeHoach = rapGetNum_(don.tongSoLuong) || totalPlanDetail;
    var daNhan = rapGetNum_(don.soLuongGiao);
    var conThieu = Math.max(tongKeHoach - daNhan, 0);
    var trangThaiNhapKho = normalizeText_(don.trangThaiNhapKho) || "Chưa nhập kho";

    return {
      ok: true,
      idMam: idMam,
      maPhieuNhapRap: maPhieu,
      maRap: normalizeText_(don.maRap),
      tenSp: normalizeText_(don.tenSp),
      nhaMay: normalizeText_(don.nhaMay),
      ngayCat: normalizeText_(don.ngayCat),
      khoNhapDuKien: normalizeText_(don.khoNhapDuKien) || normalizeText_(details[0] && details[0].khoNhapDuKien) || "KHO CHÍNH",
      tongKeHoach: tongKeHoach,
      daNhan: daNhan,
      conThieu: conThieu,
      trangThaiNhapKho: trangThaiNhapKho,
      planBySize: planBySize,
      details: details
    };
  } catch (err) {
    return { ok: false, message: "Lỗi lấy kế hoạch nhập kho: " + err.message };
  }
}

function rapKhoParseThieuBySize_(input) {
  var out = {};
  if (!input) return out;

  if (typeof input === "object" && !Array.isArray(input)) {
    Object.keys(input).forEach(function(k) {
      var sz = rapKhoNormSize_(k);
      var n = rapGetNum_(input[k]);
      if (sz && n > 0) out[sz] = (out[sz] || 0) + n;
    });
    return out;
  }

  var s = String(input || "").replace(/\r/g, "\n");
  var parts = s.split(/[\n,;]+/);
  parts.forEach(function(p) {
    p = normalizeText_(p);
    if (!p) return;
    var m = p.match(/^([A-Za-z0-9]+)\s*(?:=|:|-|\s)\s*([0-9.,]+)$/);
    if (!m) return;
    var sz = rapKhoNormSize_(m[1]);
    var n = rapGetNum_(m[2]);
    if (sz && n > 0) out[sz] = (out[sz] || 0) + n;
  });
  return out;
}

function rapKhoFormatThieu_(obj) {
  obj = obj || {};
  var keys = Object.keys(obj).filter(function(k) { return rapGetNum_(obj[k]) > 0; });
  keys.sort(function(a, b) {
    var order = ["S","M","L","XL","2X","3X","4X","5X","6X","7X","8X"];
    return order.indexOf(a) - order.indexOf(b);
  });
  return keys.map(function(k) { return k + "=" + rapGetNum_(obj[k]); }).join(", ");
}

function rapHNNhapKhoTheoSizeThieu(payload) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    hasLock = lock.tryLock(3000);
    if (!hasLock) throw new Error("Hệ thống đang nhập kho phiếu khác, vui lòng thử lại sau vài giây");

    payload = payload || {};
    var idMam = normalizeText_(payload.idMam || payload.id);
    var nguoiNhap = normalizeText_(payload.nguoiNhap || payload.user || payload.actorUser) || "app";
    var ghiChu = normalizeText_(payload.ghiChu);
    var thieuBySize = rapKhoParseThieuBySize_(payload.thieuBySize || payload.thieuText);

    var pack = rapKhoGetDonRowById_(idMam);
    var shDH = pack.sheet;
    var rowIndex = pack.rowIndex;
    var don = pack.don;

    if (normalizeText_(don.trangThaiNhapKho) === "Đã nhập kho") {
      throw new Error("Mâm này đã nhập kho rồi");
    }

    var maPhieuNhapRap = normalizeText_(don.maPhieuNhapRap);
    var details = rapKhoLayChiTietSize_(maPhieuNhapRap);

    var tongKeHoach = rapGetNum_(don.tongSoLuong);
    var daNhan = rapGetNum_(don.soLuongGiao);
    var conThieu = Math.max(tongKeHoach - daNhan, 0);
    if (daNhan <= 0) throw new Error("Mâm này chưa ghi nhận hàng nhà may giao, chưa thể nhập kho");

    var totalThieu = 0;
    Object.keys(thieuBySize).forEach(function(k) { totalThieu += rapGetNum_(thieuBySize[k]); });

    if (totalThieu !== conThieu) {
      throw new Error("Tổng size thiếu phải bằng số còn thiếu. Còn thiếu " + conThieu + " cái, bạn khai " + totalThieu + " cái.");
    }

    var remain = {};
    Object.keys(thieuBySize).forEach(function(k) { remain[rapKhoNormSize_(k)] = rapGetNum_(thieuBySize[k]); });

    var now = nowVN_();
    var maPhieuKho = "PNK-RAP-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");
    var khoMacDinh = normalizeText_(don.khoNhapDuKien) || normalizeText_(details[0] && details[0].khoNhapDuKien) || "KHO CHÍNH";
    var importItems = [];
    var tongNhapKho = 0;

    details.forEach(function(d) {
      var sz = rapKhoNormSize_(d.size);
      var plan = rapGetNum_(d.slKeHoach);
      var thieuDong = 0;
      if (remain[sz] && remain[sz] > 0) {
        thieuDong = Math.min(remain[sz], plan);
        remain[sz] -= thieuDong;
      }
      var slNhap = plan - thieuDong;
      if (slNhap > 0) {
        var item = {
          maRap: d.maRap,
          maSP: d.maSP,
          maBanHang: d.maBanHang,
          maHangNoiBo: d.maHangNoiBo,
          hieu: d.hieu || "AZALAS",
          mau: d.mau,
          size: sz,
          tenSP: d.tenSP || d.maRap,
          mauSanPham: d.tenSP || d.maRap,
          kho: d.khoNhapDuKien || khoMacDinh,
          khoNhap: d.khoNhapDuKien || khoMacDinh,
          soLuong: slNhap,
          thieu: thieuDong
        };
        importItems.push(item);
        tongNhapKho += slNhap;
      }
    });

    var conThieuKhongPhanBo = [];
    Object.keys(remain).forEach(function(sz) {
      if (rapGetNum_(remain[sz]) > 0) conThieuKhongPhanBo.push(sz + " còn " + remain[sz]);
    });
    if (conThieuKhongPhanBo.length) {
      throw new Error("Size thiếu vượt kế hoạch hoặc không có trong mâm: " + conThieuKhongPhanBo.join(", "));
    }

    if (tongNhapKho !== daNhan) {
      throw new Error("Tổng nhập kho tính ra " + tongNhapKho + " cái, không khớp số đã nhận " + daNhan + " cái. Kiểm tra lại size thiếu.");
    }

    var shPN = getSheet_("KHO", "tbl_Kho_PhieuNhap");
    var shPNCT = getSheet_("KHO", "tbl_Kho_PhieuNhap_CT");

    shPN.getRange(shPN.getLastRow() + 1, 1, 1, 10).setValues([[
      maPhieuKho,
      now,
      "Nhập từ rập hàng nhà",
      "RAP",
      idMam,
      khoMacDinh,
      tongNhapKho,
      "Đã nhập",
      nguoiNhap,
      "Từ phiếu rập " + maPhieuNhapRap + ". Thiếu size: " + (rapKhoFormatThieu_(thieuBySize) || "Không thiếu") + (ghiChu ? ". " + ghiChu : "")
    ]]);

    // AZALAS FIX 2026-06-24:
    // Nhập kho từ Rập bằng batch để không đọc tbl_Kho_Ton trong từng dòng item.
    var batchNhapRap = khoBatchNhapKhoItems_(importItems, {
      now: now,
      maChungTu: maPhieuKho,
      nguoi: nguoiNhap,
      defaultKho: khoMacDinh,
      ghiChuPrefix: "Nhập kho từ rập " + idMam
    });

    var pnctRows = batchNhapRap.details.map(function(d) {
      var item = d.item || {};
      return [
        maPhieuKho,
        d.maHangNoiBo,
        d.maBanHang,
        item.maRap,
        item.mau,
        item.size,
        item.khoNhap || item.kho || khoMacDinh,
        d.soLuong,
        item.trangThaiHang || item.trangThai || "Hàng tốt",
        item.thieu ? ("Kế hoạch thiếu " + item.thieu + " cái") : ""
      ];
    });

    if (pnctRows.length) {
      shPNCT.getRange(shPNCT.getLastRow() + 1, 1, pnctRows.length, 10).setValues(pnctRows);
    }

    try {
      var sheetLS = rapEnsureLichSuNhap_();
      sheetLS.appendRow([
        new Date(),
        normalizeText_(don.maRap),
        tongNhapKho,
        nguoiNhap,
        "Đã nhập kho " + tongNhapKho + " cái. Thiếu size: " + (rapKhoFormatThieu_(thieuBySize) || "Không thiếu") + ". Mã PN kho: " + maPhieuKho,
        idMam,
        "",
        ""
      ]);
    } catch (eLS) {}

    shDH.getRange(rowIndex, RAP_DON_COL.TRANG_THAI_NHAP_KHO + 1).setValue("Đã nhập kho");
    shDH.getRange(rowIndex, RAP_DON_COL.CAP_NHAT_CUOI + 1).setValue(now);

    SpreadsheetApp.flush();
    return {
      ok: true,
      maPhieuNhapKho: maPhieuKho,
      tongNhapKho: tongNhapKho,
      soDongNhapKho: pnctRows.length,
      message: "Đã nhập kho " + tongNhapKho + " cái"
    };
  } catch (err) {
    return { ok: false, message: "Lỗi nhập kho theo size thiếu: " + err.message };
  } finally {
    try { if (hasLock) lock.releaseLock(); } catch (e) {}
  }
}


/****************************************************
 * SOẠN HÀNG - MÃ KHÁCH + GIÁ NHẬP SAO LƯU VẬY
 * Quy ước thao tác: người dùng tự nhập 56, 75...
 * Hệ thống KHÔNG tự chia 1000, KHÔNG tự đổi 56000 -> 56.
 ****************************************************/
function soanIsKhachLe_(v) {
  var s = normalizeText_(v).toUpperCase();
  return !s || s === "KHACH_LE" || s === "KHÁCH_LẺ" || s === "KHACH LE" || s === "KHÁCH LẺ" || s === "NULL" || s === "UNDEFINED";
}

function soanGiaVeDonViNghin_(v) {
  var n = khoNum_(v);
  if (!n) return 0;
  // Nhập sao lưu vậy: 56 vẫn là 56, 75 vẫn là 75.
  // Không tự chia 1000 để tránh sửa nhầm dữ liệu.
  return Math.round(n * 1000) / 1000;
}

function soanFindHeaderIndex_(headers, names, fallback) {
  headers = headers || [];
  names = Array.isArray(names) ? names : [names];
  for (var i = 0; i < headers.length; i++) {
    var h = normalizeText_(headers[i]).toLowerCase();
    for (var j = 0; j < names.length; j++) {
      if (h === normalizeText_(names[j]).toLowerCase()) return i;
    }
  }
  return fallback;
}

function soanBuildOrderMaKHMap_() {
  var map = {};
  try {
    var sh = getSheet_("SALES", "tbl_DonHang");
    var values = azReadCols_(sh, 9);
    if (values.length < 2) return map;
    var headers = values[0];
    var idxHD = soanFindHeaderIndex_(headers, ["MaHoaDon", "Mã hóa đơn", "MaHD"], 0);
    var idxMaKH = soanFindHeaderIndex_(headers, ["MaKH", "Mã KH", "MaKhachHang"], 8);
    for (var i = 1; i < values.length; i++) {
      var maHD = normalizeText_(values[i][idxHD]);
      var maKH = normalizeText_(values[i][idxMaKH]);
      if (maHD && !soanIsKhachLe_(maKH)) map[maHD] = maKH;
    }
  } catch (err) {}
  return map;
}

function soanResolveMaKHFromOrder_(maHoaDon, maKH) {
  maKH = normalizeText_(maKH);
  if (!soanIsKhachLe_(maKH)) return maKH;
  try {
    var sh = getSheet_("SALES", "tbl_DonHang");
    var rowIndex = azFindExactRow_(sh, 1, normalizeText_(maHoaDon), false);
    if (rowIndex !== -1) {
      var found = normalizeText_(sh.getRange(rowIndex, 9).getValue());
      if (!soanIsKhachLe_(found)) return found;
    }
  } catch (e) {}
  return "KHACH_LE";
}

function soanSyncMaKHGiaCu_() {
  var now = nowVN_();
  var orderMap = soanBuildOrderMaKHMap_();
  var kq = {
    ok: true,
    fixedChiTietMaKH: 0,
    fixedSizeMaKH: 0,
    fixedChiTietGia: 0,
    fixedSizeGia: 0,
    message: ""
  };

  function fixSheet_(sheetName, cfg) {
    var sh = getSheet_("SALES", sheetName);
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return;
    var rows = values.slice(1);
    var changed = false;

    rows.forEach(function(r) {
      var maHD = normalizeText_(r[cfg.idxMaHD]);
      var maKH = normalizeText_(r[cfg.idxMaKH]);
      if (soanIsKhachLe_(maKH) && maHD && orderMap[maHD]) {
        r[cfg.idxMaKH] = orderMap[maHD];
        if (sheetName === "tbl_ChiTietDonHang") kq.fixedChiTietMaKH++;
        else kq.fixedSizeMaKH++;
        changed = true;
      }

      // Không tự chỉnh giá cũ nữa. Giá nhập sao lưu vậy: 56 là 56, 56000 vẫn là 56000 nếu dữ liệu cũ đang như vậy.
      // Nếu cần sửa dữ liệu cũ, sửa tay trong sheet để tránh đổi nhầm hàng loạt.
    });

    if (changed) {
      sh.getRange(2, 1, rows.length, values[0].length).setValues(rows);
    }
  }

  fixSheet_("tbl_ChiTietDonHang", {
    idxMaKH: 0,
    idxMaHD: 1,
    idxSoLuong: 3,
    idxDonGia: 4,
    idxThanhTien: 5
  });

  fixSheet_("tbl_DonHang_CT_Size", {
    idxMaHD: 0,
    idxMaKH: 1,
    idxSoLuong: 9,
    idxDonGia: 10,
    idxThanhTien: 11
  });

  SpreadsheetApp.flush();
  kq.message = "Đã đồng bộ MaKH cũ lúc " + now;
  return kq;
}


/****************************************************
 * SOẠN HÀNG - GIỮ TỒN TẠM
 * - Khi lưu đơn soạn: tăng TonGiu trong tbl_Kho_Ton
 * - Không trừ TonThucTe ở bước này
 * - Khi xóa/hủy/xóa vĩnh viễn: trả TonGiu
 ****************************************************/
function soanHoldKey_(maHangNoiBo, khoXuat, viTri) {
  return normalizeText_(maHangNoiBo) + "||" + normalizeText_(khoXuat).toUpperCase() + "||" + normalizeText_(viTri).toUpperCase();
}

function soanParseHoldKey_(key) {
  var parts = String(key || "").split("||");
  return {
    maHangNoiBo: normalizeText_(parts[0]),
    khoXuat: normalizeText_(parts[1]),
    viTri: normalizeText_(parts[2])
  };
}

function soanBuildHoldMapFromDetails_(details) {
  var map = {};
  details = Array.isArray(details) ? details : [];
  details.forEach(function(item) {
    if (!item) return;
    var maNB = normalizeText_(item.maHangNoiBo);
    var sl = khoNum_(item.soLuong);
    if (!maNB || sl <= 0) return;
    var key = soanHoldKey_(maNB, item.khoXuat || item.kho || "", item.viTri || "");
    map[key] = (map[key] || 0) + sl;
  });
  return map;
}

function soanGetHoldMapForOrder_(maHoaDon) {
  var map = {};
  maHoaDon = normalizeText_(maHoaDon);
  if (!maHoaDon) return map;
  try {
    var sh = getSheet_("SALES", "tbl_DonHang_CT_Size");
    var values = sh.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (normalizeText_(values[i][0]) !== maHoaDon) continue; // A MaHoaDon
      var maGiu = normalizeText_(values[i][13]);              // N MaGiuHang
      if (!maGiu) continue;
      var trangThaiXuat = normalizeText_(values[i][12]);      // M TrangThaiXuat
      if (trangThaiXuat === "Đã xuất" || trangThaiXuat === "Đã trừ tồn") continue;
      var maNB = normalizeText_(values[i][3]);                // D MaHangNoiBo
      var khoXuat = normalizeText_(values[i][8]);             // I KhoXuat
      var sl = khoNum_(values[i][9]);                         // J SoLuong
      if (!maNB || sl <= 0) continue;
      var key = soanHoldKey_(maNB, khoXuat, "");
      map[key] = (map[key] || 0) + sl;
    }
  } catch (err) {}
  return map;
}

function soanTonAvailableWithOwnHold_(maHangNoiBo, ownHoldQty, khoXuat, viTri) {
  maHangNoiBo = normalizeText_(maHangNoiBo);
  var khoFilter = normalizeText_(khoXuat).toUpperCase();
  var viTriFilter = normalizeText_(viTri).toUpperCase();
  var shTon = getSheet_("KHO", "tbl_Kho_Ton");
  var values = shTon.getDataRange().getValues();
  var total = 0;
  for (var i = 1; i < values.length; i++) {
    if (normalizeText_(values[i][0]) !== maHangNoiBo) continue; // A MaHangNoiBo
    if (khoFilter && normalizeText_(values[i][2]).toUpperCase() !== khoFilter) continue; // C Kho
    if (viTriFilter && normalizeText_(values[i][3]).toUpperCase() !== viTriFilter) continue; // D ViTri
    var tonThucTe = khoNum_(values[i][8]); // I
    var tonGiu = khoNum_(values[i][9]);    // J
    total += Math.max(tonThucTe - tonGiu, 0);
  }
  return total + khoNum_(ownHoldQty);
}

function soanCheckCanHoldMap_(newMap, oldOwnMap) {
  newMap = newMap || {};
  oldOwnMap = oldOwnMap || {};
  var keys = Object.keys(newMap);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var p = soanParseHoldKey_(key);
    var need = khoNum_(newMap[key]);
    if (need <= 0) continue;
    var available = soanTonAvailableWithOwnHold_(p.maHangNoiBo, oldOwnMap[key] || 0, p.khoXuat, p.viTri);
    if (need > available) {
      throw new Error("Mã " + p.maHangNoiBo + (p.khoXuat ? (" tại kho " + p.khoXuat) : "") + " chỉ còn khả dụng " + available + ", đơn đang giữ cần " + need);
    }
  }
}

function soanAdjustTonGiu_(maHangNoiBo, delta, nowText, khoXuat, viTri) {
  maHangNoiBo = normalizeText_(maHangNoiBo);
  delta = khoNum_(delta);
  if (!maHangNoiBo || !delta) return 0;

  var khoFilter = normalizeText_(khoXuat).toUpperCase();
  var viTriFilter = normalizeText_(viTri).toUpperCase();
  var shTon = getSheet_("KHO", "tbl_Kho_Ton");
  var values = shTon.getDataRange().getValues();
  var remaining = Math.abs(delta);
  var changed = 0;
  var sign = delta > 0 ? 1 : -1;
  nowText = nowText || nowVN_();

  for (var i = 1; i < values.length; i++) {
    if (normalizeText_(values[i][0]) !== maHangNoiBo) continue; // A MaHangNoiBo
    if (khoFilter && normalizeText_(values[i][2]).toUpperCase() !== khoFilter) continue;
    if (viTriFilter && normalizeText_(values[i][3]).toUpperCase() !== viTriFilter) continue;

    var tonThucTe = khoNum_(values[i][8]); // I TonThucTe
    var tonGiu = khoNum_(values[i][9]);    // J TonGiu
    var canMove = sign > 0 ? Math.max(tonThucTe - tonGiu, 0) : Math.max(tonGiu, 0);
    if (canMove <= 0) continue;

    var move = Math.min(remaining, canMove);
    var newTonGiu = sign > 0 ? tonGiu + move : Math.max(tonGiu - move, 0);
    var newKhaDung = Math.max(tonThucTe - newTonGiu, 0);

    shTon.getRange(i + 1, 10).setValue(newTonGiu); // J TonGiu
    shTon.getRange(i + 1, 11).setValue(newKhaDung); // K KhaDung
    shTon.getRange(i + 1, 15).setValue(nowText);    // O CapNhatCuoi

    remaining -= move;
    changed += move;
    if (remaining <= 0) break;
  }

  if (sign > 0 && remaining > 0) {
    throw new Error("Không đủ tồn khả dụng để giữ cho mã " + maHangNoiBo + (khoFilter ? (" tại kho " + khoFilter) : "") + ". Còn thiếu " + remaining);
  }

  return changed;
}

function soanReserveHoldMap_(holdMap, maHoaDon, nguoiThaoTac) {
  holdMap = holdMap || {};
  var keys = Object.keys(holdMap);
  if (!keys.length) return "";

  var nowText = nowVN_();
  var holdId = "GIU-" + normalizeText_(maHoaDon) + "-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");
  var held = [];

  try {
    keys.forEach(function(key) {
      var p = soanParseHoldKey_(key);
      var qty = khoNum_(holdMap[key]);
      if (qty <= 0 || !p.maHangNoiBo) return;
      soanAdjustTonGiu_(p.maHangNoiBo, qty, nowText, p.khoXuat, p.viTri);
      held.push({ key: key, maNB: p.maHangNoiBo, khoXuat: p.khoXuat, viTri: p.viTri, qty: qty });
    });
  } catch (err) {
    held.reverse().forEach(function(x) {
      try { soanAdjustTonGiu_(x.maNB, -x.qty, nowText, x.khoXuat, x.viTri); } catch (rollbackErr) {}
    });
    throw err;
  }

  return holdId;
}

function soanReleaseHoldForOrder_(maHoaDon) {
  maHoaDon = normalizeText_(maHoaDon);
  if (!maHoaDon) return { released: 0, rows: 0 };

  var sh = getSheet_("SALES", "tbl_DonHang_CT_Size");
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { released: 0, rows: 0 };

  var map = {};
  var rowIndexes = [];
  for (var i = 1; i < values.length; i++) {
    if (normalizeText_(values[i][0]) !== maHoaDon) continue; // A MaHoaDon
    var maGiu = normalizeText_(values[i][13]);              // N MaGiuHang
    if (!maGiu) continue;
    var trangThaiXuat = normalizeText_(values[i][12]);      // M TrangThaiXuat
    if (trangThaiXuat === "Đã xuất" || trangThaiXuat === "Đã trừ tồn") continue;
    var maNB = normalizeText_(values[i][3]);                // D MaHangNoiBo
    var khoXuat = normalizeText_(values[i][8]);             // I KhoXuat
    var sl = khoNum_(values[i][9]);                         // J SoLuong
    if (!maNB || sl <= 0) continue;
    var key = soanHoldKey_(maNB, khoXuat, "");
    map[key] = (map[key] || 0) + sl;
    rowIndexes.push(i + 1);
  }

  var released = 0;
  var nowText = nowVN_();
  Object.keys(map).forEach(function(key) {
    var p = soanParseHoldKey_(key);
    released += soanAdjustTonGiu_(p.maHangNoiBo, -map[key], nowText, p.khoXuat, p.viTri);
  });

  rowIndexes.forEach(function(row) {
    sh.getRange(row, 13).setValue("Đã trả giữ"); // M TrangThaiXuat
    sh.getRange(row, 14).setValue("");           // N MaGiuHang
  });

  return { released: released, rows: rowIndexes.length };
}

function soanRestoreHoldForOrder_(maHoaDon, nguoiThaoTac) {
  maHoaDon = normalizeText_(maHoaDon);
  if (!maHoaDon) return { held: 0, rows: 0, holdId: "" };

  var sh = getSheet_("SALES", "tbl_DonHang_CT_Size");
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { held: 0, rows: 0, holdId: "" };

  var holdMap = {};
  var rowIndexes = [];

  for (var i = 1; i < values.length; i++) {
    if (normalizeText_(values[i][0]) !== maHoaDon) continue; // A MaHoaDon

    var trangThaiXuat = normalizeText_(values[i][12]);      // M TrangThaiXuat
    var maGiuHang = normalizeText_(values[i][13]);          // N MaGiuHang

    // Chỉ giữ lại những dòng đã bị trả giữ khi xóa mềm đơn chưa chốt.
    // Không tự giữ lại dòng đã xuất/đã hoàn tồn để tránh sai tồn thật.
    if (maGiuHang) continue;
    if (trangThaiXuat !== "Đã trả giữ" && trangThaiXuat !== "Chưa xuất") continue;

    var maNB = normalizeText_(values[i][3]);                // D MaHangNoiBo
    var khoXuat = normalizeText_(values[i][8]);             // I KhoXuat
    var sl = khoNum_(values[i][9]);                         // J SoLuong
    if (!maNB || sl <= 0) continue;

    var key = soanHoldKey_(maNB, khoXuat, "");
    holdMap[key] = (holdMap[key] || 0) + sl;
    rowIndexes.push(i + 1);
  }

  var keys = Object.keys(holdMap);
  if (!keys.length) return { held: 0, rows: 0, holdId: "" };

  // Kiểm tồn trước khi khôi phục. Nếu khách đã bán mất hàng sau lúc xóa mềm,
  // trả lỗi rõ ràng để người dùng soạn lại thay vì khôi phục âm thầm sai tồn.
  soanCheckCanHoldMap_(holdMap, {});
  var holdId = soanReserveHoldMap_(holdMap, maHoaDon, nguoiThaoTac || "app");

  var held = 0;
  keys.forEach(function(key) { held += khoNum_(holdMap[key]); });

  rowIndexes.forEach(function(row) {
    sh.getRange(row, 13).setValue("Đã giữ"); // M TrangThaiXuat
    sh.getRange(row, 14).setValue(holdId);    // N MaGiuHang
  });

  return { held: held, rows: rowIndexes.length, holdId: holdId };
}


/****************************************************
 * SOẠN HÀNG - CHỐT HÓA ĐƠN TRỪ TỒN THẬT
 * - Khi chốt hóa đơn: giảm TonThucTe, giảm TonGiu đã giữ
 * - Ghi tbl_Kho_TheKho để kiểm tra lịch sử xuất kho
 * - Đánh dấu tbl_DonHang_CT_Size: Đã xuất
 ****************************************************/
function soanCollectSizeRowsForOrders_(selectedIds) {
  var idMap = {};
  (selectedIds || []).forEach(function(id) {
    id = normalizeText_(id);
    if (id) idMap[id] = true;
  });

  var shSize = getSheet_("SALES", "tbl_DonHang_CT_Size");
  var values = shSize.getDataRange().getValues();
  var rows = [];

  for (var i = 1; i < values.length; i++) {
    var maHD = normalizeText_(values[i][0]);       // A MaHoaDon
    if (!idMap[maHD]) continue;

    var trangThaiXuat = normalizeText_(values[i][12]); // M TrangThaiXuat
    if (trangThaiXuat === "Đã xuất" || trangThaiXuat === "Đã trừ tồn") continue;

    var maNB = normalizeText_(values[i][3]);       // D MaHangNoiBo
    var sl = khoNum_(values[i][9]);                // J SoLuong
    if (!maNB || sl <= 0) continue;

    rows.push({
      rowIndex: i + 1,
      maHoaDon: maHD,
      maKH: normalizeText_(values[i][1]),
      maBanHang: normalizeText_(values[i][2]),
      maHangNoiBo: maNB,
      maSP: normalizeText_(values[i][4]),
      maRap: normalizeText_(values[i][5]),
      mau: normalizeText_(values[i][6]),
      size: normalizeText_(values[i][7]),
      khoXuat: normalizeText_(values[i][8]),
      soLuong: sl,
      donGia: khoNum_(values[i][10]),
      thanhTien: khoNum_(values[i][11]),
      trangThaiXuat: trangThaiXuat,
      maGiuHang: normalizeText_(values[i][13]),
      ghiChu: normalizeText_(values[i][14])
    });
  }

  return rows;
}


/****************************************************
 * SOẠN HÀNG - HỦY HÓA ĐƠN / HOÀN TỒN
 * - Đơn chưa chốt: trả TonGiu
 * - Hóa đơn đã chốt: cộng lại TonThucTe, ghi thẻ kho hoàn tồn
 * - Chống hoàn tồn 2 lần bằng TrangThaiXuat ở tbl_DonHang_CT_Size
 ****************************************************/
function soanCollectExportedSizeRowsForOrders_(selectedIds) {
  var idMap = {};
  (selectedIds || []).forEach(function(id) {
    id = normalizeText_(id);
    if (id) idMap[id] = true;
  });

  var shSize = getSheet_("SALES", "tbl_DonHang_CT_Size");
  var values = shSize.getDataRange().getValues();
  var rows = [];

  for (var i = 1; i < values.length; i++) {
    var maHD = normalizeText_(values[i][0]);       // A MaHoaDon
    if (!idMap[maHD]) continue;

    var trangThaiXuat = normalizeText_(values[i][12]); // M TrangThaiXuat
    if (!(trangThaiXuat === "Đã xuất" || trangThaiXuat === "Đã trừ tồn")) continue;

    var maNB = normalizeText_(values[i][3]);       // D MaHangNoiBo
    var sl = khoNum_(values[i][9]);                // J SoLuong
    if (!maNB || sl <= 0) continue;

    rows.push({
      rowIndex: i + 1,
      maHoaDon: maHD,
      maKH: normalizeText_(values[i][1]),
      maBanHang: normalizeText_(values[i][2]),
      maHangNoiBo: maNB,
      maSP: normalizeText_(values[i][4]),
      maRap: normalizeText_(values[i][5]),
      mau: normalizeText_(values[i][6]),
      size: normalizeText_(values[i][7]),
      khoXuat: normalizeText_(values[i][8]),
      soLuong: sl,
      donGia: khoNum_(values[i][10]),
      thanhTien: khoNum_(values[i][11]),
      trangThaiXuat: trangThaiXuat,
      maGiuHang: normalizeText_(values[i][13]),
      ghiChu: normalizeText_(values[i][14])
    });
  }

  return rows;
}

function soanReturnOneStockRow_(item, nowText, nguoiThaoTac) {
  var maNB = normalizeText_(item.maHangNoiBo);
  var qty = khoNum_(item.soLuong);
  if (!maNB || qty <= 0) return 0;

  var shTon = getSheet_("KHO", "tbl_Kho_Ton");
  var shTheKho = getSheet_("KHO", "tbl_Kho_TheKho");
  var values = shTon.getDataRange().getValues();
  var preferredKho = normalizeText_(item.khoXuat).toUpperCase();
  var targetRow = -1;
  var firstRow = -1;

  for (var i = 1; i < values.length; i++) {
    if (normalizeText_(values[i][0]) !== maNB) continue; // A MaHangNoiBo
    if (firstRow === -1) firstRow = i + 1;
    var rowKho = normalizeText_(values[i][2]).toUpperCase();
    if (preferredKho && rowKho === preferredKho) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) targetRow = firstRow;
  if (targetRow === -1) {
    throw new Error("Không tìm thấy dòng tồn để hoàn cho mã " + maNB);
  }

  var rowValues = shTon.getRange(targetRow, 1, 1, 15).getValues()[0];
  var tonThucTe = khoNum_(rowValues[8]); // I TonThucTe
  var tonGiu = khoNum_(rowValues[9]);    // J TonGiu
  var newTonThucTe = tonThucTe + qty;
  var newKhaDung = Math.max(newTonThucTe - tonGiu, 0);

  shTon.getRange(targetRow, 9).setValue(newTonThucTe);  // I TonThucTe
  shTon.getRange(targetRow, 11).setValue(newKhaDung);   // K KhaDung
  shTon.getRange(targetRow, 15).setValue(nowText);      // O CapNhatCuoi

  shTheKho.appendRow([
    khoMakeId_("TK-"),                  // A MaGiaoDichKho
    nowText,                             // B ThoiGian
    "HOAN_TON_HUY_HD",                  // C LoaiGiaoDich
    item.maHoaDon,                       // D MaChungTu
    maNB,                                // E MaHangNoiBo
    normalizeText_(item.maBanHang),      // F MaBanHang
    normalizeText_(rowValues[2] || item.khoXuat || "KHO"), // G Kho
    qty,                                 // H SoLuongThayDoi
    newTonThucTe,                        // I TonSau
    nguoiThaoTac || "app",              // J NguoiThaoTac
    "Hủy hóa đơn " + item.maHoaDon + " - hoàn tồn" // K GhiChu
  ]);

  return qty;
}

function soanReturnExportedStockForOrders_(selectedIds, nguoiThaoTac) {
  var rows = soanCollectExportedSizeRowsForOrders_(selectedIds);
  if (!rows.length) {
    return { returned: 0, rows: 0, message: "Không có dòng đã xuất cần hoàn tồn" };
  }

  var shSize = getSheet_("SALES", "tbl_DonHang_CT_Size");
  var nowText = nowVN_();
  var returned = 0;

  rows.forEach(function(item) {
    returned += soanReturnOneStockRow_(item, nowText, nguoiThaoTac);
    shSize.getRange(item.rowIndex, 13).setValue("Đã hoàn tồn"); // M TrangThaiXuat
    shSize.getRange(item.rowIndex, 15).setValue((item.ghiChu ? item.ghiChu + " | " : "") + "Đã hoàn tồn khi hủy hóa đơn " + nowText); // O GhiChu
  });

  SpreadsheetApp.flush();
  return { returned: returned, rows: rows.length, message: "Đã hoàn tồn " + returned + " sản phẩm" };
}

function soanDeleteOrderDetailRows_(maHoaDon) {
  maHoaDon = normalizeText_(maHoaDon);
  if (!maHoaDon) return { chiTiet: 0, size: 0 };

  function deleteRows_(sheet, colIndexOneBased) {
    if (!sheet) return 0;
    var vals = sheet.getDataRange().getValues();
    var count = 0;
    for (var r = vals.length - 1; r >= 1; r--) {
      if (normalizeText_(vals[r][colIndexOneBased - 1]) === maHoaDon) {
        sheet.deleteRow(r + 1);
        count++;
      }
    }
    return count;
  }

  var shCT = getSheet_("SALES", "tbl_ChiTietDonHang");
  var shSize = getSheet_("SALES", "tbl_DonHang_CT_Size");
  return {
    chiTiet: deleteRows_(shCT, 2), // B MaHoaDon
    size: deleteRows_(shSize, 1)   // A MaHoaDon
  };
}


/****************************************************
 * SYSTEM - NHẬT KÝ THAO TÁC APP PHẦN 25
 * - Ghi lịch sử các thao tác có thay đổi dữ liệu: lưu / sửa / xóa / hủy / chốt / nhập / xuất / kiểm kê
 * - Tự tạo sheet mới tbl_System_NhatKyThaoTac trong file SYSTEM
 * - Không thay đổi cấu trúc các sheet cũ
 ****************************************************/
function auditText_(v) {
  return String(v === null || v === undefined ? "" : v).trim();
}

function auditNow_() {
  return Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
}

function auditMakeId_() {
  return "LOG-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + "-" + Math.floor(Math.random() * 10000);
}

function auditEnsureSheet_() {
  var headers = [
    "MaNhatKy", "ThoiGian", "Type", "Nhom", "HanhDong", "MaLienQuan",
    "Nguoi", "User", "TrangThai", "ThoiGianXuLyMs", "Message", "PayloadJson",
    "KetQuaTomTat", "GhiChu"
  ];
  var ss = getSS_("SYSTEM");
  var sh = ss.getSheetByName("tbl_System_NhatKyThaoTac");
  if (!sh) sh = ss.insertSheet("tbl_System_NhatKyThaoTac");
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var emptyHeader = first.every(function(v) { return !auditText_(v); });
  if (emptyHeader) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else {
    for (var i = 0; i < headers.length; i++) {
      if (!auditText_(first[i])) sh.getRange(1, i + 1).setValue(headers[i]);
    }
  }
  return sh;
}

function auditKey_(v) {
  return auditText_(v)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function auditShouldLogType_(type) {
  type = auditText_(type);
  if (!type) return false;

  var s = auditKey_(type);
  if (!s || s === "auditgetloglist" || s === "checklogin") return false;
  // PHẦN 27: saveOrderDetails sẽ được ghi bằng auditOrderDetailChanged gọn hơn, tránh 1 lần lưu sinh 2 dòng rác.
  if (s === "saveorderdetails") return false;
  if (s.indexOf("upload") !== -1 || s.indexOf("import") !== -1) return true;

  // FIX PHẦN 25.2:
  // Chỉ ghi các API làm thay đổi dữ liệu.
  // Các API xem/tải/báo cáo như khoGetKiemKeList, khoGetBienTheManager,
  // khoGetBaoCaoBanHang... sẽ bị bỏ qua để tránh 1 thao tác sinh nhiều dòng rác.
  var readWords = [
    "get", "list", "load", "search", "read", "fetch", "find", "query",
    "xem", "loc", "filter", "count", "dem", "quick",
    "bao cao", "baocao", "report", "goiy", "suggest", "manager",
    "danhmuc", "summary", "tonghop", "dashboard"
  ];
  for (var r = 0; r < readWords.length; r++) {
    if (s.indexOf(readWords[r]) !== -1) return false;
  }

  var writeWords = [
    "save", "luu", "submit", "send", "upload", "import",
    "add", "them", "create", "tao", "insert",
    "update", "capnhat", "edit", "sua",
    "delete", "remove", "xoa", "trash",
    "huy", "cancel", "restore", "khoiphuc",
    "chot", "duyet", "approve", "confirm",
    "nhap", "xuat", "dieuchinh", "kiemke", "xuly", "xu ly",
    "thanhtoan", "payment", "congno", "cong no", "dongbo", "sync"
  ];
  for (var i = 0; i < writeWords.length; i++) {
    if (s.indexOf(writeWords[i]) !== -1) return true;
  }
  return false;
}

function auditClassifyNhom_(type) {
  var s = auditText_(type).toLowerCase();
  if (s.indexOf("kho") === 0 || s.indexOf("nhap") !== -1 || s.indexOf("xuat") !== -1 || s.indexOf("kiemke") !== -1) return "KHO";
  if (s.indexOf("rap") === 0 || s.indexOf("raphn") !== -1 || s.indexOf("mam") !== -1 || s.indexOf("nhamay") !== -1 || s.indexOf("thocat") !== -1) return "RẬP / XƯỞNG";
  if (s.indexOf("phu") !== -1 || s.indexOf("vai") !== -1 || s.indexOf("theu") !== -1 || s.indexOf("in") === 0 || s.indexOf("nhan") !== -1) return "PHỤ LIỆU";
  if (s.indexOf("nhansu") !== -1 || s.indexOf("cong") !== -1 || s.indexOf("ca") !== -1) return "NHÂN SỰ";
  if (s.indexOf("thanhtoan") !== -1 || s.indexOf("payment") !== -1 || s.indexOf("no") !== -1 || s.indexOf("congno") !== -1) return "TÀI CHÍNH";
  if (s.indexOf("order") !== -1 || s.indexOf("don") !== -1 || s.indexOf("hoa") !== -1 || s.indexOf("soan") !== -1 || s.indexOf("khach") !== -1) return "ĐƠN HÀNG";
  if (s.indexOf("login") !== -1 || s.indexOf("user") !== -1 || s.indexOf("tk") !== -1) return "SYSTEM";
  return "KHÁC";
}

function auditClassifyAction_(type) {
  var s = auditText_(type).toLowerCase();
  if (s.indexOf("delete") !== -1 || s.indexOf("remove") !== -1 || s.indexOf("xoa") !== -1 || s.indexOf("trash") !== -1) return "XÓA";
  if (s.indexOf("huy") !== -1 || s.indexOf("cancel") !== -1) return "HỦY";
  if (s.indexOf("restore") !== -1 || s.indexOf("khoiphuc") !== -1 || s.indexOf("khoi") !== -1) return "KHÔI PHỤC";
  if (s.indexOf("update") !== -1 || s.indexOf("capnhat") !== -1 || s.indexOf("edit") !== -1 || s.indexOf("sua") !== -1) return "SỬA";
  if (s.indexOf("chot") !== -1 || s.indexOf("duyet") !== -1) return "CHỐT / DUYỆT";
  if (s.indexOf("nhap") !== -1 || s.indexOf("save") !== -1 || s.indexOf("luu") !== -1 || s.indexOf("create") !== -1 || s.indexOf("tao") !== -1 || s.indexOf("add") !== -1 || s.indexOf("them") !== -1) return "THÊM / LƯU";
  if (s.indexOf("xuat") !== -1) return "XUẤT";
  if (s.indexOf("kiemke") !== -1 || s.indexOf("dieuchinh") !== -1) return "KIỂM KÊ";
  if (s.indexOf("xuly") !== -1) return "XỬ LÝ";
  if (s.indexOf("sync") !== -1) return "ĐỒNG BỘ";
  return "KHÁC";
}

function auditExtractNguoi_(data) {
  data = data || {};
  return auditText_(
    data.nguoiThaoTac || data.nguoiTao || data.nguoiSua || data.nguoiHuy ||
    data.nguoi || data.name || data.tenNhanVien || data.actorName || data.currentUserName || data.userName || ""
  );
}

function auditExtractUser_(data) {
  data = data || {};
  return auditText_(data.actorUser || data.user || data.username || data.email || data.account || "");
}

function auditExtractMaLienQuan_(data) {
  data = data || {};
  var keys = [
    "maHoaDon", "maHD", "maDon", "orderId", "idDonHang", "maChungTu",
    "maPhieu", "maPhieuNhap", "maPhieuNhapRap", "maPhieuXuat", "maMam",
    "maHangNoiBo", "maBanHang", "maSP", "maRap", "maKH", "tenKhach"
  ];
  var found = [];
  keys.forEach(function(k) {
    if (data[k] !== null && data[k] !== undefined && auditText_(data[k])) {
      found.push(k + ":" + auditText_(data[k]));
    }
  });
  if (found.length) return found.slice(0, 5).join(" | ");

  try {
    if (data.items && data.items.length && typeof data.items[0] === "object") {
      var it = data.items[0];
      return auditText_(it.maHoaDon || it.maChungTu || it.maHangNoiBo || it.maBanHang || it.maRap || "");
    }
  } catch (e) {}
  return "";
}

function auditCleanValue_(v, depth) {
  depth = depth || 0;
  if (depth > 2) return "[OBJECT]";
  if (v === null || v === undefined) return v;

  if (typeof v === "string") {
    if (/^data:image\//i.test(v)) return "[IMAGE_BASE64 length=" + v.length + "]";
    if (v.length > 500) return v.substring(0, 500) + "...[CUT " + v.length + "]";
    return v;
  }
  if (typeof v !== "object") return v;

  if (Array.isArray(v)) {
    if (v.length > 5) return "[ARRAY length=" + v.length + "]";
    return v.map(function(x) { return auditCleanValue_(x, depth + 1); });
  }

  var out = {};
  Object.keys(v).forEach(function(k) {
    var lk = auditKey_(k);
    if (lk.indexOf("pass") !== -1 || lk.indexOf("password") !== -1 || lk === "matkhau") {
      out[k] = "[HIDDEN]";
    } else if (lk.indexOf("image") !== -1 || lk.indexOf("anh") !== -1 || lk.indexOf("base64") !== -1 || lk.indexOf("file") !== -1) {
      out[k] = "[FILE/IMAGE hidden]";
    } else if (lk === "data" || lk === "rows" || lk === "list" || lk === "items") {
      if (Array.isArray(v[k])) out[k] = "[ARRAY length=" + v[k].length + "]";
      else out[k] = auditCleanValue_(v[k], depth + 1);
    } else {
      out[k] = auditCleanValue_(v[k], depth + 1);
    }
  });
  return out;
}

function auditPayloadJson_(data) {
  try {
    var s = JSON.stringify(auditCleanValue_(data || {}, 0));
    if (s.length > 2500) s = s.substring(0, 2500) + "...[CUT]";
    return s;
  } catch (err) {
    return "[Không stringify được payload]";
  }
}

function auditTextOutputContent_(res) {
  try {
    if (res && typeof res.getContent === "function") return res.getContent();
  } catch (e) {}
  try {
    if (res && typeof res === "object") return JSON.stringify(res);
  } catch (e2) {}
  return auditText_(res);
}

function auditInferOk_(parsed, text) {
  if (parsed && typeof parsed === "object") {
    if (parsed.ok === false) return false;
    if (parsed.status && String(parsed.status).toLowerCase() === "fail") return false;
    if (parsed.status && String(parsed.status).toLowerCase() === "locked") return false;
    if (parsed.error) return false;
    return true;
  }
  text = auditText_(text);
  if (!text) return true;
  if (/^(ERR|ERROR|LỖI|LOI|FAIL)/i.test(text)) return false;
  return true;
}

function auditInferMessage_(parsed, text) {
  if (parsed && typeof parsed === "object") {
    var msg = parsed.message || parsed.msg || parsed.error || parsed.status || "";
    if (msg) return auditText_(msg).substring(0, 500);

    var parts = [];
    if (parsed.ok !== undefined) parts.push(parsed.ok ? "Thành công" : "Không thành công");
    if (parsed.maChungTu) parts.push("Chứng từ: " + parsed.maChungTu);
    if (parsed.maHoaDon) parts.push("HĐ: " + parsed.maHoaDon);
    if (parsed.maHangNoiBo) parts.push("Mã hàng: " + parsed.maHangNoiBo);
    if (parsed.tonCu !== undefined && parsed.tonMoi !== undefined) parts.push("Tồn: " + parsed.tonCu + " → " + parsed.tonMoi);
    if (parsed.delta !== undefined) parts.push("Lệch: " + parsed.delta);
    if (parsed.processed !== undefined) parts.push("Đã xử lý: " + parsed.processed);
    if (parts.length) return parts.join(" | ").substring(0, 500);

    return "Đã xử lý";
  }
  return auditText_(text).substring(0, 500);
}

function auditResultSummaryJson_(resultText, message) {
  var text = auditText_(resultText || message);
  var parsed = safeParseJson_(text, null);
  if (parsed && typeof parsed === "object") {
    var keep = {};
    [
      "ok", "status", "message", "msg", "error",
      "maChungTu", "maHoaDon", "maPhieu", "maPhieuNhap", "maPhieuXuat",
      "maHangNoiBo", "maBanHang", "maSP", "maRap", "maMam",
      "tonCu", "tonMoi", "delta", "khaDungMoi", "processed", "count", "total"
    ].forEach(function(k) {
      if (parsed[k] !== undefined && parsed[k] !== null && auditText_(parsed[k]) !== "") keep[k] = parsed[k];
    });

    if (parsed.summary !== undefined) keep.summary = auditCleanValue_(parsed.summary, 0);
    if (Array.isArray(parsed.data)) keep.soDongData = parsed.data.length;
    if (Array.isArray(parsed.items)) keep.soDongItems = parsed.items.length;
    if (Array.isArray(parsed.details)) keep.soDongDetails = parsed.details.length;

    try {
      var s = JSON.stringify(auditCleanValue_(keep, 0));
      if (s.length > 1200) s = s.substring(0, 1200) + "...[CUT]";
      return s;
    } catch (e) {}
  }

  if (text.length > 1000) text = text.substring(0, 1000) + "...[CUT]";
  return text;
}

function auditMaybeWrite_(data, ok, message, elapsedMs, resultText) {
  data = data || {};
  var type = auditText_(data.type);
  if (!auditShouldLogType_(type)) return;

  var sh = auditEnsureSheet_();
  var payload = auditPayloadJson_(data);
  var ketQua = auditResultSummaryJson_(resultText, message);

  sh.appendRow([
    auditMakeId_(),
    auditNow_(),
    type,
    auditClassifyNhom_(type),
    auditClassifyAction_(type),
    auditExtractMaLienQuan_(data),
    auditExtractNguoi_(data) || "app",
    auditExtractUser_(data),
    ok ? "THÀNH CÔNG" : "LỖI",
    Number(elapsedMs) || 0,
    auditText_(message).substring(0, 500),
    payload,
    ketQua,
    "Ghi tự động - chỉ ghi thao tác thay đổi dữ liệu"
  ]);
}

function auditParseVNDateTimeMs_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getTime();
  var s = auditText_(v);
  if (!s) return 0;
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)).getTime();
  var d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function auditParseDateYMD_(ymd, endOfDay) {
  ymd = auditText_(ymd);
  if (!ymd) return null;
  var m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0).getTime();
}

function auditGetLogList_(data) {
  var sh = auditEnsureSheet_();
  var values = sh.getDataRange().getValues();
  var q = auditText_(data && data.q).toLowerCase();
  var nhom = auditText_(data && data.nhom).toUpperCase();
  var hanhDong = auditText_(data && data.hanhDong).toUpperCase();
  var trangThai = auditText_(data && data.trangThai).toUpperCase();
  var fromMs = auditParseDateYMD_(data && data.fromDate, false);
  var toMs = auditParseDateYMD_(data && data.toDate, true);
  var limit = Number(data && data.limit) || 300;
  if (limit < 50) limit = 50;
  if (limit > 1000) limit = 1000;

  var out = [];
  var summary = { total: 0, success: 0, error: 0, byNhom: {}, byAction: {} };

  for (var i = values.length - 1; i >= 1; i--) {
    var r = values[i];
    var ms = auditParseVNDateTimeMs_(r[1]);
    if (fromMs !== null && ms && ms < fromMs) continue;
    if (toMs !== null && ms && ms > toMs) continue;

    var rowNhom = auditText_(r[3]).toUpperCase();
    var rowAction = auditText_(r[4]).toUpperCase();
    var rowStatus = auditText_(r[8]).toUpperCase();
    if (nhom && nhom !== "ALL" && rowNhom !== nhom) continue;
    if (hanhDong && hanhDong !== "ALL" && rowAction !== hanhDong) continue;
    if (trangThai && trangThai !== "ALL" && rowStatus !== trangThai) continue;

    var haystack = [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[10], r[11], r[12], r[13]].join(" ").toLowerCase();
    if (q && haystack.indexOf(q) === -1) continue;

    summary.total++;
    if (rowStatus === "LỖI" || rowStatus === "LOI") summary.error++;
    else summary.success++;
    summary.byNhom[auditText_(r[3]) || "KHÁC"] = (summary.byNhom[auditText_(r[3]) || "KHÁC"] || 0) + 1;
    summary.byAction[auditText_(r[4]) || "KHÁC"] = (summary.byAction[auditText_(r[4]) || "KHÁC"] || 0) + 1;

    if (out.length < limit) {
      out.push({
        maNhatKy: auditText_(r[0]),
        thoiGian: auditText_(r[1]),
        type: auditText_(r[2]),
        nhom: auditText_(r[3]),
        hanhDong: auditText_(r[4]),
        maLienQuan: auditText_(r[5]),
        nguoi: auditText_(r[6]),
        user: auditText_(r[7]),
        trangThai: auditText_(r[8]),
        ms: Number(r[9]) || 0,
        message: auditText_(r[10]),
        payload: auditText_(r[11]),
        ketQua: auditText_(r[12]),
        ghiChu: auditText_(r[13])
      });
    }
  }

  return { ok: true, data: out, summary: summary, limit: limit };
}


/****************************************************
 * SYSTEM - NHẬT KÝ RIÊNG THEO HÓA ĐƠN PHẦN 26
 * - Nhập MaHoaDon để gom lịch sử thao tác app + thẻ kho liên quan hóa đơn đó
 * - Chỉ đọc dữ liệu, không thay đổi tồn / đơn / công nợ
 ****************************************************/
function auditKhoActionByLoai_(loai) {
  var s = auditKey_(loai);
  if (s.indexOf("nhap") !== -1 || s.indexOf("hoan") !== -1 || s.indexOf("return") !== -1) return "NHẬP / HOÀN";
  if (s.indexOf("xuat") !== -1) return "XUẤT";
  if (s.indexOf("kiem") !== -1 || s.indexOf("dieu") !== -1) return "KIỂM KÊ";
  if (s.indexOf("loi") !== -1 || s.indexOf("cho") !== -1 || s.indexOf("xuly") !== -1) return "XỬ LÝ";
  return "KHO";
}

function auditGetHoaDonLog_(data) {
  data = data || {};
  var maHD = auditText_(data.maHoaDon || data.maHD || data.q || data.keyword).toUpperCase();
  if (!maHD) {
    return { ok: false, message: "Thiếu mã hóa đơn cần xem lịch sử" };
  }

  var limit = Number(data.limit) || 200;
  if (limit < 50) limit = 50;
  if (limit > 500) limit = 500;

  var qLower = maHD.toLowerCase();
  var out = [];
  var summary = {
    maHoaDon: maHD,
    total: 0,
    app: 0,
    kho: 0,
    success: 0,
    error: 0,
    tongTangKho: 0,
    tongGiamKho: 0
  };

  // 1) Lịch sử thao tác app từ tbl_System_NhatKyThaoTac
  try {
    var shAudit = auditEnsureSheet_();
    var rowsAudit = shAudit.getDataRange().getValues();
    for (var i = rowsAudit.length - 1; i >= 1; i--) {
      var r = rowsAudit[i];
      var hay = [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[10], r[11], r[12], r[13]].join(" ").toLowerCase();
      if (hay.indexOf(qLower) === -1) continue;

      var status = auditText_(r[8]);
      out.push({
        source: "APP",
        maNhatKy: auditText_(r[0]),
        thoiGian: auditText_(r[1]),
        type: auditText_(r[2]),
        nhom: auditText_(r[3]),
        hanhDong: auditText_(r[4]),
        maLienQuan: auditText_(r[5]),
        nguoi: auditText_(r[6]),
        user: auditText_(r[7]),
        trangThai: status,
        ms: Number(r[9]) || 0,
        message: auditText_(r[10]),
        payload: auditText_(r[11]),
        ketQua: auditText_(r[12]),
        ghiChu: auditText_(r[13]),
        sortMs: auditParseVNDateTimeMs_(r[1])
      });
      summary.app++;
      if (auditText_(status).toUpperCase().indexOf("LỖI") !== -1 || auditText_(status).toUpperCase().indexOf("LOI") !== -1) summary.error++;
      else summary.success++;
    }
  } catch (errAudit) {
    out.push({
      source: "APP",
      thoiGian: auditNow_(),
      type: "auditGetHoaDonLog",
      nhom: "SYSTEM",
      hanhDong: "LỖI",
      trangThai: "LỖI",
      message: "Không đọc được nhật ký app: " + errAudit.message,
      sortMs: new Date().getTime()
    });
    summary.error++;
  }

  // 2) Lịch sử thẻ kho liên quan hóa đơn từ tbl_Kho_TheKho
  try {
    var shTK = getSheet_("KHO", "tbl_Kho_TheKho");
    var rowsTK = shTK.getDataRange().getValues();
    for (var k = rowsTK.length - 1; k >= 1; k--) {
      var t = rowsTK[k];
      var hayKho = [t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[9], t[10]].join(" ").toLowerCase();
      if (hayKho.indexOf(qLower) === -1) continue;

      var soLuong = Number(t[7]) || 0;
      if (soLuong > 0) summary.tongTangKho += soLuong;
      if (soLuong < 0) summary.tongGiamKho += Math.abs(soLuong);

      var loai = auditText_(t[2]);
      var payloadKho = {
        maGiaoDichKho: auditText_(t[0]),
        maHoaDon: maHD,
        maChungTu: auditText_(t[3]),
        maHangNoiBo: auditText_(t[4]),
        maBanHang: auditText_(t[5]),
        kho: auditText_(t[6]),
        soLuongThayDoi: soLuong,
        tonSau: Number(t[8]) || 0,
        nguoiThaoTac: auditText_(t[9]),
        ghiChu: auditText_(t[10])
      };

      out.push({
        source: "KHO",
        maNhatKy: auditText_(t[0]),
        thoiGian: auditText_(t[1]),
        type: loai,
        nhom: "KHO",
        hanhDong: auditKhoActionByLoai_(loai),
        maLienQuan: "maHoaDon:" + maHD + " | maHangNoiBo:" + auditText_(t[4]),
        nguoi: auditText_(t[9]) || "app",
        user: "",
        trangThai: "THÀNH CÔNG",
        ms: 0,
        message: auditText_(t[10]) || loai,
        payload: JSON.stringify(payloadKho),
        ketQua: JSON.stringify({
          maChungTu: auditText_(t[3]),
          maHangNoiBo: auditText_(t[4]),
          maBanHang: auditText_(t[5]),
          kho: auditText_(t[6]),
          soLuongThayDoi: soLuong,
          tonSau: Number(t[8]) || 0
        }),
        ghiChu: "Lấy từ tbl_Kho_TheKho",
        sortMs: auditParseVNDateTimeMs_(t[1])
      });
      summary.kho++;
      summary.success++;
    }
  } catch (errKho) {
    // Nếu file kho chưa có thẻ kho thì vẫn trả lịch sử app, không làm lỗi toàn màn.
  }

  out.sort(function(a, b) { return (Number(b.sortMs) || 0) - (Number(a.sortMs) || 0); });
  summary.total = out.length;
  out = out.slice(0, limit).map(function(x) {
    delete x.sortMs;
    return x;
  });

  return { ok: true, data: out, summary: summary, limit: limit };
}


/****************************************************
 * PHẦN 27-34 - TRUY VẾT ĐƠN / CÔNG NỢ / ĐỐI SOÁT RẬP
 * - Chỉ thêm hàm mới, không đổi cấu trúc cột cũ
 * - Các màn xem lịch sử/đối soát chỉ đọc dữ liệu
 * - Riêng saveOrderDetails được bổ sung log gọn trước/sau để biết sửa gì
 ****************************************************/
function step2734SafeSheet_(fileKey, sheetName) {
  try { return getSheet_(fileKey, sheetName); } catch (err) { return null; }
}

function step2734Text_(v) {
  return String(v === null || v === undefined ? "" : v).trim();
}

function step2734Num_(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  var s = String(v).replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  var n = Number(s);
  return isNaN(n) ? 0 : n;
}

function step2734Key_(v) {
  return step2734Text_(v).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function step2734Contains_(hay, needle) {
  hay = step2734Key_(hay);
  needle = step2734Key_(needle);
  return !needle || hay.indexOf(needle) !== -1;
}

function step2734ParseTime_(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  var s = String(v || "").trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)).getTime();
  var d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function step2734AppendLog_(data, message, resultObj) {
  try {
    data = data || {};
    var sh = auditEnsureSheet_();
    var payload = auditPayloadJson_(data);
    var ketQua = JSON.stringify(auditCleanValue_(resultObj || {}, 0));
    sh.appendRow([
      auditMakeId_(),
      auditNow_(),
      step2734Text_(data.type || "AUDIT_MANUAL"),
      auditClassifyNhom_(data.type || "donHang"),
      auditClassifyAction_(data.type || "sua"),
      auditExtractMaLienQuan_(data),
      auditExtractNguoi_(data) || "app",
      auditExtractUser_(data),
      "THÀNH CÔNG",
      0,
      step2734Text_(message).substring(0, 500),
      payload,
      ketQua.substring(0, 5000),
      "Ghi tự động truy vết hệ thống"
    ]);
  } catch (err) {}
}

function step27ReadOrderItems_(maHoaDon) {
  maHoaDon = step2734Text_(maHoaDon);
  var out = [];
  if (!maHoaDon) return out;
  var sh = step2734SafeSheet_("SALES", "tbl_ChiTietDonHang");
  if (!sh || sh.getLastRow() < 2) return out;
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (step2734Text_(r[1]) !== maHoaDon) continue; // B MaHoaDon
    out.push({
      tenSP: step2734Text_(r[2]),
      soLuong: step2734Num_(r[3]),
      donGia: step2734Num_(r[4]),
      thanhTien: step2734Num_(r[5]),
      maBanHang: step2734Text_(r[6]),
      maHangNoiBo: step2734Text_(r[7]),
      mau: step2734Text_(r[8]),
      size: step2734Text_(r[9]),
      khoXuat: step2734Text_(r[10]),
      kieuBan: step2734Text_(r[11]),
      ghiChu: step2734Text_(r[13])
    });
  }
  return out;
}

function step27NormalizeClientItems_(details) {
  details = Array.isArray(details) ? details : [];
  var out = [];
  details.forEach(function(item) {
    if (!item) return;
    var sl = step2734Num_(item.soLuong);
    if (sl <= 0) return;
    out.push({
      tenSP: step2734Text_(item.tenSP),
      soLuong: sl,
      donGia: step2734Num_(item.donGia),
      thanhTien: sl * step2734Num_(item.donGia),
      maBanHang: step2734Text_(item.maBanHang),
      maHangNoiBo: step2734Text_(item.maHangNoiBo),
      mau: step2734Text_(item.mauChuan || item.mau),
      size: step2734Text_(item.size),
      khoXuat: step2734Text_(item.khoXuat),
      kieuBan: step2734Text_(item.kieuBan),
      ghiChu: step2734Text_(item.ghiChu)
    });
  });
  return out;
}

function step27ItemKey_(it) {
  return [it.maHangNoiBo, it.maBanHang, it.tenSP, it.mau, it.size, it.khoXuat]
    .map(function(x){ return step2734Key_(x); }).join("|");
}

function step27BuildDiff_(oldItems, newItems) {
  var oldMap = {}, newMap = {}, out = [];
  oldItems = Array.isArray(oldItems) ? oldItems : [];
  newItems = Array.isArray(newItems) ? newItems : [];
  oldItems.forEach(function(it){ oldMap[step27ItemKey_(it)] = it; });
  newItems.forEach(function(it){ newMap[step27ItemKey_(it)] = it; });
  Object.keys(newMap).forEach(function(k) {
    var n = newMap[k];
    var o = oldMap[k];
    if (!o) {
      out.push({ loai: "THÊM DÒNG", tenSP: n.tenSP, maHangNoiBo: n.maHangNoiBo, mau: n.mau, size: n.size, soLuongCu: 0, soLuongMoi: n.soLuong, giaCu: 0, giaMoi: n.donGia });
      return;
    }
    if (step2734Num_(o.soLuong) !== step2734Num_(n.soLuong) || step2734Num_(o.donGia) !== step2734Num_(n.donGia)) {
      out.push({ loai: "SỬA DÒNG", tenSP: n.tenSP, maHangNoiBo: n.maHangNoiBo, mau: n.mau, size: n.size, soLuongCu: o.soLuong, soLuongMoi: n.soLuong, giaCu: o.donGia, giaMoi: n.donGia });
    }
  });
  Object.keys(oldMap).forEach(function(k) {
    if (newMap[k]) return;
    var o = oldMap[k];
    out.push({ loai: "XÓA DÒNG", tenSP: o.tenSP, maHangNoiBo: o.maHangNoiBo, mau: o.mau, size: o.size, soLuongCu: o.soLuong, soLuongMoi: 0, giaCu: o.donGia, giaMoi: 0 });
  });
  return out;
}

function step27LogOrderDetailChange_(maHoaDon, oldItems, newItems, nguoi, ghiChu) {
  var diff = step27BuildDiff_(oldItems, newItems);
  if (!diff.length && oldItems.length === newItems.length) return;
  var totalOld = oldItems.reduce(function(s, x){ return s + step2734Num_(x.thanhTien || (x.soLuong * x.donGia)); }, 0);
  var totalNew = newItems.reduce(function(s, x){ return s + step2734Num_(x.thanhTien || (x.soLuong * x.donGia)); }, 0);
  step2734AppendLog_({
    type: "auditOrderDetailChanged",
    maHoaDon: maHoaDon,
    nguoi: nguoi,
    ghiChu: ghiChu,
    soDongCu: oldItems.length,
    soDongMoi: newItems.length
  }, "Đã ghi lịch sử chỉnh sửa chi tiết đơn", {
    ok: true,
    maHoaDon: maHoaDon,
    soDongCu: oldItems.length,
    soDongMoi: newItems.length,
    tongTienCu: totalOld,
    tongTienMoi: totalNew,
    chenhLech: totalNew - totalOld,
    soThayDoi: diff.length,
    thayDoi: diff.slice(0, 20)
  });
}

function step2734ShortAuditEvent_(r) {
  return {
    source: "APP",
    time: step2734Text_(r[1]),
    type: step2734Text_(r[2]),
    nhom: step2734Text_(r[3]),
    hanhDong: step2734Text_(r[4]),
    maLienQuan: step2734Text_(r[5]),
    nguoi: step2734Text_(r[6]),
    trangThai: step2734Text_(r[8]),
    message: step2734Text_(r[10]),
    payload: step2734Text_(r[11]),
    ketQua: step2734Text_(r[12]),
    sortMs: step2734ParseTime_(r[1])
  };
}

function step2734GetOrderFullLog_(data) {
  var maHD = step2734Text_(data.maHoaDon || data.maHD || data.q).toUpperCase();
  var limit = step2734Num_(data.limit || 300) || 300;
  if (!maHD) return { ok: false, message: "Thiếu mã hóa đơn" };

  var events = [];
  var summary = { total: 0, app: 0, status: 0, kho: 0, congNo: 0, chiTiet: 0, tongGiamKho: 0, tongCongNo: 0, tongThanhToan: 0 };

  try {
    var shA = auditEnsureSheet_();
    var aRows = shA.getDataRange().getValues();
    for (var a = 1; a < aRows.length; a++) {
      var hay = [aRows[a][2], aRows[a][5], aRows[a][10], aRows[a][11], aRows[a][12]].join(" ");
      if (!step2734Contains_(hay, maHD)) continue;
      var ev = step2734ShortAuditEvent_(aRows[a]);
      events.push(ev);
      summary.app++;
      if (step2734Text_(ev.type) === "auditOrderDetailChanged") summary.chiTiet++;
    }
  } catch (errA) {}

  try {
    var shLS = step2734SafeSheet_("SALES", "tbl_LichSuTrangThaiDon");
    if (shLS && shLS.getLastRow() >= 2) {
      var sRows = shLS.getDataRange().getValues();
      for (var s = 1; s < sRows.length; s++) {
        if (!step2734Contains_(sRows[s][1], maHD)) continue;
        events.push({ source: "TRẠNG THÁI", time: step2734Text_(sRows[s][0]), type: "LichSuTrangThaiDon", nhom: "ĐƠN HÀNG", hanhDong: "SỬA TRẠNG THÁI", nguoi: step2734Text_(sRows[s][4]), message: "Trạng thái: " + step2734Text_(sRows[s][2]) + " → " + step2734Text_(sRows[s][3]) + (sRows[s][5] ? ". " + step2734Text_(sRows[s][5]) : ""), sortMs: step2734ParseTime_(sRows[s][0]) });
        summary.status++;
      }
    }
  } catch (errS) {}

  try {
    var shTK = step2734SafeSheet_("KHO", "tbl_Kho_TheKho");
    if (shTK && shTK.getLastRow() >= 2) {
      var kRows = shTK.getDataRange().getValues();
      for (var k = 1; k < kRows.length; k++) {
        if (!step2734Contains_(kRows[k][3], maHD)) continue; // D MaChungTu
        var sl = step2734Num_(kRows[k][7]);
        events.push({ source: "THẺ KHO", time: step2734Text_(kRows[k][1]), type: step2734Text_(kRows[k][2]), nhom: "KHO", hanhDong: sl < 0 ? "TRỪ TỒN" : "CỘNG TỒN", maHangNoiBo: step2734Text_(kRows[k][4]), maBanHang: step2734Text_(kRows[k][5]), kho: step2734Text_(kRows[k][6]), soLuong: sl, tonSau: step2734Num_(kRows[k][8]), nguoi: step2734Text_(kRows[k][9]), message: step2734Text_(kRows[k][10]), sortMs: step2734ParseTime_(kRows[k][1]) });
        summary.kho++;
        if (sl < 0) summary.tongGiamKho += Math.abs(sl);
      }
    }
  } catch (errK) {}

  try {
    var shNo = step2734SafeSheet_("TAI_CHINH", "tbl_NhatKyNo");
    if (shNo && shNo.getLastRow() >= 2) {
      var nRows = shNo.getDataRange().getValues();
      for (var n = 1; n < nRows.length; n++) {
        var maChungTuNo = step2734Text_(nRows[n][7]);
        var ghiChuNo = step2734Text_(nRows[n][5]);
        if (!step2734Contains_(maChungTuNo + " " + ghiChuNo, maHD)) continue;
        var soTien = step2734Num_(nRows[n][4]);
        events.push({ source: "CÔNG NỢ", time: step2734Text_(nRows[n][2]), type: step2734Text_(nRows[n][3]), nhom: "TÀI CHÍNH", hanhDong: soTien >= 0 ? "PHÁT SINH NỢ" : "THANH TOÁN", maKH: step2734Text_(nRows[n][0]), tenKhach: step2734Text_(nRows[n][1]), soTien: soTien, nguoi: step2734Text_(nRows[n][6]), message: ghiChuNo, sortMs: step2734ParseTime_(nRows[n][2]) });
        summary.congNo++;
        if (soTien >= 0) summary.tongCongNo += soTien; else summary.tongThanhToan += Math.abs(soTien);
      }
    }
  } catch (errN) {}

  var currentItems = step27ReadOrderItems_(maHD);
  summary.currentItems = currentItems.length;
  events.sort(function(a, b){ return (b.sortMs || 0) - (a.sortMs || 0); });
  if (events.length > limit) events = events.slice(0, limit);
  summary.total = events.length;
  return { ok: true, maHoaDon: maHD, summary: summary, currentItems: currentItems, data: events };
}

function step30GetCustomerDebtHistory_(data) {
  var q = step2734Text_(data.q || data.maKH || data.tenKhach || data.maHoaDon).toLowerCase();
  var limit = step2734Num_(data.limit || 300) || 300;
  var events = [];
  var summary = { total: 0, phatSinhTang: 0, phatSinhGiam: 0, soDuGanNhat: 0 };

  try {
    var shKH = step2734SafeSheet_("SALES", "tbl_KhachHang");
    if (shKH && shKH.getLastRow() >= 2) {
      var khRows = shKH.getDataRange().getValues();
      for (var kh = 1; kh < khRows.length; kh++) {
        var hayKH = [khRows[kh][0], khRows[kh][1], khRows[kh][2]].join(" ");
        if (q && !step2734Contains_(hayKH, q)) continue;
        summary.soDuGanNhat += step2734Num_(khRows[kh][4]);
      }
    }
  } catch (errKH) {}

  try {
    var shNo = step2734SafeSheet_("TAI_CHINH", "tbl_NhatKyNo");
    if (shNo && shNo.getLastRow() >= 2) {
      var rows = shNo.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        var hay = rows[i].join(" ");
        if (q && !step2734Contains_(hay, q)) continue;
        var soTien = step2734Num_(rows[i][4]);
        events.push({ source: "NHẬT KÝ NỢ", time: step2734Text_(rows[i][2]), maKH: step2734Text_(rows[i][0]), tenKhach: step2734Text_(rows[i][1]), loai: step2734Text_(rows[i][3]), soTien: soTien, ghiChu: step2734Text_(rows[i][5]), nguoi: step2734Text_(rows[i][6]), maChungTu: step2734Text_(rows[i][7]), sortMs: step2734ParseTime_(rows[i][2]) });
        if (soTien >= 0) summary.phatSinhTang += soTien; else summary.phatSinhGiam += Math.abs(soTien);
      }
    }
  } catch (errNo) {}

  try {
    var shTT = step2734SafeSheet_("TAI_CHINH", "tbl_ThanhToanKhach");
    if (shTT && shTT.getLastRow() >= 2) {
      var ttRows = shTT.getDataRange().getValues();
      for (var t = 1; t < ttRows.length; t++) {
        var hayTT = ttRows[t].join(" ");
        if (q && !step2734Contains_(hayTT, q)) continue;
        var tt = step2734Num_(ttRows[t][5]);
        events.push({ source: "THANH TOÁN", time: step2734Text_(ttRows[t][1]), maKH: step2734Text_(ttRows[t][2]), tenKhach: step2734Text_(ttRows[t][3]), loai: step2734Text_(ttRows[t][6]), soTien: -Math.abs(tt), ghiChu: step2734Text_(ttRows[t][8]), nguoi: step2734Text_(ttRows[t][7]), maChungTu: step2734Text_(ttRows[t][4]), sortMs: step2734ParseTime_(ttRows[t][1]) });
        summary.phatSinhGiam += Math.abs(tt);
      }
    }
  } catch (errTT) {}

  events.sort(function(a, b){ return (b.sortMs || 0) - (a.sortMs || 0); });
  if (events.length > limit) events = events.slice(0, limit);
  summary.total = events.length;
  return { ok: true, summary: summary, data: events };
}

function step3133CountNhapKhoByMam_() {
  var map = {};
  var sh = step2734SafeSheet_("KHO", "tbl_Kho_PhieuNhap");
  if (!sh || sh.getLastRow() < 2) return map;
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var loai = step2734Text_(rows[i][2]);
    var nguon = step2734Text_(rows[i][3]);
    var maThamChieu = step2734Text_(rows[i][4]);
    if (!maThamChieu) continue;
    if (step2734Key_(loai).indexOf("rap") === -1 && step2734Key_(nguon).indexOf("rap") === -1 && step2734Key_(maThamChieu).indexOf("mam") === -1) continue;
    if (!map[maThamChieu]) map[maThamChieu] = { soPhieu: 0, tongNhap: 0, phieu: [] };
    map[maThamChieu].soPhieu++;
    map[maThamChieu].tongNhap += step2734Num_(rows[i][6]);
    map[maThamChieu].phieu.push({ maPhieuNhap: step2734Text_(rows[i][0]), ngayNhap: step2734Text_(rows[i][1]), tongSoLuong: step2734Num_(rows[i][6]), khoNhap: step2734Text_(rows[i][5]), nguoiNhap: step2734Text_(rows[i][8]) });
  }
  return map;
}

function step31GetDoiSoatNhapKhoRap_(data) {
  var q = step2734Text_(data.q).toLowerCase();
  var onlyPending = data.onlyPending === true || step2734Text_(data.trangThai) === "PENDING";
  var limit = step2734Num_(data.limit || 300) || 300;
  var sh = rapEnsureRapDonHangSheet_();
  var rows = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 0), Math.max(sh.getLastColumn(), RAP_DON_HEADERS.length)).getValues();
  var nhapMap = step3133CountNhapKhoByMam_();
  var out = [];
  var summary = { total: 0, chuaNhan: 0, choNhapKho: 0, daNhapKho: 0, conThieu: 0, tongKeHoach: 0, tongDaGiao: 0, tongDaNhap: 0 };

  rows.forEach(function(r) {
    var don = rapMapDonHangRow_(r);
    if (!don || !don.maMam) return;
    var n = nhapMap[don.maMam] || { soPhieu: 0, tongNhap: 0, phieu: [] };
    var tongKH = step2734Num_(don.tongKeHoach || don.tongSoLuong);
    var daGiao = step2734Num_(don.tongDaGiao || don.soLuongGiao);
    var conThieu = Math.max(tongKH - daGiao, 0);
    var daNhap = step2734Num_(n.tongNhap);
    var trangThaiNhap = step2734Text_(don.trangThaiNhapKho) || (daNhap > 0 ? "Đã nhập kho" : "Chưa nhập kho");
    var hay = [don.maMam, don.maPhieuNhapRap, don.maRap, don.tenSp, don.nhaMay, don.mau, trangThaiNhap].join(" ");
    if (q && !step2734Contains_(hay, q)) return;
    var isPending = daGiao > 0 && trangThaiNhap !== "Đã nhập kho";
    if (onlyPending && !isPending) return;
    if (daGiao <= 0) summary.chuaNhan++;
    if (isPending) summary.choNhapKho++;
    if (trangThaiNhap === "Đã nhập kho" || daNhap > 0) summary.daNhapKho++;
    if (conThieu > 0) summary.conThieu++;
    summary.tongKeHoach += tongKH;
    summary.tongDaGiao += daGiao;
    summary.tongDaNhap += daNhap;
    out.push({
      maMam: don.maMam,
      maPhieuNhapRap: don.maPhieuNhapRap,
      ngayTao: don.ngayTao,
      ngayCat: don.ngayCat,
      nhaMay: don.nhaMay,
      maRap: don.maRap,
      tenSP: don.tenSp,
      mau: don.mau || don.mauChuan,
      size: don.sizeChung || don.size,
      tongKeHoach: tongKH,
      daGiao: daGiao,
      conThieu: conThieu,
      daNhapKho: daNhap,
      chenhLechGiaoNhap: daGiao - daNhap,
      trangThaiNhanHang: don.trangThaiNhanHang,
      trangThaiNhapKho: trangThaiNhap,
      khoNhapDuKien: don.khoNhapDuKien,
      maChotNhaMay: don.maChotNhaMay,
      donGiaNhaMay: don.donGiaNhaMay || don.donGia,
      thanhTienNhaMay: don.thanhTienNhaMay || don.thanhTien,
      phieuNhapKho: n.phieu
    });
  });
  out.sort(function(a,b){ return (a.trangThaiNhapKho === "Đã nhập kho" ? 1 : 0) - (b.trangThaiNhapKho === "Đã nhập kho" ? 1 : 0); });
  if (out.length > limit) out = out.slice(0, limit);
  summary.total = out.length;
  return { ok: true, summary: summary, data: out };
}

function step32GetBaoCaoLechRap_(data) {
  var res = step31GetDoiSoatNhapKhoRap_(data);
  if (!res.ok) return res;
  var list = (res.data || []).map(function(x) {
    var mucDo = "OK";
    var canhBao = [];
    if (x.daGiao <= 0) { mucDo = "CHƯA NHẬN"; canhBao.push("Mâm chưa nhận hàng"); }
    if (x.daGiao > 0 && x.daNhapKho <= 0) { mucDo = "CHỜ NHẬP"; canhBao.push("Đã nhận nhưng chưa nhập kho"); }
    if (x.daNhapKho > 0 && x.daNhapKho !== x.daGiao) { mucDo = "LỆCH"; canhBao.push("Đã nhập kho không khớp số nhà may giao"); }
    if (x.conThieu > 0) canhBao.push("Nhà may còn thiếu " + x.conThieu + " cái");
    x.mucDo = mucDo;
    x.canhBao = canhBao.join("; ");
    return x;
  });
  var summary = res.summary || {};
  summary.soCanhBao = list.filter(function(x){ return x.canhBao; }).length;
  return { ok: true, summary: summary, data: list };
}

function step33GetDoiSoatCongNhaMay_(data) {
  var q = step2734Text_(data.q).toLowerCase();
  var sh = rapEnsureRapDonHangSheet_();
  var rows = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 0), Math.max(sh.getLastColumn(), RAP_DON_HEADERS.length)).getValues();
  var out = [];
  var summary = { total: 0, tongDaGiao: 0, tongThanhTien: 0, chuaThanhToan: 0, daThanhToan: 0 };
  rows.forEach(function(r) {
    var don = rapMapDonHangRow_(r);
    if (!don || !don.maMam) return;
    var hay = [don.nhaMay, don.maMam, don.maRap, don.tenSp, don.maChotNhaMay, don.trangThaiThanhToan].join(" ");
    if (q && !step2734Contains_(hay, q)) return;
    var daGiao = step2734Num_(don.tongDaGiao || don.soLuongGiao);
    var donGia = step2734Num_(don.donGiaNhaMay || don.donGia);
    var thanhTien = step2734Num_(don.thanhTienNhaMay || don.thanhTien) || (daGiao * donGia);
    var tt = step2734Text_(don.trangThaiThanhToan || don.trangThai);
    if (step2734Key_(tt).indexOf("roi") !== -1 || step2734Key_(tt).indexOf("da") !== -1) summary.daThanhToan++; else summary.chuaThanhToan++;
    summary.tongDaGiao += daGiao;
    summary.tongThanhTien += thanhTien;
    out.push({ maMam: don.maMam, nhaMay: don.nhaMay, maRap: don.maRap, tenSP: don.tenSp, daGiao: daGiao, donGia: donGia, thanhTien: thanhTien, trangThaiThanhToan: tt, maChotNhaMay: don.maChotNhaMay, trangThaiNhapKho: don.trangThaiNhapKho, ngayCat: don.ngayCat, capNhatCuoi: don.capNhatCuoi });
  });
  summary.total = out.length;
  out.sort(function(a,b){ return step2734Key_(a.nhaMay).localeCompare(step2734Key_(b.nhaMay)); });
  return { ok: true, summary: summary, data: out };
}

function step34GetPhieuNhapRapList_(data) {
  var q = step2734Text_(data.q).toLowerCase();
  var limit = step2734Num_(data.limit || 200) || 200;
  var sh = step2734SafeSheet_("KHO", "tbl_Kho_PhieuNhap");
  var out = [];
  var summary = { total: 0, tongSoLuong: 0 };
  if (!sh || sh.getLastRow() < 2) return { ok: true, summary: summary, data: out };
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var loai = step2734Text_(rows[i][2]);
    var nguon = step2734Text_(rows[i][3]);
    var maThamChieu = step2734Text_(rows[i][4]);
    var ghiChu = step2734Text_(rows[i][9]);
    var hay = rows[i].join(" ");
    var isRap = step2734Key_(loai).indexOf("rap") !== -1 || step2734Key_(nguon).indexOf("rap") !== -1 || step2734Key_(maThamChieu).indexOf("mam") !== -1 || step2734Key_(ghiChu).indexOf("rap") !== -1;
    if (!isRap) continue;
    if (q && !step2734Contains_(hay, q)) continue;
    var sl = step2734Num_(rows[i][6]);
    out.push({ maPhieuNhap: step2734Text_(rows[i][0]), ngayNhap: step2734Text_(rows[i][1]), loaiNhap: loai, nguonNhap: nguon, maThamChieu: maThamChieu, khoNhap: step2734Text_(rows[i][5]), tongSoLuong: sl, trangThai: step2734Text_(rows[i][7]), nguoiNhap: step2734Text_(rows[i][8]), ghiChu: ghiChu });
    summary.tongSoLuong += sl;
  }
  out.sort(function(a,b){ return step2734ParseTime_(b.ngayNhap) - step2734ParseTime_(a.ngayNhap); });
  if (out.length > limit) out = out.slice(0, limit);
  summary.total = out.length;
  return { ok: true, summary: summary, data: out };
}

function step34GetPhieuNhapRapDetail_(data) {
  var maPhieu = step2734Text_(data.maPhieuNhap || data.maPhieu || data.q);
  if (!maPhieu) return { ok: false, message: "Thiếu mã phiếu nhập" };
  var listRes = step34GetPhieuNhapRapList_({ q: maPhieu, limit: 50 });
  var phieu = null;
  (listRes.data || []).forEach(function(p){ if (step2734Text_(p.maPhieuNhap) === maPhieu) phieu = p; });
  var shCT = step2734SafeSheet_("KHO", "tbl_Kho_PhieuNhap_CT");
  var details = [];
  if (shCT && shCT.getLastRow() >= 2) {
    var rows = shCT.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (step2734Text_(rows[i][0]) !== maPhieu) continue;
      details.push({ maHangNoiBo: step2734Text_(rows[i][1]), maBanHang: step2734Text_(rows[i][2]), maRap: step2734Text_(rows[i][3]), mau: step2734Text_(rows[i][4]), size: step2734Text_(rows[i][5]), khoNhap: step2734Text_(rows[i][6]), soLuong: step2734Num_(rows[i][7]), trangThaiHang: step2734Text_(rows[i][8]), ghiChu: step2734Text_(rows[i][9]) });
    }
  }
  return { ok: true, phieu: phieu, details: details, summary: { soDong: details.length, tongSoLuong: details.reduce(function(s,x){ return s + step2734Num_(x.soLuong); }, 0) } };
}


/****************************************************
 * PHẦN 30.1 - 40: LÀM RÕ CÔNG NỢ / ĐỐI SOÁT / DASHBOARD / CẢNH BÁO
 * - Ưu tiên chỉ đọc dữ liệu, không đổi cấu trúc sheet cũ
 * - PHẦN 39 dùng sheet mới tbl_Kho_YeuCauDieuChinhTon để duyệt điều chỉnh tồn
 ****************************************************/
function step3040DateText_(v) {
  if (!v) return "";
  var d = null;
  if (v instanceof Date && !isNaN(v.getTime())) d = v;
  else {
    var ms = step2734ParseTime_(v);
    if (ms) d = new Date(ms);
  }
  if (!d) return step2734Text_(v);
  return Utilities.formatDate(d, "GMT+7", "dd/MM/yyyy HH:mm");
}

function step3040LoaiNoLabel_(loai) {
  var k = step2734Key_(loai);
  if (k.indexOf("phat") !== -1 || k.indexOf("no") !== -1 || k.indexOf("chot") !== -1) return "Phát sinh nợ";
  if (k.indexOf("thanh") !== -1 || k.indexOf("tra tien") !== -1) return "Khách thanh toán";
  if (k.indexOf("tra_hang") !== -1 || k.indexOf("tra hang") !== -1 || k.indexOf("can tru") !== -1 || k.indexOf("hang tra") !== -1) return "Khách trả hàng / cấn trừ";
  if (k.indexOf("giam") !== -1) return "Giảm nợ";
  if (k.indexOf("tang") !== -1) return "Tăng nợ";
  return step2734Text_(loai) || "Công nợ";
}

function step3040GetCustomerDebtHistory_(data) {
  var res = step30GetCustomerDebtHistory_(data || {});
  if (!res || res.ok === false) return res;
  var summary = res.summary || {};
  var tamTinh = step2734Num_(summary.phatSinhTang) - step2734Num_(summary.phatSinhGiam);
  var noHeThong = step2734Num_(summary.soDuGanNhat);
  summary.noTamTinh = tamTinh;
  summary.noHeThong = noHeThong;
  summary.chenhLech = noHeThong - tamTinh;
  summary.coLech = Math.abs(summary.chenhLech) > 1;
  summary.giaiThich = summary.coLech
    ? "Còn nợ tạm tính từ lịch sử giao dịch đang lệch với số dư hệ thống. Cần kiểm tra dòng cũ hoặc dữ liệu nhập tay."
    : "Còn nợ tạm tính khớp với số dư hệ thống.";
  var dataOut = (res.data || []).map(function(x) {
    var soTien = step2734Num_(x.soTien);
    return {
      source: x.source,
      time: x.time,
      timeText: step3040DateText_(x.time),
      maKH: x.maKH,
      tenKhach: x.tenKhach,
      loai: x.loai,
      loaiText: step3040LoaiNoLabel_(x.loai),
      huong: soTien >= 0 ? "TĂNG NỢ" : "GIẢM NỢ",
      soTien: soTien,
      ghiChu: x.ghiChu,
      nguoi: x.nguoi,
      maChungTu: x.maChungTu
    };
  });
  return { ok: true, summary: summary, data: dataOut };
}

function step3040RapStatus_(x) {
  var kh = step2734Num_(x.tongKeHoach);
  var giao = step2734Num_(x.daGiao);
  var nhap = step2734Num_(x.daNhapKho);
  var alerts = [];
  var status = "Khớp đủ";
  var level = "success";

  if (giao <= 0) {
    status = "Chưa nhận hàng";
    level = "warning";
    alerts.push("Mâm chưa có số lượng nhà may giao.");
  }
  if (giao > 0 && nhap <= 0) {
    status = "Chờ nhập kho";
    level = "warning";
    alerts.push("Nhà may đã giao " + giao + " cái nhưng chưa nhập kho thành phẩm.");
  }
  if (giao > 0 && nhap > 0 && nhap === giao) {
    status = "Đã nhập phần đã giao";
    level = "success";
  }
  if (nhap > 0 && giao > 0 && nhap !== giao) {
    status = "Lệch giao / nhập";
    level = "danger";
    alerts.push("Đã giao " + giao + " nhưng đã nhập kho " + nhap + ", lệch " + (giao - nhap) + " cái.");
  }
  if (kh > 0 && giao < kh) {
    level = level === "danger" ? "danger" : "warning";
    alerts.push("Thiếu kế hoạch " + (kh - giao) + " cái.");
  }
  if (kh > 0 && giao === kh && nhap === kh) {
    status = "Khớp đủ";
    level = "success";
  }
  if (kh > 0 && giao > kh) {
    level = "danger";
    alerts.push("Giao dư kế hoạch " + (giao - kh) + " cái.");
  }
  if (alerts.length && status === "Khớp đủ") status = "Có cảnh báo";
  return { statusText: status, level: level, canhBaoText: alerts.join(" ") };
}

function step3040DecorateRapList_(res) {
  if (!res || res.ok === false) return res;
  var summary = res.summary || {};
  var list = (res.data || []).map(function(x) {
    var st = step3040RapStatus_(x);
    x.statusText = st.statusText;
    x.level = st.level;
    x.canhBaoText = st.canhBaoText || x.canhBao || "";
    x.coCanhBao = !!x.canhBaoText;
    var dg = step2734Num_(x.donGiaNhaMay || x.donGia);
    var tt = step2734Num_(x.thanhTien || x.thanhTienNhaMay);
    x.donGiaText = dg > 0 ? String(dg) : "Chưa có đơn giá";
    x.thanhTienText = tt > 0 ? String(tt) : "Chưa có đơn giá";
    return x;
  });
  summary.soCanhBao = list.filter(function(x){ return x.coCanhBao; }).length;
  summary.canLocCanhBao = true;
  return { ok: true, summary: summary, data: list };
}

function step3040GetDoiSoatNhapKhoRap_(data) {
  return step3040DecorateRapList_(step31GetDoiSoatNhapKhoRap_(data || {}));
}
function step3040GetBaoCaoLechRap_(data) {
  return step3040DecorateRapList_(step32GetBaoCaoLechRap_(data || {}));
}
function step3040GetDoiSoatCongNhaMay_(data) {
  var res = step33GetDoiSoatCongNhaMay_(data || {});
  if (!res || res.ok === false) return res;
  var list = (res.data || []).map(function(x) {
    var dg = step2734Num_(x.donGia);
    var tt = step2734Num_(x.thanhTien);
    x.donGiaText = dg > 0 ? String(dg) : "Chưa có đơn giá";
    x.thanhTienText = tt > 0 ? String(tt) : "Chưa có đơn giá";
    x.level = tt > 0 ? "success" : "warning";
    x.statusText = tt > 0 ? "Có công" : "Chưa có đơn giá";
    x.canhBaoText = tt > 0 ? "" : "Mâm này chưa có đơn giá/thành tiền công nhà may.";
    x.coCanhBao = !!x.canhBaoText;
    return x;
  });
  var s = res.summary || {};
  s.soCanhBao = list.filter(function(x){ return x.coCanhBao; }).length;
  return { ok: true, summary: s, data: list };
}

function step35GetDashboardTong_(data) {
  var summary = {
    tongTon: 0, khaDung: 0, dangGiu: 0, choKiem: 0, hangLoi: 0,
    soMaTon: 0, mamChoNhap: 0, mamCanhBao: 0, congNhaMayChuaTT: 0,
    congNhaMayTien: 0, canhBaoDuLieu: 0
  };
  var topTon = [];
  try {
    var shTon = step2734SafeSheet_("KHO", "tbl_Kho_Ton");
    if (shTon && shTon.getLastRow() >= 2) {
      var rows = shTon.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        var ton = step2734Num_(rows[i][8]);
        var giu = step2734Num_(rows[i][9]);
        var kd = step2734Num_(rows[i][10]);
        var cho = step2734Num_(rows[i][11]);
        var loi = step2734Num_(rows[i][13]);
        summary.tongTon += ton;
        summary.dangGiu += giu;
        summary.khaDung += kd;
        summary.choKiem += cho;
        summary.hangLoi += loi;
        if (step2734Text_(rows[i][0])) summary.soMaTon++;
        topTon.push({ maHangNoiBo: step2734Text_(rows[i][0]), maBanHang: step2734Text_(rows[i][1]), kho: step2734Text_(rows[i][2]), mau: step2734Text_(rows[i][6]), size: step2734Text_(rows[i][7]), ton: ton, khaDung: kd, giu: giu, loi: loi, cho: cho });
      }
    }
  } catch (eTon) {}
  topTon.sort(function(a,b){ return step2734Num_(b.khaDung) - step2734Num_(a.khaDung); });

  try {
    var rap = step3040GetDoiSoatNhapKhoRap_({ limit: 1000 });
    summary.mamChoNhap = step2734Num_(rap.summary && rap.summary.choNhapKho);
    summary.mamCanhBao = step2734Num_(rap.summary && rap.summary.soCanhBao);
  } catch (eRap) {}
  try {
    var cong = step3040GetDoiSoatCongNhaMay_({ limit: 1000 });
    summary.congNhaMayChuaTT = step2734Num_(cong.summary && cong.summary.chuaThanhToan);
    summary.congNhaMayTien = step2734Num_(cong.summary && cong.summary.tongThanhTien);
  } catch (eCong) {}
  try {
    var warn = step36GetDataWarnings_({ limit: 500 });
    summary.canhBaoDuLieu = step2734Num_(warn.summary && warn.summary.total);
  } catch (eWarn) {}
  return { ok: true, summary: summary, topTon: topTon.slice(0, 20) };
}

function step36GetDataWarnings_(data) {
  data = data || {};
  var q = step2734Text_(data.q);
  var limit = step2734Num_(data.limit || 300) || 300;
  if (limit < 50) limit = 50;
  if (limit > 1000) limit = 1000;

  var levelFilter = step2734Key_(data.level || "ALL");
  var groupFilter = step2734Key_(data.group || "ALL");
  var ngayGiu = step2734Num_(data.ngayGiu || data.soNgayGiu || 7) || 7;
  var nowMs = new Date().getTime();
  var dayMs = 24 * 60 * 60 * 1000;

  var warnings = [];
  var seenKey = {};
  var bienTheMap = {};
  var maBanHangMap = {};
  var anhMap = {};

  function isActiveBan_(v) {
    var k = step2734Key_(v || "Có");
    if (!k) return true;
    if (k.indexOf("khong") !== -1 || k.indexOf("ngung") !== -1 || k.indexOf("khoa") !== -1 || k.indexOf("off") !== -1) return false;
    return true;
  }

  function passFilter_(w) {
    if (levelFilter && levelFilter !== "all" && step2734Key_(w.level) !== levelFilter) return false;
    if (groupFilter && groupFilter !== "all" && step2734Key_(w.group) !== groupFilter) return false;
    if (q) {
      var hay = [w.level, w.group, w.title, w.detail, w.maLienQuan, w.kho, w.viTri, w.maBanHang].join(" ");
      if (!step2734Contains_(hay, q)) return false;
    }
    return true;
  }

  function pushWarn(level, group, title, detail, maLienQuan, extra) {
    extra = extra || {};
    var key = [level, group, title, maLienQuan, extra.kho || "", extra.viTri || "", detail].join("|");
    if (seenKey[key]) return;
    var w = {
      level: level,
      group: group,
      title: title,
      detail: detail,
      maLienQuan: maLienQuan || "",
      maBanHang: extra.maBanHang || "",
      kho: extra.kho || "",
      viTri: extra.viTri || "",
      tonThucTe: step2734Num_(extra.tonThucTe),
      tonGiu: step2734Num_(extra.tonGiu),
      khaDung: step2734Num_(extra.khaDung),
      choHoanThien: step2734Num_(extra.choHoanThien),
      hangLoi: step2734Num_(extra.hangLoi),
      capNhatCuoi: extra.capNhatCuoi || "",
      goiY: extra.goiY || "",
      sortKey: level === "danger" ? 1 : (level === "warning" ? 2 : 3)
    };
    if (!passFilter_(w)) return;
    seenKey[key] = true;
    warnings.push(w);
  }

  try {
    var shBT = step2734SafeSheet_("KHO", "tbl_Kho_BienThe");
    if (shBT && shBT.getLastRow() >= 2) {
      var bt = shBT.getDataRange().getValues();
      for (var b = 1; b < bt.length; b++) {
        var maNoiBo = step2734Text_(bt[b][0]);
        if (!maNoiBo) continue;
        var maBH = step2734Text_(bt[b][1]);
        bienTheMap[maNoiBo] = {
          maHangNoiBo: maNoiBo,
          maBanHang: maBH,
          maSP: step2734Text_(bt[b][2]),
          maRap: step2734Text_(bt[b][3]),
          mau: step2734Text_(bt[b][6]),
          size: step2734Text_(bt[b][7]),
          tenHienThi: step2734Text_(bt[b][8]),
          coBan: step2734Text_(bt[b][9] || "Có"),
          ghiChu: step2734Text_(bt[b][10])
        };
        if (maBH) maBanHangMap[maBH] = true;
      }
    }
  } catch (eBT) {}

  try {
    anhMap = (typeof khoGetAnhMaBanHangMap_ === "function") ? khoGetAnhMaBanHangMap_() : {};
  } catch (eAnh) { anhMap = {}; }

  try {
    var shTon = step2734SafeSheet_("KHO", "tbl_Kho_Ton");
    if (shTon && shTon.getLastRow() >= 2) {
      var rows = shTon.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        var ma = step2734Text_(rows[i][0]);
        if (!ma) continue;
        var maBanHang = step2734Text_(rows[i][1]);
        var kho = step2734Text_(rows[i][2]);
        var viTri = step2734Text_(rows[i][3]);
        var mau = step2734Text_(rows[i][6]);
        var size = step2734Text_(rows[i][7]);
        var ton = step2734Num_(rows[i][8]);
        var giu = step2734Num_(rows[i][9]);
        var kd = step2734Num_(rows[i][10]);
        var cho = step2734Num_(rows[i][11]);
        var loi = step2734Num_(rows[i][13]);
        var capNhat = rows[i][14];
        var capNhatText = step2734Text_(capNhat);
        var expectedKD = Math.max(ton - giu, 0);
        var baseExtra = { maBanHang: maBanHang, kho: kho, viTri: viTri, tonThucTe: ton, tonGiu: giu, khaDung: kd, choHoanThien: cho, hangLoi: loi, capNhatCuoi: capNhatText };
        var tenDong = ma + (maBanHang ? " / " + maBanHang : "") + (kho ? " | " + kho : "") + (viTri ? " | " + viTri : "") + (mau || size ? " | " + [mau, size].filter(function(x){return x;}).join(" ") : "");

        if (!kho) pushWarn("warning", "KHO", "Dòng tồn chưa có kho", tenDong + " chưa ghi kho. Nên bổ sung kho để xuất/giữ đúng vị trí.", ma, Object.assign({}, baseExtra, { goiY: "Bổ sung kho hoặc chuyển về KHO CHÍNH." }));
        if (ton < 0) pushWarn("danger", "KHO", "Tồn thật bị âm", tenDong + " đang có Tồn thực tế = " + ton + ".", ma, Object.assign({}, baseExtra, { goiY: "Kiểm tra xuất kho/chuyển kho/kiểm kê gần nhất." }));
        if (giu < 0) pushWarn("danger", "KHO", "Tồn giữ bị âm", tenDong + " đang có Tồn giữ = " + giu + ".", ma, baseExtra);
        if (kd < 0) pushWarn("danger", "KHO", "Khả dụng bị âm", tenDong + " đang có Khả dụng = " + kd + ".", ma, baseExtra);
        if (cho < 0) pushWarn("danger", "KHO", "Chờ kiểm bị âm", tenDong + " đang có Chờ kiểm = " + cho + ".", ma, baseExtra);
        if (loi < 0) pushWarn("danger", "KHO", "Hàng lỗi bị âm", tenDong + " đang có Hàng lỗi = " + loi + ".", ma, baseExtra);
        if (giu > ton) pushWarn("danger", "KHO", "Hàng giữ lớn hơn tồn thật", tenDong + " giữ " + giu + " nhưng tồn thật chỉ " + ton + ".", ma, Object.assign({}, baseExtra, { goiY: "Kiểm tra đơn đang giữ hoặc hủy giữ sai." }));
        if (kd !== expectedKD) pushWarn("warning", "KHO", "Khả dụng lệch công thức", tenDong + " Khả dụng = " + kd + ", đúng ra phải là " + expectedKD + " theo Tồn thực tế - Tồn giữ.", ma, Object.assign({}, baseExtra, { goiY: "Chạy kiểm kê/đồng bộ lại khả dụng." }));

        if (!bienTheMap[ma]) {
          pushWarn("warning", "BIẾN THỂ", "Tồn có mã nhưng thiếu biến thể", tenDong + " có tồn trong tbl_Kho_Ton nhưng không tìm thấy trong tbl_Kho_BienThe.", ma, Object.assign({}, baseExtra, { goiY: "Tạo lại biến thể hoặc kiểm tra mã nhập sai." }));
        } else if (!isActiveBan_(bienTheMap[ma].coBan) && (ton > 0 || kd > 0 || giu > 0)) {
          pushWarn("warning", "BIẾN THỂ", "Mã ngừng bán vẫn còn tồn bán được", tenDong + " đang ngừng bán nhưng còn tồn/khả dụng/giữ.", ma, Object.assign({}, baseExtra, { goiY: "Bật bán lại, chuyển kho, hoặc xuất xử lý nếu không bán nữa." }));
        }

        if (maBanHang && maBanHangMap[maBanHang] && (ton > 0 || kd > 0) && (!anhMap[maBanHang] || !step2734Text_(anhMap[maBanHang].linkAnhChinh))) {
          pushWarn("info", "ẢNH MÃ", "Mã bán hàng có tồn nhưng chưa có ảnh", maBanHang + " đang có hàng nhưng chưa gắn ảnh chính.", ma, Object.assign({}, baseExtra, { goiY: "Gắn ảnh để nhân viên chọn đúng mẫu/màu." }));
        }

        var lastMs = step2734ParseTime_(capNhat);
        var ageDays = lastMs ? Math.floor((nowMs - lastMs) / dayMs) : 0;
        if (giu > 0) {
          var lvGiu = ageDays >= ngayGiu ? "warning" : "info";
          pushWarn(lvGiu, "HÀNG GIỮ", ageDays >= ngayGiu ? "Hàng giữ lâu chưa xử lý" : "Đang có hàng giữ", tenDong + " đang giữ " + giu + " cái" + (ageDays ? ", cập nhật cách đây khoảng " + ageDays + " ngày." : "."), ma, Object.assign({}, baseExtra, { goiY: "Kiểm tra đơn đang giữ, chốt hoặc trả giữ nếu khách không lấy." }));
        }
        if (cho > 0) {
          var lvCho = ageDays >= ngayGiu ? "warning" : "info";
          pushWarn(lvCho, "CHỜ KIỂM", ageDays >= ngayGiu ? "Hàng chờ kiểm lâu chưa xử lý" : "Đang có hàng chờ kiểm", tenDong + " còn " + cho + " cái chờ kiểm/chờ hoàn thiện" + (ageDays ? ", cập nhật cách đây khoảng " + ageDays + " ngày." : "."), ma, Object.assign({}, baseExtra, { goiY: "Vào Hàng lỗi / Chờ kiểm để chuyển sang hàng tốt hoặc hàng lỗi." }));
        }
        if (loi > 0) {
          pushWarn("warning", "HÀNG LỖI", "Đang có hàng lỗi chưa xử lý", tenDong + " còn " + loi + " cái hàng lỗi.", ma, Object.assign({}, baseExtra, { goiY: "Sửa xong chuyển thành hàng tốt, hoặc xuất xử lý nếu bỏ/hoàn xưởng." }));
        }
      }
    }
  } catch (eTon) {}

  try {
    var shBT2 = step2734SafeSheet_("KHO", "tbl_Kho_BienThe");
    if (shBT2 && shBT2.getLastRow() >= 2) {
      var bt2 = shBT2.getDataRange().getValues();
      var maTonMap = {};
      try {
        var shT2 = step2734SafeSheet_("KHO", "tbl_Kho_Ton");
        if (shT2 && shT2.getLastRow() >= 2) {
          var tr = shT2.getDataRange().getValues();
          for (var t = 1; t < tr.length; t++) if (step2734Text_(tr[t][0])) maTonMap[step2734Text_(tr[t][0])] = true;
        }
      } catch (eTonMap) {}
      for (var bb = 1; bb < bt2.length; bb++) {
        var maBT = step2734Text_(bt2[bb][0]);
        var maBH2 = step2734Text_(bt2[bb][1]);
        if (!maBT) continue;
        if (isActiveBan_(bt2[bb][9]) && maBH2 && (!anhMap[maBH2] || !step2734Text_(anhMap[maBH2].linkAnhChinh))) {
          pushWarn("info", "ẢNH MÃ", "Mã đang bán chưa có ảnh", maBH2 + " đang bật bán nhưng chưa có ảnh chính.", maBT, { maBanHang: maBH2, goiY: "Gắn ảnh chính cho mã bán hàng." });
        }
        if (isActiveBan_(bt2[bb][9]) && !maTonMap[maBT]) {
          pushWarn("info", "BIẾN THỂ", "Biến thể đang bán chưa có dòng tồn", maBT + " đang bật bán nhưng chưa có dòng tồn trong tbl_Kho_Ton.", maBT, { maBanHang: maBH2, goiY: "Không bắt buộc, nhưng nên nhập kho hoặc kiểm tra mã nếu đang bán." });
        }
      }
    }
  } catch (eBT2) {}

  try {
    var rap = step3040GetDoiSoatNhapKhoRap_({ limit: 1000 });
    (rap.data || []).forEach(function(x) {
      if (x.coCanhBao) {
        pushWarn(x.level === "danger" ? "danger" : "warning", "RẬP", "Mâm rập có cảnh báo", x.maMam + ": " + x.canhBaoText, x.maMam, { goiY: "Đối soát lại kế hoạch, đã giao, còn thiếu và trạng thái nhập kho." });
      }
    });
  } catch (eRap) {}

  warnings.sort(function(a, b) {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    return String(a.group || "").localeCompare(String(b.group || ""), "vi");
  });
  var summaryAll = { totalBeforeLimit: warnings.length, total: 0, danger: 0, warning: 0, info: 0, byGroup: {} };
  warnings.forEach(function(w) {
    summaryAll[w.level] = (summaryAll[w.level] || 0) + 1;
    summaryAll.byGroup[w.group] = (summaryAll.byGroup[w.group] || 0) + 1;
  });
  if (warnings.length > limit) warnings = warnings.slice(0, limit);
  summaryAll.total = warnings.length;
  return { ok: true, summary: summaryAll, data: warnings };
}

function step37GetTraceCenter_(data) {
  var q = step2734Text_(data && data.q);
  var limit = step2734Num_(data && data.limit || 300) || 300;
  if (!q) return { ok: false, message: "Nhập mã hóa đơn / mã rập / mã mâm / khách / nhân viên cần truy vết" };
  var events = [];
  function addEvent(source, time, title, detail, maLienQuan, raw) {
    var hay = [source, time, title, detail, maLienQuan, JSON.stringify(raw || {})].join(" ");
    if (!step2734Contains_(hay, q)) return;
    events.push({ source: source, time: time, timeText: step3040DateText_(time), title: title, detail: detail, maLienQuan: maLienQuan, raw: raw || {}, sortMs: step2734ParseTime_(time) });
  }
  try {
    var shA = auditEnsureSheet_();
    var aRows = shA.getDataRange().getValues();
    for (var a = 1; a < aRows.length; a++) addEvent("APP", aRows[a][1], step2734Text_(aRows[a][4] || aRows[a][2]), step2734Text_(aRows[a][10]), step2734Text_(aRows[a][5]), { type: aRows[a][2], payload: aRows[a][11], ketQua: aRows[a][12] });
  } catch (eA) {}
  try {
    var shTK = step2734SafeSheet_("KHO", "tbl_Kho_TheKho");
    if (shTK && shTK.getLastRow() >= 2) {
      var kRows = shTK.getDataRange().getValues();
      for (var k = 1; k < kRows.length; k++) addEvent("KHO", kRows[k][1], step2734Text_(kRows[k][2]), "Mã " + step2734Text_(kRows[k][4]) + " | SL " + step2734Num_(kRows[k][7]) + " | Tồn sau " + step2734Num_(kRows[k][8]), step2734Text_(kRows[k][3]), { row: kRows[k] });
    }
  } catch (eK) {}
  try {
    var shNo = step2734SafeSheet_("TAI_CHINH", "tbl_NhatKyNo");
    if (shNo && shNo.getLastRow() >= 2) {
      var nRows = shNo.getDataRange().getValues();
      for (var n = 1; n < nRows.length; n++) addEvent("CÔNG NỢ", nRows[n][2], step3040LoaiNoLabel_(nRows[n][3]), step2734Text_(nRows[n][1]) + " | " + step2734Num_(nRows[n][4]) + " | " + step2734Text_(nRows[n][5]), step2734Text_(nRows[n][7]), { row: nRows[n] });
    }
  } catch (eN) {}
  try {
    var shRap = rapEnsureRapDonHangSheet_();
    var rRows = shRap.getRange(2,1,Math.max(shRap.getLastRow()-1,0),Math.max(shRap.getLastColumn(), RAP_DON_HEADERS.length)).getValues();
    rRows.forEach(function(r) { var don = rapMapDonHangRow_(r); if (!don || !don.maMam) return; addEvent("RẬP", don.ngayTao || don.capNhatCuoi, "Mâm rập " + don.maMam, [don.nhaMay, don.maRap, don.tenSp, "KH " + don.tongKeHoach, "Giao " + don.tongDaGiao, don.trangThaiNhapKho].join(" | "), don.maMam, don); });
  } catch (eR) {}
  events.sort(function(a,b){ return (b.sortMs || 0) - (a.sortMs || 0); });
  if (events.length > limit) events = events.slice(0, limit);
  return { ok: true, summary: { total: events.length }, data: events.map(function(x){ delete x.sortMs; return x; }) };
}

function step38GetKiemKePhieuList_(data) {
  var q = step2734Text_(data && data.q);
  var limit = step2734Num_(data && data.limit || 200) || 200;
  var map = {};
  try {
    var sh = step2734SafeSheet_("KHO", "tbl_Kho_TheKho");
    if (sh && sh.getLastRow() >= 2) {
      var rows = sh.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        var loai = step2734Text_(rows[i][2]);
        if (step2734Key_(loai).indexOf("kiem") === -1 && step2734Key_(loai).indexOf("dieu_chinh") === -1) continue;
        var maCT = step2734Text_(rows[i][3]) || step2734Text_(rows[i][0]);
        var hay = rows[i].join(" ");
        if (q && !step2734Contains_(hay, q)) continue;
        if (!map[maCT]) map[maCT] = { maPhieu: maCT, ngay: step2734Text_(rows[i][1]), nguoi: step2734Text_(rows[i][9]), soDong: 0, tongTang: 0, tongGiam: 0, items: [] };
        var sl = step2734Num_(rows[i][7]);
        map[maCT].soDong++;
        if (sl > 0) map[maCT].tongTang += sl; else map[maCT].tongGiam += Math.abs(sl);
        map[maCT].items.push({ maHangNoiBo: step2734Text_(rows[i][4]), maBanHang: step2734Text_(rows[i][5]), kho: step2734Text_(rows[i][6]), lech: sl, tonSau: step2734Num_(rows[i][8]), ghiChu: step2734Text_(rows[i][10]) });
      }
    }
  } catch (e) {}
  var list = Object.keys(map).map(function(k){ return map[k]; });
  list.sort(function(a,b){ return step2734ParseTime_(b.ngay) - step2734ParseTime_(a.ngay); });
  if (list.length > limit) list = list.slice(0, limit);
  return { ok: true, summary: { total: list.length, tongDong: list.reduce(function(s,x){return s+x.soDong;},0) }, data: list };
}

function step39EnsureYeuCauDCTonSheet_() {
  var headers = ["MaYeuCau","ThoiGianTao","NguoiTao","MaHangNoiBo","Kho","ViTri","TonCu","TonMoi","Lech","LyDo","TrangThai","NguoiDuyet","ThoiGianDuyet","GhiChuDuyet","MaChungTuKiemKe"];
  var ss = getSS_("KHO");
  var sh = ss.getSheetByName("tbl_Kho_YeuCauDieuChinhTon");
  if (!sh) sh = ss.insertSheet("tbl_Kho_YeuCauDieuChinhTon");
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  var first = sh.getRange(1,1,1,headers.length).getValues()[0];
  var empty = first.every(function(v){ return !step2734Text_(v); });
  if (empty) { sh.getRange(1,1,1,headers.length).setValues([headers]); sh.setFrozenRows(1); }
  return sh;
}
function step39FindTonRow_(ma, kho, viTri) {
  var sh = step2734SafeSheet_("KHO", "tbl_Kho_Ton");
  if (!sh || sh.getLastRow() < 2) return null;
  var rows = sh.getDataRange().getValues();
  for (var i=1;i<rows.length;i++) {
    if (step2734Text_(rows[i][0]) !== step2734Text_(ma)) continue;
    if (kho && step2734Text_(rows[i][2]) !== step2734Text_(kho)) continue;
    if (viTri && step2734Text_(rows[i][3]) !== step2734Text_(viTri)) continue;
    return { rowIndex: i+1, row: rows[i], tonCu: step2734Num_(rows[i][8]) };
  }
  return null;
}
function step39CreateYeuCauDCTon_(data) {
  var ma = step2734Text_(data.maHangNoiBo);
  var tonMoi = step2734Num_(data.tonMoi);
  var kho = step2734Text_(data.kho);
  var viTri = step2734Text_(data.viTri);
  if (!ma) return { ok:false, message:"Thiếu mã hàng nội bộ" };
  if (tonMoi < 0) return { ok:false, message:"Tồn mới không được âm" };
  var found = step39FindTonRow_(ma, kho, viTri);
  if (!found) return { ok:false, message:"Không tìm thấy dòng tồn cần điều chỉnh" };
  var maYC = khoMakeId_("YCDC-");
  var now = nowVN_();
  var sh = step39EnsureYeuCauDCTonSheet_();
  sh.appendRow([maYC, now, step2734Text_(data.nguoi || data.user || "app"), ma, kho, viTri, found.tonCu, tonMoi, tonMoi - found.tonCu, step2734Text_(data.lyDo || data.ghiChu), "CHỜ DUYỆT", "", "", "", ""]);
  return { ok:true, message:"Đã tạo yêu cầu điều chỉnh tồn", maYeuCau: maYC, tonCu: found.tonCu, tonMoi: tonMoi, lech: tonMoi - found.tonCu };
}
function step39GetYeuCauDCTonList_(data) {
  var q = step2734Text_(data && data.q);
  var status = step2734Text_(data && data.trangThai || "ALL");
  var sh = step39EnsureYeuCauDCTonSheet_();
  var rows = sh.getDataRange().getValues();
  var out = [];
  for (var i=1;i<rows.length;i++) {
    var hay = rows[i].join(" ");
    if (q && !step2734Contains_(hay, q)) continue;
    if (status && status !== "ALL" && step2734Text_(rows[i][10]) !== status) continue;
    out.push({ rowIndex:i+1, maYeuCau:step2734Text_(rows[i][0]), thoiGianTao:step2734Text_(rows[i][1]), nguoiTao:step2734Text_(rows[i][2]), maHangNoiBo:step2734Text_(rows[i][3]), kho:step2734Text_(rows[i][4]), viTri:step2734Text_(rows[i][5]), tonCu:step2734Num_(rows[i][6]), tonMoi:step2734Num_(rows[i][7]), lech:step2734Num_(rows[i][8]), lyDo:step2734Text_(rows[i][9]), trangThai:step2734Text_(rows[i][10]), nguoiDuyet:step2734Text_(rows[i][11]), thoiGianDuyet:step2734Text_(rows[i][12]), ghiChuDuyet:step2734Text_(rows[i][13]), maChungTuKiemKe:step2734Text_(rows[i][14]) });
  }
  out.sort(function(a,b){ return step2734ParseTime_(b.thoiGianTao) - step2734ParseTime_(a.thoiGianTao); });
  return { ok:true, summary:{ total:out.length, choDuyet:out.filter(function(x){return x.trangThai==='CHỜ DUYỆT';}).length }, data:out };
}
function step39DuyetYeuCauDCTon_(data) {
  var maYC = step2734Text_(data.maYeuCau);
  var action = step2734Text_(data.action || "APPROVE").toUpperCase();
  var sh = step39EnsureYeuCauDCTonSheet_();
  var rows = sh.getDataRange().getValues();
  for (var i=1;i<rows.length;i++) {
    if (step2734Text_(rows[i][0]) !== maYC) continue;
    if (step2734Text_(rows[i][10]) !== "CHỜ DUYỆT") return { ok:false, message:"Yêu cầu này đã xử lý rồi" };
    var now = nowVN_();
    if (action === "REJECT") {
      sh.getRange(i+1, 11, 1, 4).setValues([["TỪ CHỐI", step2734Text_(data.nguoi || "app"), now, step2734Text_(data.ghiChuDuyet)]]);
      return { ok:true, message:"Đã từ chối yêu cầu" };
    }
    var resultText = auditTextOutputContent_(khoDieuChinhKiemKe_({ maHangNoiBo: rows[i][3], kho: rows[i][4], viTri: rows[i][5], tonMoi: rows[i][7], nguoi: data.nguoi || "app", ghiChu: "Duyệt yêu cầu " + maYC + ". " + step2734Text_(rows[i][9]) }));
    var parsed = safeParseJson_(resultText, {});
    if (!parsed.ok) return { ok:false, message: parsed.message || "Không điều chỉnh được tồn" };
    sh.getRange(i+1, 11, 1, 5).setValues([["ĐÃ DUYỆT", step2734Text_(data.nguoi || "app"), now, step2734Text_(data.ghiChuDuyet), parsed.maChungTu || ""]]);
    return { ok:true, message:"Đã duyệt và cập nhật tồn", result: parsed };
  }
  return { ok:false, message:"Không tìm thấy yêu cầu" };
}

function step40GetCongNoTong_(data) {
  var q = step2734Text_(data && data.q);
  var result = { khachHang: [], nhaMay: [], tong: { khachHang:0, nhaMay:0, tatCa:0 } };
  try {
    var shKH = step2734SafeSheet_("SALES", "tbl_KhachHang");
    if (shKH && shKH.getLastRow() >= 2) {
      var rows = shKH.getDataRange().getValues();
      for (var i=1;i<rows.length;i++) {
        var no = step2734Num_(rows[i][4]);
        var hay = rows[i].join(" ");
        if (q && !step2734Contains_(hay, q)) continue;
        if (Math.abs(no) <= 1) continue;
        result.khachHang.push({ maKH:step2734Text_(rows[i][0]), tenKhach:step2734Text_(rows[i][1]), sdt:step2734Text_(rows[i][2]), conNo:no, ghiChu:step2734Text_(rows[i][6]) });
        result.tong.khachHang += no;
      }
    }
  } catch(eKH) {}
  try {
    var cong = step3040GetDoiSoatCongNhaMay_({ q:q, limit:1000 });
    (cong.data || []).forEach(function(x){
      var tt = step2734Key_(x.trangThaiThanhToan);
      var tien = step2734Num_(x.thanhTien);
      if (tien <= 1) return;
      if (tt.indexOf("da") !== -1 || tt.indexOf("roi") !== -1) return;
      result.nhaMay.push({ nhaMay:x.nhaMay, maMam:x.maMam, maRap:x.maRap, daGiao:x.daGiao, thanhTien:tien, trangThai:x.trangThaiThanhToan || "Chưa thanh toán" });
      result.tong.nhaMay += tien;
    });
  } catch(eNM) {}
  result.tong.tatCa = result.tong.khachHang + result.tong.nhaMay;
  result.khachHang.sort(function(a,b){ return Math.abs(b.conNo)-Math.abs(a.conNo); });
  result.nhaMay.sort(function(a,b){ return b.thanhTien-a.thanhTien; });
  return { ok:true, summary:{ khachHang:result.khachHang.length, nhaMay:result.nhaMay.length, tongKhachHang:result.tong.khachHang, tongNhaMay:result.tong.nhaMay, tongTatCa:result.tong.tatCa }, data:result };
}


/****************************************************
 * AZALAS - GÓI QUẢN TRỊ TỔNG HỢP
 * - Dashboard chủ hệ thống
 * - Nhật ký thao tác
 * - Sao lưu dữ liệu
 * - Công nợ khách / công nợ rập
 * - Giá vốn / báo cáo lợi nhuận
 * Chỉ bổ sung API riêng, không thay luồng kho/rập/đơn hàng hiện có.
 ****************************************************/
function azMngText_(v) {
  return String(v === null || v === undefined ? "" : v).trim();
}
function azMngNum_(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  var s = String(v).replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  var n = Number(s);
  return isNaN(n) ? 0 : n;
}
function azMngNow_() {
  return Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
}
function azMngToday_() {
  return Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy");
}
function azMngMakeId_(prefix) {
  return prefix + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMddHHmmss") + "-" + Math.floor(Math.random() * 1000);
}
function azMngHeaderMap_(headers) {
  var map = {};
  (headers || []).forEach(function(h, i) {
    var k = azMngText_(h).toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/Đ/g, "D")
      .replace(/[^A-Z0-9]+/g, "");
    if (k) map[k] = i;
  });
  return map;
}
function azMngPick_(row, map, names, fallbackIndex) {
  for (var i = 0; i < names.length; i++) {
    var key = String(names[i]).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/Đ/g, "D").replace(/[^A-Z0-9]+/g, "");
    if (map && map[key] !== undefined) return row[map[key]];
  }
  return fallbackIndex !== undefined ? row[fallbackIndex] : "";
}
function azMngRows_(fileKey, sheetName, limit) {
  try {
    var sh = getSheet_(fileKey, sheetName);
    var values = sh.getDataRange().getValues();
    if (!values || values.length < 1) return { headers: [], map: {}, rows: [] };
    var headers = values[0];
    var rows = values.slice(1).filter(function(r) { return r.some(function(c) { return azMngText_(c) !== ""; }); });
    if (limit && rows.length > limit) rows = rows.slice(Math.max(0, rows.length - limit));
    return { headers: headers, map: azMngHeaderMap_(headers), rows: rows };
  } catch (err) {
    return { headers: [], map: {}, rows: [], error: err.message };
  }
}
function azMngEnsureSheet_(fileKey, sheetName, headers) {
  var ss = getSS_(fileKey);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var empty = first.every(function(v) { return azMngText_(v) === ""; });
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function azMngRolesOf_(user) {
  user = azMngText_(user);
  if (!user) return ["MEMBER"];
  try {
    var sh = getSheet_("SYSTEM", "tbl_TaiKhoan");
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (azMngText_(rows[i][0]).toUpperCase() === user.toUpperCase()) {
        var roleText = azMngText_(rows[i][3] || "MEMBER").toUpperCase()
          .replace(/[;|\/\\]+/g, ",").replace(/\s+/g, ",").replace(/,+/g, ",");
        var out = roleText.split(",").map(function(x) { return azMngText_(x); }).filter(Boolean);
        return out.length ? out : ["MEMBER"];
      }
    }
  } catch (err) {}
  return ["MEMBER"];
}
function azMngIsFull_(user) {
  var roles = azMngRolesOf_(user).join(",");
  return roles.indexOf("OWNER") !== -1 || roles.indexOf("ADMIN") !== -1;
}
function azMngAssertFull_(data) {
  var actor = azMngText_(data.actorUser || data.user || data.currentUser);
  if (!azMngIsFull_(actor)) throw new Error("Tài khoản chưa có quyền quản trị chức năng này");
}

function azMngIsOwner_(user) {
  return azMngRolesOf_(user).indexOf("OWNER") !== -1;
}

function azMngOwnerDenied_(data) {
  var actor = azMngText_(data && (data.actorUser || data.user || data.currentUser));
  return !azMngIsOwner_(actor);
}
function azMngCostSheet_() {
  return azMngEnsureSheet_("KHO", "tbl_Kho_GiaVon", ["MaHangNoiBo", "MaBanHang", "GiaVon", "NguoiCapNhat", "CapNhatCuoi", "GhiChu"]);
}
function azMngFormKey_(code) {
  code = azMngText_(code).toUpperCase();
  if (!code) return "";
  code = code.replace(/\s+/g, "");
  var parts = code.split("-").filter(function(x) { return x; });
  return parts.length ? parts[0] : code;
}
function azMngCostMap_() {
  var map = {};

  // 1) Giá vốn mặc định theo Mã rập từ RAP > MaRap > GiaVon
  // Ví dụ MaRap 859DUI có GiaVon 52000 => FORM:859DUI = 52000
  try {
    var shRap = getSheet_("RAP", "MaRap");
    var rowsRap = shRap.getDataRange().getValues();

    if (rowsRap.length > 1) {
      var headerRap = rowsRap[0].map(function(h) {
        return azMngText_(h).toLowerCase().replace(/\s+/g, "");
      });

      var idxMaRap = headerRap.indexOf("marap");
      var idxGiaVon = headerRap.indexOf("giavon");

      if (idxMaRap < 0) idxMaRap = 0;   // A: MaRap
      if (idxGiaVon < 0) idxGiaVon = 2; // C: GiaVon

      for (var r = 1; r < rowsRap.length; r++) {
        var maRap = azMngFormKey_(rowsRap[r][idxMaRap]);
        var giaVonRap = azMngNum_(rowsRap[r][idxGiaVon]);
        // V54: giá vốn nhập 45 thì giữ nguyên là 45, không tự đổi thành 45.000.
        if (maRap && giaVonRap > 0) {
          map["FORM:" + maRap] = giaVonRap;
        }
      }
    }
  } catch (errRapGiaVon) {}

  // 2) Giá vốn chỉnh tay trong KHO > tbl_Kho_GiaVon
  // Bảng này được ưu tiên ghi đè giá vốn mặc định từ MaRap.
  try {
    var sh = azMngCostSheet_();
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var maNB = azMngText_(rows[i][0]).toUpperCase();
      var maBH = azMngText_(rows[i][1]).toUpperCase();
      var gia = azMngNum_(rows[i][2]);
      // V54: giá vốn chỉnh tay nhập sao dùng vậy, không tự nhân 1000.
      if (maNB && maNB.indexOf("-") === -1 && !maBH) {
        map["FORM:" + maNB] = gia;
      } else {
        if (maNB) map[maNB] = gia;
        if (maBH && map[maBH] === undefined) map[maBH] = gia;
      }
    }
  } catch (err) {}
  return map;
}
function azMngLookupCost_(cost, maNB, maBH, maRap) {
  maNB = azMngText_(maNB).toUpperCase();
  maBH = azMngText_(maBH).toUpperCase();
  maRap = azMngText_(maRap).toUpperCase();
  var form1 = azMngFormKey_(maRap || maNB || maBH);
  var form2 = azMngFormKey_(maNB);
  var form3 = azMngFormKey_(maBH);
  var exact = cost[maNB] || cost[maBH];
  if (exact !== undefined && exact !== null && exact !== "") return azMngNum_(exact);
  if (maRap && cost["FORM:" + maRap] !== undefined) return azMngNum_(cost["FORM:" + maRap]);
  if (form1 && cost["FORM:" + form1] !== undefined) return azMngNum_(cost["FORM:" + form1]);
  if (form2 && cost["FORM:" + form2] !== undefined) return azMngNum_(cost["FORM:" + form2]);
  if (form3 && cost["FORM:" + form3] !== undefined) return azMngNum_(cost["FORM:" + form3]);
  return 0;
}
function azMngCostSource_(cost, maNB, maBH, maRap) {
  maNB = azMngText_(maNB).toUpperCase();
  maBH = azMngText_(maBH).toUpperCase();
  maRap = azMngText_(maRap).toUpperCase();
  if (maNB && cost[maNB] !== undefined) return "Theo biến thể";
  if (maBH && cost[maBH] !== undefined) return "Theo mã bán";
  var f = azMngFormKey_(maRap || maNB || maBH);
  if (f && cost["FORM:" + f] !== undefined) return "Theo form " + f;
  return "Chưa có";
}
function azMngSaveCostPrice_(data) {
  azMngAssertFull_(data);
  var maNB = azMngText_(data.maHangNoiBo).toUpperCase();
  var maBH = azMngText_(data.maBanHang).toUpperCase();
  var maForm = azMngFormKey_(data.maForm || data.maRap || "");
  var phamVi = azMngText_(data.phamVi || data.scope).toUpperCase();
  var gia = azMngNum_(data.giaVon);
  if ((phamVi === "FORM" || data.apDungTheoForm === true || data.apDungTheoForm === "true") && !maForm) {
    maForm = azMngFormKey_(maNB || maBH);
  }
  if (phamVi === "FORM" || data.apDungTheoForm === true || data.apDungTheoForm === "true") {
    maNB = maForm;
    maBH = "";
  }
  if (!maNB && !maBH) return { ok: false, message: "Thiếu mã hàng hoặc mã form" };
  if (gia < 0) return { ok: false, message: "Giá vốn không hợp lệ" };
  var sh = azMngCostSheet_();
  var rows = sh.getDataRange().getValues();
  var row = -1;
  for (var i = 1; i < rows.length; i++) {
    var rNB = azMngText_(rows[i][0]).toUpperCase();
    var rBH = azMngText_(rows[i][1]).toUpperCase();
    if (!maBH && maNB && rNB === maNB && !rBH) { row = i + 1; break; }
    if (maBH && ((maNB && rNB === maNB) || (maBH && rBH === maBH))) { row = i + 1; break; }
    if (!maBH && maNB && rNB === maNB) { row = i + 1; break; }
  }
  var now = azMngNow_();
  var note = azMngText_(data.ghiChu);
  if (!maBH && maNB.indexOf("-") === -1 && note.indexOf("Theo form") === -1) note = (note ? note + " | " : "") + "Theo form " + maNB;
  var vals = [maNB, maBH, gia, azMngText_(data.actorUser || data.user || "app"), now, note];
  if (row === -1) sh.appendRow(vals); else sh.getRange(row, 1, 1, vals.length).setValues([vals]);
  return { ok: true, message: (!maBH && maNB.indexOf("-") === -1) ? ("Đã lưu giá vốn cho form " + maNB) : "Đã lưu giá vốn", data: { maHangNoiBo: maNB, maBanHang: maBH, maForm: maForm || azMngFormKey_(maNB), giaVon: gia } };
}
function azMngGetCostPriceList_(data) {
  var q = azMngText_(data.q).toLowerCase();
  var bt = azMngRows_("KHO", "tbl_Kho_BienThe", 5000);
  var cost = azMngCostMap_();
  var tonRows = azMngRows_("KHO", "tbl_Kho_Ton", 10000).rows;
  var tonMap = {};
  tonRows.forEach(function(r) {
    var k = azMngText_(r[0]);
    if (!k) return;
    tonMap[k] = (tonMap[k] || 0) + azMngNum_(r[8]);
  });
  var dataOut = [];
  bt.rows.forEach(function(r) {
    var maNB = azMngText_(r[0]);
    var maBH = azMngText_(r[1]);
    var maRap = azMngText_(r[3]);
    var item = {
      maHangNoiBo: maNB, maBanHang: maBH, maSP: azMngText_(r[2]), maRap: maRap, maForm: azMngFormKey_(maRap || maNB || maBH),
      hieu: azMngText_(r[5]), mau: azMngText_(r[6]), size: azMngText_(r[7]), tenHienThi: azMngText_(r[8]),
      coBan: azMngText_(r[9]), ton: tonMap[maNB] || 0,
      giaVon: azMngLookupCost_(cost, maNB, maBH, maRap), nguonGiaVon: azMngCostSource_(cost, maNB, maBH, maRap)
    };
    var hay = [item.maHangNoiBo, item.maBanHang, item.maRap, item.maForm, item.mau, item.size, item.tenHienThi].join(" ").toLowerCase();
    if (!q || hay.indexOf(q) !== -1) dataOut.push(item);
  });
  return { ok: true, data: dataOut.slice(0, azMngNum_(data.limit || 300) || 300) };
}


function azMngGetRapDebt_(data) {
  try {
    if (typeof step3040GetDoiSoatCongNhaMay_ === "function") {
      var r = step3040GetDoiSoatCongNhaMay_(data);
      return { ok: true, data: r.data || [], summary: r.summary || {} };
    }
  } catch (err) {}
  var nm = azMngRows_("RAP", "tbl_NhaMay_ThanhToan", 5000);
  var out = nm.rows.map(function(r){ return { thoiGian: r[0], nhaMay: r[1], maMam: r[2], soTien: azMngNum_(r[3]), trangThai: r[4], ghiChu: r[5] }; });
  return { ok: true, summary: { soDong: out.length }, data: out };
}
function azMngGetAppAudit_(data) {
  var log = azMngRows_("SYSTEM", "tbl_System_NhatKyThaoTac", azMngNum_(data.limit || 300) || 300);
  var rows = log.rows.map(function(r) {
    return { thoiGian: r[0], user: r[1], type: r[2], ok: r[3], message: r[4], ms: r[5] };
  }).reverse();
  return { ok: true, summary: { soDong: rows.length }, data: rows };
}
function azMngCleanFolderName_(name) {
  return azMngText_(name || "")
    .replace(/[\\\/\:\*\?"\<\>\|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 120) || "backup";
}
function azMngGetOrCreateChildFolder_(parentFolder, folderName) {
  folderName = azMngCleanFolderName_(folderName);
  var it = parentFolder.getFoldersByName(folderName);
  if (it.hasNext()) return it.next();
  return parentFolder.createFolder(folderName);
}
function azMngCreateBackup_(data) {
  azMngAssertFull_(data);
  var actor = azMngText_(data.actorUser || data.user || "app");
  var rootFolder = getFolder_("BACKUP_DU_LIEU_CU");
  var now = new Date();
  var dayFolderName = Utilities.formatDate(now, "GMT+7", "yyyy-MM-dd");
  var timeFolderName = Utilities.formatDate(now, "GMT+7", "HHmmss") + "_" + azMngCleanFolderName_(actor || "app");
  var dayFolder = azMngGetOrCreateChildFolder_(rootFolder, dayFolderName);
  var backupFolder = azMngGetOrCreateChildFolder_(dayFolder, timeFolderName);
  var stamp = Utilities.formatDate(now, "GMT+7", "yyyyMMdd_HHmmss");
  var copied = [];
  Object.keys(AZALAS_DATA_FILES).forEach(function(key) {
    try {
      var id = AZALAS_DATA_FILES[key];
      var f = DriveApp.getFileById(id);
      var copy = f.makeCopy("BACKUP_" + key + "_" + stamp, backupFolder);
      copied.push({ key: key, name: copy.getName(), url: copy.getUrl() });
    } catch (err) {
      copied.push({ key: key, error: err.message });
    }
  });
  try {
    var sh = azMngEnsureSheet_("SYSTEM", "tbl_System_BackupLog", ["MaBackup", "ThoiGian", "NguoiTao", "SoFile", "GhiChu", "FolderName", "FolderUrl", "JsonKetQua"]);
    var headerNeed = ["MaBackup", "ThoiGian", "NguoiTao", "SoFile", "GhiChu", "FolderName", "FolderUrl", "JsonKetQua"];
    var current = sh.getRange(1, 1, 1, headerNeed.length).getValues()[0];
    for (var h = 0; h < headerNeed.length; h++) {
      if (!azMngText_(current[h])) sh.getRange(1, h + 1).setValue(headerNeed[h]);
    }
    sh.appendRow([
      azMngMakeId_("BK-"),
      azMngNow_(),
      actor,
      copied.filter(function(x){ return !x.error; }).length,
      azMngText_(data.ghiChu),
      dayFolderName + "/" + timeFolderName,
      backupFolder.getUrl(),
      JSON.stringify(copied)
    ]);
  } catch (e) {}
  return { ok: true, message: "Đã tạo backup trong folder theo thời gian", folderName: dayFolderName + "/" + timeFolderName, folderUrl: backupFolder.getUrl(), data: copied };
}
function azMngGetBackupLog_(data) {
  var log = azMngRows_("SYSTEM", "tbl_System_BackupLog", azMngNum_(data.limit || 50) || 50);
  return { ok: true, data: log.rows.map(function(r){ return { ma: r[0], thoiGian: r[1], nguoiTao: r[2], soFile: r[3], ghiChu: r[4], folderName: r[5], folderUrl: r[6] }; }).reverse() };
}
function azMngGetOwnerDashboard_(data) {
  var orders = azMngRows_("SALES", "tbl_DonHang", 10000).rows;
  var ton = azMngRows_("KHO", "tbl_Kho_Ton", 10000).rows;
  var rap = azMngRows_("RAP", "tbl_Rap_DonHang", 5000).rows;
  var ycd = azMngRows_("KHO", "tbl_Kho_YeuCauDieuChinhTon", 5000).rows;
  var summary = {
    tongDon: orders.length,
    tonThucTe: 0, tonGiu: 0, khaDung: 0, choKiem: 0, hangLoi: 0,
    tongMamRap: rap.length,
    yeuCauDuyetTon: 0
  };
  ton.forEach(function(r){ summary.tonThucTe += azMngNum_(r[8]); summary.tonGiu += azMngNum_(r[9]); summary.khaDung += azMngNum_(r[10]); summary.choKiem += azMngNum_(r[11]); summary.hangLoi += azMngNum_(r[13]); });
  ycd.forEach(function(r){ var tt = azMngText_(r[12] || r[8]).toLowerCase(); if (tt.indexOf("duyệt") === -1 && tt.indexOf("từ chối") === -1) summary.yeuCauDuyetTon++; });
  var profit = azMngGetProfitReport_({ limit: 8 });
  var debt = azMngGetCustomerDebt_({ limit: 8 });
  return { ok: true, summary: summary, profit: profit.summary, topBan: profit.data.slice(0, 8), congNo: debt.summary, topNo: debt.data.slice(0, 8) };
}
function azMngGetAdminChecklist_(data) {
  return { ok: true, data: [
    { nhom: "Phân quyền", viec: "OWNER/ADMIN vào đủ menu, MEMBER chỉ thấy mục được cấp", uuTien: "Cao" },
    { nhom: "QL Rập MEMBER", viec: "MEMBER chỉ dùng NHẬP và LỊCH SỬ trong Xem đơn", uuTien: "Cao" },
    { nhom: "Dashboard", viec: "Chủ xem tổng đơn, tồn, rập, yêu cầu duyệt, top nợ", uuTien: "Cao" },
    { nhom: "Nhật ký", viec: "Xem thao tác quan trọng gần nhất", uuTien: "Cao" },
    { nhom: "Sao lưu", viec: "Tạo backup toàn bộ file dữ liệu vào Drive", uuTien: "Cao" },
    { nhom: "Công nợ", viec: "Xem công nợ khách và nhà may", uuTien: "Trung bình" },
    { nhom: "Giá vốn", viec: "Nhập giá vốn theo mã hàng để báo cáo lời", uuTien: "Cao" },
    { nhom: "Lợi nhuận", viec: "Kiểm tra doanh thu - giá vốn - lãi tạm tính", uuTien: "Cao" },
    { nhom: "Giao diện", viec: "Test PC và điện thoại sau khi thêm menu quản trị", uuTien: "Trung bình" }
  ] };
}


function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Azalas Sport Management')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1') // Thêm dòng này
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/****************************************************
 * AZALAS V46 SAFE CLIENT API
 * Cho Index gọi API nội bộ bằng google.script.run thay vì fetch WEB_APP_URL.
 * Fix lỗi fetch nhận HTML "<!DOCTYPE..." rồi res.json() bị vỡ.
 ****************************************************/
function azClientApiV46(data) {
  data = data || {};
  var raw = "";
  var parsed = null;
  var isJson = false;

  try {
    var out = doPost({
      postData: {
        contents: JSON.stringify(data)
      }
    });

    if (out && typeof out.getContent === "function") {
      raw = String(out.getContent());
    } else if (out !== null && out !== undefined) {
      raw = String(out);
    } else {
      raw = "";
    }

    try {
      parsed = JSON.parse(raw);
      isJson = true;
    } catch (parseErr) {
      parsed = null;
      isJson = false;
    }

    return {
      __azClientApiV46: true,
      ok: true,
      isJson: isJson,
      rawText: raw,
      data: parsed
    };
  } catch (err) {
    raw = JSON.stringify({
      ok: false,
      message: err && err.message ? err.message : String(err)
    });
    return {
      __azClientApiV46: true,
      ok: false,
      isJson: true,
      rawText: raw,
      data: {
        ok: false,
        message: err && err.message ? err.message : String(err)
      }
    };
  }
}


function azCtSoanStatsDate_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    var numberDate = new Date(value);
    return isNaN(numberDate.getTime()) ? null : numberDate;
  }
  var text = String(value).trim();
  var vn = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (vn) {
    return new Date(Number(vn[3]), Number(vn[2]) - 1, Number(vn[1]), Number(vn[4] || 0), Number(vn[5] || 0), Number(vn[6] || 0));
  }
  var iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] || 0), Number(iso[5] || 0), Number(iso[6] || 0));
  }
  var parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function azCtSoanStatsMonth_(value) {
  var text = azMngText_(value);
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  return Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM");
}

function azCtSoanStatsMonthOf_(value) {
  var date = azCtSoanStatsDate_(value);
  return date ? Utilities.formatDate(date, "GMT+7", "yyyy-MM") : "";
}

function azCtSoanStatsDisplayDate_(value) {
  var date = azCtSoanStatsDate_(value);
  return date ? Utilities.formatDate(date, "GMT+7", "dd/MM/yyyy HH:mm") : azMngText_(value);
}

function azCtSoanStatsStatusKey_(value) {
  return azMngText_(value).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function azCtOwnerSoanStats_(data) {
  if (azMngOwnerDenied_(data)) {
    return { ok: false, denied: true, message: "Chỉ tài khoản OWNER được xem thống kê người soạn." };
  }

  var month = azCtSoanStatsMonth_(data.month);
  // Đọc toàn bộ lịch sử để OWNER vẫn xem đúng các tháng cũ; azMngRows_ vốn đã
  // đọc toàn sheet nên giới hạn ở đây chỉ làm mất những đơn lâu năm.
  var obj = azMngRows_("SALES", "tbl_DonHang");
  if (obj.error) return { ok: false, message: "Không đọc được tbl_DonHang: " + obj.error };

  var employeeMap = {};
  var warehouseMap = {};
  var totals = { total: 0, completed: 0, inProgress: 0, employees: 0 };

  function getEmployee_(name) {
    var key = azMngText_(name).toUpperCase();
    if (!employeeMap[key]) {
      employeeMap[key] = {
        name: azMngText_(name), total: 0, completed: 0, inProgress: 0,
        byWarehouse: {}, orders: []
      };
    }
    return employeeMap[key];
  }

  (obj.rows || []).forEach(function(row) {
    var employeeName = azMngText_(azMngPick_(row, obj.map, ["NguoiSoan", "NguoiSoanHang"], 9));
    if (!employeeName) return;

    var status = azMngText_(azMngPick_(row, obj.map, ["TrangThai", "TrangThaiDon"], 6));
    var statusKey = azCtSoanStatsStatusKey_(status);
    var completedAt = azMngPick_(row, obj.map, ["GioSoanXong", "ThoiGianSoanXong", "NgaySoanXong"], 15);
    var updatedAt = azMngPick_(row, obj.map, ["CapNhatCuoi", "ThoiGianCapNhat"], 21);
    var isInProgress = /dang soan|dang xu ly|soan hang/.test(statusKey) && !completedAt;
    var kind = completedAt ? "completed" : (isInProgress ? "inProgress" : "");
    var countedAt = completedAt || (isInProgress ? updatedAt : "");
    if (!kind || azCtSoanStatsMonthOf_(countedAt) !== month) return;

    var warehouse = azMngText_(azMngPick_(row, obj.map, ["LoaiDon", "Kho", "KhoDon"], 3)) || "Khác";
    var employee = getEmployee_(employeeName);
    employee.total++;
    employee[kind]++;
    employee.byWarehouse[warehouse] = (employee.byWarehouse[warehouse] || 0) + 1;
    warehouseMap[warehouse] = (warehouseMap[warehouse] || 0) + 1;
    totals.total++;
    totals[kind]++;

    var date = azCtSoanStatsDate_(countedAt);
    employee.orders.push({
      maHoaDon: azMngText_(azMngPick_(row, obj.map, ["MaHoaDon", "MaDon", "MaHD"], 0)),
      tenKhach: azMngText_(azMngPick_(row, obj.map, ["TenKhach", "KhachHang"], 2)),
      warehouse: warehouse,
      status: kind === "completed" ? "Đã soạn" : "Đang soạn",
      currentStatus: status,
      countedAt: azCtSoanStatsDisplayDate_(countedAt),
      ngayGiao: azCtSoanStatsDisplayDate_(azMngPick_(row, obj.map, ["NgayGiao"], 4)).split(" ")[0],
      sortMs: date ? date.getTime() : 0
    });
  });

  var employees = Object.keys(employeeMap).map(function(key) {
    var item = employeeMap[key];
    item.orders.sort(function(a, b) { return b.sortMs - a.sortMs; });
    item.orders.forEach(function(order) { delete order.sortMs; });
    return item;
  }).sort(function(a, b) {
    return b.total - a.total || b.completed - a.completed || a.name.localeCompare(b.name);
  });

  var warehouses = Object.keys(warehouseMap).map(function(name) {
    return { name: name, total: warehouseMap[name] };
  }).sort(function(a, b) { return b.total - a.total || a.name.localeCompare(b.name); });

  totals.employees = employees.length;
  return {
    ok: true,
    month: month,
    generatedAt: Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss"),
    basis: "Đã soạn dùng GioSoanXong; Đang soạn dùng CapNhatCuoi.",
    summary: totals,
    warehouses: warehouses,
    employees: employees
  };
}

function doPost(e) {
  var startedAt = new Date();
  var data = {};
  var resultText = "";
  var okLog = true;
  var msgLog = "";

  try {
    data = JSON.parse((e && e.postData && e.postData.contents) ? e.postData.contents : "{}");
  } catch (parseErr) {
    data = { type: "PARSE_ERROR" };
  }

  // API riêng để xem nhật ký thao tác. Không ghi ngược lại vào nhật ký để tránh rác dữ liệu.
  if (auditText_(data.type) === "auditGetLogList") {
    try {
      return outJson_(auditGetLogList_(data));
    } catch (errAuditList) {
      return outJson_({ ok: false, message: "Lỗi tải nhật ký thao tác: " + errAuditList.message });
    }
  }

  // PHẦN 26: Xem lịch sử riêng theo hóa đơn / đơn hàng.
  // Chỉ đọc dữ liệu, không ghi ngược lại vào nhật ký.
  if (auditText_(data.type) === "auditGetHoaDonLog") {
    try {
      return outJson_(auditGetHoaDonLog_(data));
    } catch (errHoaDonLog) {
      return outJson_({ ok: false, message: "Lỗi tải lịch sử hóa đơn: " + errHoaDonLog.message });
    }
  }


  // PHẦN 30.1 - 40: API đã tối ưu giao diện và báo cáo tổng. Chỉ ghi dữ liệu ở PHẦN 39 khi tạo/duyệt yêu cầu.
  if (auditText_(data.type) === "debtGetCustomerHistory") {
    try { return outJson_(step3040GetCustomerDebtHistory_(data)); }
    catch (err3040A) { return outJson_({ ok:false, message:"Lỗi tải công nợ khách hàng: " + err3040A.message }); }
  }
  if (auditText_(data.type) === "rapGetDoiSoatNhapKho") {
    try { return outJson_(step3040GetDoiSoatNhapKhoRap_(data)); }
    catch (err3040B) { return outJson_({ ok:false, message:"Lỗi đối soát nhập kho rập: " + err3040B.message }); }
  }
  if (auditText_(data.type) === "rapGetLechKeHoachNhapKho") {
    try { return outJson_(step3040GetBaoCaoLechRap_(data)); }
    catch (err3040C) { return outJson_({ ok:false, message:"Lỗi báo cáo lệch rập/kho: " + err3040C.message }); }
  }
  if (auditText_(data.type) === "rapGetDoiSoatCongNhaMay") {
    try { return outJson_(step3040GetDoiSoatCongNhaMay_(data)); }
    catch (err3040D) { return outJson_({ ok:false, message:"Lỗi đối soát công nhà may: " + err3040D.message }); }
  }
  if (auditText_(data.type) === "dashGetKhoXuongTong") {
    try { return outJson_(step35GetDashboardTong_(data)); }
    catch (err35) { return outJson_({ ok:false, message:"Lỗi tải dashboard kho xưởng: " + err35.message }); }
  }
  if (auditText_(data.type) === "warnGetDataIssues") {
    try { return outJson_(step36GetDataWarnings_(data)); }
    catch (err36) { return outJson_({ ok:false, message:"Lỗi tải cảnh báo dữ liệu: " + err36.message }); }
  }
  if (auditText_(data.type) === "traceGetCenter") {
    try { return outJson_(step37GetTraceCenter_(data)); }
    catch (err37) { return outJson_({ ok:false, message:"Lỗi truy vết toàn hệ thống: " + err37.message }); }
  }
  if (auditText_(data.type) === "kiemKeGetPhieuList") {
    try { return outJson_(step38GetKiemKePhieuList_(data)); }
    catch (err38) { return outJson_({ ok:false, message:"Lỗi tải phiếu kiểm kê: " + err38.message }); }
  }
  if (auditText_(data.type) === "tonGetYeuCauDuyetList") {
    try { return outJson_(step39GetYeuCauDCTonList_(data)); }
    catch (err39A) { return outJson_({ ok:false, message:"Lỗi tải yêu cầu điều chỉnh tồn: " + err39A.message }); }
  }
  if (auditText_(data.type) === "tonCreateYeuCauDieuChinh") {
    try { return outJson_(step39CreateYeuCauDCTon_(data)); }
    catch (err39B) { return outJson_({ ok:false, message:"Lỗi tạo yêu cầu điều chỉnh tồn: " + err39B.message }); }
  }
  if (auditText_(data.type) === "tonDuyetYeuCauDieuChinh") {
    try { return outJson_(step39DuyetYeuCauDCTon_(data)); }
    catch (err39C) { return outJson_({ ok:false, message:"Lỗi duyệt yêu cầu điều chỉnh tồn: " + err39C.message }); }
  }
  if (auditText_(data.type) === "debtGetTongHopCongNo") {
    try { return outJson_(step40GetCongNoTong_(data)); }
    catch (err40) { return outJson_({ ok:false, message:"Lỗi tải báo cáo công nợ tổng: " + err40.message }); }
  }

  // CHI TIẾT ĐƠN / THỐNG KÊ NGƯỜI SOẠN - CHỈ OWNER.
  if (auditText_(data.type) === "getOwnerSoanThongKe") {
    try { return outJson_(azCtOwnerSoanStats_(data)); }
    catch (errCtStats) { return outJson_({ ok:false, message:"Lỗi tải thống kê người soạn: " + errCtStats.message }); }
  }

  var azMngResult = azMngHandleApi_(data);
  if (azMngResult) return azMngResult;

  // PHẦN 27-34: Các API xem truy vết/đối soát. Chỉ đọc dữ liệu nên không ghi log ngược lại.
  if (auditText_(data.type) === "auditGetDonHangFullLog") {
    try { return outJson_(step2734GetOrderFullLog_(data)); }
    catch (err2734A) { return outJson_({ ok:false, message:"Lỗi tải truy vết đơn hàng: " + err2734A.message }); }
  }
  if (auditText_(data.type) === "debtGetCustomerHistory") {
    try { return outJson_(step30GetCustomerDebtHistory_(data)); }
    catch (err2734B) { return outJson_({ ok:false, message:"Lỗi tải nhật ký công nợ: " + err2734B.message }); }
  }
  if (auditText_(data.type) === "rapGetDoiSoatNhapKho") {
    try { return outJson_(step31GetDoiSoatNhapKhoRap_(data)); }
    catch (err2734C) { return outJson_({ ok:false, message:"Lỗi đối soát nhập kho rập: " + err2734C.message }); }
  }
  if (auditText_(data.type) === "rapGetLechKeHoachNhapKho") {
    try { return outJson_(step32GetBaoCaoLechRap_(data)); }
    catch (err2734D) { return outJson_({ ok:false, message:"Lỗi báo cáo lệch rập/kho: " + err2734D.message }); }
  }
  if (auditText_(data.type) === "rapGetDoiSoatCongNhaMay") {
    try { return outJson_(step33GetDoiSoatCongNhaMay_(data)); }
    catch (err2734E) { return outJson_({ ok:false, message:"Lỗi đối soát công nhà may: " + err2734E.message }); }
  }
  if (auditText_(data.type) === "rapGetPhieuNhapKhoRapList") {
    try { return outJson_(step34GetPhieuNhapRapList_(data)); }
    catch (err2734F) { return outJson_({ ok:false, message:"Lỗi tải phiếu nhập rập: " + err2734F.message }); }
  }
  if (auditText_(data.type) === "rapGetPhieuNhapKhoRapDetail") {
    try { return outJson_(step34GetPhieuNhapRapDetail_(data)); }
    catch (err2734G) { return outJson_({ ok:false, message:"Lỗi tải chi tiết phiếu nhập rập: " + err2734G.message }); }
  }
  try {
    var result = doPostMain_(e);
    resultText = auditTextOutputContent_(result);
    var parsed = safeParseJson_(resultText, null);
    okLog = auditInferOk_(parsed, resultText);
    msgLog = auditInferMessage_(parsed, resultText);
    return result;
  } catch (err) {
    okLog = false;
    msgLog = err && err.message ? err.message : String(err);
    throw err;
  } finally {
    try {
      auditMaybeWrite_(data, okLog, msgLog, new Date().getTime() - startedAt.getTime(), resultText);
    } catch (logErr) {
      // Không để lỗi ghi nhật ký làm hỏng thao tác chính.
    }
  }
}


/****************************************************
 * GỢI Ý MÃ DÙNG CHUNG CHO Ô NHẬP
 * - Dùng cho các ô nhập mã hàng, mã bán hàng, mã rập, hóa đơn, khách hàng, kho/vị trí
 * - Chỉ đọc dữ liệu, không ghi/sửa/xóa dữ liệu
 ****************************************************/
function azSuggestText_(v) {
  return String(v === null || v === undefined ? "" : v).trim();
}

function azSuggestAdd_(bag, value, label) {
  value = azSuggestText_(value);
  if (!value) return;
  var key = value.toUpperCase();
  if (!bag._seen) bag._seen = {};
  if (bag._seen[key]) return;
  bag._seen[key] = true;
  bag.push({ v: value, l: azSuggestText_(label || "") });
}

function azSuggestSlice_(arr, limit) {
  var out = [];
  for (var i = 0; i < arr.length && out.length < limit; i++) {
    if (arr[i] && arr[i].v) out.push(arr[i]);
  }
  return out;
}

function azSuggestReadRows_(fileKey, sheetName, limitRows) {
  try {
    var sh = getSheet_(fileKey, sheetName);
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];
    var n = Math.min(Math.max(Number(limitRows) || 1500, 50), lastRow - 1);
    var start = Math.max(2, lastRow - n + 1);
    return sh.getRange(start, 1, n, lastCol).getValues();
  } catch (err) {
    return [];
  }
}

function azSuggestReadWithHeaders_(fileKey, sheetName, limitRows) {
  try {
    var sh = getSheet_(fileKey, sheetName);
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [] };
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(azSuggestText_);
    var n = Math.min(Math.max(Number(limitRows) || 1500, 50), Math.max(lastRow - 1, 0));
    if (n <= 0) return { headers: headers, rows: [] };
    var start = Math.max(2, lastRow - n + 1);
    return { headers: headers, rows: sh.getRange(start, 1, n, lastCol).getValues() };
  } catch (err) {
    return { headers: [], rows: [] };
  }
}

function azSuggestNormHeader_(v) {
  return azSuggestText_(v).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "");
}

function azSuggestHeaderIndex_(headers, names, fallback) {
  var map = {};
  for (var i = 0; i < headers.length; i++) map[azSuggestNormHeader_(headers[i])] = i;
  for (var j = 0; j < names.length; j++) {
    var key = azSuggestNormHeader_(names[j]);
    if (map[key] !== undefined) return map[key];
  }
  return fallback;
}

function azGetCodeSuggestions_(data) {
  var limit = Math.min(Math.max(Number(data && data.limit) || 700, 100), 1200);
  var rowsLimit = Math.min(Math.max(Number(data && data.rowsLimit) || 2200, 300), 5000);
  var s = {
    maHangNoiBo: [], maBanHang: [], maSP: [], maRap: [], mau: [], size: [],
    kho: [], viTri: [], maHoaDon: [], maKH: [], tenKhach: [], maMam: [],
    nhaMay: [], thoCat: [], ghiChu: []
  };

  // Kho - biến thể
  var bt = azSuggestReadRows_("KHO", "tbl_Kho_BienThe", rowsLimit);
  for (var i = bt.length - 1; i >= 0; i--) {
    var r = bt[i];
    azSuggestAdd_(s.maHangNoiBo, r[0], [r[8], r[6], r[7]].filter(String).join(" • "));
    azSuggestAdd_(s.maBanHang, r[1], [r[8], r[6], r[7]].filter(String).join(" • "));
    azSuggestAdd_(s.maSP, r[2], [r[4], r[5]].filter(String).join(" • "));
    azSuggestAdd_(s.maRap, r[3], [r[4], r[5]].filter(String).join(" • "));
    azSuggestAdd_(s.mau, r[6], r[8]);
    azSuggestAdd_(s.size, r[7], r[8]);
  }

  // Kho - hàng hóa
  var hh = azSuggestReadRows_("KHO", "tbl_Kho_HangHoa", rowsLimit);
  for (var h = hh.length - 1; h >= 0; h--) {
    var x = hh[h];
    azSuggestAdd_(s.maSP, x[0], [x[4], x[2], x[3]].filter(String).join(" • "));
    azSuggestAdd_(s.maRap, x[1], [x[4], x[2], x[3]].filter(String).join(" • "));
    azSuggestAdd_(s.mau, x[2], x[4]);
  }

  // Kho - tồn / kho / vị trí
  var ton = azSuggestReadRows_("KHO", "tbl_Kho_Ton", rowsLimit);
  for (var t = ton.length - 1; t >= 0; t--) {
    var y = ton[t];
    azSuggestAdd_(s.maHangNoiBo, y[0], [y[2], y[3], y[6], y[7]].filter(String).join(" • "));
    azSuggestAdd_(s.maBanHang, y[1], [y[2], y[3], y[6], y[7]].filter(String).join(" • "));
    azSuggestAdd_(s.kho, y[2], y[3]);
    azSuggestAdd_(s.viTri, y[3], y[2]);
    azSuggestAdd_(s.maRap, y[4], [y[5], y[6], y[7]].filter(String).join(" • "));
    azSuggestAdd_(s.mau, y[6], y[1]);
    azSuggestAdd_(s.size, y[7], y[1]);
  }

  // Bán hàng - hóa đơn / khách hàng
  var dhObj = azSuggestReadWithHeaders_("SALES", "tbl_DonHang", rowsLimit);
  var dhH = dhObj.headers;
  var idxHD = azSuggestHeaderIndex_(dhH, ["MaHoaDon", "Mã hóa đơn", "MaHD"], 0);
  var idxTen = azSuggestHeaderIndex_(dhH, ["TenKhach", "Tên khách", "KhachHang"], 2);
  var idxMaKH = azSuggestHeaderIndex_(dhH, ["MaKH", "Mã KH", "MaKhachHang"], 8);
  for (var d = dhObj.rows.length - 1; d >= 0; d--) {
    var rowD = dhObj.rows[d];
    azSuggestAdd_(s.maHoaDon, rowD[idxHD], [rowD[idxTen], rowD[idxMaKH]].filter(String).join(" • "));
    azSuggestAdd_(s.maKH, rowD[idxMaKH], rowD[idxTen]);
    azSuggestAdd_(s.tenKhach, rowD[idxTen], rowD[idxMaKH]);
  }

  var khObj = azSuggestReadWithHeaders_("SALES", "tbl_KhachHang", rowsLimit);
  var khH = khObj.headers;
  var idxKH = azSuggestHeaderIndex_(khH, ["MaKH", "Mã KH", "MaKhachHang"], 0);
  var idxTenKH = azSuggestHeaderIndex_(khH, ["TenKhach", "Tên khách", "KhachHang"], 1);
  var idxSdt = azSuggestHeaderIndex_(khH, ["SDT", "Số điện thoại", "DienThoai"], 2);
  for (var k = khObj.rows.length - 1; k >= 0; k--) {
    var rowK = khObj.rows[k];
    azSuggestAdd_(s.maKH, rowK[idxKH], [rowK[idxTenKH], rowK[idxSdt]].filter(String).join(" • "));
    azSuggestAdd_(s.tenKhach, rowK[idxTenKH], [rowK[idxKH], rowK[idxSdt]].filter(String).join(" • "));
  }

  // Rập - mâm / mã rập / nhà may / thợ cắt
  var rap = azSuggestReadRows_("RAP", "tbl_Rap_DonHang", rowsLimit);
  for (var rp = rap.length - 1; rp >= 0; rp--) {
    var rr = rap[rp];
    azSuggestAdd_(s.maMam, rr[0], [rr[5], rr[6], rr[4]].filter(String).join(" • "));
    azSuggestAdd_(s.nhaMay, rr[4], rr[5]);
    azSuggestAdd_(s.maRap, rr[5], [rr[6], rr[4], rr[0]].filter(String).join(" • "));
    azSuggestAdd_(s.thoCat, rr[18], rr[5]);
    azSuggestAdd_(s.maSP, rr[33], rr[6]);
    azSuggestAdd_(s.maBanHang, rr[34], rr[6]);
  }

  var nm = azSuggestReadRows_("RAP", "tbl_NhaMay", rowsLimit);
  for (var n = nm.length - 1; n >= 0; n--) azSuggestAdd_(s.nhaMay, nm[n][0] || nm[n][1], nm[n][2] || "");
  var dc = azSuggestReadRows_("RAP", "tbl_DoiCat", rowsLimit);
  for (var c = dc.length - 1; c >= 0; c--) azSuggestAdd_(s.thoCat, dc[c][0] || dc[c][1], dc[c][2] || "");

  var all = [];
  function mergeAll_(arr) {
    for (var m = 0; m < arr.length; m++) azSuggestAdd_(all, arr[m].v, arr[m].l);
  }
  mergeAll_(s.maHangNoiBo); mergeAll_(s.maBanHang); mergeAll_(s.maRap); mergeAll_(s.maSP);
  mergeAll_(s.maHoaDon); mergeAll_(s.maKH); mergeAll_(s.maMam); mergeAll_(s.tenKhach);

  var rapAll = [];
  mergeRap_(s.maMam); mergeRap_(s.maRap); mergeRap_(s.nhaMay); mergeRap_(s.thoCat);
  function mergeRap_(arr) { for (var z = 0; z < arr.length; z++) azSuggestAdd_(rapAll, arr[z].v, arr[z].l); }

  return outJson_({
    ok: true,
    updatedAt: nowVN_(),
    suggestions: {
      maHangNoiBo: azSuggestSlice_(s.maHangNoiBo, limit),
      maBanHang: azSuggestSlice_(s.maBanHang, limit),
      maSP: azSuggestSlice_(s.maSP, limit),
      maRap: azSuggestSlice_(s.maRap, limit),
      mau: azSuggestSlice_(s.mau, limit),
      size: azSuggestSlice_(s.size, limit),
      kho: azSuggestSlice_(s.kho, limit),
      viTri: azSuggestSlice_(s.viTri, limit),
      maHoaDon: azSuggestSlice_(s.maHoaDon, limit),
      maKH: azSuggestSlice_(s.maKH, limit),
      tenKhach: azSuggestSlice_(s.tenKhach, limit),
      maMam: azSuggestSlice_(s.maMam, limit),
      nhaMay: azSuggestSlice_(s.nhaMay, limit),
      thoCat: azSuggestSlice_(s.thoCat, limit),
      all: azSuggestSlice_(all, limit * 2),
      rapAll: azSuggestSlice_(rapAll, limit * 2)
    }
  });
}

/****************************************************
 * AZALAS CHAT CENTER - ĐỌC LỊCH SỬ NHẬN HÀNG V57
 * Nguồn dữ liệu:
 *   RAP/LichSuNhap A:H
 *   RAP/tbl_Rap_DonHang A:Q (schema chuẩn A:AQ, chỉ đọc cột cần thiết)
 ****************************************************/
function azChatCenterTextV57_(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function azChatCenterNumV57_(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return isNaN(value) ? 0 : value;
  var text = String(value)
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");
  var number = Number(text);
  return isNaN(number) ? 0 : number;
}

function azChatCenterIdV57_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, "GMT+7", "dd/MM/yyyy HH:mm:ss");
  }
  return azChatCenterTextV57_(value);
}

function azChatCenterDateTimeV57_(value, pattern) {
  pattern = pattern || "HH:mm dd/MM";
  if (!value) return "";
  if (value instanceof Date) {
    return Utilities.formatDate(value, "GMT+7", pattern);
  }
  return azChatCenterTextV57_(value);
}

function azChatCenterGetNhanHangV57_() {
  var ssRap = getSS_("RAP");
  var sheetLS = ssRap.getSheetByName("LichSuNhap");
  var sheetDon = ssRap.getSheetByName("tbl_Rap_DonHang");

  if (!sheetLS || sheetLS.getLastRow() < 2) {
    return {
      ok: true,
      nhanHang: [],
      total: 0,
      updatedAt: nowVN_()
    };
  }

  // Đọc toàn bộ lịch sử A:H để tính đúng số đã giao lũy kế tại từng lần nhận.
  var historyRows = sheetLS
    .getRange(2, 1, sheetLS.getLastRow() - 1, 8)
    .getValues();

  var orderById = {};
  var orderByUniqueRap = {};
  var duplicateRap = {};

  if (sheetDon && sheetDon.getLastRow() >= 2) {
    // Chỉ cần A:Q: MaMam, NgayCat, NhaMay, MaRap, SoLop, tổng kế hoạch,
    // tổng đã giao, LoaiMam, TenKhach.
    var orderRows = sheetDon
      .getRange(2, 1, sheetDon.getLastRow() - 1, Math.min(Math.max(sheetDon.getLastColumn(), 17), 17))
      .getValues();

    for (var i = 0; i < orderRows.length; i++) {
      var row = orderRows[i] || [];
      var maMam = azChatCenterIdV57_(row[0]);       // A
      var ngayCat = rapFormatNgay_(row[3]);         // D
      var nhaMay = azChatCenterTextV57_(row[4]);    // E
      var maRap = azChatCenterTextV57_(row[5]);     // F
      var soLop = azChatCenterTextV57_(row[9]);     // J
      var tongKeHoach = azChatCenterNumV57_(row[10]); // K
      var tongDaGiao = azChatCenterNumV57_(row[11]);  // L
      var loaiMam = azChatCenterTextV57_(row[14]);  // O
      var tenKhach = azChatCenterTextV57_(row[15]); // P

      var order = {
        maMam: maMam,
        ngayCat: ngayCat,
        nhaMay: nhaMay,
        maRap: maRap,
        soLop: soLop,
        tongSoLuong: tongKeHoach,
        tongDaGiao: tongDaGiao,
        loaiMam: loaiMam,
        tenKhach: tenKhach
      };

      if (maMam) orderById[maMam] = order;

      var rapKey = maRap.toUpperCase();
      if (rapKey) {
        if (orderByUniqueRap[rapKey]) {
          duplicateRap[rapKey] = true;
        } else {
          orderByUniqueRap[rapKey] = order;
        }
      }
    }
  }

  // Không dùng fallback theo MaRap nếu có nhiều mâm cùng mã rập vì dễ nối nhầm đơn.
  Object.keys(duplicateRap).forEach(function(key) {
    delete orderByUniqueRap[key];
  });

  var cumulativeByOrder = {};
  var result = [];

  for (var h = 0; h < historyRows.length; h++) {
    var history = historyRows[h] || [];
    var maRapHistory = azChatCenterTextV57_(history[1]); // B
    var soLuong = azChatCenterNumV57_(history[2]);       // C
    var nguoiNhap = azChatCenterTextV57_(history[3]);    // D
    var ghiChu = azChatCenterTextV57_(history[4]);       // E
    var idDonHang = azChatCenterIdV57_(history[5]);      // F

    // Bỏ qua đúng các dòng hoàn toàn trống, không bỏ dòng số lượng âm/0 có nghiệp vụ.
    if (!history[0] && !maRapHistory && !idDonHang && !nguoiNhap && !ghiChu && soLuong === 0) {
      continue;
    }

    var order = idDonHang ? orderById[idDonHang] : null;
    if (!order && maRapHistory) {
      order = orderByUniqueRap[maRapHistory.toUpperCase()] || null;
    }

    var groupKey = idDonHang
      ? "ID:" + idDonHang
      : "RAP:" + maRapHistory.toUpperCase();

    cumulativeByOrder[groupKey] = (cumulativeByOrder[groupKey] || 0) + soLuong;

    result.push({
      rowIdx: h + 2,
      ngayGio: azChatCenterDateTimeV57_(history[0], "HH:mm dd/MM"),
      maRap: maRapHistory || (order ? order.maRap : ""),
      soLuong: soLuong,
      nguoiNhap: nguoiNhap || "Không rõ",
      ghiChu: ghiChu,
      idDonHang: idDonHang,
      maMam: order ? order.maMam : idDonHang,
      ngayGioTick: azChatCenterDateTimeV57_(history[6], "HH:mm dd/MM"),
      nguoiTick: azChatCenterTextV57_(history[7]),
      nhaMay: order ? order.nhaMay : "",
      ngayCat: order ? order.ngayCat : "",
      soLop: order ? order.soLop : "",
      tongSoLuong: order ? order.tongSoLuong : 0,
      // Số đã giao tại đúng thời điểm của bản ghi, không dùng tổng hiện tại của mâm.
      soLuongGiao: cumulativeByOrder[groupKey],
      tongDaGiaoHienTai: order ? order.tongDaGiao : cumulativeByOrder[groupKey],
      loaiMam: order ? order.loaiMam : "",
      tenKhach: order ? order.tenKhach : ""
    });
  }

  var maxItems = 100;
  var visible = result.length > maxItems
    ? result.slice(result.length - maxItems)
    : result;

  return {
    ok: true,
    nhanHang: visible,
    total: result.length,
    updatedAt: nowVN_()
  };
}

function doPostMain_(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = JSON.parse(e.postData.contents);

  if (data.type === "azGetCodeSuggestions") {
    return azGetCodeSuggestions_(data);
  }

  // V72 - MÃ RẬP / ẢNH - ONLY OWNER
  var rapAnhEarlyV72 = rapAnhHandleApiV72_(data);
  if (rapAnhEarlyV72) return rapAnhEarlyV72;

  // DATA MỚI: chặn trước các API Nhân sự + Phụ liệu để dùng đúng file mới.
  var dmEarlyResult = dmHandleNhanSuPhuLieuDataMoi_(data);
  if (dmEarlyResult) return dmEarlyResult;

  // DATA MỚI: KHO THÀNH PHẨM / XUẤT NHẬP TỒN
  var khoEarlyResult = khoHandleDataMoi_(data);
  if (khoEarlyResult) return khoEarlyResult;

  // DATA MỚI: PHIẾU NHẬP RẬP HÀNG NHÀ
  var rapHNEarlyResult = rapHangNhaHandleDataMoi_(data);
  if (rapHNEarlyResult) return rapHNEarlyResult;

  // SOẠN HÀNG: đồng bộ MaKH cũ nếu cần, không tự đổi giá
  if (data.type === "soanSyncMaKHGiaCu") {
    try {
      return outJson_(soanSyncMaKHGiaCu_());
    } catch (errSyncGia) {
      return outJson_({ ok: false, message: "Lỗi đồng bộ MaKH: " + errSyncGia.message });
    }
  }

  /****************************************************
 * TASK 1 - SYSTEM / TÀI KHOẢN
 * Đọc ghi từ file mới:
 * 01_DATA_SYSTEM / tbl_TaiKhoan
 ****************************************************/

  // 1. KIỂM TRA ĐĂNG NHẬP
  if (data.type === "checkLogin") {
    try {
      var sheetLogin = getSheet_("SYSTEM", "tbl_TaiKhoan");
      var valuesLogin = sheetLogin.getDataRange().getValues();

      var userInput = normalizeText_(data.user);
      var passInput = normalizeText_(data.pass);

      for (var i = 1; i < valuesLogin.length; i++) {
        var row = valuesLogin[i];

        var user = normalizeText_(row[0]);       // User
        var pass = normalizeText_(row[1]);       // Pass
        var name = row[2] || "";                 // TenNhanVien
        var role = normalizeRole_(row[3]);       // Role
        var sdt = row[4] || "";                  // SDT
        var avatar = row[5] || "";               // Avatar
        var trangThai = normalizeText_(row[6]);  // TrangThai

        if (user === userInput && pass === passInput) {
          if (
            trangThai &&
            trangThai !== "Đang hoạt động" &&
            trangThai !== "Dang hoat dong" &&
            trangThai.toUpperCase() !== "ACTIVE"
          ) {
            return outJson_({
              status: "locked",
              message: "Tài khoản đã bị khóa hoặc ngưng hoạt động."
            });
          }

          return outJson_({
            status: "success",
            name: name,
            role: role,
            roleLabel: roleLabel_(role),
            permissionSummary: rolePermissionSummary_(role),
            permissionMatrix: getPermissionMatrix_(),
            sdt: sdt,
            avatar: avatar,
            user: user
          });
        }
      }

      return outJson_({
        status: "fail",
        message: "Sai tài khoản hoặc mật khẩu."
      });

    } catch (err) {
      return outJson_({
        status: "error",
        message: "Lỗi đăng nhập: " + err.message
      });
    }
  }

  // 2. ĐỔI MẬT KHẨU
  if (data.type === "updatePassword") {
    try {
      var sheetPass = getSheet_("SYSTEM", "tbl_TaiKhoan");
      var valuesPass = sheetPass.getDataRange().getValues();

      var userChange = normalizeText_(data.user);
      var newPass = normalizeText_(data.newPass);

      if (!userChange || !newPass) {
        return outText_("FAIL");
      }

      for (var p = 1; p < valuesPass.length; p++) {
        var userInSheet = normalizeText_(valuesPass[p][0]);

        if (userInSheet === userChange) {
          sheetPass.getRange(p + 1, 2).setValue(newPass);      // Pass
          sheetPass.getRange(p + 1, 9).setValue(nowVN_());     // CapNhatCuoi
          SpreadsheetApp.flush();
          return outText_("OK");
        }
      }

      return outText_("FAIL");

    } catch (err) {
      return outText_("FAIL: " + err.message);
    }
  }

  // 2B. QUẢN LÝ TÀI KHOẢN & PHÂN QUYỀN
  if (
    data.type === "getAccountList" ||
    data.type === "getPermissionMatrix" ||
    data.type === "createAccount" ||
    data.type === "updateAccountRole" ||
    data.type === "deleteAccount"
  ) {
    try {
      var sheetTK = getSheet_("SYSTEM", "tbl_TaiKhoan");
      var valuesTK = sheetTK.getDataRange().getValues();

      function findAccountRowByUserTK_(username) {
        username = normalizeText_(username);

        for (var i = 1; i < valuesTK.length; i++) {
          var u = normalizeText_(valuesTK[i][0]);

          if (u === username) {
            return {
              rowIndex: i + 1,
              row: valuesTK[i],
              user: u,
              pass: valuesTK[i][1] || "",
              name: valuesTK[i][2] || "",
              role: normalizeRole_(valuesTK[i][3]),
              sdt: valuesTK[i][4] || "",
              avatar: valuesTK[i][5] || "",
              trangThai: valuesTK[i][6] || "",
              ngayTao: valuesTK[i][7] || "",
              capNhatCuoi: valuesTK[i][8] || "",
              ghiChu: valuesTK[i][9] || ""
            };
          }
        }

        return null;
      }

      var actorUser = normalizeText_(
        data.actorUser ||
        data.currentUser ||
        data.loginUser ||
        ""
      );

      var actor = findAccountRowByUserTK_(actorUser);

      if (!actor) {
        return outJson_({
          ok: false,
          message: "Không xác định được người thao tác. Vui lòng đăng nhập lại."
        });
      }

      var actorRole = normalizeRole_(actor.role);
      var isManager = isOwnerAdminRole_(actorRole);
      var actorIsOwner = hasAppRole_(actorRole, "OWNER");
      var actorIsAdmin = hasAppRole_(actorRole, "ADMIN");

      if (!isManager) {
        return outJson_({
          ok: false,
          message: "Bạn không có quyền quản lý tài khoản."
        });
      }

      // A0. LẤY MA TRẬN QUYỀN
      if (data.type === "getPermissionMatrix") {
        return outJson_({
          ok: true,
          roles: getPermissionMatrix_(),
          actorRole: actorRole
        });
      }

      // A. LẤY DANH SÁCH TÀI KHOẢN
      if (data.type === "getAccountList") {
        var list = [];

        for (var a = 1; a < valuesTK.length; a++) {
          var user = normalizeText_(valuesTK[a][0]);
          if (!user) continue;

          list.push({
            user: user,
            name: valuesTK[a][2] || "",
            role: normalizeRole_(valuesTK[a][3]),
            roleLabel: roleLabel_(valuesTK[a][3]),
            permissionSummary: rolePermissionSummary_(valuesTK[a][3]),
            sdt: valuesTK[a][4] || "",
            avatar: valuesTK[a][5] || "",
            trangThai: valuesTK[a][6] || "",
            ngayTao: valuesTK[a][7] || "",
            capNhatCuoi: valuesTK[a][8] || "",
            ghiChu: valuesTK[a][9] || ""
          });
        }

        return outJson_({
          ok: true,
          data: list,
          actorRole: actorRole
        });
      }

      // B. TẠO TÀI KHOẢN
      if (data.type === "createAccount") {
        var newUser = normalizeText_(data.user || data.newUser);
        var newPass = normalizeText_(data.pass || data.newPass);
        var newName = normalizeText_(data.name || data.tenNhanVien);
        var newSdt = normalizeText_(data.sdt);
        var newAvatar = normalizeText_(data.avatar);
        var newRole = normalizeRole_(data.role || "MEMBER");

        if (!newUser || !newPass || !newName) {
          return outJson_({
            ok: false,
            message: "Vui lòng nhập đủ Tài khoản, Mật khẩu và Tên nhân viên."
          });
        }

        if (hasAppRole_(newRole, "OWNER") || !isValidAppRole_(newRole)) {
          return outJson_({
            ok: false,
            message: "Quyền không hợp lệ. OWNER nên giữ cố định trong sheet."
          });
        }

        if (findAccountRowByUserTK_(newUser)) {
          return outJson_({
            ok: false,
            message: "Tài khoản này đã tồn tại."
          });
        }

        var now = nowVN_();

        sheetTK.appendRow([
          newUser,              // User
          newPass,              // Pass
          newName,              // TenNhanVien
          newRole,              // Role
          newSdt,               // SDT
          newAvatar,            // Avatar
          "Đang hoạt động",     // TrangThai
          now,                  // NgayTao
          now,                  // CapNhatCuoi
          "Tạo từ app bởi " + actorUser // GhiChu
        ]);

        SpreadsheetApp.flush();

        return outJson_({
          ok: true,
          message: "Đã tạo tài khoản thành công."
        });
      }

      // C. CẬP NHẬT QUYỀN
      if (data.type === "updateAccountRole") {
        var targetUser = normalizeText_(data.targetUser || data.user);
        var targetRoleNew = normalizeRole_(data.role);

        if (!targetUser) {
          return outJson_({
            ok: false,
            message: "Thiếu tài khoản cần đổi quyền."
          });
        }

        if (hasAppRole_(targetRoleNew, "OWNER") || !isValidAppRole_(targetRoleNew)) {
          return outJson_({
            ok: false,
            message: "Quyền không hợp lệ. Không được đổi trực tiếp sang OWNER."
          });
        }

        if (targetUser === actorUser) {
          return outJson_({
            ok: false,
            message: "Không được tự đổi quyền của chính mình."
          });
        }

        var target = findAccountRowByUserTK_(targetUser);

        if (!target) {
          return outJson_({
            ok: false,
            message: "Không tìm thấy tài khoản cần đổi quyền."
          });
        }

        if (hasAppRole_(target.role, "OWNER")) {
          return outJson_({
            ok: false,
            message: "Không được đổi quyền tài khoản OWNER."
          });
        }

        // ADMIN có toàn quyền vận hành và có thể tạo/thêm ADMIN mới.
        // Nhưng để tránh ADMIN tự hạ/xóa quyền nhau, chỉ OWNER được sửa quyền tài khoản ADMIN đã tồn tại.
        if (hasAppRole_(target.role, "ADMIN") && !actorIsOwner) {
          return outJson_({
            ok: false,
            message: "Chỉ OWNER được sửa quyền tài khoản ADMIN hiện có."
          });
        }

        sheetTK.getRange(target.rowIndex, 4).setValue(targetRoleNew); // Role
        sheetTK.getRange(target.rowIndex, 9).setValue(nowVN_());      // CapNhatCuoi

        SpreadsheetApp.flush();

        return outJson_({
          ok: true,
          message: "Đã cập nhật quyền thành công."
        });
      }

      // D. XÓA / KHÓA TÀI KHOẢN
      if (data.type === "deleteAccount") {
        var deleteUser = normalizeText_(data.targetUser || data.user);

        if (!deleteUser) {
          return outJson_({
            ok: false,
            message: "Thiếu tài khoản cần xóa."
          });
        }

        if (deleteUser === actorUser) {
          return outJson_({
            ok: false,
            message: "Không được xóa chính tài khoản đang đăng nhập."
          });
        }

        var delTarget = findAccountRowByUserTK_(deleteUser);

        if (!delTarget) {
          return outJson_({
            ok: false,
            message: "Không tìm thấy tài khoản cần xóa."
          });
        }

        if (hasAppRole_(delTarget.role, "OWNER")) {
          return outJson_({
            ok: false,
            message: "Không được xóa tài khoản OWNER."
          });
        }

        // ADMIN có thể tạo/thêm ADMIN mới, nhưng chỉ OWNER được khóa/xóa tài khoản ADMIN.
        if (hasAppRole_(delTarget.role, "ADMIN") && !actorIsOwner) {
          return outJson_({
            ok: false,
            message: "Chỉ OWNER được khóa/xóa tài khoản ADMIN."
          });
        }

        // Không xóa dòng thật để giữ lịch sử.
        // Chỉ đổi trạng thái thành Đã khóa.
        sheetTK.getRange(delTarget.rowIndex, 7).setValue("Đã khóa"); // TrangThai
        sheetTK.getRange(delTarget.rowIndex, 9).setValue(nowVN_());  // CapNhatCuoi
        sheetTK.getRange(delTarget.rowIndex, 10).setValue("Khóa từ app bởi " + actorUser); // GhiChu

        SpreadsheetApp.flush();

        return outJson_({
          ok: true,
          message: "Đã khóa tài khoản thành công."
        });
      }

    } catch (err) {
      return outJson_({
        ok: false,
        message: "Lỗi tài khoản: " + err.message
      });
    }
  }
  /****************************************************
   * V81 - THÔNG TIN CHÀNH XE KHÁCH HÀNG
   * Chỉ thêm 2 cột nếu chưa có:
   *   ChanhXe
   *   SDTChanhXe
   * Không chèn giữa bảng, không đổi vị trí 12 cột cũ.
   ****************************************************/
  function ensureCustomerTransportColsV81_() {
    var sh = getSheet_("SALES", "tbl_KhachHang");
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];

    function headerKey_(v) {
      return normalizeText_(v)
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9]/g, "");
    }

    function findCol_(names) {
      var wanted = names.map(headerKey_);
      for (var i = 0; i < headers.length; i++) {
        if (wanted.indexOf(headerKey_(headers[i])) !== -1) return i + 1;
      }
      return 0;
    }

    var colChanhXe = findCol_(["ChanhXe", "Chành xe", "Chanh Xe"]);
    var colSDTChanhXe = findCol_(["SDTChanhXe", "SĐT Chành Xe", "SDT Chanh Xe", "SoDienThoaiChanhXe"]);

    if (!colChanhXe) {
      lastCol++;
      sh.getRange(1, lastCol).setValue("ChanhXe");
      headers.push("ChanhXe");
      colChanhXe = lastCol;
    }

    if (!colSDTChanhXe) {
      lastCol++;
      sh.getRange(1, lastCol).setValue("SDTChanhXe");
      headers.push("SDTChanhXe");
      colSDTChanhXe = lastCol;
    }

    return {
      sheet: sh,
      colChanhXe: colChanhXe,
      colSDTChanhXe: colSDTChanhXe
    };
  }

  /****************************************************
   * TASK 2 - SALES / KHÁCH HÀNG / ĐƠN HÀNG
   * Đọc ghi từ file mới:
   * 02_DATA_SALES_CRM
   ****************************************************/

  // 3. LẤY DANH SÁCH KHÁCH HÀNG
  if (data.type === "getCustomers") {
    try {
      var transportColsV81 = ensureCustomerTransportColsV81_();
      var sheetKH = transportColsV81.sheet;
      var valuesKH = sheetKH.getDataRange().getValues();

      if (valuesKH.length < 2) {
        return outJson_([]);
      }

      valuesKH.shift();

      var cleanData = valuesKH.filter(function (row) {
        // Cột B = TenKhach
        // Cột I = TrangThai
        var tenKhach = row[1];
        var trangThai = normalizeText_(row[8]);

        return tenKhach !== "" &&
          tenKhach !== null &&
          tenKhach !== undefined &&
          trangThai !== "Đã xóa";
      }).map(function(row) {
        // V81: Frontend luôn đọc 2 thông tin mới ở index 12 và 13,
        // dù cột vật lý được thêm ở cuối sheet.
        var outRow = row.slice();
        outRow[12] = row[transportColsV81.colChanhXe - 1] || "";
        outRow[13] = row[transportColsV81.colSDTChanhXe - 1] || "";
        return outRow;
      });

      return outJson_(cleanData);

    } catch (err) {
      return outJson_({
        ok: false,
        message: "Lỗi lấy khách hàng: " + err.message
      });
    }
  }

  // 4. LẤY DANH SÁCH ĐƠN HÀNG
  // Có filter tùy chọn để không gửi cả bảng về browser khi màn hình chỉ cần 1 vài trạng thái.
  if (data.type === "getOrders") {
    try {
      var sheetOrders = getSheet_("SALES", "tbl_DonHang");
      var lastOrderRow = sheetOrders.getLastRow();
      var lastOrderCol = sheetOrders.getLastColumn();
      if (lastOrderRow < 2 || lastOrderCol < 1) return outJson_([]);

      var fullData = sheetOrders.getRange(2, 1, lastOrderRow - 1, lastOrderCol).getValues();
      var statusList = Array.isArray(data.statuses) ? data.statuses : [];
      if (!statusList.length && normalizeText_(data.status)) statusList = [data.status];

      var statusSet = {};
      statusList.forEach(function(s) { s = normalizeText_(s); if (s) statusSet[s] = true; });
      var excludeSet = {};
      (Array.isArray(data.excludeStatuses) ? data.excludeStatuses : []).forEach(function(s) {
        s = normalizeText_(s); if (s) excludeSet[s] = true;
      });

      var hasStatusFilter = Object.keys(statusSet).length > 0;
      var hasExcludeFilter = Object.keys(excludeSet).length > 0;
      var cleanData = [];

      for (var oi = 0; oi < fullData.length; oi++) {
        var row = fullData[oi];
        if (row[0] === "" || row[0] === null || row[0] === undefined) continue;
        var st = normalizeText_(row[6]);
        if (hasStatusFilter && !statusSet[st]) continue;
        if (hasExcludeFilter && excludeSet[st]) continue;
        cleanData.push(row);
      }

      var limitOrders = Math.max(0, Math.min(5000, Number(data.limit) || 0));
      if (limitOrders > 0 && cleanData.length > limitOrders) cleanData = cleanData.slice(-limitOrders);
      return outJson_(cleanData);

    } catch (err) {
      return outJson_({ ok: false, message: "Lỗi lấy đơn hàng: " + err.message });
    }
  }

  // Home chỉ cần số đếm và vài hoạt động gần nhất.
  if (data.type === "getOrderStats") {
    try {
      var shOrderStats = getSheet_("SALES", "tbl_DonHang");
      var lastStatsRow = shOrderStats.getLastRow();
      if (lastStatsRow < 2) {
        return outJson_({ ok: true, counts: { moi: 0, dangGiao: 0, daGiao: 0 }, recentOrders: [] });
      }

      var statRows = shOrderStats.getRange(2, 1, lastStatsRow - 1, Math.min(7, shOrderStats.getLastColumn())).getValues();
      var countMoi = 0, countDangGiao = 0, countDaGiao = 0;
      for (var si = 0; si < statRows.length; si++) {
        if (!normalizeText_(statRows[si][0])) continue;
        var sStatus = normalizeText_(statRows[si][6]);
        if (sStatus === "Mới") countMoi++;
        else if (sStatus === "Đang vận chuyển") countDangGiao++;
        else if (sStatus === "Hoàn tất") countDaGiao++;
      }

      var recentOrders = statRows.filter(function(r) { return !!normalizeText_(r[0]); }).slice(-60);
      return outJson_({
        ok: true,
        counts: { moi: countMoi, dangGiao: countDangGiao, daGiao: countDaGiao },
        recentOrders: recentOrders
      });
    } catch (errStats) {
      return outJson_({
        ok: false, message: "Lỗi lấy thống kê đơn hàng: " + errStats.message,
        counts: { moi: 0, dangGiao: 0, daGiao: 0 }, recentOrders: []
      });
    }
  }

  // 5. LƯU KHÁCH HÀNG MỚI
  if (data.type === "saveCustomer") {
    try {
      var customerColsV81 = ensureCustomerTransportColsV81_();
      var sheetCustomer = customerColsV81.sheet;

      var tenKhach = normalizeText_(data.tenKhach);
      var sdt = normalizeText_(data.sdt);
      var diaChi = normalizeText_(data.diaChi);
      var chanhXe = normalizeText_(data.chanhXe || data.chanhxe);
      var sdtChanhXe = normalizeText_(data.sdtChanhXe || data.sdtchanhxe);

      if (!tenKhach) {
        return outText_("Vui lòng nhập tên khách hàng");
      }

      var maKH = "KH" + new Date().getTime();
      var now = nowVN_();
      var today = dateVN_();

      sheetCustomer.appendRow([
        maKH,              // MaKH
        tenKhach,          // TenKhach
        sdt,               // SDT
        diaChi,            // DiaChi
        0,                 // NoHienTai
        "Khách lẻ",        // NhomKhach
        sdt,               // Zalo
        "",                // KhuVuc
        "Đang mua",        // TrangThai
        "",                // GhiChu
        today,             // NgayTao
        now                // CapNhatCuoi
      ]);

      // V81: Hai cột mới nằm ở cuối bảng, không thay đổi 12 cột cũ.
      var newCustomerRowV81 = sheetCustomer.getLastRow();
      sheetCustomer.getRange(newCustomerRowV81, customerColsV81.colChanhXe).setValue(chanhXe);
      sheetCustomer.getRange(newCustomerRowV81, customerColsV81.colSDTChanhXe).setValue(sdtChanhXe);

      SpreadsheetApp.flush();

      return outText_("Thành công");

    } catch (err) {
      return outText_("Lỗi lưu khách hàng: " + err.message);
    }
  }

  // 6. LƯU ĐƠN HÀNG & ẢNH ZALO
  // V80: CHỐNG TẠO TRÙNG MaHoaDon.
  // Chỉ sửa riêng luồng tạo đơn:
  // - kiểm tra mã trước khi upload ảnh;
  // - kiểm tra lại lần cuối bên trong ScriptLock trước khi appendRow;
  // - nếu request trùng chạy song song, chỉ request thắng được append;
  // - request thua sẽ xóa ảnh Drive vừa upload để không tạo ảnh rác.
  if (data.type === "saveOrder") {
    try {
      var sheetDonHang = getSheet_("SALES", "tbl_DonHang");
      var sheetKhachHang = getSheet_("SALES", "tbl_KhachHang");
      var sheetAnhZalo = getSheet_("SALES", "tbl_DonHang_AnhZalo");

      var maHoaDonGoc = normalizeText_(data.maHoaDon) || makeId_("HD");
      var tenKhach = normalizeText_(data.tenKhach);
      var loaiDon = normalizeText_(data.loaiDon);
      var ngayTao = normalizeText_(data.ngayTao) || dateVN_();
      var ngayGiao = normalizeText_(data.ngayGiao);
      var ghiChu = normalizeText_(data.ghiChu);
      var nguoiTao = normalizeText_(data.user || data.nguoiTao || data.actorUser || "");
      var now = nowVN_();

      if (!tenKhach) {
        return outText_("Vui lòng nhập tên khách");
      }

      // -------------------------------------------------------
      // V80.1 - Xác định chính xác các mã mà request này sẽ tạo.
      // Tân Xuân và Cá Koi vẫn là 2 mã hợp lệ riêng: -TX và -CK.
      // -------------------------------------------------------
      var isSplitOrderV80 = loaiDon === "Tân Xuân và Cá Koi";
      var targetOrderIdsV80 = isSplitOrderV80
        ? [maHoaDonGoc + "-TX", maHoaDonGoc + "-CK"]
        : [maHoaDonGoc];

      function getExistingOrderMapV80_() {
        var map = {};
        var lastRow = sheetDonHang.getLastRow();
        if (lastRow < 2) return map;

        var ids = sheetDonHang.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var ex = 0; ex < ids.length; ex++) {
          var id = normalizeText_(ids[ex][0]);
          if (id) map[id] = true;
        }
        return map;
      }

      function allTargetIdsExistV80_(map) {
        for (var a = 0; a < targetOrderIdsV80.length; a++) {
          if (!map[targetOrderIdsV80[a]]) return false;
        }
        return true;
      }

      // Kiểm tra nhanh trước khi upload để request lặp thông thường
      // không tạo thêm file Drive.
      var existingBeforeUploadV80 = getExistingOrderMapV80_();
      if (allTargetIdsExistV80_(existingBeforeUploadV80)) {
        return outText_("ALREADY_EXISTS");
      }

      // Tìm mã khách hàng theo tên khách - giữ nguyên logic cũ.
      var listKhach = sheetKhachHang.getDataRange().getValues();
      var maKH = "KHACH_LE";

      for (var i = 1; i < listKhach.length; i++) {
        var tenTrongSheet = normalizeText_(listKhach[i][1]).toLowerCase();
        if (tenTrongSheet && tenTrongSheet === tenKhach.toLowerCase()) {
          maKH = listKhach[i][0] || "KHACH_LE";
          break;
        }
      }

      // Upload ảnh giữ nguyên như cũ.
      var listUrlAnh = uploadOrderImages_(data.images, maHoaDonGoc);
      var strImages = JSON.stringify(listUrlAnh);

      // Nếu request khác thắng race sau lúc mình upload ảnh,
      // xóa các file vừa upload của request thua để tránh ảnh rác.
      function trashUploadedOrderImagesV80_() {
        listUrlAnh.forEach(function(url) {
          try {
            var s = String(url || "");
            var m = s.match(/\/d\/([A-Za-z0-9_-]+)/) ||
                    s.match(/[?&]id=([A-Za-z0-9_-]+)/);
            if (m && m[1]) {
              DriveApp.getFileById(m[1]).setTrashed(true);
            }
          } catch (eTrash) {
            // Không chặn tạo đơn chỉ vì không dọn được 1 file ảnh.
          }
        });
      }

      function appendAnhZaloRows_(maHoaDon) {
        listUrlAnh.forEach(function (linkAnh) {
          sheetAnhZalo.appendRow([
            makeId_("ANH"),                          // MaAnh
            maHoaDon,                                // MaHoaDon
            maKH,                                    // MaKH
            tenKhach,                                // TenKhach
            linkAnh,                                 // LinkAnh
            AZALAS_DRIVE_FOLDERS.ANH_DON_ZALO,       // FolderId
            nguoiTao,                                // NguoiUpload
            now,                                     // ThoiGian
            "Ảnh khách gửi qua Zalo"                 // GhiChu
          ]);
        });
      }

      var createdOrderIdsV80 = [];

      function appendOrder_(maHoaDon, loaiDonFinal, ghiChuFinal) {
        sheetDonHang.appendRow([
          maHoaDon,              // MaHoaDon
          ngayTao,               // NgayTao
          tenKhach,              // TenKhach
          loaiDonFinal,          // LoaiDon
          ngayGiao,              // NgayGiao
          ghiChuFinal,           // GhiChuKhach
          "Mới",                 // TrangThai
          strImages,             // AnhZaloJson
          maKH,                  // MaKH
          "",                    // NguoiSoan
          0,                     // NoTrongHoaDon
          0,                     // TongTien
          0,                     // DaThanhToan
          "",                    // TrangThaiHoaDon
          "",                    // GhiChuNV
          "",                    // GioSoanXong
          "",                    // ThoiGianHuy
          "",                    // NguoiHuy
          nguoiTao,              // NguoiTao
          "Đơn từ ảnh Zalo",     // KieuDon
          "ZALO",                // KenhBan
          now                    // CapNhatCuoi
        ]);

        // Đánh dấu ngay sau khi dòng đơn đã được tạo.
        createdOrderIdsV80.push(maHoaDon);

        appendAnhZaloRows_(maHoaDon);
      }

      // -------------------------------------------------------
      // V80.2 - Chốt chống trùng ở SERVER bằng ScriptLock.
      // Hai request cùng mã có thể upload song song, nhưng chỉ một
      // request được qua bước kiểm tra + appendRow này.
      // -------------------------------------------------------
      var createOrderLockV80 = LockService.getScriptLock();
      var lockTakenV80 = false;

      try {
        createOrderLockV80.waitLock(30000);
        lockTakenV80 = true;

        // PHẢI đọc lại sheet sau khi lấy lock.
        var existingInsideLockV80 = getExistingOrderMapV80_();

        var missingMapV80 = {};
        var missingCountV80 = 0;

        for (var t = 0; t < targetOrderIdsV80.length; t++) {
          var targetIdV80 = targetOrderIdsV80[t];
          if (!existingInsideLockV80[targetIdV80]) {
            missingMapV80[targetIdV80] = true;
            missingCountV80++;
          }
        }

        // Request khác đã tạo xong đúng mã trong lúc request này upload ảnh.
        if (missingCountV80 === 0) {
          trashUploadedOrderImagesV80_();
          return outText_("ALREADY_EXISTS");
        }

        // Giữ nguyên logic cũ: Tân Xuân và Cá Koi tách thành 2 đơn.
        // Nếu trước đó chỉ có 1 nửa do lỗi cũ, V80 chỉ tạo phần còn thiếu,
        // tuyệt đối không append thêm dòng trùng.
        if (isSplitOrderV80) {
          var idTXV80 = maHoaDonGoc + "-TX";
          var idCKV80 = maHoaDonGoc + "-CK";

          if (missingMapV80[idTXV80]) {
            appendOrder_(
              idTXV80,
              "Tân Xuân",
              ghiChu ? ghiChu + " (Phần kho Tân Xuân)" : "(Phần kho Tân Xuân)"
            );
          }

          if (missingMapV80[idCKV80]) {
            appendOrder_(
              idCKV80,
              "Cá Koi",
              ghiChu ? ghiChu + " (Phần kho Cá Koi)" : "(Phần kho Cá Koi)"
            );
          }

          SpreadsheetApp.flush();
          return outText_("SPLIT_SUCCESS");
        }

        // Đơn thường: chỉ append khi mã đó chưa tồn tại.
        if (missingMapV80[maHoaDonGoc]) {
          appendOrder_(maHoaDonGoc, loaiDon, ghiChu);
        }

        SpreadsheetApp.flush();
        return outText_("Thành công");

      } catch (lockOrSaveErrV80) {
        // Chỉ dọn ảnh nếu CHƯA tạo được bất kỳ dòng đơn nào.
        // Nếu đã append 1 phần thì giữ ảnh để dòng đã tạo không bị mất link.
        if (createdOrderIdsV80.length === 0) {
          trashUploadedOrderImagesV80_();
        }
        throw lockOrSaveErrV80;

      } finally {
        if (lockTakenV80) {
          try {
            createOrderLockV80.releaseLock();
          } catch (eReleaseV80) {}
        }
      }

    } catch (err) {
      return outText_("Lỗi lưu đơn hàng: " + err.message);
    }
  }



  // TASK 06I - SOẠN HÀNG THEO TÊN SẢN PHẨM / HIỂN THỊ BOX MÀU + ẢNH + SIZE
  if (data.type === "soanSearchSanPhamTheoTen") {
    try {
      var qInput = normalizeText_(data.q || data.tenSanPham || data.maBanHang || "");
      var q = qInput.toUpperCase();
      if (!q) return outJson_({ ok: false, message: "Chưa nhập tên sản phẩm" });

      var shBT2 = getSheet_("KHO", "tbl_Kho_BienThe");
      var shHH2 = getSheet_("KHO", "tbl_Kho_HangHoa");
      var shTon2 = getSheet_("KHO", "tbl_Kho_Ton");
      var shAnh2 = getSheet_("KHO", "tbl_Kho_AnhSanPham");

      var btRows2 = shBT2.getDataRange().getValues();
      var hhRows2 = shHH2.getDataRange().getValues();
      var tonRows2 = shTon2.getDataRange().getValues();
      var anhRows2 = shAnh2.getDataRange().getValues();

      var hhMap2 = {};
      for (var hh = 1; hh < hhRows2.length; hh++) {
        var hhMaSP = normalizeText_(hhRows2[hh][0]);
        if (!hhMaSP) continue;
        hhMap2[hhMaSP] = {
          maSP: hhMaSP,
          mauSanPham: normalizeText_(hhRows2[hh][2]),
          hieu: normalizeText_(hhRows2[hh][3]),
          tenSanPham: normalizeText_(hhRows2[hh][4] || hhRows2[hh][2] || hhMaSP)
        };
      }

      var tonMap2 = {};
      for (var tt = 1; tt < tonRows2.length; tt++) {
        var tMaNB2 = normalizeText_(tonRows2[tt][0]);
        var tMaBH2 = normalizeText_(tonRows2[tt][1]);
        var tKey2 = tMaNB2 || ("BH:" + tMaBH2);
        if (!tKey2) continue;
        if (!tonMap2[tKey2]) tonMap2[tKey2] = { tonThucTe: 0, tonGiu: 0, khaDung: 0 };
        tonMap2[tKey2].tonThucTe += khoNum_(tonRows2[tt][8]);
        tonMap2[tKey2].tonGiu += khoNum_(tonRows2[tt][9]);
        tonMap2[tKey2].khaDung += khoNum_(tonRows2[tt][10]);
      }

      function getAnhFor_(maBH, maSP) {
        var fallback = "";
        for (var aa = 1; aa < anhRows2.length; aa++) {
          var aMaBH2 = normalizeText_(anhRows2[aa][1]);
          var aMaSP2 = normalizeText_(anhRows2[aa][2]);
          var link = normalizeText_(anhRows2[aa][6] || anhRows2[aa][7] || "");
          if (!link) continue;
          if (maBH && aMaBH2.toUpperCase() === maBH.toUpperCase()) return link;
          if (!fallback && maSP && aMaSP2 === maSP) fallback = link;
        }
        return fallback;
      }

      var groups = {};
      for (var i2 = 1; i2 < btRows2.length; i2++) {
        var r2 = btRows2[i2];
        var maNB2 = normalizeText_(r2[0]);
        var maBH2 = normalizeText_(r2[1]);
        var maSP2 = normalizeText_(r2[2]);
        var maRap2 = normalizeText_(r2[3]);
        var mauSP2 = normalizeText_(r2[4]);
        var hieu2 = normalizeText_(r2[5]);
        var mau2 = normalizeText_(r2[6]);
        var size2 = normalizeText_(r2[7]);
        var tenHienThi2 = normalizeText_(r2[8]);
        var hhInfo2 = hhMap2[maSP2] || {};
        var tenSP2 = normalizeText_(hhInfo2.tenSanPham || tenHienThi2 || maSP2 || maBH2);
        if (!mauSP2) mauSP2 = normalizeText_(hhInfo2.mauSanPham || "");
        if (!hieu2) hieu2 = normalizeText_(hhInfo2.hieu || "");

        var searchText2 = (maBH2 + " " + maNB2 + " " + maSP2 + " " + maRap2 + " " + mauSP2 + " " + hieu2 + " " + mau2 + " " + size2 + " " + tenHienThi2 + " " + tenSP2).toUpperCase();
        if (searchText2.indexOf(q) === -1) continue;

        var key2 = maBH2 || (maSP2 + "|" + mau2);
        if (!groups[key2]) {
          groups[key2] = {
            maBanHang: maBH2,
            maSP: maSP2,
            maRap: maRap2,
            hieu: hieu2,
            mauSanPham: mauSP2,
            mau: mau2,
            tenSanPham: tenSP2,
            tenHienThi: tenSP2 + (mau2 ? " - " + mau2 : ""),
            linkAnhChinh: getAnhFor_(maBH2, maSP2),
            sizes: [],
            tongTon: 0,
            tongGiu: 0,
            tongKhaDung: 0
          };
        }
        var ton2 = tonMap2[maNB2] || tonMap2["BH:" + maBH2] || { tonThucTe: 0, tonGiu: 0, khaDung: 0 };
        groups[key2].sizes.push({
          maHangNoiBo: maNB2,
          maBanHang: maBH2,
          maSP: maSP2,
          maRap: maRap2,
          mauSanPham: mauSP2,
          hieu: hieu2,
          mau: mau2,
          size: size2,
          tenHienThi: tenHienThi2,
          tonThucTe: ton2.tonThucTe,
          tonGiu: ton2.tonGiu,
          khaDung: ton2.khaDung
        });
        groups[key2].tongTon += ton2.tonThucTe;
        groups[key2].tongGiu += ton2.tonGiu;
        groups[key2].tongKhaDung += ton2.khaDung;
      }

      var sizeOrder2 = { "XS": 1, "S": 2, "M": 3, "L": 4, "XL": 5, "2X": 6, "2XL": 6, "3X": 7, "3XL": 7, "4X": 8, "4XL": 8, "5X": 9, "5XL": 9 };
      var colors = Object.keys(groups).map(function(k) {
        var g = groups[k];
        g.sizes.sort(function(a, b) {
          var oa = sizeOrder2[String(a.size).toUpperCase()] || 999;
          var ob = sizeOrder2[String(b.size).toUpperCase()] || 999;
          return oa - ob || String(a.size).localeCompare(String(b.size));
        });
        return g;
      }).sort(function(a, b) {
        return (b.tongKhaDung || 0) - (a.tongKhaDung || 0) || String(a.tenHienThi).localeCompare(String(b.tenHienThi));
      }).slice(0, 30);

      if (!colors.length) {
        return outJson_({ ok: false, message: "Không tìm thấy sản phẩm/màu trong kho mới: " + qInput, colors: [] });
      }

      return outJson_({ ok: true, query: qInput, colors: colors });
    } catch (err) {
      return outJson_({ ok: false, message: "Lỗi tìm sản phẩm theo tên: " + err.message });
    }
  }


  // SOẠN HÀNG - TRA MÃ BÁN HÀNG / HIỂN THỊ ẢNH + TỒN SIZE
  if (data.type === "soanGetHangTheoMaBanHang") {
    try {
      var qRaw = normalizeText_(data.maBanHang || data.q || "");
      var q = qRaw.toUpperCase();
      if (!q) return outJson_({ ok: false, message: "Chưa nhập mã bán hàng" });

      var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
      var shHH = getSheet_("KHO", "tbl_Kho_HangHoa");
      var shTon = getSheet_("KHO", "tbl_Kho_Ton");
      var shAnh = getSheet_("KHO", "tbl_Kho_AnhSanPham");

      var btRows = azReadCols_(shBT, 9);
      var matched = [];
      var canonicalMaBanHang = "";

      for (var i = 1; i < btRows.length; i++) {
        var maHangNoiBo = normalizeText_(btRows[i][0]);
        var maBanHang = normalizeText_(btRows[i][1]);
        if (!maHangNoiBo && !maBanHang) continue;
        if (maBanHang.toUpperCase() === q || maHangNoiBo.toUpperCase() === q) {
          if (!canonicalMaBanHang) canonicalMaBanHang = maBanHang || maHangNoiBo;
          matched.push(btRows[i]);
        }
      }

      // Nếu chưa thấy, cho phép tìm gần đúng theo mã bán hàng để nhân viên nhập thiếu vẫn có gợi ý.
      if (matched.length === 0) {
        var suggestions = [];
        for (var sg = 1; sg < btRows.length; sg++) {
          var sgMaBH = normalizeText_(btRows[sg][1]);
          var sgMaNB = normalizeText_(btRows[sg][0]);
          var sgText = (sgMaBH + " " + sgMaNB).toUpperCase();
          if (sgText.indexOf(q) !== -1) {
            if (suggestions.indexOf(sgMaBH || sgMaNB) === -1) suggestions.push(sgMaBH || sgMaNB);
          }
          if (suggestions.length >= 8) break;
        }
        return outJson_({ ok: false, message: "Không tìm thấy mã bán hàng: " + qRaw, suggestions: suggestions });
      }

      // Nếu nhập MaHangNoiBo, lấy lại đầy đủ các size cùng MaBanHang.
      if (canonicalMaBanHang) {
        matched = [];
        for (var b = 1; b < btRows.length; b++) {
          if (normalizeText_(btRows[b][1]).toUpperCase() === canonicalMaBanHang.toUpperCase()) matched.push(btRows[b]);
        }
      }

      var maSP = normalizeText_(matched[0][2]);
      var maRap = normalizeText_(matched[0][3]);
      var mauSanPham = normalizeText_(matched[0][4]);
      var hieu = normalizeText_(matched[0][5]);
      var mau = normalizeText_(matched[0][6]);

      var tenSanPham = "";
      var hhRows = azReadCols_(shHH, 5);
      for (var h = 1; h < hhRows.length; h++) {
        if (normalizeText_(hhRows[h][0]) === maSP) {
          tenSanPham = normalizeText_(hhRows[h][4] || hhRows[h][2] || maSP);
          if (!mauSanPham) mauSanPham = normalizeText_(hhRows[h][2]);
          if (!hieu) hieu = normalizeText_(hhRows[h][3]);
          break;
        }
      }
      if (!tenSanPham) tenSanPham = normalizeText_(matched[0][8] || maSP || canonicalMaBanHang);

      var tonMap = {};
      var khoSet = {};
      var tonRows = azReadCols_(shTon, 11);
      for (var t = 1; t < tonRows.length; t++) {
        var tMaNB = normalizeText_(tonRows[t][0]);
        var tMaBH = normalizeText_(tonRows[t][1]);
        if (!tMaNB && !tMaBH) continue;
        if (tMaBH.toUpperCase() !== canonicalMaBanHang.toUpperCase()) continue;
        if (!tonMap[tMaNB]) {
          tonMap[tMaNB] = { tonThucTe: 0, tonGiu: 0, khaDung: 0, khoList: [] };
        }
        var kho = normalizeText_(tonRows[t][2] || "KHO CHÍNH");
        var tonThucTe = khoNum_(tonRows[t][8]);
        var tonGiu = khoNum_(tonRows[t][9]);
        var khaDung = khoNum_(tonRows[t][10]);
        tonMap[tMaNB].tonThucTe += tonThucTe;
        tonMap[tMaNB].tonGiu += tonGiu;
        tonMap[tMaNB].khaDung += khaDung;
        tonMap[tMaNB].khoList.push({ kho: kho, tonThucTe: tonThucTe, tonGiu: tonGiu, khaDung: khaDung });
        khoSet[kho] = true;
      }

      var sizeOrder = { "XS": 1, "S": 2, "M": 3, "L": 4, "XL": 5, "2X": 6, "2XL": 6, "3X": 7, "3XL": 7, "4X": 8, "4XL": 8, "5X": 9, "5XL": 9, "6X": 10, "6XL": 10, "7X": 11, "8X": 12 };
      var sizes = matched.map(function(r) {
        var maNB = normalizeText_(r[0]);
        var ton = tonMap[maNB] || { tonThucTe: 0, tonGiu: 0, khaDung: 0, khoList: [] };
        return {
          maHangNoiBo: maNB,
          maBanHang: normalizeText_(r[1]),
          maSP: normalizeText_(r[2]),
          maRap: normalizeText_(r[3]),
          mauSanPham: normalizeText_(r[4]),
          hieu: normalizeText_(r[5]),
          mau: normalizeText_(r[6]),
          size: normalizeText_(r[7]),
          tenHienThi: normalizeText_(r[8]),
          tonThucTe: ton.tonThucTe,
          tonGiu: ton.tonGiu,
          khaDung: ton.khaDung,
          khoList: ton.khoList
        };
      }).sort(function(a, b) {
        var oa = sizeOrder[String(a.size).toUpperCase()] || 999;
        var ob = sizeOrder[String(b.size).toUpperCase()] || 999;
        return oa - ob || String(a.size).localeCompare(String(b.size));
      });

      var linkAnhChinh = "";
      var anhRows = azReadCols_(shAnh, 8);
      for (var a = 1; a < anhRows.length; a++) {
        var aMaBH = normalizeText_(anhRows[a][1]);
        var aMaSP = normalizeText_(anhRows[a][2]);
        if (aMaBH.toUpperCase() === canonicalMaBanHang.toUpperCase() || (maSP && aMaSP === maSP)) {
          linkAnhChinh = normalizeText_(anhRows[a][6] || anhRows[a][7] || "");
          if (linkAnhChinh) break;
        }
      }

      var tongTon = sizes.reduce(function(sum, x) { return sum + khoNum_(x.tonThucTe); }, 0);
      var tongGiu = sizes.reduce(function(sum, x) { return sum + khoNum_(x.tonGiu); }, 0);
      var tongKhaDung = sizes.reduce(function(sum, x) { return sum + khoNum_(x.khaDung); }, 0);

      // Giá gợi ý: ưu tiên khách này từng mua cùng MaBanHang, sau đó mới lấy giá bán gần nhất.
      // Có sửa lỗi dữ liệu cũ MaKH = KHACH_LE bằng cách dò lại MaKH từ tbl_DonHang theo MaHoaDon.
      var maHoaDonPrice = normalizeText_(data.maHoaDon || "");
      var maKHPrice = soanResolveMaKHFromOrder_(maHoaDonPrice, normalizeText_(data.maKH || data.maKhachHang || ""));
      var orderMaKHMapPrice = soanBuildOrderMaKHMap_();
      var lastPrice = 0;
      var lastPriceSource = "";
      try {
        var shSizeGia = getSheet_("SALES", "tbl_DonHang_CT_Size");
        var shCTGia = getSheet_("SALES", "tbl_ChiTietDonHang");
        var sizeRowsGia = shSizeGia.getLastRow() >= 2
          ? shSizeGia.getRange(2, 1, shSizeGia.getLastRow() - 1, Math.min(11, shSizeGia.getLastColumn())).getValues()
          : [];
        var ctRowsGia = shCTGia.getLastRow() >= 2
          ? shCTGia.getRange(2, 1, shCTGia.getLastRow() - 1, Math.min(8, shCTGia.getLastColumn())).getValues()
          : [];

        function buildSizeCandidate_(r) {
          return { maHD: normalizeText_(r[0]), maKH: normalizeText_(r[1]), maBH: normalizeText_(r[2]), maNB: normalizeText_(r[3]), gia: khoNum_(r[10]) };
        }
        function buildCtCandidate_(r) {
          return { maHD: normalizeText_(r[1]), maKH: normalizeText_(r[0]), maBH: normalizeText_(r[6]), maNB: normalizeText_(r[7]), gia: khoNum_(r[4]) };
        }
        function fixCandidateMaKH_(c) {
          if (soanIsKhachLe_(c.maKH) && c.maHD && orderMaKHMapPrice[c.maHD]) c.maKH = orderMaKHMapPrice[c.maHD];
          return c.maKH;
        }
        function matchGiaCandidate_(c, requireCustomer) {
          if (!c || khoNum_(c.gia) <= 0) return false;
          var cMaKH = fixCandidateMaKH_(c);
          if (requireCustomer && maKHPrice && cMaKH !== maKHPrice) return false;
          if (c.maBH && c.maBH.toUpperCase() === canonicalMaBanHang.toUpperCase()) return true;
          for (var mm = 0; mm < matched.length; mm++) {
            if (c.maNB && c.maNB === normalizeText_(matched[mm][0])) return true;
          }
          return false;
        }
        function findLatestPrice_(requireCustomer) {
          var idx, c;
          // Giữ đúng ưu tiên bản cũ: ChiTietDonHang trước CT_Size.
          for (idx = ctRowsGia.length - 1; idx >= 0; idx--) {
            c = buildCtCandidate_(ctRowsGia[idx]);
            if (matchGiaCandidate_(c, requireCustomer)) return c;
          }
          for (idx = sizeRowsGia.length - 1; idx >= 0; idx--) {
            c = buildSizeCandidate_(sizeRowsGia[idx]);
            if (matchGiaCandidate_(c, requireCustomer)) return c;
          }
          return null;
        }

        var priceCandidate = maKHPrice ? findLatestPrice_(true) : null;
        if (priceCandidate) {
          lastPrice = soanGiaVeDonViNghin_(priceCandidate.gia);
          lastPriceSource = "giá gợi ý theo khách này";
        }
        if (!lastPrice) {
          priceCandidate = findLatestPrice_(false);
          if (priceCandidate) {
            lastPrice = soanGiaVeDonViNghin_(priceCandidate.gia);
            lastPriceSource = "giá gợi ý gần nhất";
          }
        }
      } catch (priceErr) {}

      return outJson_({
        ok: true,
        maBanHang: canonicalMaBanHang,
        maSP: maSP,
        maRap: maRap,
        hieu: hieu,
        mau: mau,
        mauSanPham: mauSanPham,
        tenSanPham: tenSanPham,
        tenHienThi: tenSanPham + (mau ? " - " + mau : ""),
        linkAnhChinh: linkAnhChinh,
        sizes: sizes,
        tongTon: tongTon,
        tongGiu: tongGiu,
        tongKhaDung: tongKhaDung,
        khoList: Object.keys(khoSet),
        lastPrice: lastPrice,
        lastPriceSource: lastPriceSource
      });
    } catch (err) {
      return outJson_({ ok: false, message: "Lỗi tra mã bán hàng: " + err.message });
    }
  }

  // 7. LƯU CHI TIẾT ĐƠN HÀNG / SOẠN HÀNG XONG + GIỮ TỒN TẠM
  if (data.type === "saveOrderDetails") {
    var soanLock = null;
    var soanHasLock = false;
    try {
      soanLock = LockService.getScriptLock();
      soanHasLock = soanLock.tryLock(25000);
      if (!soanHasLock) {
        return outText_("Lỗi: Hệ thống đang có người lưu/giữ tồn. Vui lòng thử lại sau vài giây.");
      }

      var sheetDetails = getSheet_("SALES", "tbl_ChiTietDonHang");
      var sheetOrderSize = getSheet_("SALES", "tbl_DonHang_CT_Size");
      var sheetOrders2 = getSheet_("SALES", "tbl_DonHang");
      // FIX CHỐT ĐƠN V60:
      // Nếu một mã đơn từng có bản sửa hóa đơn/GỘP CHUNG cũ, khi nhân viên soạn lại
      // thì dữ liệu soạn mới phải trở thành nguồn chính để Hóa đơn đọc đúng.
      var sheetEditedDetails = getSheet_("SALES", "tbl_ChiTietThayDoiDonHang");

      var details = Array.isArray(data.details) ? data.details : [];
      var maHoaDon = normalizeText_(data.maHoaDon);
      var maKH = normalizeText_(data.maKH);
      var now = nowVN_();
      var nguoiThaoTac = normalizeText_(data.user || data.actorUser || data.currentUser || "app");

      if (!maHoaDon) {
        return outText_("Thiếu mã hóa đơn");
      }

      // Chỉ giữ các dòng thực sự có Tên SP + Số lượng > 0.
      // Không cho đơn chuyển sang "Đã soạn" nếu giao diện chỉ có dòng rỗng/lỗi.
      details = details.filter(function (item) {
        if (!item) return false;
        var tenHopLe = normalizeText_(item.tenSP);
        var slHopLe = khoNum_(item.soLuong || 0);
        if (!tenHopLe || slHopLe <= 0) return false;
        item.tenSP = tenHopLe;
        item.soLuong = slHopLe;
        return true;
      });

      if (details.length === 0) {
        return outText_("Lỗi: Không có dòng sản phẩm hợp lệ để lưu");
      }

      var step62Lock = soanCheckOrderLockedAfterExport_(maHoaDon);
      if (step62Lock.locked) {
        return outText_("Lỗi: " + step62Lock.message);
      }

      // Sửa lỗi MaKH bị KHACH_LE: server luôn lấy lại MaKH thật từ tbl_DonHang theo MaHoaDon nếu client gửi thiếu.
      maKH = soanResolveMaKHFromOrder_(maHoaDon, maKH);

      // PHẦN 27: đọc chi tiết cũ trước khi xóa/lưu lại để ghi lịch sử sửa đơn.
      var step27OldItemsBeforeSave = step27ReadOrderItems_(maHoaDon);

      // Giữ tồn tạm: kiểm tra tồn khả dụng trước khi ghi dữ liệu.
      var newHoldMap = soanBuildHoldMapFromDetails_(details);
      var oldOwnHoldMap = soanGetHoldMapForOrder_(maHoaDon);
      soanCheckCanHoldMap_(newHoldMap, oldOwnHoldMap);

      // Nếu đơn này từng lưu soạn rồi, trả giữ tồn cũ và xóa chi tiết cũ để không bị trùng dòng.
      soanReleaseHoldForOrder_(maHoaDon);
      soanDeleteOrderDetailRows_(maHoaDon);

      // Giữ tồn mới. Chỉ tăng TonGiu, chưa trừ TonThucTe.
      var maGiuHang = soanReserveHoldMap_(newHoldMap, maHoaDon, nguoiThaoTac);

      var soanDetailRows = [];
      var soanSizeRows = [];

      details.forEach(function (item) {
        if (!item || !item.tenSP) return;
        var tenSP = item.tenSP || "";
        var soLuong = khoNum_(item.soLuong || 0);
        var donGia = soanGiaVeDonViNghin_(item.donGia || 0);
        var thanhTien = soLuong * donGia;
        var maBanHang = normalizeText_(item.maBanHang || "");
        var maHangNoiBo = normalizeText_(item.maHangNoiBo || "");
        var mauChuan = normalizeText_(item.mauChuan || item.mau || "");
        var size = normalizeText_(item.size || "");
        var khoXuat = normalizeText_(item.khoXuat || "");
        var kieuBan = normalizeText_(item.kieuBan || "");
        var anhSanPham = normalizeText_(item.anhSanPham || "");
        var ghiChu = normalizeText_(item.ghiChu || "");
        if (!tenSP || soLuong <= 0) return;

        soanDetailRows.push([
          maKH, maHoaDon, tenSP, soLuong, donGia, thanhTien,
          maBanHang, maHangNoiBo, mauChuan, size, khoXuat, kieuBan, anhSanPham, ghiChu
        ]);

        if (maBanHang || maHangNoiBo || size || mauChuan || khoXuat) {
          soanSizeRows.push([
            maHoaDon, maKH, maBanHang, maHangNoiBo,
            item.maSP || "", item.maRap || "", mauChuan, size, khoXuat,
            soLuong, donGia, thanhTien,
            maHangNoiBo ? "Đã giữ" : "Chưa xuất",
            maHangNoiBo ? maGiuHang : "",
            ghiChu
          ]);
        }
      });

      if (soanDetailRows.length) {
        sheetDetails.getRange(sheetDetails.getLastRow() + 1, 1, soanDetailRows.length, 14).setValues(soanDetailRows);
      }
      if (soanSizeRows.length) {
        sheetOrderSize.getRange(sheetOrderSize.getLastRow() + 1, 1, soanSizeRows.length, 15).setValues(soanSizeRows);
      }

      // FIX CHỐT ĐƠN V60:
      // Xóa CHỈ bản sửa hóa đơn của đúng mã đang vừa soạn xong.
      // Lý do: getBillDetails ưu tiên tbl_ChiTietThayDoiDonHang; nếu còn marker
      // "GỘP CHUNG" hoặc dữ liệu sửa cũ, sản phẩm nhân viên vừa nhập sẽ bị che mất.
      // Không đụng các mã đơn khác, không đụng kho/công nợ/thanh toán.
      if (sheetEditedDetails && sheetEditedDetails.getLastRow() > 1) {
        var editedRowsAfterSoan = sheetEditedDetails.getDataRange().getValues();
        for (var ed = editedRowsAfterSoan.length - 1; ed >= 1; ed--) {
          if (normalizeText_(editedRowsAfterSoan[ed][1]) === maHoaDon) { // B: MaHoaDon
            sheetEditedDetails.deleteRow(ed + 1);
          }
        }
      }

      // Cập nhật đúng đơn theo MaHoaDon, không tải toàn bộ tbl_DonHang.
      var orderRowIndex = azFindExactRow_(sheetOrders2, 1, maHoaDon, false);
      if (orderRowIndex !== -1) {
        sheetOrders2.getRange(orderRowIndex, 7).setValue("Đã soạn");
        var ghiChuDeLuu = normalizeText_(data.ghiChuNV);
        if (!ghiChuDeLuu) ghiChuDeLuu = "Không có ghi chú";
        sheetOrders2.getRange(orderRowIndex, 15, 1, 2).setValues([[ghiChuDeLuu, now]]);
        sheetOrders2.getRange(orderRowIndex, 22).setValue(now);
      }

      // PHẦN 27: ghi log gọn trước/sau khi lưu chi tiết đơn.
      var step27NewItemsAfterSave = step27NormalizeClientItems_(details);
      step27LogOrderDetailChange_(maHoaDon, step27OldItemsBeforeSave || [], step27NewItemsAfterSave, nguoiThaoTac, normalizeText_(data.ghiChuNV));

      SpreadsheetApp.flush();

      return outText_("Thành công|Đã giữ tồn tạm");

    } catch (err) {
      return outText_("Lỗi lưu chi tiết đơn: " + err.message);
    } finally {
      try { if (soanHasLock && soanLock) soanLock.releaseLock(); } catch (eLock) {}
    }
  }

  // 8. CẬP NHẬT TRẠNG THÁI VẬN CHUYỂN / TRẠNG THÁI ĐƠN
  if (data.type === "updateShipStatus") {
    try {
      var sheetShip = getSheet_("SALES", "tbl_DonHang");
      var sheetStatusLog = getSheet_("SALES", "tbl_LichSuTrangThaiDon");

      var maHD = normalizeText_(data.maHoaDon);
      var newStatus = normalizeText_(data.newStatus);
      var nguoiThaoTac = normalizeText_(data.user || data.actorUser || "");
      var now = nowVN_();

      if (!maHD || !newStatus) {
        return outText_("Thiếu mã hóa đơn hoặc trạng thái mới");
      }

      var shipRowIndex = azFindExactRow_(sheetShip, 1, maHD, false);
      if (shipRowIndex === -1) return outText_("Không tìm thấy hóa đơn");

      var oldStatus = normalizeText_(sheetShip.getRange(shipRowIndex, 7).getValue());
      sheetShip.getRange(shipRowIndex, 7).setValue(newStatus);
      sheetShip.getRange(shipRowIndex, 22).setValue(now);

      sheetStatusLog.appendRow([
        now, maHD, oldStatus, newStatus, nguoiThaoTac, "Cập nhật từ app"
      ]);

      SpreadsheetApp.flush();
      return outText_("Thành công");

    } catch (err) {
      return outText_("Lỗi cập nhật trạng thái: " + err.message);
    }
  }

  /****************************************************
 * TASK 3A - LẤY CHI TIẾT HÓA ĐƠN
 * Đọc từ file mới:
 * 02_DATA_SALES_CRM
 ****************************************************/
  /****************************************************
 * TASK 3A.2 - LẤY CHI TIẾT HÓA ĐƠN - BẢN CHẮC CHẮN
 * Dữ liệu mới:
 * 02_DATA_SALES_CRM
 ****************************************************/
  if (data.type === "getBillDetails") {
    try {
      var sheetDonHang = getSheet_("SALES", "tbl_DonHang");
      var sheetGoc = getSheet_("SALES", "tbl_ChiTietDonHang");
      var sheetSua = getSheet_("SALES", "tbl_ChiTietThayDoiDonHang");
      var sheetKH = getSheet_("SALES", "tbl_KhachHang");
      var sheetHT = getSheet_("SALES", "tbl_HangTra");

      var dataDonHang = sheetDonHang.getDataRange().getValues();
      var dataGoc = sheetGoc.getDataRange().getValues();
      var dataSua = sheetSua.getDataRange().getValues();
      var dataKH = sheetKH.getDataRange().getValues();
      var dataHT = sheetHT.getDataRange().getValues();

      var maHoaDonInput = normalizeText_(data.maHoaDon);
      var tenKhachInput = normalizeText_(data.tenKhach);
      var isHistory = data.isHistory === true;

      if (!maHoaDonInput) {
        return outJson_({
          products: [],
          oldDebt: 0,
          maKH: "",
          ghiChuNV: "Không có ghi chú",
          subStatuses: [],
          images: "[]",
          pendingHangTra: [],
          validIds: [],
          imagesByOrder: {},
          debug: "Thiếu mã hóa đơn"
        });
      }

      // Mã có thể dạng: HD1 hoặc HD1 + HD2
      var listMa = maHoaDonInput.split("+").map(function (m) {
        return normalizeText_(m)
          .replace("-TX", "")
          .replace("-CK", "")
          .trim();
      }).filter(function (m) {
        return m !== "";
      });

      var validIds = [];
      var maKHFound = "";
      var noTrongHoaDonK = "";
      var combinedNotes = [];
      var subStatuses = [];
      var billImages = "[]";
      var billImagesByOrder = {};
      var thoiGianGui = "";

      function isSameOrder_(idDon, baseCode) {
        idDon = normalizeText_(idDon);
        baseCode = normalizeText_(baseCode);

        if (!idDon || !baseCode) return false;

        // Match chính xác
        if (idDon === baseCode) return true;

        // Match đơn tách kho: HDxxx-TX / HDxxx-CK
        if (idDon.indexOf(baseCode + "-") === 0) return true;

        return false;
      }

      // 1. Quét tbl_DonHang tìm mã hóa đơn liên quan
      for (var d = 1; d < dataDonHang.length; d++) {
        var rowDon = dataDonHang[d];
        var idDon = normalizeText_(rowDon[0]); // A: MaHoaDon
        if (!idDon) continue;

        var isMatch = false;

        for (var m = 0; m < listMa.length; m++) {
          if (isSameOrder_(idDon, listMa[m])) {
            isMatch = true;
            break;
          }
        }

        if (!isMatch) continue;

        maKHFound = rowDon[8] || maKHFound; // I: MaKH

        if (rowDon[10] !== "" && rowDon[10] !== null && rowDon[10] !== undefined) {
          noTrongHoaDonK = rowDon[10]; // K: NoTrongHoaDon
        }

        var note = rowDon[14] ? normalizeText_(rowDon[14]) : ""; // O: GhiChuNV
        if (note && note !== "Không có ghi chú") {
          if (idDon.indexOf("-TX") > -1) {
            combinedNotes.push("TX - " + note);
          } else if (idDon.indexOf("-CK") > -1) {
            combinedNotes.push("CK - " + note);
          } else {
            combinedNotes.push(note);
          }
        }

        var statusKho = rowDon[6] ? normalizeText_(rowDon[6]) : "Chưa rõ";       // G: TrangThai
        var trangThaiBill = rowDon[13] ? normalizeText_(rowDon[13]) : "";       // N: TrangThaiHoaDon

        if (isHistory) {
          // Lịch sử chỉ lấy đơn đã gửi
          if (trangThaiBill === "Đã gửi đơn") {
            validIds.push(idDon);
          }
        } else {
          // Đơn mới: chỉ loại trừ Mới / Nợ đơn / Xóa / Đã gửi đơn
          // Đã soạn thì chắc chắn được lên bill.
          if (
            trangThaiBill !== "Đã gửi đơn" &&
            statusKho !== "Mới" &&
            statusKho !== "Nợ đơn" &&
            statusKho !== "Xóa"
          ) {
            validIds.push(idDon);
          }
        }

        var hienThiStatus = statusKho;
        if (trangThaiBill === "Đã gửi đơn") {
          hienThiStatus = "✅ Đã gửi đơn (Đã chốt)";
          if (rowDon[21]) thoiGianGui = rowDon[21]; // V: CapNhatCuoi
        }

        if (idDon.indexOf("-TX") > -1) {
          subStatuses.push("📦 Tân Xuân: " + hienThiStatus);
        } else if (idDon.indexOf("-CK") > -1) {
          subStatuses.push("📦 Cá Koi: " + hienThiStatus);
        } else {
          subStatuses.push("📦 " + idDon + ": " + hienThiStatus);
        }

        // Ảnh đơn: H = AnhZaloJson
        if (rowDon[7] && normalizeText_(rowDon[7]).length > 5) {
          var newImages = safeParseJson_(normalizeText_(rowDon[7]), []);

          billImagesByOrder[idDon] = newImages;

          var currentImages = safeParseJson_(billImages, []);
          newImages.forEach(function (img) {
            if (currentImages.indexOf(img) === -1) currentImages.push(img);
          });

          billImages = JSON.stringify(currentImages);
        }
      }

      // 2. Nếu validIds rỗng nhưng tbl_ChiTietDonHang có sản phẩm,
      // vẫn tự đưa mã đó lên bill để tránh hóa đơn trống.
      if (validIds.length === 0) {
        for (var gd = 1; gd < dataGoc.length; gd++) {
          var maTrongChiTiet = dataGoc[gd][1] ? normalizeText_(dataGoc[gd][1]) : "";
          if (!maTrongChiTiet) continue;

          for (var lm = 0; lm < listMa.length; lm++) {
            if (isSameOrder_(maTrongChiTiet, listMa[lm])) {
              if (validIds.indexOf(maTrongChiTiet) === -1) {
                validIds.push(maTrongChiTiet);
              }
            }
          }
        }
      }

      // FIX CHỐT ĐƠN V60:
      // Phân biệt "bản sửa hóa đơn còn hiệu lực" với "bản sửa/marker cũ hơn lần soạn mới".
      // Điều này tự cứu các đơn đã bị lỗi trước khi cài bản vá:
      // - Sửa HĐ/GỘP CHUNG SAU khi soạn xong => vẫn tôn trọng bản sửa.
      // - Marker/bản sửa CŨ hơn GioSoanXong => dùng chi tiết soạn mới.
      function billParseTimeV60_(v) {
        if (!v) return 0;
        if (v instanceof Date) return v.getTime();

        var s = normalizeText_(v);
        if (!s) return 0;

        var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
        if (m) {
          var d = new Date(
            Number(m[3]),
            Number(m[2]) - 1,
            Number(m[1]),
            Number(m[4] || 0),
            Number(m[5] || 0),
            Number(m[6] || 0)
          );
          return isNaN(d.getTime()) ? 0 : d.getTime();
        }

        var d2 = new Date(s);
        return isNaN(d2.getTime()) ? 0 : d2.getTime();
      }

      function billSoanDoneTimeV60_(idDon) {
        idDon = normalizeText_(idDon);
        for (var od60 = 1; od60 < dataDonHang.length; od60++) {
          if (normalizeText_(dataDonHang[od60][0]) === idDon) {
            return billParseTimeV60_(dataDonHang[od60][15]); // P: GioSoanXong
          }
        }
        return 0;
      }

      function billUseEditedRowsV60_(idDon, itemsSua) {
        if (!itemsSua || itemsSua.length === 0) return false;

        var soanDoneMs = billSoanDoneTimeV60_(idDon);

        var latestEditMs = 0;
        itemsSua.forEach(function (r) {
          var t = billParseTimeV60_(r[13]); // N: ThoiGianSua
          if (t > latestEditMs) latestEditMs = t;
        });

        // =====================================================
        // AZALAS V84 - FIX SỬA HÓA ĐƠN LƯU XONG BỊ NHẢY VỀ SỐ CŨ
        //
        // updateEditedBill luôn:
        // - ghi ThoiGianSua vào cột N của tbl_ChiTietThayDoiDonHang
        // - ghi CapNhatCuoi vào cột V của tbl_DonHang
        // cùng một thời điểm.
        //
        // Một số database MAIN có GioSoanXong cũ/khác kiểu ngày khiến phép so sánh
        // V60 hiểu nhầm bản sửa là "cũ" rồi lấy lại tbl_ChiTietDonHang gốc.
        // Vì vậy nếu CapNhatCuoi của đơn trùng/gần với ThoiGianSua thì chắc chắn
        // đây là bản sửa vừa lưu và phải ưu tiên bản sửa.
        // =====================================================
        var capNhatCuoiMs = 0;
        idDon = normalizeText_(idDon);

        for (var od84 = 1; od84 < dataDonHang.length; od84++) {
          if (normalizeText_(dataDonHang[od84][0]) === idDon) {
            capNhatCuoiMs = billParseTimeV60_(dataDonHang[od84][21]); // V: CapNhatCuoi
            break;
          }
        }

        // Nếu dữ liệu sửa không có thời gian thì giữ hành vi cũ: ưu tiên bản sửa.
        if (!latestEditMs) return true;

        // Bản sửa vừa lưu: thời gian dòng sửa và CapNhatCuoi thường bằng nhau
        // hoặc lệch vài giây. Cho biên 10 phút để tránh sai số định dạng/ghi sheet.
        if (
          capNhatCuoiMs &&
          Math.abs(capNhatCuoiMs - latestEditMs) <= 10 * 60 * 1000
        ) {
          return true;
        }

        // Không có GioSoanXong thì bản sửa là nguồn ưu tiên.
        if (!soanDoneMs) return true;

        // Giữ cơ chế V60 cho dữ liệu lịch sử cũ.
        return latestEditMs >= soanDoneMs;
      }

      // 3. Lấy sản phẩm
      var products = [];

      validIds.forEach(function (vid) {
        var idDon = normalizeText_(vid);

        var itemsSua = dataSua.filter(function (row) {
          return row[1] && normalizeText_(row[1]) === idDon;
        });

        var useEdited = billUseEditedRowsV60_(idDon, itemsSua);

        if (useEdited) {
          var realItems = itemsSua.filter(function (r) {
            return normalizeText_(r[2]) !== "GỘP CHUNG";
          });

          products = products.concat(realItems);
        } else {
          var itemsGoc = dataGoc.filter(function (row) {
            return row[1] && normalizeText_(row[1]) === idDon;
          });

          products = products.concat(itemsGoc);
        }
      });

      // 4. Nếu products vẫn rỗng, quét trực tiếp lần cuối theo maHoaDonInput
      // Đoạn này để bắt chắc trường hợp mã truyền vào bị lạ.
      if (products.length === 0) {
        for (var px = 1; px < dataGoc.length; px++) {
          var maCT = normalizeText_(dataGoc[px][1]);

          for (var bx = 0; bx < listMa.length; bx++) {
            if (isSameOrder_(maCT, listMa[bx])) {
              products.push(dataGoc[px]);

              if (validIds.indexOf(maCT) === -1) {
                validIds.push(maCT);
              }
            }
          }
        }
      }

      // 5. Ghi chú
      var ghiChuHienTai = combinedNotes.join("\n");
      if (!ghiChuHienTai) ghiChuHienTai = "Không có ghi chú";

      // 6. Lấy nợ cũ
      var rawOldDebt = 0;

      if (maKHFound) {
        for (var k = 1; k < dataKH.length; k++) {
          if (dataKH[k][0] && normalizeText_(dataKH[k][0]) === normalizeText_(maKHFound)) {
            rawOldDebt = parseFloat(dataKH[k][4]) || 0; // E: NoHienTai
            break;
          }
        }
      }

      if (!maKHFound && tenKhachInput) {
        for (var kh = 1; kh < dataKH.length; kh++) {
          if (normalizeText_(dataKH[kh][1]).toLowerCase() === tenKhachInput.toLowerCase()) {
            maKHFound = dataKH[kh][0] || "";
            rawOldDebt = parseFloat(dataKH[kh][4]) || 0;
            break;
          }
        }
      }

      // 7. Phiếu hàng trả chưa xử lý
      var pendingHangTra = [];

      for (var h = 1; h < dataHT.length; h++) {
        var rowHT = dataHT[h];

        var maPhieu = rowHT[0];
        var ngayTra = rowHT[1];
        var tenKhachHT = normalizeText_(rowHT[2]);
        var tongTienTra = rowHT[3];
        var nguoiKiem = rowHT[4];
        var trangThaiHT = normalizeText_(rowHT[5]);
        var ghiChuHT = rowHT[6];
        var maKHHT = rowHT[7] || "";

        var matchByName = tenKhachInput && tenKhachHT === tenKhachInput;
        var matchByMaKH = maKHFound && normalizeText_(maKHHT) === normalizeText_(maKHFound);

        if ((matchByName || matchByMaKH) && trangThaiHT === "Mới") {
          pendingHangTra.push({
            maPhieu: maPhieu,
            ngay: ngayTra,
            soTien: parseFloat(tongTienTra) || 0,
            nguoiKiem: nguoiKiem,
            ghiChu: ghiChuHT,
            tenKhach: tenKhachHT,
            maKH: maKHHT
          });
        }
      }

      return outJson_({
        products: products,
        oldDebt: rawOldDebt,
        maKH: maKHFound,
        ghiChuNV: ghiChuHienTai,
        subStatuses: subStatuses,
        images: billImages,
        pendingHangTra: pendingHangTra,
        validIds: validIds,
        imagesByOrder: billImagesByOrder,
        thoiGianGui: thoiGianGui,
        noTrongHoaDon: noTrongHoaDonK,

        // Debug tạm để nếu còn lỗi mình nhìn biết ngay
        debug: {
          maHoaDonInput: maHoaDonInput,
          listMa: listMa,
          validIds: validIds,
          productCount: products.length,
          donHangRows: dataDonHang.length,
          chiTietRows: dataGoc.length
        }
      });

    } catch (err) {
      return outJson_({
        products: [],
        oldDebt: 0,
        maKH: "",
        ghiChuNV: "Không có ghi chú",
        subStatuses: [],
        images: "[]",
        pendingHangTra: [],
        validIds: [],
        imagesByOrder: {},
        error: "Lỗi getBillDetails: " + err.message
      });
    }
  }

  // 10. LỆNH XÍ ĐƠN/HỦY ĐƠN - BẢN TƯƠNG THÍCH CŨ
  // Data mới: SALES / tbl_DonHang
  // Giữ response dạng text: OK / ERROR_ALREADY_TAKEN_xxx
  if (data.type === "updateOrderStatus") {
    try {
      var sheet = getSheet_("SALES", "tbl_DonHang");
      var sheetLog = getSheet_("SALES", "tbl_LichSuTrangThaiDon");

      var maHoaDon = normalizeText_(data.maHoaDon || data.maDon);
      var newStatus = normalizeText_(data.newStatus || data.status);
      var nguoiSoan = normalizeText_(data.nguoiSoan || data.user || data.actorUser || "");
      var now = nowVN_();

      if (!maHoaDon) {
        return outText_("ERROR: Thiếu mã hóa đơn");
      }

      if (!newStatus) {
        return outText_("ERROR: Thiếu trạng thái mới");
      }

      var values = sheet.getDataRange().getValues();

      for (var i = 1; i < values.length; i++) {
        var maTrongSheet = normalizeText_(values[i][0]); // A: MaHoaDon

        if (maTrongSheet === maHoaDon) {
          var oldStatus = normalizeText_(values[i][6]);     // G: TrangThai
          var nguoiHienTai = normalizeText_(values[i][9]);  // J: NguoiSoan

          // Chặn 2 người cùng xí đơn
          if (newStatus === "Đang soạn") {
            if (
              nguoiHienTai !== "" &&
              nguoiSoan !== "" &&
              nguoiHienTai.toUpperCase() !== nguoiSoan.toUpperCase()
            ) {
              return outText_("ERROR_ALREADY_TAKEN_" + nguoiHienTai);
            }
          }

          // Cập nhật trạng thái cột G
          sheet.getRange(i + 1, 7).setValue(newStatus);

          // Cập nhật người soạn cột J
          if (newStatus === "Nợ đơn" || newStatus === "Xóa" || newStatus === "Mới") {
            sheet.getRange(i + 1, 10).setValue("");
          } else if (newStatus === "Đang soạn") {
            sheet.getRange(i + 1, 10).setValue(nguoiSoan);
          }

          // Cập nhật cuối cột V
          sheet.getRange(i + 1, 22).setValue(now);

          // Ghi lịch sử trạng thái
          sheetLog.appendRow([
            now,
            maHoaDon,
            oldStatus,
            newStatus,
            nguoiSoan,
            "Cập nhật từ updateOrderStatus"
          ]);

          SpreadsheetApp.flush();
          return outText_("OK");
        }
      }

      return outText_("ERROR: Không tìm thấy hóa đơn " + maHoaDon);

    } catch (err) {
      return outText_("ERROR updateOrderStatus: " + err.message);
    }
  }
  // 11. CHỐT ĐƠN & CẬP NHẬT NHIỀU KHOẢN THANH TOÁN
  // FIX DATA MỚI: ghi vào SALES + TAI_CHINH, trả đúng OK_CHOT_NO cho frontend
  if (data.type === "confirmAndCloseDebt") {
    var chotNoLockV27 = LockService.getScriptLock();
    try {
      chotNoLockV27.waitLock(30000);
      var sheetDonHang = getSheet_("SALES", "tbl_DonHang");
      var sheetKhachHang = getSheet_("SALES", "tbl_KhachHang");
      var sheetChiTiet = getSheet_("SALES", "tbl_ChiTietDonHang");
      var sheetSua = getSheet_("SALES", "tbl_ChiTietThayDoiDonHang");
      var sheetHangTra = getSheet_("SALES", "tbl_HangTra");

      var sheetNK = getSheet_("TAI_CHINH", "tbl_NhatKyNo");
      var sheetTT = getSheet_("TAI_CHINH", "tbl_ThanhToanKhach");
      var sheetCNTH = getSheet_("TAI_CHINH", "tbl_CongNo_TongHop");

      var maHD = normalizeText_(data.maHoaDon);
      var maKH = normalizeText_(data.maKH);
      var selectedIds = Array.isArray(data.selectedIds) ? data.selectedIds : [];
      var danhSachTra = Array.isArray(data.danhSachTra) ? data.danhSachTra : [];

      selectedIds = selectedIds
        .map(function (x) {
          return normalizeText_(x);
        })
        .filter(function (x) {
          return x !== "";
        });

      if (selectedIds.length === 0 && maHD) {
        selectedIds = [maHD];
      }

      if (selectedIds.length === 0) {
        return outText_("Lỗi: Bạn chưa tick hóa đơn nào để chốt");
      }

      if (!maKH) {
        return outText_("Lỗi: Thiếu mã khách hàng khi chốt hóa đơn");
      }

      var noCuAppGuiLen = parseFloat(data.noCu);
      if (isNaN(noCuAppGuiLen)) noCuAppGuiLen = 0;

      var totalDonFrontend = parseFloat(data.totalDonNay);
      if (isNaN(totalDonFrontend)) totalDonFrontend = 0;

      var nguoiChotDon = normalizeText_(data.userChotDon || data.user || data.actorUser) || "Chưa rõ";
      var now = nowVN_();
      var today = dateVN_();

      // ==============================
      // 1. TÌM KHÁCH HÀNG TRONG DATA MỚI
      // ==============================
      var dataKH = sheetKhachHang.getDataRange().getValues();
      var tenKH = "";
      var noThucTeHeThong = 0;
      var rowKH = -1;

      for (var k = 1; k < dataKH.length; k++) {
        if (normalizeText_(dataKH[k][0]) === maKH) {
          rowKH = k + 1;
          tenKH = dataKH[k][1] || "";
          noThucTeHeThong = parseFloat(dataKH[k][4]) || 0; // E: NoHienTai
          break;
        }
      }

      if (rowKH === -1) {
        return outText_("Lỗi: Không tìm thấy khách hàng " + maKH);
      }

      // ==============================
      // 2. TÍNH TỔNG TIỀN THEO MÃ ĐƠN
      // Ưu tiên bảng hóa đơn đã sửa; nếu chưa sửa thì lấy bảng chi tiết gốc.
      // ==============================
      var dataCT = sheetChiTiet.getDataRange().getValues();
      var dataSua = sheetSua.getDataRange().getValues();

      function tinhTongTheoMaDon_(maDon) {
        maDon = normalizeText_(maDon);
        var tong = 0;
        var coDuLieuSua = false;

        for (var s = 1; s < dataSua.length; s++) {
          var maSua = normalizeText_(dataSua[s][1]);     // B: MaHoaDon
          var tenSPSua = normalizeText_(dataSua[s][2]);  // C: TenSP

          if (maSua === maDon && tenSPSua !== "GỘP CHUNG") {
            coDuLieuSua = true;
            tong += parseFloat(dataSua[s][5]) || 0;      // F: ThanhTien
          }
        }

        if (coDuLieuSua) return tong;

        for (var c = 1; c < dataCT.length; c++) {
          var maCT = normalizeText_(dataCT[c][1]);       // B: MaHoaDon
          if (maCT === maDon) {
            tong += parseFloat(dataCT[c][5]) || 0;       // F: ThanhTien
          }
        }

        return tong;
      }

      var totalDonNay = 0;
      selectedIds.forEach(function (id) {
        totalDonNay += tinhTongTheoMaDon_(id);
      });

      // Nếu không tính được từ sheet, dùng tổng frontend gửi lên để tránh kẹt chốt đơn
      if (totalDonNay <= 0 && totalDonFrontend > 0) {
        totalDonNay = totalDonFrontend;
      }

      if (totalDonNay <= 0) {
        return outText_("Lỗi: Tổng tiền hóa đơn bằng 0, chưa thể chốt");
      }

      // ==============================
      // 3. TÍNH TIỀN KHÁCH TRẢ / CỘNG THÊM
      // ==============================
      var tongKhachTra = 0;
      var tongCongThem = 0;

      danhSachTra.forEach(function (item) {
        var soTien =
          parseFloat(item.amount) ||
          parseFloat(item.soTien) ||
          parseFloat(item.tien) ||
          0;

        if (soTien <= 0) return;

        var method = normalizeText_(item.method || item.hinhThuc || item.type);

        if (method === "Cộng thêm") {
          tongCongThem += soTien;
        } else {
          tongKhachTra += soTien;
        }
      });

      // Nếu frontend có gửi nợ cũ thì dùng nợ đó; nếu không, lấy nợ trong hệ thống
      var noGocDeTinh = noCuAppGuiLen;
      if (data.noCu === undefined || data.noCu === null || data.noCu === "") {
        noGocDeTinh = noThucTeHeThong;
      }

      var conLaiHoaDon = totalDonNay + tongCongThem - tongKhachTra;
      if (conLaiHoaDon <= 1) conLaiHoaDon = 0;

      var noMoi = noGocDeTinh + totalDonNay + tongCongThem - tongKhachTra;
      if (noMoi <= 1) noMoi = 0;

      // ==============================
      // 3B. KIỂM TRA TỒN TRƯỚC KHI CHỐT
      // Chỉ kiểm tra các dòng soạn có MaHangNoiBo trong tbl_DonHang_CT_Size.
      // Nếu đơn cũ chưa có dữ liệu size thì bỏ qua, không làm kẹt chốt hóa đơn cũ.
      // ==============================
      var sizeRowsCanXuat = soanCollectSizeRowsForOrders_(selectedIds);
      soanPrecheckCanExportStock_(sizeRowsCanXuat);

      // ==============================
      // 4. CẬP NHẬT tbl_DonHang TRONG SALES
      // ==============================
      var dataDH = sheetDonHang.getDataRange().getValues();
      var daCapNhat = 0;
      var daGhiTienVaoDongChinh = false;

      for (var i = 1; i < dataDH.length; i++) {
        var idDon = normalizeText_(dataDH[i][0]); // A: MaHoaDon
        if (selectedIds.indexOf(idDon) === -1) continue;

        var trangThaiBill = normalizeText_(dataDH[i][13]); // N: TrangThaiHoaDon
        var statusKho = normalizeText_(dataDH[i][6]);      // G: TrangThai

        if (trangThaiBill === "Đã gửi đơn") {
          continue;
        }

        if (statusKho === "Mới" || statusKho === "Nợ đơn" || statusKho === "Xóa") {
          continue;
        }

        var tongTienDongNay = tinhTongTheoMaDon_(idDon);

        // Nếu chỉ có 1 hóa đơn và không tính được từ sheet, lấy tổng frontend
        if (selectedIds.length === 1 && tongTienDongNay <= 0) {
          tongTienDongNay = totalDonNay;
        }

        var daThanhToanDongNay = 0;
        var conLaiDongNay = 0;

        // Ghi thanh toán/nợ vào dòng chính đầu tiên có tiền, tránh đơn gộp bị nhân đôi
        if (!daGhiTienVaoDongChinh && tongTienDongNay > 0) {
          daThanhToanDongNay = tongKhachTra;
          conLaiDongNay = conLaiHoaDon;
          daGhiTienVaoDongChinh = true;
        }

        // Không ghi "Đã gửi đơn" vào cột G TrangThai; cột G chỉ giữ trạng thái xử lý/soạn hàng.
        sheetDonHang.getRange(i + 1, 11).setValue(conLaiDongNay);      // K: NoTrongHoaDon
        sheetDonHang.getRange(i + 1, 12).setValue(tongTienDongNay);    // L: TongTien
        sheetDonHang.getRange(i + 1, 13).setValue(daThanhToanDongNay); // M: DaThanhToan
        sheetDonHang.getRange(i + 1, 14).setValue("Đã gửi đơn");       // N: TrangThaiHoaDon
        sheetDonHang.getRange(i + 1, 22).setValue(now);                // V: CapNhatCuoi

        daCapNhat++;
      }

      if (daCapNhat === 0) {
        return outText_("Lỗi: Không có hóa đơn hợp lệ để chốt. Kiểm tra đơn đã gửi/chưa, hoặc trạng thái đơn.");
      }

      // ==============================
      // 4B. TRỪ TỒN THẬT KHI CHỐT HÓA ĐƠN
      // - Giảm TonThucTe
      // - Giảm TonGiu đã giữ
      // - Ghi tbl_Kho_TheKho
      // ==============================
      var kqXuatKho = soanFinalizeStockForOrders_(selectedIds, nguoiChotDon);

      // ==============================
      // 5. CẬP NHẬT NỢ KHÁCH HÀNG
      // ==============================
      sheetKhachHang.getRange(rowKH, 5).setValue(noMoi); // E: NoHienTai
      sheetKhachHang.getRange(rowKH, 12).setValue(now);  // L: CapNhatCuoi

      // ==============================
      // 6. GHI NHẬT KÝ NỢ
      // ==============================
      if (Math.abs(noGocDeTinh - noThucTeHeThong) > 1) {
        sheetNK.appendRow([
          maKH,
          tenKH,
          now,
          "DIEU_CHINH_NO_CU",
          noGocDeTinh - noThucTeHeThong,
          "Điều chỉnh nợ cũ khi chốt hóa đơn " + (maHD || selectedIds.join("+")),
          nguoiChotDon,
          maHD || selectedIds.join("+"),
          "KHACH_HANG"
        ]);
      }

      sheetNK.appendRow([
        maKH,
        tenKH,
        now,
        "PHAT_SINH_NO",
        totalDonNay,
        "Chốt hóa đơn " + selectedIds.join(", "),
        nguoiChotDon,
        maHD || selectedIds.join("+"),
        "KHACH_HANG"
      ]);

      if (tongCongThem > 0) {
        sheetNK.appendRow([
          maKH,
          tenKH,
          now,
          "CONG_THEM",
          tongCongThem,
          "Cộng thêm khi chốt hóa đơn " + selectedIds.join(", "),
          nguoiChotDon,
          maHD || selectedIds.join("+"),
          "KHACH_HANG"
        ]);
      }

      if (tongKhachTra > 0) {
        sheetNK.appendRow([
          maKH,
          tenKH,
          now,
          "KHACH_THANH_TOAN",
          -tongKhachTra,
          "Khách thanh toán khi chốt hóa đơn " + selectedIds.join(", "),
          nguoiChotDon,
          maHD || selectedIds.join("+"),
          "KHACH_HANG"
        ]);
      }

      // ==============================
      // 7. GHI TỪNG KHOẢN THANH TOÁN
      // ==============================
      danhSachTra.forEach(function (item) {
        var soTien =
          parseFloat(item.amount) ||
          parseFloat(item.soTien) ||
          parseFloat(item.tien) ||
          0;

        if (soTien <= 0) return;

        var method = normalizeText_(item.method || item.hinhThuc || item.type) || "Thanh toán";
        var note = normalizeText_(item.note || item.ghiChu) || "";
        var ngayTT = item.date || item.ngay || today;

        sheetTT.appendRow([
          makeId_("TTKH"),
          ngayTT,
          maKH,
          tenKH,
          maHD || selectedIds.join("+"),
          soTien,
          method,
          nguoiChotDon,
          note
        ]);
      });

      // ==============================
      // 8. ĐỔI TRẠNG THÁI HÀNG TRẢ NẾU CÓ CẤN TRỪ
      // ==============================
      if (danhSachTra.length > 0 && sheetHangTra) {
        var dataHT = sheetHangTra.getDataRange().getValues();

        danhSachTra.forEach(function (item) {
          var method = normalizeText_(item.method || item.hinhThuc || item.type);
          var note = normalizeText_(item.note || item.ghiChu);

          if (method !== "Hàng Trả") return;

          for (var h = 1; h < dataHT.length; h++) {
            var maPhieuTra = normalizeText_(dataHT[h][0]);
            if (maPhieuTra && note.indexOf(maPhieuTra) > -1) {
              sheetHangTra.getRange(h + 1, 6).setValue("Đã duyệt"); // F: TrangThai
              sheetHangTra.getRange(h + 1, 9).setValue(maHD || selectedIds.join("+")); // I: MaHoaDonGoc
              sheetHangTra.getRange(h + 1, 10).setValue(now); // J: CapNhatCuoi
            }
          }
        });
      }

      // ==============================
      // 9. CẬP NHẬT CÔNG NỢ TỔNG HỢP
      // ==============================
      var dataCN = sheetCNTH.getDataRange().getValues();
      var rowCN = -1;

      for (var cn = 1; cn < dataCN.length; cn++) {
        if (normalizeText_(dataCN[cn][0]) === maKH) {
          rowCN = cn + 1;
          break;
        }
      }

      if (rowCN === -1) {
        sheetCNTH.appendRow([
          maKH,
          tenKH,
          "KHACH_HANG",
          0,
          totalDonNay + tongCongThem,
          tongKhachTra,
          noMoi,
          now
        ]);
      } else {
        var psTangCu = parseFloat(sheetCNTH.getRange(rowCN, 5).getValue()) || 0;
        var psGiamCu = parseFloat(sheetCNTH.getRange(rowCN, 6).getValue()) || 0;

        sheetCNTH.getRange(rowCN, 2).setValue(tenKH);
        sheetCNTH.getRange(rowCN, 3).setValue("KHACH_HANG");
        sheetCNTH.getRange(rowCN, 5).setValue(psTangCu + totalDonNay + tongCongThem);
        sheetCNTH.getRange(rowCN, 6).setValue(psGiamCu + tongKhachTra);
        sheetCNTH.getRange(rowCN, 7).setValue(noMoi);
        sheetCNTH.getRange(rowCN, 8).setValue(now);
      }

      SpreadsheetApp.flush();

      // Frontend của bạn đang chờ đúng text này.
      return outText_("OK_CHOT_NO");

    } catch (error) {
      return outText_("LỖI_MÁY_CHỦ: " + error.message);
    } finally {
      try { chotNoLockV27.releaseLock(); } catch (lockErrV27) {}
    }
  }
  // 11X. XÓA MỀM / KHÔI PHỤC / XÓA VĨNH VIỄN HÓA ĐƠN
  // Đã chuyển sang data mới: 02_DATA_SALES_CRM
  if (data.type === "xuLyHoaDonXoa") {
    var lock = LockService.getScriptLock();

    var out = function (obj) {
      return ContentService
        .createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
    };

    try {
      lock.waitLock(20000);

      var sheetDonHang = getSheet_("SALES", "tbl_DonHang");
      var sheetCT = getSheet_("SALES", "tbl_ChiTietDonHang");
      var sheetSua = getSheet_("SALES", "tbl_ChiTietThayDoiDonHang");

      // Các sheet phụ, có thì xóa theo, không có cũng không làm lỗi app
      var ssSales = getSS_("SALES");
      var sheetCTSize = ssSales.getSheetByName("tbl_DonHang_CT_Size");
      var sheetAnhZalo = ssSales.getSheetByName("tbl_DonHang_AnhZalo");

      var action = normalizeText_(data.action);
      // SOFT_DELETE | RESTORE | PERMANENT_DELETE

      var selectedIds = Array.isArray(data.selectedIds) ? data.selectedIds : [];
      selectedIds = selectedIds
        .map(function (x) {
          return normalizeText_(x);
        })
        .filter(function (x) {
          return x !== "";
        });

      if (selectedIds.length === 0) {
        return out({
          ok: false,
          message: "Bạn chưa tick hóa đơn nào"
        });
      }

      var userName = normalizeText_(data.userName || data.user || data.actorUser) || "Không rõ";
      var nowText = nowVN_();

      var values = sheetDonHang.getDataRange().getValues();

      var done = [];
      var skipped = [];

      function idInList_(id) {
        return selectedIds.indexOf(normalizeText_(id)) > -1;
      }

      function deleteRowsByIds_(sheet, colIndexOneBased, ids) {
        if (!sheet) return 0;

        var vals = sheet.getDataRange().getValues();
        var count = 0;

        for (var r = vals.length - 1; r >= 1; r--) {
          var id = normalizeText_(vals[r][colIndexOneBased - 1]);

          if (ids.indexOf(id) > -1) {
            sheet.deleteRow(r + 1);
            count++;
          }
        }

        return count;
      }

      // ==============================
      // A. XÓA MỀM
      // Không xóa dòng thật.
      // Chỉ đổi cột N = Đã xóa đơn
      // Cột Q = thời gian xóa
      // Cột R = người xóa
      // Cột V = cập nhật cuối
      // ==============================
      if (action === "SOFT_DELETE") {
        var restoredStockTotal = 0;
        var releasedHoldTotal = 0;

        for (var i = 1; i < values.length; i++) {
          var idDon = normalizeText_(values[i][0]); // A: MaHoaDon
          if (!idInList_(idDon)) continue;

          var trangThaiBill = normalizeText_(values[i][13]); // N: TrangThaiHoaDon

          if (trangThaiBill === "Đã xóa đơn" || trangThaiBill === "Đã hủy đơn") {
            skipped.push(idDon + " đã xử lý trước đó");
            continue;
          }

          // Nếu hóa đơn đã chốt và đã xuất kho thật: hoàn TonThucTe trước.
          var restoreResult = { returned: 0, rows: 0 };
          try {
            restoreResult = soanReturnExportedStockForOrders_([idDon], userName);
          } catch (restoreErr) {
            skipped.push(idDon + " lỗi hoàn tồn: " + restoreErr.message);
            continue;
          }

          // Nếu đơn mới chỉ giữ tồn tạm, chưa xuất kho: trả TonGiu.
          if (!restoreResult.returned) {
            try {
              var releaseResult = soanReleaseHoldForOrder_(idDon);
              releasedHoldTotal += khoNum_(releaseResult.released);
            } catch (holdErr) {
              skipped.push(idDon + " lỗi trả giữ tồn: " + holdErr.message);
              continue;
            }
          }

          var newBillStatus = restoreResult.returned > 0 ? "Đã hủy đơn" : "Đã xóa đơn";
          restoredStockTotal += khoNum_(restoreResult.returned);

          sheetDonHang.getRange(i + 1, 14).setValue(newBillStatus); // N
          sheetDonHang.getRange(i + 1, 17).setValue(nowText);       // Q: ThoiGianHuy
          sheetDonHang.getRange(i + 1, 18).setValue(userName);      // R: NguoiHuy
          sheetDonHang.getRange(i + 1, 22).setValue(nowText);       // V: CapNhatCuoi

          done.push(idDon);
        }

        SpreadsheetApp.flush();

        return out({
          ok: done.length > 0,
          action: action,
          message: done.length > 0 ? "Đã xử lý hủy/xóa đơn" : "Không có đơn nào được xử lý",
          done: done,
          skipped: skipped,
          restoredStock: restoredStockTotal,
          releasedHold: releasedHoldTotal
        });
      }

      // ==============================
      // B. KHÔI PHỤC
      // Data mới dùng "Chưa gửi đơn"
      // Cột N = Chưa gửi đơn
      // Cột Q/R = rỗng
      // Cột V = cập nhật cuối
      // ==============================
      if (action === "RESTORE") {
        for (var j = 1; j < values.length; j++) {
          var idRestore = normalizeText_(values[j][0]);
          if (!idInList_(idRestore)) continue;

          var trangThaiRestore = normalizeText_(values[j][13]);

          if (trangThaiRestore !== "Đã xóa đơn") {
            skipped.push(idRestore + " không phải đơn đã xóa");
            continue;
          }

          var restoreHoldResult = { held: 0, rows: 0, holdId: "" };
          try {
            restoreHoldResult = soanRestoreHoldForOrder_(idRestore, userName);
          } catch (restoreHoldErr) {
            skipped.push(idRestore + " không đủ tồn để khôi phục giữ hàng: " + restoreHoldErr.message + ". Hãy tạo/soạn lại đơn.");
            continue;
          }

          sheetDonHang.getRange(j + 1, 14).setValue("Chưa gửi đơn"); // N
          sheetDonHang.getRange(j + 1, 17).setValue("");             // Q
          sheetDonHang.getRange(j + 1, 18).setValue("");             // R
          sheetDonHang.getRange(j + 1, 22).setValue(nowText);        // V

          done.push(idRestore + (restoreHoldResult.held ? (" | giữ lại " + restoreHoldResult.held) : ""));
        }

        SpreadsheetApp.flush();

        return out({
          ok: done.length > 0,
          action: action,
          message: done.length > 0 ? "Đã khôi phục đơn" : "Không có đơn nào được khôi phục",
          done: done,
          skipped: skipped
        });
      }

      // ==============================
      // C. XÓA VĨNH VIỄN
      // Chỉ xóa nếu cột N = Đã xóa đơn
      // Xóa luôn chi tiết đơn, bảng sửa, bảng size, ảnh Zalo liên quan
      // ==============================
      if (action === "PERMANENT_DELETE") {
        var allowedIds = [];

        for (var k = 1; k < values.length; k++) {
          var idDelete = normalizeText_(values[k][0]);
          if (!idInList_(idDelete)) continue;

          var trangThaiDelete = normalizeText_(values[k][13]);

          if (trangThaiDelete === "Đã xóa đơn" || trangThaiDelete === "Đã hủy đơn") {
            allowedIds.push(idDelete);
          } else {
            skipped.push(idDelete + " chưa ở trạng thái Đã xóa đơn / Đã hủy đơn");
          }
        }

        if (allowedIds.length === 0) {
          return out({
            ok: false,
            action: action,
            message: "Không có đơn hợp lệ để xóa vĩnh viễn",
            done: [],
            skipped: skipped
          });
        }

        // Đảm bảo trả giữ tồn trước khi xóa vĩnh viễn.
        allowedIds.forEach(function(id) {
          try { soanReleaseHoldForOrder_(id); } catch (holdErr2) {}
        });

        var countDH = deleteRowsByIds_(sheetDonHang, 1, allowedIds); // tbl_DonHang: A MaHoaDon
        var countCT = deleteRowsByIds_(sheetCT, 2, allowedIds);      // tbl_ChiTietDonHang: B MaHoaDon
        var countSua = deleteRowsByIds_(sheetSua, 2, allowedIds);    // tbl_ChiTietThayDoiDonHang: B MaHoaDon
        var countCTSize = deleteRowsByIds_(sheetCTSize, 1, allowedIds); // tbl_DonHang_CT_Size: A MaHoaDon
        var countAnh = deleteRowsByIds_(sheetAnhZalo, 2, allowedIds);   // tbl_DonHang_AnhZalo: B MaHoaDon

        SpreadsheetApp.flush();

        return out({
          ok: true,
          action: action,
          message: "Đã xóa vĩnh viễn",
          done: allowedIds,
          skipped: skipped,
          deletedRows: {
            tbl_DonHang: countDH,
            tbl_ChiTietDonHang: countCT,
            tbl_ChiTietThayDoiDonHang: countSua,
            tbl_DonHang_CT_Size: countCTSize,
            tbl_DonHang_AnhZalo: countAnh
          }
        });
      }

      return out({
        ok: false,
        message: "Action không hợp lệ: " + action
      });

    } catch (err) {
      return out({
        ok: false,
        message: "Lỗi máy chủ: " + err.message
      });
    } finally {
      try {
        lock.releaseLock();
      } catch (e) { }
    }
  }
  // 12. Cập nhật thông tin cá nhân khách hàng
  // Đã chuyển sang data mới: 02_DATA_SALES_CRM / tbl_KhachHang
  if (data.type === "updateCustomerInfo") {
    try {
      var customerInfoColsV81 = ensureCustomerTransportColsV81_();
      var sheetKH = customerInfoColsV81.sheet;

      var maKH = normalizeText_(data.id || data.maKH);
      var tenMoi = normalizeText_(data.name || data.tenKhach);
      var sdtMoi = normalizeText_(data.sdt);
      var diaChiMoi = normalizeText_(data.diachi || data.diaChi);
      var chanhXeMoi = normalizeText_(data.chanhXe || data.chanhxe);
      var sdtChanhXeMoi = normalizeText_(data.sdtChanhXe || data.sdtchanhxe);
      var now = nowVN_();

      if (!maKH) {
        return outText_("Lỗi: Thiếu mã khách hàng");
      }

      var valuesKH = sheetKH.getDataRange().getValues();

      for (var i = 1; i < valuesKH.length; i++) {
        if (normalizeText_(valuesKH[i][0]) === maKH) {
          sheetKH.getRange(i + 1, 2).setValue(tenMoi);    // B: TenKhach
          sheetKH.getRange(i + 1, 3).setValue(sdtMoi);    // C: SDT
          sheetKH.getRange(i + 1, 4).setValue(diaChiMoi); // D: DiaChi
          sheetKH.getRange(i + 1, customerInfoColsV81.colChanhXe).setValue(chanhXeMoi);
          sheetKH.getRange(i + 1, customerInfoColsV81.colSDTChanhXe).setValue(sdtChanhXeMoi);
          sheetKH.getRange(i + 1, 12).setValue(now);      // L: CapNhatCuoi

          SpreadsheetApp.flush();
          return outText_("OK");
        }
      }

      return outText_("Lỗi: Không tìm thấy khách");

    } catch (err) {
      return outText_("Lỗi updateCustomerInfo: " + err.message);
    }
  }

  // 13. Cập nhật nợ thủ công & ghi nhật ký nợ
  // Đã chuyển sang:
  // SALES / tbl_KhachHang
  // TAI_CHINH / tbl_NhatKyNo
  // TAI_CHINH / tbl_CongNo_TongHop
  if (data.type === "updateCustomerDebt") {
    try {
      var sheetKH = getSheet_("SALES", "tbl_KhachHang");
      var sheetNK = getSheet_("TAI_CHINH", "tbl_NhatKyNo");
      var sheetCNTH = getSheet_("TAI_CHINH", "tbl_CongNo_TongHop");

      var maKH = normalizeText_(data.id || data.maKH);
      var newDebt = parseFloat(data.newDebt);
      var amount = parseFloat(data.amount);
      var adjustType = normalizeText_(data.adjustType); // plus / minus
      var note = normalizeText_(data.note);
      var now = nowVN_();

      if (!maKH) {
        return outText_("Lỗi: Thiếu mã khách hàng");
      }

      if (isNaN(newDebt)) newDebt = 0;
      if (newDebt <= 1) newDebt = 0;

      if (isNaN(amount)) amount = 0;

      var valuesKH = sheetKH.getDataRange().getValues();

      for (var i = 1; i < valuesKH.length; i++) {
        if (normalizeText_(valuesKH[i][0]) === maKH) {
          var tenKH = valuesKH[i][1] || "";
          var noCu = parseFloat(valuesKH[i][4]) || 0;

          // 1. Cập nhật nợ hiện tại trong SALES / tbl_KhachHang
          sheetKH.getRange(i + 1, 5).setValue(newDebt); // E: NoHienTai
          sheetKH.getRange(i + 1, 12).setValue(now);    // L: CapNhatCuoi

          // 2. Xác định loại giao dịch
          var loaiHanhDong = "";
          var soTienLog = 0;
          var phatSinhTang = 0;
          var phatSinhGiam = 0;

          if (adjustType === "plus") {
            loaiHanhDong = "MUA_NO_THEM";
            soTienLog = Math.abs(amount);
            phatSinhTang = Math.abs(amount);
          } else {
            loaiHanhDong = "KHACH_TRA_TIEN";
            soTienLog = -Math.abs(amount);
            phatSinhGiam = Math.abs(amount);
          }

          // Nếu amount bị thiếu, dùng chênh lệch giữa nợ mới và nợ cũ
          if (amount === 0 && noCu !== newDebt) {
            var chenhLech = newDebt - noCu;

            if (chenhLech > 0) {
              loaiHanhDong = "DIEU_CHINH_TANG_NO";
              soTienLog = chenhLech;
              phatSinhTang = chenhLech;
              phatSinhGiam = 0;
            } else {
              loaiHanhDong = "DIEU_CHINH_GIAM_NO";
              soTienLog = chenhLech;
              phatSinhTang = 0;
              phatSinhGiam = Math.abs(chenhLech);
            }
          }

          // 3. Ghi nhật ký nợ mới
          // tbl_NhatKyNo:
          // MaDoiTuong | TenDoiTuong | ThoiGian | LoaiGiaoDich
          // SoTien | GhiChu | NguoiThaoTac | MaChungTu | NhomDoiTuong
          sheetNK.appendRow([
            maKH,
            tenKH,
            now,
            loaiHanhDong,
            soTienLog,
            note || "Cập nhật nợ thủ công",
            data.user || data.actorUser || data.nguoiThaoTac || "Không rõ",
            "THU_CONG",
            "KHACH_HANG"
          ]);

          // 4. Cập nhật công nợ tổng hợp
          var dataCN = sheetCNTH.getDataRange().getValues();
          var rowCN = -1;

          for (var c = 1; c < dataCN.length; c++) {
            if (normalizeText_(dataCN[c][0]) === maKH) {
              rowCN = c + 1;
              break;
            }
          }

          if (rowCN === -1) {
            sheetCNTH.appendRow([
              maKH,              // MaDoiTuong
              tenKH,             // TenDoiTuong
              "KHACH_HANG",      // NhomDoiTuong
              0,                 // NoDauKy
              phatSinhTang,      // PhatSinhTang
              phatSinhGiam,      // PhatSinhGiam
              newDebt,           // NoHienTai
              now                // CapNhatCuoi
            ]);
          } else {
            var psTangCu = parseFloat(sheetCNTH.getRange(rowCN, 5).getValue()) || 0;
            var psGiamCu = parseFloat(sheetCNTH.getRange(rowCN, 6).getValue()) || 0;

            sheetCNTH.getRange(rowCN, 2).setValue(tenKH);                         // TenDoiTuong
            sheetCNTH.getRange(rowCN, 3).setValue("KHACH_HANG");                  // NhomDoiTuong
            sheetCNTH.getRange(rowCN, 5).setValue(psTangCu + phatSinhTang);       // PhatSinhTang
            sheetCNTH.getRange(rowCN, 6).setValue(psGiamCu + phatSinhGiam);       // PhatSinhGiam
            sheetCNTH.getRange(rowCN, 7).setValue(newDebt);                       // NoHienTai
            sheetCNTH.getRange(rowCN, 8).setValue(now);                           // CapNhatCuoi
          }

          SpreadsheetApp.flush();
          return outText_("OK");
        }
      }

      return outText_("Lỗi: Không tìm thấy khách");

    } catch (e) {
      return outText_("Lỗi updateCustomerDebt: " + e.message);
    }
  }
  // 14. Xóa khách hàng
  // Data mới: SALES / tbl_KhachHang
  // Không xóa dòng thật, chỉ đổi TrangThai = Đã xóa để giữ lịch sử hóa đơn
  if (data.type === "deleteCustomer") {
    try {
      var sheetKH = getSheet_("SALES", "tbl_KhachHang");

      var maKH = normalizeText_(data.id || data.maKH);
      var now = nowVN_();

      if (!maKH) {
        return outText_("Lỗi: Thiếu mã khách hàng");
      }

      var valuesKH = sheetKH.getDataRange().getValues();

      for (var i = 1; i < valuesKH.length; i++) {
        if (normalizeText_(valuesKH[i][0]) === maKH) {
          var tenKH = valuesKH[i][1] || "";
          var noHienTai = parseFloat(valuesKH[i][4]) || 0; // E: NoHienTai

          // Quy tắc của bạn: <= 1đ xem như hết nợ
          if (noHienTai > 1) {
            return outText_("Lỗi: Khách " + tenKH + " còn nợ " + noHienTai.toLocaleString('vi-VN') + "đ, chưa thể xóa");
          }

          sheetKH.getRange(i + 1, 5).setValue(0);          // E: NoHienTai
          sheetKH.getRange(i + 1, 9).setValue("Đã xóa");  // I: TrangThai
          sheetKH.getRange(i + 1, 12).setValue(now);       // L: CapNhatCuoi

          SpreadsheetApp.flush();
          return outText_("OK");
        }
      }

      return outText_("Lỗi: Không tìm thấy khách hàng");

    } catch (err) {
      return outText_("Lỗi deleteCustomer: " + err.message);
    }
  }
  // 15. Ghi nhật ký khi chủ shop dùng cây bút chì sửa nợ thủ công trong Hóa đơn
  // Đã chuyển sang data mới: 06_DATA_TAI_CHINH_CONG_NO / tbl_NhatKyNo
  if (data.type === "logManualEditDebt") {
    try {
      var sheetNK = getSheet_("TAI_CHINH", "tbl_NhatKyNo");

      var maKH = normalizeText_(data.id || data.maKH);
      var tenKH = normalizeText_(data.name || data.tenKhach);
      var oldVal = parseFloat(data.oldVal) || 0;
      var newVal = parseFloat(data.newVal) || 0;
      var note = normalizeText_(data.note);
      var now = nowVN_();

      if (!maKH) {
        return outText_("Lỗi: Thiếu mã khách hàng");
      }

      var chenhLech = newVal - oldVal;
      if (Math.abs(chenhLech) <= 1) {
        return outText_("OK");
      }

      var loaiHanhDong = chenhLech > 0 ? "SUA_NO_TANG_BANG_BUT" : "SUA_NO_GIAM_BANG_BUT";

      sheetNK.appendRow([
        maKH,                                      // MaDoiTuong
        tenKH,                                     // TenDoiTuong
        now,                                       // ThoiGian
        loaiHanhDong,                              // LoaiGiaoDich
        chenhLech,                                 // SoTien
        (note || "Sửa nợ bằng cây bút") +
        " (Từ " + oldVal.toLocaleString('vi-VN') +
        " -> " + newVal.toLocaleString('vi-VN') + ")", // GhiChu
        data.user || data.actorUser || "",          // NguoiThaoTac
        "SUA_NO_BUT",                               // MaChungTu
        "KHACH_HANG"                                // NhomDoiTuong
      ]);

      SpreadsheetApp.flush();

      return outText_("OK");

    } catch (e) {
      return outText_("Lỗi logManualEditDebt: " + e.message);
    }
  }

  // 16. Lấy lịch sử giao dịch công nợ khách hàng
  // Đã chuyển sang data mới: 06_DATA_TAI_CHINH_CONG_NO / tbl_NhatKyNo
  if (data.type === "getPaymentHistory") {
    try {
      var sheetNK = getSheet_("TAI_CHINH", "tbl_NhatKyNo");
      var valuesNK = sheetNK.getDataRange().getValues();

      var maKH = normalizeText_(data.maKH || data.id);
      var history = [];

      if (!maKH) {
        return outJson_([]);
      }

      for (var i = valuesNK.length - 1; i >= 1; i--) {
        var maTrongSheet = normalizeText_(valuesNK[i][0]); // A: MaDoiTuong

        if (maTrongSheet === maKH) {
          history.push({
            ngay: valuesNK[i][2],       // C: ThoiGian
            loai: valuesNK[i][3],       // D: LoaiGiaoDich
            tien: valuesNK[i][4],       // E: SoTien
            ghiChu: valuesNK[i][5],     // F: GhiChu
            nguoi: valuesNK[i][6] || "",// G: NguoiThaoTac
            maChungTu: valuesNK[i][7] || "" // H: MaChungTu
          });
        }

        if (history.length >= 200) break;
      }

      return outJson_(history);

    } catch (e) {
      return outJson_([]);
    }
  }
  /****************************************************
 * TASK 2.1 - CẬP NHẬT TRẠNG THÁI ĐƠN
 * Dùng cho nút: BẮT ĐẦU SOẠN ĐƠN / NỢ ĐƠN / XÓA ĐƠN
 * Đọc ghi từ file mới:
 * 02_DATA_SALES_CRM / tbl_DonHang
 ****************************************************/
  if (data.type === "updateStatus") {
    try {
      var sheetStatus = getSheet_("SALES", "tbl_DonHang");
      var sheetLogStatus = getSheet_("SALES", "tbl_LichSuTrangThaiDon");

      var maDon = normalizeText_(data.maDon || data.maHoaDon);
      var newStatus = normalizeText_(data.status || data.newStatus);
      var userName = normalizeText_(data.user || data.actorUser || "");
      var now = nowVN_();

      if (!maDon) {
        return outJson_({
          result: "ERROR",
          message: "Thiếu mã đơn"
        });
      }

      if (!newStatus) {
        return outJson_({
          result: "ERROR",
          message: "Thiếu trạng thái mới"
        });
      }

      var values = sheetStatus.getDataRange().getValues();

      for (var i = 1; i < values.length; i++) {
        var maTrongSheet = normalizeText_(values[i][0]); // A: MaHoaDon

        if (maTrongSheet === maDon) {
          var oldStatus = normalizeText_(values[i][6]);      // G: TrangThai
          var nguoiHienTai = normalizeText_(values[i][9]);   // J: NguoiSoan

          // Chống 2 người cùng nhận 1 đơn
          if (newStatus === "Đang soạn") {
            if (
              nguoiHienTai !== "" &&
              userName !== "" &&
              nguoiHienTai.toUpperCase() !== userName.toUpperCase()
            ) {
              return outJson_({
                result: "ERROR_ALREADY_TAKEN",
                nguoiLay: nguoiHienTai
              });
            }
          }

          // Cập nhật trạng thái cột G
          sheetStatus.getRange(i + 1, 7).setValue(newStatus);

          // Cột J = Người soạn
          if (newStatus === "Nợ đơn" || newStatus === "Xóa" || newStatus === "Mới") {
            sheetStatus.getRange(i + 1, 10).setValue("");
          } else if (newStatus === "Đang soạn") {
            sheetStatus.getRange(i + 1, 10).setValue(userName);
          }

          // Cột V = CapNhatCuoi
          sheetStatus.getRange(i + 1, 22).setValue(now);

          // Ghi lịch sử trạng thái
          sheetLogStatus.appendRow([
            now,              // ThoiGian
            maDon,            // MaHoaDon
            oldStatus,        // TrangThaiCu
            newStatus,        // TrangThaiMoi
            userName,         // NguoiThaoTac
            "Cập nhật trạng thái từ app" // GhiChu
          ]);

          SpreadsheetApp.flush();

          return outJson_({
            result: "Thành công"
          });
        }
      }

      return outJson_({
        result: "NOT_FOUND",
        message: "Không tìm thấy đơn " + maDon
      });

    } catch (err) {
      return outJson_({
        result: "ERROR",
        message: "Lỗi updateStatus: " + err.message
      });
    }
  }
  /****************************************************
 * TASK 3B - LƯU HÓA ĐƠN ĐÃ SỬA
 * Đọc ghi từ file mới:
 * 02_DATA_SALES_CRM
 ****************************************************/
  if (data.type === "updateEditedBill") {
    try {
      var sheetThayDoi = getSheet_("SALES", "tbl_ChiTietThayDoiDonHang");
      var sheetOrders = getSheet_("SALES", "tbl_DonHang");
      var sheetKhach = getSheet_("SALES", "tbl_KhachHang");

      var maHoaDonInput = normalizeText_(data.maHoaDon);
      var maKH = normalizeText_(data.maKH);
      var ghiChuNV = normalizeText_(data.ghiChuNV) || "Không có ghi chú";
      var newOldDebt = parseFloat(data.newOldDebt) || 0;
      var details = Array.isArray(data.details) ? data.details : [];
      var now = nowVN_();

      if (!maHoaDonInput) {
        return outText_("Lỗi: Thiếu mã hóa đơn");
      }

      if (details.length === 0) {
        return outText_("Lỗi: Hóa đơn không có sản phẩm để lưu");
      }

      function isSameOrderForEdit_(idDon, baseCode) {
        idDon = normalizeText_(idDon);
        baseCode = normalizeText_(baseCode);

        if (!idDon || !baseCode) return false;
        if (idDon === baseCode) return true;
        if (idDon.indexOf(baseCode + "-") === 0) return true;

        return false;
      }

      var listMa = maHoaDonInput.split("+").map(function (m) {
        return normalizeText_(m)
          .replace("-TX", "")
          .replace("-CK", "")
          .trim();
      }).filter(function (m) {
        return m !== "";
      });

      var validIds = [];
      var rowsOrders = sheetOrders.getDataRange().getValues();

      for (var j = 1; j < rowsOrders.length; j++) {
        var idDon = normalizeText_(rowsOrders[j][0]);      // A: MaHoaDon
        var statusKho = normalizeText_(rowsOrders[j][6]);  // G: TrangThai
        var trangThaiBill = normalizeText_(rowsOrders[j][13]); // N: TrangThaiHoaDon

        var isMatch = false;

        for (var m = 0; m < listMa.length; m++) {
          if (isSameOrderForEdit_(idDon, listMa[m])) {
            isMatch = true;
            break;
          }
        }

        if (!isMatch) continue;

        // Chỉ cho sửa đơn chưa chốt hóa đơn, không bị xóa/nợ đơn/mới tinh
        if (
          trangThaiBill !== "Đã gửi đơn" &&
          statusKho !== "Mới" &&
          statusKho !== "Nợ đơn" &&
          statusKho !== "Xóa"
        ) {
          validIds.push(idDon);

          // O: GhiChuNV
          sheetOrders.getRange(j + 1, 15).setValue(ghiChuNV);

          // K: NoTrongHoaDon - lưu lại nợ cũ tại thời điểm bill
          sheetOrders.getRange(j + 1, 11).setValue(newOldDebt);

          // V: CapNhatCuoi
          sheetOrders.getRange(j + 1, 22).setValue(now);
        }
      }

      if (validIds.length === 0) {
        return outText_("Lỗi: Không tìm thấy đơn hợp lệ để lưu hóa đơn sửa");
      }

      // Cập nhật nợ hiện tại vào tbl_KhachHang nếu có mã khách
      if (maKH) {
        var dataKhach = sheetKhach.getDataRange().getValues();

        for (var k = 1; k < dataKhach.length; k++) {
          if (normalizeText_(dataKhach[k][0]) === maKH) {
            sheetKhach.getRange(k + 1, 5).setValue(newOldDebt); // E: NoHienTai
            sheetKhach.getRange(k + 1, 12).setValue(now);       // L: CapNhatCuoi
            break;
          }
        }
      }

      // Xóa dữ liệu sửa cũ của các mã hóa đơn này
      if (sheetThayDoi.getLastRow() > 1) {
        var rowsSua = sheetThayDoi.getDataRange().getValues();

        for (var i = rowsSua.length - 1; i >= 1; i--) {
          var maSua = normalizeText_(rowsSua[i][1]); // B: MaHoaDon

          if (validIds.indexOf(maSua) > -1) {
            sheetThayDoi.deleteRow(i + 1);
          }
        }
      }

      // Ghi sản phẩm sửa theo đúng từng mã hóa đơn.
      // Bỏ tick ở giao diện chỉ là ẩn dòng khi xem/in, không được làm mất dòng đang ẩn.
      var mainId = validIds[0];
      var validMap = {};
      validIds.forEach(function(id) {
        validMap[normalizeText_(id)] = true;
      });

      var hasPerOrderDetails = false;
      details.forEach(function(item) {
        if (normalizeText_(item.maHoaDon)) {
          hasPerOrderDetails = true;
        }
      });

      var usedOrderMap = {};

      details.forEach(function (item) {
        var tenSP = normalizeText_(item.tenSP);
        var soLuong = parseFloat(item.soLuong) || 0;
        var donGia = parseFloat(item.donGia) || 0;
        var thanhTien = parseFloat(item.thanhTien) || (soLuong * donGia);
        var targetId = hasPerOrderDetails ? normalizeText_(item.maHoaDon) : mainId;

        if (!targetId || !validMap[targetId]) {
          targetId = mainId;
        }

        if (!tenSP || soLuong <= 0) return;

        usedOrderMap[targetId] = true;

        sheetThayDoi.appendRow([
          maKH,                              // MaKH
          targetId,                          // MaHoaDon
          tenSP,                             // TenSP
          soLuong,                           // SoLuong
          donGia,                            // DonGia
          thanhTien,                         // ThanhTien
          normalizeText_(item.maBanHang),    // MaBanHang
          normalizeText_(item.maHangNoiBo),  // MaHangNoiBo
          normalizeText_(item.mau),          // Mau
          normalizeText_(item.size),         // Size
          normalizeText_(item.khoXuat),      // KhoXuat
          ghiChuNV,                          // GhiChuSua
          data.user || "",                   // NguoiSua
          now                                // ThoiGianSua
        ]);
      });

      if (!hasPerOrderDetails) {
        // Giữ tương thích với bản frontend cũ: nếu không gửi maHoaDon theo từng dòng
        // thì vẫn lưu theo cách cũ để không phá dữ liệu đang dùng.
        for (var v = 1; v < validIds.length; v++) {
          sheetThayDoi.appendRow([
            maKH,
            validIds[v],
            "GỘP CHUNG",
            0,
            0,
            0,
            "",
            "",
            "",
            "",
            "",
            ghiChuNV,
            data.user || "",
            now
          ]);
        }
      } else {
        // Nếu người dùng xóa hết dòng của một mã đơn đang hiện, cần có marker để
        // getBillDetails không tự lấy lại chi tiết gốc của mã đó.
        for (var emptyIdx = 0; emptyIdx < validIds.length; emptyIdx++) {
          var emptyId = normalizeText_(validIds[emptyIdx]);
          if (!usedOrderMap[emptyId]) {
            sheetThayDoi.appendRow([
              maKH,
              emptyId,
              "GỘP CHUNG",
              0,
              0,
              0,
              "",
              "",
              "",
              "",
              "",
              ghiChuNV,
              data.user || "",
              now
            ]);
          }
        }
      }

      SpreadsheetApp.flush();

      return outText_("OK_SAVE");

    } catch (e) {
      return outText_("Lỗi Backend updateEditedBill: " + e.message);
    }
  }
  // 19. LẤY TẤT CẢ ẢNH TRONG 10 NGÀY QUA
  // Đã chuyển sang data mới: SALES / tbl_DonHang
  if (data.type === "getAllImagesLast10Days") {
    try {
      var sheet = getSheet_("SALES", "tbl_DonHang");
      var values = sheet.getDataRange().getValues();

      var tenNgayTruoc = new Date();
      tenNgayTruoc.setDate(tenNgayTruoc.getDate() - 10);
      tenNgayTruoc.setHours(0, 0, 0, 0);

      var result = {};

      function parseDateFromSheet_(v) {
        if (v instanceof Date) return v;

        var s = normalizeText_(v);
        if (!s) return null;

        // Ngày từ input type=date: yyyy-MM-dd.
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
          var iso = new Date(s);
          return isNaN(iso.getTime()) ? null : iso;
        }

        // Chuỗi trong dữ liệu có dạng MM/DD/YYYY: 09/12/2026 là 12 tháng 9.
        // Nếu số đầu > 12, nhận dạng trường hợp DD/MM/YYYY không mơ hồ.
        var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) {
          var first = Number(m[1]);
          var second = Number(m[2]);
          var year = Number(m[3]);
          var month = first > 12 ? second : first;
          var day = first > 12 ? first : second;
          var date = new Date(year, month - 1, day);
          return month >= 1 && month <= 12 && day >= 1 &&
            date.getFullYear() === year && date.getMonth() === month - 1 &&
            date.getDate() === day ? date : null;
        }

        var other = new Date(s);
        return isNaN(other.getTime()) ? null : other;
      }





      for (var i = values.length - 1; i >= 1; i--) {
        var maHD = normalizeText_(values[i][0]);   // A: MaHoaDon
        var ngayTaoRaw = values[i][1];             // B: NgayTao
        var tenKH = values[i][2] || "";            // C: TenKhach
        var anhJson = values[i][7] || "";          // H: AnhZaloJson
        var trangThaiBill = normalizeText_(values[i][13]); // N: TrangThaiHoaDon

        if (!maHD) continue;

        // Bỏ qua đơn đã xóa
        if (trangThaiBill === "Đã xóa đơn") continue;

        var ngayTao = parseDateFromSheet_(ngayTaoRaw);
        if (!ngayTao) continue;

        ngayTao.setHours(0, 0, 0, 0);

        if (ngayTao < tenNgayTruoc || ngayTao > new Date()) continue;

        var dsAnh = safeParseJson_(anhJson, []);

        if (dsAnh && dsAnh.length > 0) {
          var ngayKey = Utilities.formatDate(ngayTao, "GMT+7", "dd/MM/yyyy");

          if (!result[ngayKey]) result[ngayKey] = [];

          result[ngayKey].push({
            maHD: maHD,
            tenKH: tenKH,
            listAnh: dsAnh
          });
        }
      }

      return outJson_(result);

    } catch (err) {
      return outJson_({
        error: "Lỗi getAllImagesLast10Days: " + err.message
      });
    }
  }
  // 13.1 CẬP NHẬT NỢ VÀ GHI NHIỀU KHOẢN TỪ BIÊN LAI (Ý tưởng 3)
  // 13.1 CẬP NHẬT NỢ VÀ GHI NHIỀU KHOẢN TỪ BIÊN LAI
  // Đã chuyển sang data mới:
  // SALES / tbl_KhachHang
  // TAI_CHINH / tbl_NhatKyNo
  // TAI_CHINH / tbl_CongNo_TongHop
  if (data.type === "updateCustomerDebtMultiple") {
    try {
      var sheetKH = getSheet_("SALES", "tbl_KhachHang");
      var sheetNK = getSheet_("TAI_CHINH", "tbl_NhatKyNo");
      var sheetCNTH = getSheet_("TAI_CHINH", "tbl_CongNo_TongHop");

      var maKH = normalizeText_(data.id || data.maKH);
      var newDebt = parseFloat(data.newDebt);
      var items = Array.isArray(data.items) ? data.items : [];
      var now = nowVN_();

      if (!maKH) {
        return outText_("Lỗi: Thiếu mã khách hàng");
      }

      if (isNaN(newDebt)) newDebt = 0;
      if (newDebt <= 1) newDebt = 0;

      if (items.length === 0) {
        return outText_("Lỗi: Chưa có khoản nào để chốt");
      }

      var valuesKH = sheetKH.getDataRange().getValues();
      var rowKH = -1;
      var tenKH = "";
      var noCu = 0;

      for (var i = 1; i < valuesKH.length; i++) {
        if (normalizeText_(valuesKH[i][0]) === maKH) {
          rowKH = i + 1;
          tenKH = valuesKH[i][1] || "";
          noCu = parseFloat(valuesKH[i][4]) || 0;
          break;
        }
      }

      if (rowKH === -1) {
        return outText_("Lỗi: Không tìm thấy khách hàng " + maKH);
      }

      var tongTang = 0;
      var tongGiam = 0;

      // 1. Ghi từng dòng nhật ký nợ
      items.forEach(function (item) {
        var type = normalizeText_(item.type); // plus / minus
        var amount = parseFloat(item.amount) || 0;
        var ngay = item.date || now;
        var note = normalizeText_(item.note);

        if (amount <= 0) return;

        var loaiHanhDong = "";
        var soTienLog = 0;

        if (type === "plus") {
          loaiHanhDong = "MUA_NO_THEM";
          soTienLog = amount;
          tongTang += amount;
        } else {
          loaiHanhDong = "KHACH_TRA_TIEN";
          soTienLog = -amount;
          tongGiam += amount;
        }

        sheetNK.appendRow([
          maKH,                         // MaDoiTuong
          tenKH,                        // TenDoiTuong
          ngay,                         // ThoiGian
          loaiHanhDong,                 // LoaiGiaoDich
          soTienLog,                    // SoTien
          note || "Chốt nợ từ biên lai", // GhiChu
          data.user || data.actorUser || data.nguoiThaoTac || "Không rõ", // NguoiThaoTac
          "CHOT_NO_KHACH",              // MaChungTu
          "KHACH_HANG"                  // NhomDoiTuong
        ]);
      });

      // 2. Cập nhật nợ hiện tại trong SALES / tbl_KhachHang
      sheetKH.getRange(rowKH, 5).setValue(newDebt); // E: NoHienTai
      sheetKH.getRange(rowKH, 12).setValue(now);    // L: CapNhatCuoi

      // 3. Cập nhật công nợ tổng hợp
      var dataCN = sheetCNTH.getDataRange().getValues();
      var rowCN = -1;

      for (var c = 1; c < dataCN.length; c++) {
        if (normalizeText_(dataCN[c][0]) === maKH) {
          rowCN = c + 1;
          break;
        }
      }

      if (rowCN === -1) {
        sheetCNTH.appendRow([
          maKH,              // MaDoiTuong
          tenKH,             // TenDoiTuong
          "KHACH_HANG",      // NhomDoiTuong
          noCu,              // NoDauKy
          tongTang,          // PhatSinhTang
          tongGiam,          // PhatSinhGiam
          newDebt,           // NoHienTai
          now                // CapNhatCuoi
        ]);
      } else {
        var psTangCu = parseFloat(sheetCNTH.getRange(rowCN, 5).getValue()) || 0;
        var psGiamCu = parseFloat(sheetCNTH.getRange(rowCN, 6).getValue()) || 0;

        sheetCNTH.getRange(rowCN, 2).setValue(tenKH);                  // TenDoiTuong
        sheetCNTH.getRange(rowCN, 3).setValue("KHACH_HANG");           // NhomDoiTuong
        sheetCNTH.getRange(rowCN, 5).setValue(psTangCu + tongTang);    // PhatSinhTang
        sheetCNTH.getRange(rowCN, 6).setValue(psGiamCu + tongGiam);    // PhatSinhGiam
        sheetCNTH.getRange(rowCN, 7).setValue(newDebt);                // NoHienTai
        sheetCNTH.getRange(rowCN, 8).setValue(now);                    // CapNhatCuoi
      }

      SpreadsheetApp.flush();

      return outText_("OK");

    } catch (e) {
      return outText_("Lỗi updateCustomerDebtMultiple: " + e.message);
    }
  }

  // =========================================================
  // DASHBOARD TỔNG QUAN - DATA MỚI + CACHE
  // Đọc nhiều file data mới, ghi nhanh vào 08_DATA_BAO_CAO_CACHE
  // =========================================================
  if (data.type === "getDashboardTongQuan") {
    try {
      var dashCacheKey = "AZ_DASHBOARD_TONGQUAN_TEST_V1";
      if (!data.forceRefresh) {
        try {
          var dashCachedText = CacheService.getScriptCache().get(dashCacheKey);
          if (dashCachedText) {
            var dashCachedObj = JSON.parse(dashCachedText);
            if (dashCachedObj && dashCachedObj.ok) return outJson_(dashCachedObj);
          }
        } catch (eDashCacheRead) {}
      }

      var nowDash = new Date();
      var todayISO = Utilities.formatDate(nowDash, "GMT+7", "yyyy-MM-dd");
      var todayVN = Utilities.formatDate(nowDash, "GMT+7", "dd/MM/yyyy");
      var currentYM = Utilities.formatDate(nowDash, "GMT+7", "yyyy-MM");

      function dashText_(v) {
        return String(v === null || v === undefined ? "" : v).trim();
      }

      function dashNum_(v) {
        if (v === null || v === undefined || v === "") return 0;
        if (typeof v === "number") return v;
        var s = String(v).replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
        var n = Number(s);
        return isNaN(n) ? 0 : n;
      }

      function dashDate_(v) {
        if (!v) return null;
        if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
        var s = dashText_(v);
        if (!s) return null;

        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
          var p = s.substring(0, 10).split("-");
          return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
        }

        var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

        var d = new Date(s);
        if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        return null;
      }

      function dashYM_(v) {
        var d = dashDate_(v);
        if (!d) return "";
        return Utilities.formatDate(d, "GMT+7", "yyyy-MM");
      }

      function dashDayKey_(v) {
        var d = dashDate_(v);
        if (!d) return "";
        return Utilities.formatDate(d, "GMT+7", "yyyy-MM-dd");
      }

      function dashIsCanceled_(s) {
        var t = dashText_(s).toLowerCase();
        return t.indexOf("xóa") > -1 || t.indexOf("xoa") > -1 || t.indexOf("hủy") > -1 || t.indexOf("huy") > -1;
      }

      function dashSafeSheet_(fileKey, sheetName) {
        try { return getSheet_(fileKey, sheetName); } catch (e) { return null; }
      }

      var monthStart = new Date(nowDash.getFullYear(), nowDash.getMonth(), 1);
      var last7Keys = [];
      var chart7Map = {};
      for (var d7 = 6; d7 >= 0; d7--) {
        var dd7 = new Date(nowDash.getFullYear(), nowDash.getMonth(), nowDash.getDate() - d7);
        var k7 = Utilities.formatDate(dd7, "GMT+7", "yyyy-MM-dd");
        last7Keys.push(k7);
        chart7Map[k7] = {
          key: k7,
          display: Utilities.formatDate(dd7, "GMT+7", "dd/MM"),
          revenue: 0,
          orders: 0,
          cash: 0
        };
      }

      var summary = {
        updatedAt: nowVN_(),
        today: todayVN,
        thang: currentYM,
        doanhThuThang: 0,
        soDonThang: 0,
        thucThuThang: 0,
        donMoi: 0,
        noKhach: 0,
        noNhaMay: 0,
        noPhuLieu: 0,
        ungLuongThang: 0,
        mamThieu: 0,
        tongSLThieu: 0,
        mamChuaThanhToan: 0,
        mamChuaNhan: 0
      };

      var topNoKhach = [];
      var mamThieuList = [];
      var viecCanLam = [];

      // 1. SALES - đơn hàng, doanh thu tháng, đơn mới
      var shDH = dashSafeSheet_("SALES", "tbl_DonHang");
      if (shDH && shDH.getLastRow() >= 2) {
        var dhRows = shDH.getDataRange().getValues();
        for (var iDH = 1; iDH < dhRows.length; iDH++) {
          var rDH = dhRows[iDH];
          var maHD = dashText_(rDH[0]);
          if (!maHD) continue;

          var trangThaiDon = dashText_(rDH[6]);
          var trangThaiHD = dashText_(rDH[13]);
          if (dashIsCanceled_(trangThaiDon) || dashIsCanceled_(trangThaiHD)) continue;

          if (trangThaiDon === "Mới") summary.donMoi++;

          var dDon = dashDate_(rDH[21]) || dashDate_(rDH[1]); // V CapNhatCuoi, B NgayTao
          var ymDon = dDon ? Utilities.formatDate(dDon, "GMT+7", "yyyy-MM") : "";
          var tongTienDon = dashNum_(rDH[11]); // L TongTien

          if (ymDon === currentYM && tongTienDon > 0) {
            summary.doanhThuThang += tongTienDon;
            summary.soDonThang++;
          }

          var keyDon = dDon ? Utilities.formatDate(dDon, "GMT+7", "yyyy-MM-dd") : "";
          if (keyDon && chart7Map[keyDon]) {
            chart7Map[keyDon].revenue += tongTienDon;
            if (tongTienDon > 0) chart7Map[keyDon].orders++;
          }
        }
      }

      // 2. SALES - nợ khách
      var shKH = dashSafeSheet_("SALES", "tbl_KhachHang");
      if (shKH && shKH.getLastRow() >= 2) {
        var khRows = shKH.getDataRange().getValues();
        for (var iKH = 1; iKH < khRows.length; iKH++) {
          var tenKH = dashText_(khRows[iKH][1]);
          if (!tenKH) continue;
          if (dashText_(khRows[iKH][8]) === "Đã xóa") continue;
          var noKH = dashNum_(khRows[iKH][4]);
          if (noKH > 1) {
            summary.noKhach += noKH;
            topNoKhach.push({ ten: tenKH, no: noKH });
          }
        }
      }
      topNoKhach.sort(function(a, b) { return b.no - a.no; });
      topNoKhach = topNoKhach.slice(0, 5);

      // 3. TÀI CHÍNH - thực thu tháng từ Nhật ký nợ
      var shNK = dashSafeSheet_("TAI_CHINH", "tbl_NhatKyNo");
      if (shNK && shNK.getLastRow() >= 2) {
        var nkRows = shNK.getDataRange().getValues();
        for (var iNK = 1; iNK < nkRows.length; iNK++) {
          var loaiNK = dashText_(nkRows[iNK][3]).toLowerCase();
          var isThuTien = loaiNK.indexOf("chuyển khoản") > -1 ||
                          loaiNK.indexOf("chuyen khoan") > -1 ||
                          loaiNK.indexOf("tiền mặt") > -1 ||
                          loaiNK.indexOf("tien mat") > -1 ||
                          loaiNK.indexOf("khách trả tiền") > -1 ||
                          loaiNK.indexOf("khach tra tien") > -1;
          if (!isThuTien) continue;

          var dNK = dashDate_(nkRows[iNK][2]);
          if (!dNK) continue;
          var tienThu = Math.abs(dashNum_(nkRows[iNK][4]));
          if (Utilities.formatDate(dNK, "GMT+7", "yyyy-MM") === currentYM) {
            summary.thucThuThang += tienThu;
          }
          var keyNK = Utilities.formatDate(dNK, "GMT+7", "yyyy-MM-dd");
          if (chart7Map[keyNK]) chart7Map[keyNK].cash += tienThu;
        }
      }

      // 4. RẬP - mâm thiếu, chưa nhận, chưa thanh toán
      var shRap = dashSafeSheet_("RAP", "tbl_Rap_DonHang");
      if (shRap && shRap.getLastRow() >= 2) {
        var rapRows = shRap.getDataRange().getValues();
        for (var iR = 1; iR < rapRows.length; iR++) {
          var rr = rapRows[iR];
          var maMam = dashText_(rr[0]);
          if (!maMam) continue;
          if (dashIsCanceled_(rr[21])) continue; // V TrangThaiSanXuat

          var tongKH = dashNum_(rr[10]);      // K TongKeHoach
          var daGiao = dashNum_(rr[11]);      // L TongDaGiao
          var conThieu = rr[12] !== "" && rr[12] !== undefined ? dashNum_(rr[12]) : Math.max(tongKH - daGiao, 0);
          var ttNhan = dashText_(rr[22]);     // W TrangThaiNhanHang
          var ttThanhToan = dashText_(rr[23]); // X TrangThaiThanhToan

          if (conThieu > 0) {
            summary.mamThieu++;
            summary.tongSLThieu += conThieu;
            mamThieuList.push({
              maMam: maMam,
              ngayCat: dashText_(rr[3]),
              nhaMay: dashText_(rr[4]),
              maRap: dashText_(rr[5]),
              tenSP: dashText_(rr[6]),
              tong: tongKH,
              daGiao: daGiao,
              conThieu: conThieu
            });
          }

          if (daGiao <= 0 || ttNhan === "Chưa nhận") summary.mamChuaNhan++;

          var ttLower = ttThanhToan.toLowerCase();
          if (!ttThanhToan || ttLower.indexOf("chưa") > -1 || ttLower.indexOf("chua") > -1 || ttLower.indexOf("ép") > -1 || ttLower.indexOf("ep") > -1) {
            summary.mamChuaThanhToan++;
          }
        }
      }
      mamThieuList.sort(function(a, b) { return b.conThieu - a.conThieu; });
      mamThieuList = mamThieuList.slice(0, 8);

      // 5. Nhà may - công nợ hiện tại
      var shNM = dashSafeSheet_("RAP", "tbl_NhaMay");
      if (shNM && shNM.getLastRow() >= 2) {
        var nmRows = shNM.getDataRange().getValues();
        for (var iNM = 1; iNM < nmRows.length; iNM++) {
          summary.noNhaMay += Math.max(dashNum_(nmRows[iNM][4]), 0); // E NoHienTai
        }
      }

      // 6. Phụ liệu - nợ vải, dây kéo, thêu, in/nhãn
      var noVai = 0, noDayKeo = 0, noTheu = 0, noInNhan = 0;
      var shNVai = dashSafeSheet_("PHU_LIEU", "tbl_Vai_NhaCungCap");
      if (shNVai && shNVai.getLastRow() >= 2) {
        var nvaiRows = shNVai.getDataRange().getValues();
        for (var iV = 1; iV < nvaiRows.length; iV++) noVai += Math.max(dashNum_(nvaiRows[iV][2]), 0);
      }
      var shDK = dashSafeSheet_("PHU_LIEU", "tbl_DayKeo_Nhap");
      if (shDK && shDK.getLastRow() >= 2) {
        var dkRows = shDK.getDataRange().getValues();
        for (var iDK = 1; iDK < dkRows.length; iDK++) noDayKeo += dashNum_(dkRows[iDK][8]);
        if (noDayKeo < 0) noDayKeo = 0;
      }
      var shTheu = dashSafeSheet_("PHU_LIEU", "tbl_Theu_ChotTien");
      if (shTheu && shTheu.getLastRow() >= 2) {
        var theuRows = shTheu.getDataRange().getValues();
        for (var iT = 1; iT < theuRows.length; iT++) noTheu += Math.max(dashNum_(theuRows[iT][6]), 0);
      }
      ["tbl_NhatIn_GiaoDich", "tbl_TungIn_GiaoDich"].forEach(function(sheetInName) {
        var shIN = dashSafeSheet_("PHU_LIEU", sheetInName);
        if (!shIN || shIN.getLastRow() < 2) return;
        var inRows = shIN.getDataRange().getValues();
        var noSheet = 0;
        for (var iIN = 1; iIN < inRows.length; iIN++) {
          noSheet += dashNum_(inRows[iIN][8]);
        }
        noInNhan += Math.max(noSheet, 0);
      });
      summary.noPhuLieu = noVai + noDayKeo + noTheu + noInNhan;

      // 7. Nhân sự - ứng lương tháng này
      var shUL = dashSafeSheet_("NHAN_SU", "tbl_UngLuong");
      if (shUL && shUL.getLastRow() >= 2) {
        var ulRows = shUL.getDataRange().getValues();
        for (var iUL = 1; iUL < ulRows.length; iUL++) {
          if (dashYM_(ulRows[iUL][1]) === currentYM) summary.ungLuongThang += dashNum_(ulRows[iUL][3]);
        }
      }

      // Việc cần làm nhanh
      if (summary.donMoi > 0) viecCanLam.push({ icon: "bi-receipt", title: "Đơn mới cần xử lý", value: summary.donMoi + " đơn", screen: "ct-don" });
      if (summary.mamThieu > 0) viecCanLam.push({ icon: "bi-scissors", title: "Mâm rập còn thiếu hàng", value: summary.mamThieu + " mâm / " + summary.tongSLThieu + " sp", screen: "rap-list" });
      if (summary.mamChuaThanhToan > 0) viecCanLam.push({ icon: "bi-cash-coin", title: "Mâm rập chưa thanh toán", value: summary.mamChuaThanhToan + " mâm", screen: "rap-menu" });
      if (summary.noKhach > 0) viecCanLam.push({ icon: "bi-person-exclamation", title: "Công nợ khách đang mở", value: summary.noKhach, screen: "khach" });
      if (summary.noPhuLieu > 0) viecCanLam.push({ icon: "bi-box-seam", title: "Công nợ phụ liệu", value: summary.noPhuLieu, screen: "phu-lieu" });

      // Ghi cache tổng quan vào 08_DATA_BAO_CAO_CACHE / tbl_Dashboard_Ngay
      try {
        var shCache = getSheet_("BAO_CAO", "tbl_Dashboard_Ngay");
        if (shCache.getLastRow() === 0 || !dashText_(shCache.getRange(1, 1).getValue())) {
          shCache.getRange(1, 1, 1, 12).setValues([[
            "Ngay",
            "DoanhThuThang",
            "SoDonThang",
            "ThucThuThang",
            "NoKhach",
            "NoNhaMay",
            "NoPhuLieu",
            "UngLuongThang",
            "MamThieu",
            "MamChuaThanhToan",
            "CapNhatCuoi",
            "JsonTongQuan"
          ]]);
          shCache.setFrozenRows(1);
        }

        var payloadCache = JSON.stringify({ summary: summary, topNoKhach: topNoKhach, mamThieuList: mamThieuList, viecCanLam: viecCanLam });
        var cacheRows = shCache.getDataRange().getValues();
        var cacheRow = -1;
        for (var cr = 1; cr < cacheRows.length; cr++) {
          if (dashText_(cacheRows[cr][0]) === todayISO || dashDayKey_(cacheRows[cr][0]) === todayISO) {
            cacheRow = cr + 1;
            break;
          }
        }

        var cacheLine = [
          todayISO,
          summary.doanhThuThang,
          summary.soDonThang,
          summary.thucThuThang,
          summary.noKhach,
          summary.noNhaMay,
          summary.noPhuLieu,
          summary.ungLuongThang,
          summary.mamThieu,
          summary.mamChuaThanhToan,
          summary.updatedAt,
          payloadCache
        ];

        if (cacheRow === -1) shCache.appendRow(cacheLine);
        else shCache.getRange(cacheRow, 1, 1, cacheLine.length).setValues([cacheLine]);
      } catch (eCache) {}

      // Ghi cache danh sách mâm thiếu vào tbl_BaoCao_MamThieuHang
      try {
        var shMamCache = getSheet_("BAO_CAO", "tbl_BaoCao_MamThieuHang");
        shMamCache.clearContents();
        shMamCache.getRange(1, 1, 1, 10).setValues([[
          "MaMam", "NgayCat", "NhaMay", "MaRap", "TenSP", "TongKeHoach", "TongDaGiao", "TongConThieu", "CapNhatCuoi", "GhiChu"
        ]]);
        if (mamThieuList.length > 0) {
          var mamCacheRows = mamThieuList.map(function(m) {
            return [m.maMam, m.ngayCat, m.nhaMay, m.maRap, m.tenSP, m.tong, m.daGiao, m.conThieu, summary.updatedAt, "Cache dashboard"];
          });
          shMamCache.getRange(2, 1, mamCacheRows.length, 10).setValues(mamCacheRows);
        }
        shMamCache.setFrozenRows(1);
      } catch (eMamCache) {}

      var chart7 = last7Keys.map(function(k) { return chart7Map[k]; });

      var dashResponse = {
        ok: true,
        summary: summary,
        phuLieu: { vai: noVai, dayKeo: noDayKeo, theu: noTheu, inNhan: noInNhan },
        topNoKhach: topNoKhach,
        mamThieuList: mamThieuList,
        viecCanLam: viecCanLam,
        chart7: chart7
      };
      try {
        CacheService.getScriptCache().put(dashCacheKey, JSON.stringify(dashResponse), 30);
      } catch (eDashCacheWrite) {}
      return outJson_(dashResponse);

    } catch (err) {
      return outJson_({ ok: false, message: "Lỗi getDashboardTongQuan: " + err.message });
    }
  }

  // 20. LẤY DỮ LIỆU BÁO CÁO NHÂN VIÊN
  // Data mới: SALES / tbl_DonHang
  if (data.type === "getReportData") {
    try {
      var sheetDonHang = getSheet_("SALES", "tbl_DonHang");
      var values = sheetDonHang.getDataRange().getValues();

      var report = {};

      for (var i = 1; i < values.length; i++) {
        var maHD = normalizeText_(values[i][0]);              // A: MaHoaDon
        var trangThai = normalizeText_(values[i][6]);         // G: TrangThai
        var nguoiSoan = normalizeText_(values[i][9]);         // J: NguoiSoan
        var tongTien = parseFloat(values[i][11]) || 0;        // L: TongTien
        var trangThaiBill = normalizeText_(values[i][13]);    // N: TrangThaiHoaDon

        if (!maHD) continue;
        if (!nguoiSoan) continue;

        // Bỏ đơn mới tinh / đơn xóa
        if (trangThai === "Mới") continue;
        if (trangThai === "Xóa") continue;
        if (trangThaiBill === "Đã xóa đơn") continue;

        if (!report[nguoiSoan]) {
          report[nguoiSoan] = {
            ten: nguoiSoan,
            soDon: 0,
            doanhThu: 0
          };
        }

        report[nguoiSoan].soDon += 1;
        report[nguoiSoan].doanhThu += tongTien;
      }

      var arr = Object.keys(report).map(function (key) {
        return [
          report[key].ten,
          report[key].soDon,
          report[key].doanhThu
        ];
      });

      arr.sort(function (a, b) {
        return b[1] - a[1];
      });

      return outJson_(arr);

    } catch (err) {
      return outJson_([]);
    }
  }

  // 20.5 LẤY DỮ LIỆU BÁO CÁO DOANH THU VÀ SỐ ĐƠN
  // Data mới: SALES / tbl_DonHang
  if (data.type === "getReportRevenueData") {
    try {
      var sheetDonHang = getSheet_("SALES", "tbl_DonHang");
      var values = sheetDonHang.getDataRange().getValues();

      var result = {};

      function parseReportDate_(v) {
        if (v instanceof Date) return v;

        var s = normalizeText_(v);
        if (!s) return null;

        // yyyy-MM-dd
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
          var d1 = new Date(s);
          if (!isNaN(d1.getTime())) return d1;
        }

        // dd/MM/yyyy hoặc dd/MM/yyyy HH:mm:ss
        var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) {
          return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        }

        var d2 = new Date(s);
        if (!isNaN(d2.getTime())) return d2;

        return null;
      }

      for (var i = 1; i < values.length; i++) {
        var maHD = normalizeText_(values[i][0]);              // A: MaHoaDon
        var ngayTao = values[i][1];                           // B: NgayTao
        var tongTien = parseFloat(values[i][11]) || 0;        // L: TongTien
        var trangThaiBill = normalizeText_(values[i][13]);    // N: TrangThaiHoaDon
        var capNhatCuoi = values[i][21];                      // V: CapNhatCuoi

        if (!maHD) continue;
        if (trangThaiBill !== "Đã gửi đơn") continue;
        if (tongTien <= 0) continue;

        // Ưu tiên ngày chốt ở cột V, nếu không có thì lấy ngày tạo
        var d = parseReportDate_(capNhatCuoi) || parseReportDate_(ngayTao);
        if (!d) continue;

        var dateKey = Utilities.formatDate(d, "GMT+7", "dd/MM/yyyy");
        var displayKey = Utilities.formatDate(d, "GMT+7", "dd/MM");
        var timeSort = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

        if (!result[dateKey]) {
          result[dateKey] = {
            display: displayKey,
            sort: timeSort,
            revenue: 0,
            orders: 0
          };
        }

        result[dateKey].revenue += tongTien;
        result[dateKey].orders += 1;
      }

      var arr = Object.keys(result).map(function (key) {
        return result[key];
      });

      arr.sort(function (a, b) {
        return a.sort - b.sort;
      });

      // Chỉ lấy 15 ngày gần nhất cho biểu đồ gọn
      if (arr.length > 15) {
        arr = arr.slice(arr.length - 15);
      }

      return outJson_(arr);

    } catch (err) {
      return outJson_([]);
    }
  }

  // 21. LẤY DỮ LIỆU BÁO CÁO KHÁCH HÀNG
  // Data mới:
  // SALES / tbl_KhachHang
  // SALES / tbl_DonHang
  if (data.type === "getReportCustomerData") {
    try {
      var sheetKH = getSheet_("SALES", "tbl_KhachHang");
      var sheetDH = getSheet_("SALES", "tbl_DonHang");

      var dataKH = sheetKH.getDataRange().getValues();
      var dataDH = sheetDH.getDataRange().getValues();

      // ==============================
      // 1. TOP NỢ
      // Trả về dạng: [[TenKhach, NoHienTai], ...]
      // ==============================
      var topNo = [];

      for (var k = 1; k < dataKH.length; k++) {
        var tenKH = dataKH[k][1] || "";              // B: TenKhach
        var no = parseFloat(dataKH[k][4]) || 0;      // E: NoHienTai
        var trangThaiKH = normalizeText_(dataKH[k][8]); // I: TrangThai

        if (!tenKH) continue;
        if (trangThaiKH === "Đã xóa") continue;

        if (no > 1) {
          topNo.push([tenKH, no]);
        }
      }

      topNo.sort(function (a, b) {
        return b[1] - a[1];
      });

      topNo = topNo.slice(0, 10);

      // ==============================
      // 2. TOP MUA NHIỀU
      // Trả về dạng: [[TenKhach, SoDon, TongTien], ...]
      // ==============================
      var mapMua = {};

      for (var d = 1; d < dataDH.length; d++) {
        var maHD = normalizeText_(dataDH[d][0]);           // A: MaHoaDon
        var tenDon = normalizeText_(dataDH[d][2]);         // C: TenKhach
        var maKHDon = normalizeText_(dataDH[d][8]);        // I: MaKH
        var tongTien = parseFloat(dataDH[d][11]) || 0;     // L: TongTien
        var trangThaiBill = normalizeText_(dataDH[d][13]); // N: TrangThaiHoaDon

        if (!maHD) continue;
        if (trangThaiBill !== "Đã gửi đơn") continue;
        if (tongTien <= 0) continue;

        var key = maKHDon || tenDon;
        if (!key) continue;

        if (!mapMua[key]) {
          mapMua[key] = {
            ten: tenDon || key,
            soDon: 0,
            tongTien: 0
          };
        }

        mapMua[key].soDon += 1;
        mapMua[key].tongTien += tongTien;
      }

      var topMua = Object.keys(mapMua).map(function (key) {
        return [
          mapMua[key].ten,
          mapMua[key].soDon,
          mapMua[key].tongTien
        ];
      });

      topMua.sort(function (a, b) {
        return b[2] - a[2];
      });

      topMua = topMua.slice(0, 10);

      // ==============================
      // 3. KHÁCH QUÊN
      // Khách không mua trong 30 ngày gần đây
      // Frontend chỉ dùng row[0], nên trả [[TenKhach], ...]
      // ==============================
      function parseCustomerReportDate_(v) {
        if (v instanceof Date) return v;

        var s = normalizeText_(v);
        if (!s) return null;

        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
          var d1 = new Date(s);
          if (!isNaN(d1.getTime())) return d1;
        }

        var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) {
          return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        }

        var d2 = new Date(s);
        if (!isNaN(d2.getTime())) return d2;

        return null;
      }

      var lastOrderMap = {};

      for (var od = 1; od < dataDH.length; od++) {
        var maKHOrder = normalizeText_(dataDH[od][8]);      // I: MaKH
        var tenOrder = normalizeText_(dataDH[od][2]);       // C: TenKhach
        var trangThaiOrderBill = normalizeText_(dataDH[od][13]);
        var ngayOrder = parseCustomerReportDate_(dataDH[od][1]); // B: NgayTao

        if (trangThaiOrderBill === "Đã xóa đơn") continue;
        if (!ngayOrder) continue;

        var keyOrder = maKHOrder || tenOrder;
        if (!keyOrder) continue;

        var time = ngayOrder.getTime();

        if (!lastOrderMap[keyOrder] || time > lastOrderMap[keyOrder]) {
          lastOrderMap[keyOrder] = time;
        }
      }

      var nowDate = new Date();
      var thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      var khachQuen = [];

      for (var q = 1; q < dataKH.length; q++) {
        var maKHQ = normalizeText_(dataKH[q][0]);        // A: MaKH
        var tenKHQ = normalizeText_(dataKH[q][1]);       // B: TenKhach
        var trangThaiQ = normalizeText_(dataKH[q][8]);   // I: TrangThai

        if (!tenKHQ) continue;
        if (trangThaiQ === "Đã xóa") continue;

        var keyQ = maKHQ || tenKHQ;
        var lastTime = lastOrderMap[keyQ];

        if (!lastTime || (nowDate.getTime() - lastTime > thirtyDaysMs)) {
          khachQuen.push([tenKHQ]);
        }

        if (khachQuen.length >= 20) break;
      }

      return outJson_({
        topNo: topNo,
        topMua: topMua,
        khachQuen: khachQuen
      });

    } catch (err) {
      return outJson_({
        topNo: [],
        topMua: [],
        khachQuen: []
      });
    }
  }
  /****************************************************
   * AZALAS CHAT CENTER - API NHẬN HÀNG RIÊNG V57
   * - Chỉ đọc RAP/LichSuNhap và RAP/tbl_Rap_DonHang.
   * - Không ghi đè API getChatMessages/saveChatMessage cũ.
   * - Không tạo sheet, không sửa dữ liệu khi tải danh sách.
   ****************************************************/
  if (data.type === "getChatNhanHang") {
    try {
      return outJson_(azChatCenterGetNhanHangV57_());
    } catch (err) {
      return outJson_({
        ok: false,
        nhanHang: [],
        total: 0,
        message: "Lỗi getChatNhanHang: " + (err && err.message ? err.message : String(err))
      });
    }
  }

  // 22. LƯU TIN NHẮN CHAT / THÔNG BÁO
  // Data mới: SYSTEM / tbl_Chat
  if (data.type === "saveChatMessage") {
    try {
      var sheetChat = getSheet_("SYSTEM", "tbl_Chat");

      var role = normalizeRole_(data.role);
      var chatType = normalizeText_(data.chatType);
      var sender = normalizeText_(data.sender || data.user || data.actorUser) || "Không rõ";
      var message = normalizeText_(data.message);
      var thoiGian = Utilities.formatDate(new Date(), "GMT+7", "HH:mm dd/MM/yyyy");

      if (!chatType) chatType = "BOSS";

      if (!message) {
        return outText_("Lỗi: Nội dung tin nhắn trống");
      }

      if (chatType === "BOSS" && !isOwnerAdminRole_(role)) {
        return outText_("Lỗi: Bạn không có quyền gửi thông báo!");
      }

      sheetChat.appendRow([
        thoiGian,
        chatType,
        sender,
        message
      ]);

      SpreadsheetApp.flush();
      return outText_("OK");

    } catch (err) {
      return outText_("Lỗi saveChatMessage: " + err.message);
    }
  }

  // 23. TẢI DANH SÁCH TIN NHẮN
  // Data mới: SYSTEM / tbl_Chat
  if (data.type === "getChatMessages") {
    try {
      var bossMsgs = [];
      var nhanHangMsgs = [];

      var sheetChat = getSheet_("SYSTEM", "tbl_Chat");

      var lastRow = sheetChat.getLastRow();

      if (lastRow >= 2) {
        var startRow = Math.max(2, lastRow - 99);
        var chatData = sheetChat
          .getRange(startRow, 1, lastRow - startRow + 1, 4)
          .getValues();

        bossMsgs = chatData.filter(function (row) {
          return normalizeText_(row[1]) === "BOSS";
        });
      }

      return outJson_({
        boss: bossMsgs,
        nhanHang: nhanHangMsgs
      });

    } catch (err) {
      return outJson_({
        boss: [],
        nhanHang: [],
        error: "Lỗi getChatMessages: " + err.message
      });
    }
  }
  // 24. DUYỆT / THẢ LỬA THÔNG BÁO NHẬN HÀNG
  // Data mới: RAP / LichSuNhap
  if (data.type === "duyetNhanHang") {
    try {
      var ssRap = getSS_("RAP");
      var sheetLS = ssRap.getSheetByName("LichSuNhap");

      if (!sheetLS) {
        return outText_("Lỗi: Không tìm thấy sheet LichSuNhap trong file RAP");
      }

      var row = parseInt(data.rowIdx, 10);
      var nguoiDuyet = normalizeText_(data.user || data.actorUser || data.nguoiDuyet) || "Không rõ";

      if (!row || row < 2) {
        return outText_("Lỗi: Dòng duyệt không hợp lệ");
      }

      if (row > sheetLS.getLastRow()) {
        return outText_("Lỗi: Dòng duyệt vượt quá dữ liệu hiện có");
      }

      // Cột G: thời gian duyệt
      // Cột H: người duyệt
      sheetLS.getRange(row, 7).setValue(nowVN_());
      sheetLS.getRange(row, 8).setValue(nguoiDuyet);

      SpreadsheetApp.flush();
      return outText_("OK");

    } catch (err) {
      return outText_("Lỗi duyetNhanHang: " + err.message);
    }
  }
  // LỆNH RESET ĐƠN HÀNG / HÓA ĐƠN ĐÃ SỬA
  // Xóa bản sửa trong SALES / tbl_ChiTietThayDoiDonHang
  // Sau đó hóa đơn sẽ quay về chi tiết gốc trong tbl_ChiTietDonHang
  if (data.type === "resetBill") {
    try {
      var sheetThayDoi = getSheet_("SALES", "tbl_ChiTietThayDoiDonHang");

      var maHoaDonInput = normalizeText_(data.maHoaDon);

      if (!maHoaDonInput) {
        return outText_("Lỗi: Thiếu mã hóa đơn cần reset");
      }

      var values = sheetThayDoi.getDataRange().getValues();

      var listMa = maHoaDonInput.split("+").map(function (m) {
        return normalizeText_(m)
          .replace("-TX", "")
          .replace("-CK", "")
          .trim();
      }).filter(function (m) {
        return m !== "";
      });

      function isSameOrderReset_(idDon, baseCode) {
        idDon = normalizeText_(idDon);
        baseCode = normalizeText_(baseCode);

        if (!idDon || !baseCode) return false;

        if (idDon === baseCode) return true;
        if (idDon.indexOf(baseCode + "-") === 0) return true;

        return false;
      }

      var deleted = 0;

      for (var i = values.length - 1; i >= 1; i--) {
        var maTrongSheet = normalizeText_(values[i][1]); // B: MaHoaDon
        if (!maTrongSheet) continue;

        var isMatch = false;

        for (var m = 0; m < listMa.length; m++) {
          if (isSameOrderReset_(maTrongSheet, listMa[m])) {
            isMatch = true;
            break;
          }
        }

        if (isMatch) {
          sheetThayDoi.deleteRow(i + 1);
          deleted++;
        }
      }

      SpreadsheetApp.flush();

      return outText_("OK_RESET");

    } catch (err) {
      return outText_("Lỗi resetBill: " + err.message);
    }
  }

    // =================================================================
  // HÀNG TRẢ - DATA MỚI - FIX ĐỒNG BỘ SALES / TÀI CHÍNH
  // Dùng helper global htText_/htNum_/htStatus_/htFind... ở đầu file.
  // Đã xóa các bản helper lặp bên trong doPost để tránh shadow/gây lệch logic.

  // 4A.0 LẤY GIÁ CŨ THEO KHÁCH + SẢN PHẨM ĐÃ TỪNG RA HÓA ĐƠN
  if (data.type === "getHangTraOldPrice") {
    try {
      var sheetKHOld = getSheet_("SALES", "tbl_KhachHang");
      var khOld = htFindCustomer_(sheetKHOld, htText_(data.maKH), htText_(data.tenKhach));
      if (!khOld.found) {
        return outJson_({ ok: true, found: false, message: "Chưa chọn đúng khách hàng" });
      }

      var targetMaNB = htText_(data.maHangNoiBo).toUpperCase();
      var targetMaBH = htText_(data.maBanHang).toUpperCase();
      var targetMaSP = htText_(data.maSP).toUpperCase();
      var targetMaRap = htText_(data.maRap).toUpperCase();
      var targetMau = htText_(data.mau).toUpperCase();
      var targetSize = htText_(data.size).toUpperCase();

      function htDateKeyOld_(v) {
        try {
          if (v instanceof Date && !isNaN(v.getTime())) return v.getTime();
          var s = htText_(v);
          if (!s) return 0;
          var d = new Date(s);
          if (!isNaN(d.getTime())) return d.getTime();
          var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
        } catch (eDateOld) {}
        return 0;
      }

      function htBadStatusOld_(v) {
        var k = htText_(v).toLowerCase();
        return k.indexOf("hủy") !== -1 || k.indexOf("huỷ") !== -1 || k.indexOf("xóa") !== -1 || k.indexOf("xoá") !== -1 || k.indexOf("xoa") !== -1;
      }

      function htMatchOld_(rowInfo) {
        var maNB = htText_(rowInfo.maHangNoiBo).toUpperCase();
        var maBH = htText_(rowInfo.maBanHang).toUpperCase();
        var maSP = htText_(rowInfo.maSP).toUpperCase();
        var maRap = htText_(rowInfo.maRap).toUpperCase();
        var mau = htText_(rowInfo.mau).toUpperCase();
        var size = htText_(rowInfo.size).toUpperCase();

        if (targetMaNB && maNB && targetMaNB === maNB) return true;
        if (targetMaBH && maBH && targetMaBH === maBH) return true;
        if (targetMaSP && maSP && targetMaSP === maSP && (!targetMau || targetMau === mau) && (!targetSize || targetSize === size)) return true;
        if (targetMaRap && maRap && targetMaRap === maRap && (!targetMau || targetMau === mau) && (!targetSize || targetSize === size)) return true;
        return false;
      }

      var orderMapOld = {};
      var shDHOld = getSheet_("SALES", "tbl_DonHang");
      var dhOld = shDHOld.getDataRange().getValues();
      for (var od = 1; od < dhOld.length; od++) {
        var maHD = htText_(dhOld[od][0]);
        if (!maHD) continue;
        var maKH = htText_(dhOld[od][8]);      // I MaKH
        var tenK = htText_(dhOld[od][2]);      // C TenKhach
        if (maKH !== khOld.maKH && tenK.toLowerCase() !== khOld.tenKhach.toLowerCase()) continue;
        if (htBadStatusOld_(dhOld[od][6]) || htBadStatusOld_(dhOld[od][13])) continue;
        orderMapOld[maHD] = {
          maHoaDon: maHD,
          ngay: dhOld[od][1],
          dateKey: htDateKeyOld_(dhOld[od][1]),
          tenKhach: tenK
        };
      }

      var bestOld = null;
      function takeOld_(candidate) {
        if (!candidate || !candidate.maHoaDon || !orderMapOld[candidate.maHoaDon]) return;
        var info = orderMapOld[candidate.maHoaDon];
        candidate.dateKey = info.dateKey || 0;
        candidate.ngay = info.ngay || "";
        if (!bestOld || candidate.dateKey >= bestOld.dateKey) bestOld = candidate;
      }

      // Ưu tiên bảng chi tiết theo size vì có mã bán hàng / mã nội bộ rõ nhất.
      try {
        var shSizeOld = getSheet_("SALES", "tbl_DonHang_CT_Size");
        var sizeRowsOld = shSizeOld.getDataRange().getValues();
        for (var sr = 1; sr < sizeRowsOld.length; sr++) {
          var maHDSize = htText_(sizeRowsOld[sr][0]);
          if (!orderMapOld[maHDSize]) continue;
          var giaSize = htNum_(sizeRowsOld[sr][10]); // K DonGia
          if (giaSize <= 0) continue;
          var infoSize = {
            maHoaDon: maHDSize,
            maBanHang: htText_(sizeRowsOld[sr][2]),
            maHangNoiBo: htText_(sizeRowsOld[sr][3]),
            maSP: htText_(sizeRowsOld[sr][4]),
            maRap: htText_(sizeRowsOld[sr][5]),
            mau: htText_(sizeRowsOld[sr][6]),
            size: htText_(sizeRowsOld[sr][7]),
            donGia: giaSize
          };
          if (htMatchOld_(infoSize)) takeOld_(infoSize);
        }
      } catch (eSizeOld) {}

      // Fallback bảng chi tiết đơn cũ.
      try {
        var shCTOld = getSheet_("SALES", "tbl_ChiTietDonHang");
        var ctOld = shCTOld.getDataRange().getValues();
        for (var cr = 1; cr < ctOld.length; cr++) {
          var maHDCT = htText_(ctOld[cr][1]); // B MaHoaDon
          if (!orderMapOld[maHDCT]) continue;
          var giaCT = htNum_(ctOld[cr][4]); // E DonGia
          if (giaCT <= 0) continue;
          var infoCT = {
            maHoaDon: maHDCT,
            maBanHang: htText_(ctOld[cr][6]),
            maHangNoiBo: htText_(ctOld[cr][7]),
            maSP: "",
            maRap: "",
            mau: htText_(ctOld[cr][8]),
            size: htText_(ctOld[cr][9]),
            donGia: giaCT
          };
          if (htMatchOld_(infoCT)) takeOld_(infoCT);
        }
      } catch (eCTOld) {}

      if (bestOld && bestOld.donGia > 0) {
        return outJson_({
          ok: true,
          found: true,
          gia: bestOld.donGia,
          maHoaDon: bestOld.maHoaDon,
          ngay: bestOld.ngay,
          source: "HOA_DON_CU"
        });
      }

      return outJson_({ ok: true, found: false, message: "Chưa có giá cũ cho khách + sản phẩm này" });
    } catch (errOldPrice) {
      return outJson_({ ok: false, found: false, message: "Lỗi dò giá cũ: " + errOldPrice.message });
    }
  }

  // 4A.1 LƯU PHIẾU HÀNG TRẢ MỚI
  if (data.type === "saveHangTra") {
    try {
      var sheetHangTra = getSheet_("SALES", "tbl_HangTra");
      var sheetChiTiet = getSheet_("SALES", "tbl_ChiTietHangTra");
      var sheetKH = getSheet_("SALES", "tbl_KhachHang");

      var tenKhach = htText_(data.tenKhach);
      var tongTien = htNum_(data.tongTien);
      var nguoiKiem = htText_(data.nguoiKiem || data.user || data.actorUser) || "Không rõ";
      var ghiChu = htText_(data.ghiChu);
      var details = Array.isArray(data.details) ? data.details : [];
      var now = nowVN_();

      if (!tenKhach) return outText_("Lỗi: Thiếu tên khách hàng");
      if (details.length === 0) return outText_("Lỗi: Chưa có sản phẩm hàng trả");

      var kh = htFindCustomer_(sheetKH, "", tenKhach);

      if (!kh.found) {
        return outText_("Lỗi: Khách hàng chưa có trong danh sách. Vui lòng tạo khách trước.");
      }

      for (var vht = 0; vht < details.length; vht++) {
        var itemCheck = details[vht] || {};
        var tenSPCheck = htText_(itemCheck.tenSP);
        var soLuongCheck = htNum_(itemCheck.soLuong);
        if (!tenSPCheck || soLuongCheck <= 0) continue;
        if (htNum_(itemCheck.donGia) <= 0) return outText_("Lỗi: Sản phẩm " + tenSPCheck + " chưa có giá áp dụng.");
        if (!htText_(itemCheck.tinhTrang)) return outText_("Lỗi: Sản phẩm " + tenSPCheck + " chưa chọn loại hàng.");
      }

      var maPhieu = "HT" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + "-" + Math.floor(100 + Math.random() * 900);

      sheetHangTra.appendRow([
        maPhieu,        // A MaPhieuTra
        now,            // B NgayTra
        kh.tenKhach,    // C TenKhach
        tongTien,       // D TongTienTra
        nguoiKiem,      // E NguoiKiem
        "Mới",          // F TrangThai
        ghiChu,         // G GhiChu
        kh.maKH,        // H MaKH
        "",             // I MaHoaDonGoc
        now             // J CapNhatCuoi
      ]);

      var hangTraDetailRows = [];
      details.forEach(function(item) {
        var tenSP = htText_(item.tenSP);
        var soLuong = htNum_(item.soLuong);
        var donGia = htNum_(item.donGia);
        var thanhTien = htNum_(item.thanhTien) || (soLuong * donGia);
        var tinhTrangItem = htText_(item.tinhTrang);
        if (!tenSP || soLuong <= 0) return;

        hangTraDetailRows.push([
          maPhieu, tenSP, soLuong, donGia, thanhTien, ghiChu, now, tinhTrangItem,
          htText_(item.maBanHang), htText_(item.maHangNoiBo), htText_(item.maSP),
          htText_(item.maRap), htText_(item.mau), htText_(item.size)
        ]);
      });

      if (hangTraDetailRows.length) {
        sheetChiTiet.getRange(sheetChiTiet.getLastRow() + 1, 1, hangTraDetailRows.length, 14).setValues(hangTraDetailRows);
      }

      SpreadsheetApp.flush();
      return outText_("OK");

    } catch (err) {
      return outText_("Lỗi saveHangTra: " + err.message);
    }
  }

  // 4A.2 LẤY DANH SÁCH PHIẾU HÀNG TRẢ
  if (data.type === "getHangTraList") {
    try {
      var sheetHangTra = getSheet_("SALES", "tbl_HangTra");
      var values = sheetHangTra.getDataRange().getValues();

      if (values.length < 2) return outJson_([]);

      var list = [];

      for (var i = 1; i < values.length; i++) {
        if (!htText_(values[i][0])) continue;

        var row = values[i].slice();
        row[5] = htStatus_(row[5]);

        // Không trả phiếu đã xóa ra giao diện danh sách chính
        if (row[5] === "Xóa") continue;

        list.push(row);
      }

      // Mới lên trước
      list.reverse();

      return outJson_(list);

    } catch (err) {
      return outJson_([]);
    }
  }

  // 4A.3 LẤY CHI TIẾT PHIẾU HÀNG TRẢ
  if (data.type === "getHangTraDetails") {
    try {
      var sheetGoc = getSheet_("SALES", "tbl_ChiTietHangTra");
      var sheetSua = htEnsureChiTietHangTraSuaSheet_();
      var sheetHT = getSheet_("SALES", "tbl_HangTra");
      var sheetKH = getSheet_("SALES", "tbl_KhachHang");

      var maPhieu = htText_(data.maPhieu);

      if (!maPhieu) {
        return outJson_({
          details: [],
          oldDebt: 0,
          maKH: "",
          tenKhach: "",
          trangThai: "",
          tongTienTra: 0,
          ngay: "",
          nguoiKiem: ""
        });
      }

      var ht = htFindHangTra_(sheetHT, maPhieu);

      if (!ht.found) {
        return outJson_({
          details: [],
          oldDebt: 0,
          maKH: "",
          tenKhach: "",
          trangThai: "",
          tongTienTra: 0,
          ngay: "",
          nguoiKiem: "",
          error: "Không tìm thấy phiếu " + maPhieu
        });
      }

      var products = [];

      var dataSua = sheetSua.getDataRange().getValues();

      for (var s = 1; s < dataSua.length; s++) {
        if (htText_(dataSua[s][0]) === maPhieu) {
          products.push(dataSua[s]);
        }
      }

      if (products.length === 0) {
        var dataGoc = sheetGoc.getDataRange().getValues();

        for (var g = 1; g < dataGoc.length; g++) {
          if (htText_(dataGoc[g][0]) === maPhieu) {
            products.push(dataGoc[g]);
          }
        }
      }

      var kh = htFindCustomer_(sheetKH, ht.maKH, ht.tenKhach);

      return outJson_({
        details: products,
        oldDebt: kh.noHienTai || 0,
        maKH: kh.maKH || ht.maKH,
        tenKhach: kh.tenKhach || ht.tenKhach,
        trangThai: ht.trangThai,
        tongTienTra: ht.tongTienTra,
        ngay: ht.ngayTra,
        nguoiKiem: ht.nguoiKiem,
        maHoaDonGoc: ht.maHoaDonGoc
      });

    } catch (err) {
      return outJson_({
        details: [],
        oldDebt: 0,
        maKH: "",
        tenKhach: "",
        trangThai: "",
        tongTienTra: 0,
        ngay: "",
        nguoiKiem: "",
        error: "Lỗi getHangTraDetails: " + err.message
      });
    }
  }

  // 4A.4 LƯU BẢN SỬA PHIẾU HÀNG TRẢ
  if (data.type === "updateEditedHangTra") {
    try {
      var sheetSua = htEnsureChiTietHangTraSuaSheet_();
      var sheetHangTra = getSheet_("SALES", "tbl_HangTra");

      var maPhieu = htText_(data.maPhieu);
      var details = Array.isArray(data.details) ? data.details : [];
      var newTotal = htNum_(data.newTotal);
      var now = nowVN_();

      if (!maPhieu) return outText_("Lỗi: Thiếu mã phiếu hàng trả");

      var ht = htFindHangTra_(sheetHangTra, maPhieu);

      if (!ht.found) return outText_("Lỗi: Không tìm thấy phiếu " + maPhieu);
      if (ht.trangThai !== "Mới") return outText_("Lỗi: Phiếu đã duyệt hoặc đã xóa, không được sửa.");

      var dataSuaOld = sheetSua.getDataRange().getValues();

      for (var r = dataSuaOld.length - 1; r >= 1; r--) {
        if (htText_(dataSuaOld[r][0]) === maPhieu) {
          sheetSua.deleteRow(r + 1);
        }
      }

      // Giữ lại dữ liệu phụ của hàng trả khi sửa phiếu:
      // TinhTrangHang, MaBanHang, MaHangNoiBo, MaSP, MaRap, Mau, Size.
      // Nếu frontend chưa gửi đủ các trường này, backend lấy lại từ bản sửa cũ hoặc bản gốc.
      var metaMap = {};
      var hadSuaOld = false;

      dataSuaOld.forEach(function(row, idx) {
        if (idx === 0) return;
        if (htText_(row[0]) !== maPhieu) return;
        hadSuaOld = true;
        var key = htText_(row[1]).toLowerCase();
        if (!key) return;
        metaMap[key] = {
          tinhTrang: htText_(row[7]),
          maBanHang: htText_(row[8]),
          maHangNoiBo: htText_(row[9]),
          maSP: htText_(row[10]),
          maRap: htText_(row[11]),
          mau: htText_(row[12]),
          size: htText_(row[13])
        };
      });

      if (!hadSuaOld) {
        try {
          var sheetGoc = getSheet_("SALES", "tbl_ChiTietHangTra");
          var dataGoc = sheetGoc.getDataRange().getValues();
          dataGoc.forEach(function(row, idx) {
            if (idx === 0) return;
            if (htText_(row[0]) !== maPhieu) return;
            var key = htText_(row[1]).toLowerCase();
            if (!key) return;
            metaMap[key] = {
              tinhTrang: htText_(row[7]),
              maBanHang: htText_(row[8]),
              maHangNoiBo: htText_(row[9]),
              maSP: htText_(row[10]),
              maRap: htText_(row[11]),
              mau: htText_(row[12]),
              size: htText_(row[13])
            };
          });
        } catch (errMeta) {}
      }

      details.forEach(function(item) {
        var tenSP = htText_(item.tenSP);
        var soLuong = htNum_(item.soLuong);
        var donGia = htNum_(item.donGia);
        var thanhTien = htNum_(item.thanhTien) || (soLuong * donGia);
        var meta = metaMap[tenSP.toLowerCase()] || {};

        if (!tenSP || soLuong <= 0) return;

        sheetSua.appendRow([
          maPhieu,                                                   // A MaPhieuTra
          tenSP,                                                     // B TenSP
          soLuong,                                                   // C SoLuong
          donGia,                                                    // D DonGia
          thanhTien,                                                 // E ThanhTien
          htText_(item.ghiChu) || "Sửa phiếu hàng trả",              // F GhiChu
          now,                                                       // G ThoiGian
          htText_(item.tinhTrang || item.tinhTrangHang) || meta.tinhTrang,      // H TinhTrangHang
          htText_(item.maBanHang) || meta.maBanHang,                 // I MaBanHang
          htText_(item.maHangNoiBo) || meta.maHangNoiBo,             // J MaHangNoiBo
          htText_(item.maSP) || meta.maSP,                           // K MaSP
          htText_(item.maRap) || meta.maRap,                         // L MaRap
          htText_(item.mau) || meta.mau,                             // M Mau
          htText_(item.size) || meta.size                            // N Size
        ]);
      });

      sheetHangTra.getRange(ht.rowIndex, 4).setValue(newTotal); // D TongTienTra
      sheetHangTra.getRange(ht.rowIndex, 10).setValue(now);     // J CapNhatCuoi

      SpreadsheetApp.flush();
      return outText_("OK_SAVE");

    } catch (err) {
      return outText_("Lỗi updateEditedHangTra: " + err.message);
    }
  }

  // 4A.5 RESET PHIẾU HÀNG TRẢ VỀ BẢN GỐC
  if (data.type === "resetHangTra") {
    try {
      var sheetSua = htEnsureChiTietHangTraSuaSheet_();
      var sheetHangTra = getSheet_("SALES", "tbl_HangTra");
      var sheetGoc = getSheet_("SALES", "tbl_ChiTietHangTra");

      var maPhieu = htText_(data.maPhieu);
      var now = nowVN_();

      if (!maPhieu) return outText_("Lỗi: Thiếu mã phiếu");

      var ht = htFindHangTra_(sheetHangTra, maPhieu);

      if (!ht.found) return outText_("Lỗi: Không tìm thấy phiếu " + maPhieu);
      if (ht.trangThai !== "Mới") return outText_("Lỗi: Phiếu đã duyệt hoặc đã xóa, không được reset.");

      var dataSua = sheetSua.getDataRange().getValues();

      for (var s = dataSua.length - 1; s >= 1; s--) {
        if (htText_(dataSua[s][0]) === maPhieu) {
          sheetSua.deleteRow(s + 1);
        }
      }

      var tongGoc = 0;
      var dataGoc = sheetGoc.getDataRange().getValues();

      for (var g = 1; g < dataGoc.length; g++) {
        if (htText_(dataGoc[g][0]) === maPhieu) {
          tongGoc += htNum_(dataGoc[g][4]);
        }
      }

      sheetHangTra.getRange(ht.rowIndex, 4).setValue(tongGoc);
      sheetHangTra.getRange(ht.rowIndex, 10).setValue(now);

      SpreadsheetApp.flush();
      return outText_("OK_RESET");

    } catch (err) {
      return outText_("Lỗi resetHangTra: " + err.message);
    }
  }

  // 4A.5B CẬP NHẬT TRẠNG THÁI PHIẾU HÀNG TRẢ
  if (data.type === "updateHangTraStatus") {
    try {
      var sheetHT = getSheet_("SALES", "tbl_HangTra");

      var maPhieu = htText_(data.maPhieu);
      var status = htStatus_(data.status || "Xóa");
      var now = nowVN_();

      if (!maPhieu) return outText_("Lỗi: Thiếu mã phiếu hàng trả");

      var ht = htFindHangTra_(sheetHT, maPhieu);

      if (!ht.found) return outText_("Lỗi: Không tìm thấy phiếu " + maPhieu);
      if (ht.trangThai === "Đã duyệt") return outText_("Lỗi: Phiếu đã duyệt, không được xóa.");

      sheetHT.getRange(ht.rowIndex, 6).setValue(status); // F TrangThai
      sheetHT.getRange(ht.rowIndex, 10).setValue(now);   // J CapNhatCuoi

      SpreadsheetApp.flush();
      return outText_("OK");

    } catch (err) {
      return outText_("Lỗi updateHangTraStatus: " + err.message);
    }
  }

  // 4A.6 CHỐT PHIẾU HÀNG TRẢ TRỪ THẲNG VÀO NỢ
  if (data.type === "confirmHangTraDeductDebt") {
    var htDebtLock = null;
    var htDebtLocked = false;
    try {
      htDebtLock = LockService.getScriptLock();
      htDebtLocked = htDebtLock.tryLock(20000);
      if (!htDebtLocked) return outText_("Lỗi: Hệ thống đang xử lý công nợ khác. Vui lòng thử lại sau vài giây.");

      var sheetKH = getSheet_("SALES", "tbl_KhachHang");
      var sheetNK = getSheet_("TAI_CHINH", "tbl_NhatKyNo");
      var sheetCNTH = getSheet_("TAI_CHINH", "tbl_CongNo_TongHop");
      var sheetHT = getSheet_("SALES", "tbl_HangTra");

      var maKH = htText_(data.maKH);
      var tenKhach = htText_(data.tenKhach);
      var maPhieu = htText_(data.maPhieu);
      var tongTienTra = htNum_(data.tongTienTra);
      var nguoiDuyet = htText_(data.nguoiDuyet || data.user || data.actorUser) || "Không rõ";
      var now = nowVN_();

      if (!maKH || !maPhieu) return outText_("Lỗi: Thiếu mã khách hoặc mã phiếu");
      if (tongTienTra <= 0) return outText_("Lỗi: Tổng tiền trả không hợp lệ");

      var ht = htFindHangTra_(sheetHT, maPhieu);
      if (!ht.found) return outText_("Lỗi: Không tìm thấy phiếu " + maPhieu);
      if (ht.trangThai !== "Mới") return outText_("Lỗi: Phiếu này đã duyệt hoặc đã xóa.");

      var kh = htFindCustomer_(sheetKH, maKH, tenKhach);
      if (!kh.found) return outText_("Lỗi: Không tìm thấy khách hàng " + maKH);

      var noMoi = kh.noHienTai - tongTienTra;
      if (noMoi <= 1) noMoi = 0;

      sheetKH.getRange(kh.rowIndex, 5).setValue(noMoi);
      sheetKH.getRange(kh.rowIndex, 12).setValue(now);

      sheetNK.appendRow([
        kh.maKH, kh.tenKhach, now, "KHACH_TRA_HANG", -tongTienTra,
        "Chốt trừ nợ phiếu hàng trả " + maPhieu, nguoiDuyet, maPhieu, "KHACH_HANG"
      ]);

      var htStatusRow = sheetHT.getRange(ht.rowIndex, 6, 1, 5).getValues()[0];
      htStatusRow[0] = "Đã duyệt"; // F
      htStatusRow[2] = kh.maKH;    // H
      htStatusRow[4] = now;        // J
      sheetHT.getRange(ht.rowIndex, 6, 1, 5).setValues([htStatusRow]);

      htAppendCongNoTongHop_(sheetCNTH, kh.maKH, kh.tenKhach, 0, tongTienTra, noMoi, now);
      SpreadsheetApp.flush();
      return outText_("OK");

    } catch (err) {
      return outText_("Lỗi confirmHangTraDeductDebt: " + err.message);
    } finally {
      try { if (htDebtLocked && htDebtLock) htDebtLock.releaseLock(); } catch (eHtDebtLock) {}
    }
  }
  // =================================================================
  // [CÔNG NHÂN VIÊN - TASK 2]: CÁC API XỬ LÝ NHÂN SỰ & TIỀN LƯƠNG
  // =================================================================

  // 1. LẤY DANH SÁCH NHÂN VIÊN (Loại bỏ những người "Đã nghỉ")
  if (data.type === "getNhanVienList") {
    var sheet = ss.getSheetByName("tbl_NhanVien");
    if (!sheet) return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
    var values = sheet.getDataRange().getValues();
    values.shift(); // Bỏ dòng tiêu đề
    var list = values.filter(function (r) { return r[2] !== "Đã nghỉ" && r[0] !== ""; }).map(function (r) { return r[0]; });
    return ContentService.createTextOutput(JSON.stringify(list)).setMimeType(ContentService.MimeType.JSON);
  }

  // 2. LƯU CHẤM CÔNG HÀNG THÁNG
  if (data.type === "saveChamCong") {
    var sheet = ss.getSheetByName("tbl_ChamCong");
    var maCC = "CC-" + data.tenNV + "-" + data.thangNam; // Chìa khóa duy nhất

    // Kiểm tra xem tháng này đã nhập công cho người này chưa
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (values[i][0] === maCC) {
        return ContentService.createTextOutput("Lỗi: Tháng này đã nhập công rồi. Hãy vào mục Chỉnh sửa!").setMimeType(ContentService.MimeType.TEXT);
      }
    }
    sheet.appendRow([maCC, data.tenNV, data.thangNam, dmCongNum_(data.soCong), data.tangCa, data.thuong]);
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // 3. LƯU ỨNG LƯƠNG
  if (data.type === "saveUngLuong") {
    var sheet = ss.getSheetByName("tbl_UngLuong");
    var maPhieu = "UL" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");

    // Tự động cắt lấy Tháng/Năm từ ngày ứng để làm mốc gom báo cáo (Ví dụ: 2026-05-10 -> 05/2026)
    var d = new Date(data.ngayUng);
    var thangGhiNhan = Utilities.formatDate(d, "GMT+7", "MM/yyyy");

    sheet.appendRow([maPhieu, data.tenNV, data.ngayUng, data.soTien, data.lyDo, thangGhiNhan]);
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // 4. LƯU & GHI NHẬT KÝ ĐỔI GIÁ CÔNG
  if (data.type === "updateGiaCong") {
    var sheetGia = ss.getSheetByName("tbl_LichSuGiaCong");
    var sheetLog = ss.getSheetByName("tbl_LogNhanSu");

    sheetGia.appendRow([data.tenNV, data.ngayApDung, data.giaCong]);

    var logNoiDung = "Cập nhật giá công mới: " + parseFloat(data.giaCong).toLocaleString('vi-VN') + "đ (Từ " + data.ngayApDung + ")";
    sheetLog.appendRow([new Date(), data.nguoiSua, "Đổi giá công", data.tenNV, logNoiDung]);

    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // 5. CHỈNH SỬA CÔNG & GHI NHẬT KÝ
  if (data.type === "updateChamCong") {
    var sheet = ss.getSheetByName("tbl_ChamCong");
    var sheetLog = ss.getSheetByName("tbl_LogNhanSu");
    var maCC = "CC-" + data.tenNV + "-" + data.thangNam;
    var values = sheet.getDataRange().getValues();

    for (var i = 1; i < values.length; i++) {
      if (values[i][0] === maCC) {
        var oldCong = values[i][3]; var oldTC = values[i][4]; var oldThuong = values[i][5];
        // Giữ nguyên giá trị cũ nếu ô nhập bị bỏ trống
        var newCong = (data.soCong !== "") ? dmCongNum_(data.soCong) : dmCongNum_(oldCong);
        var newTC = (data.tangCa !== "") ? data.tangCa : oldTC;
        var newThuong = (data.thuong !== "") ? data.thuong : oldThuong;

        sheet.getRange(i + 1, 4).setValue(newCong);
        sheet.getRange(i + 1, 5).setValue(newTC);
        sheet.getRange(i + 1, 6).setValue(newThuong);

        var logNoiDung = "Sửa công " + data.thangNam + " (Công: " + oldCong + "->" + newCong + ", TC: " + oldTC + "->" + newTC + ", Thưởng: " + oldThuong + "->" + newThuong + ")";
        sheetLog.appendRow([new Date(), data.nguoiSua, "Sửa công", data.tenNV, logNoiDung]);

        return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
      }
    }
    return ContentService.createTextOutput("Lỗi: Không tìm thấy dữ liệu công của tháng này!").setMimeType(ContentService.MimeType.TEXT);
  }

  // 6. LẤY DANH SÁCH ỨNG (Theo tháng) + SỬA/XÓA ỨNG
  if (data.type === "getUngLuongList") {
    var sheet = ss.getSheetByName("tbl_UngLuong");
    if (!sheet) return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
    var values = sheet.getDataRange().getValues();
    values.shift();
    // Lọc theo tháng (cột F)
    var filtered = values.filter(function (r) { return r[5] === data.thangNam; });
    filtered.reverse(); // Đảo mới nhất lên đầu
    return ContentService.createTextOutput(JSON.stringify(filtered)).setMimeType(ContentService.MimeType.JSON);
  }

  if (data.type === "updateUngLuong") {
    var sheet = ss.getSheetByName("tbl_UngLuong");
    var sheetLog = ss.getSheetByName("tbl_LogNhanSu");
    var values = sheet.getDataRange().getValues();

    for (var i = 1; i < values.length; i++) {
      if (values[i][0] === data.maPhieu) {
        var tenNV = values[i][1];
        var oldTien = parseFloat(values[i][3]) || 0;

        if (data.action === "Xoa") {
          sheet.deleteRow(i + 1);
          sheetLog.appendRow([new Date(), data.nguoiSua, "Xóa ứng", tenNV, "Xóa phiếu " + data.maPhieu + " (" + oldTien.toLocaleString('vi-VN') + "đ)"]);
          return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
        } else {
          sheet.getRange(i + 1, 4).setValue(data.soTien);
          var newTien = parseFloat(data.soTien) || 0;
          sheetLog.appendRow([new Date(), data.nguoiSua, "Sửa ứng", tenNV, "Sửa phiếu " + data.maPhieu + " (Tiền: " + oldTien.toLocaleString('vi-VN') + "đ -> " + newTien.toLocaleString('vi-VN') + "đ)"]);
          return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
        }
      }
    }
    return ContentService.createTextOutput("Không tìm thấy phiếu ứng này!").setMimeType(ContentService.MimeType.TEXT);
  }

  // 7. LẤY TOÀN BỘ DỮ LIỆU ĐỂ APP TỰ TÍNH TOÁN BÁO CÁO (Siêu tốc độ)
  if (data.type === "getHRReportData") {
    var ccSheet = ss.getSheetByName("tbl_ChamCong");
    var ulSheet = ss.getSheetByName("tbl_UngLuong");
    var giaSheet = ss.getSheetByName("tbl_LichSuGiaCong");

    var ccData = ccSheet ? ccSheet.getDataRange().getValues() : [];
    var ulData = ulSheet ? ulSheet.getDataRange().getValues() : [];
    var giaData = giaSheet ? giaSheet.getDataRange().getValues() : [];

    if (ccData.length > 0) ccData.shift();
    if (ulData.length > 0) ulData.shift();
    if (giaData.length > 0) giaData.shift();

    return ContentService.createTextOutput(JSON.stringify({
      chamCong: ccData,
      ungLuong: ulData,
      giaCong: giaData
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 8. THÊM NHÂN VIÊN MỚI
  if (data.type === "saveNhanVien") {
    var sheetNV = ss.getSheetByName("tbl_NhanVien");
    var sheetGia = ss.getSheetByName("tbl_LichSuGiaCong");
    var sheetLog = ss.getSheetByName("tbl_LogNhanSu");

    if (!sheetNV || !sheetGia) return ContentService.createTextOutput("Lỗi: Thiếu sheet tbl_NhanVien hoặc tbl_LichSuGiaCong").setMimeType(ContentService.MimeType.TEXT);

    // Kiểm tra chống trùng tên
    var values = sheetNV.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (values[i][0].toString().trim().toLowerCase() === data.tenNV.trim().toLowerCase()) {
        return ContentService.createTextOutput("Lỗi: Tên nhân viên này đã tồn tại!").setMimeType(ContentService.MimeType.TEXT);
      }
    }

    // 1. Lưu vào sheet Nhân Viên (Thêm cột Ngày vào ở Cột D)
    sheetNV.appendRow([data.tenNV.trim(), data.sdt.trim(), "Đang làm", data.ngayVao]);

    // 2. Tự động thiết lập Giá công khởi điểm vào Lịch sử giá công
    sheetGia.appendRow([data.tenNV.trim(), data.ngayVao, data.giaCong]);

    // 3. Ghi Log lịch sử
    var logMsg = "Thêm NV mới. Giá công khởi điểm: " + parseFloat(data.giaCong).toLocaleString('vi-VN');
    if (sheetLog) sheetLog.appendRow([new Date(), data.nguoiSua, "Thêm NV", data.tenNV.trim(), logMsg]);

    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // 9. LẤY DANH SÁCH NHÂN VIÊN (KÈM GIÁ CÔNG HIỆN TẠI)
  if (data.type === "getDSNhanVien") {
    var sheetNV = ss.getSheetByName("tbl_NhanVien");
    var sheetGia = ss.getSheetByName("tbl_LichSuGiaCong");

    var dataNV = sheetNV ? sheetNV.getDataRange().getValues() : [];
    var dataGia = sheetGia ? sheetGia.getDataRange().getValues() : [];

    if (dataNV.length > 0) dataNV.shift();
    if (dataGia.length > 0) dataGia.shift();

    var result = [];
    var today = new Date();

    dataNV.forEach(function (nv) {
      if (nv[0] === "") return;
      var ten = nv[0].toString().trim();
      var sdt = nv[1] ? nv[1].toString() : "";
      var trangThai = nv[2] ? nv[2].toString() : "Đang làm";
      var ngayVao = nv[3] ? nv[3] : "";

      // Thuật toán: Dò tìm giá công hiện tại (mới nhất tính đến hôm nay)
      var giaHienTai = 0;
      var giaLichSu = dataGia.filter(function (g) { return g[0].toString().trim() === ten; });
      if (giaLichSu.length > 0) {
        giaLichSu.sort(function (a, b) { return new Date(b[1]) - new Date(a[1]); }); // Xếp mới nhất lên đầu
        for (var k = 0; k < giaLichSu.length; k++) {
          if (new Date(giaLichSu[k][1]) <= today) {
            giaHienTai = parseFloat(giaLichSu[k][2]) || 0;
            break;
          }
        }
        // Nếu không tìm thấy (do lỗi ngày), lấy đỡ cái giá mới nhất trong mảng
        if (giaHienTai === 0) giaHienTai = parseFloat(giaLichSu[0][2]) || 0;
      }

      result.push({ ten: ten, sdt: sdt, trangThai: trangThai, ngayVao: ngayVao, giaHienTai: giaHienTai });
    });

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }

  // 10. CHO NGHỈ VIỆC HOẶC ĐI LÀM LẠI
  if (data.type === "updateNhanVienStatus") {
    var sheetNV = ss.getSheetByName("tbl_NhanVien");
    var sheetLog = ss.getSheetByName("tbl_LogNhanSu");
    var values = sheetNV.getDataRange().getValues();

    for (var i = 1; i < values.length; i++) {
      if (values[i][0].toString().trim() === data.tenNV) {
        sheetNV.getRange(i + 1, 3).setValue(data.status);
        if (sheetLog) sheetLog.appendRow([new Date(), data.nguoiSua, "Đổi trạng thái", data.tenNV, "Chuyển thành: " + data.status]);
        return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
      }
    }
    return ContentService.createTextOutput("Lỗi: Không tìm thấy nhân viên!").setMimeType(ContentService.MimeType.TEXT);
  }

  // 11. SỬA SỐ ĐIỆN THOẠI NHÂN VIÊN
  if (data.type === "updateSdtNhanVien") {
    var sheetNV = ss.getSheetByName("tbl_NhanVien");
    var values = sheetNV.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (values[i][0].toString().trim() === data.tenNV) {
        sheetNV.getRange(i + 1, 2).setValue(data.sdtMoi);
        return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
      }
    }
    return ContentService.createTextOutput("Lỗi không tìm thấy!").setMimeType(ContentService.MimeType.TEXT);
  }

  // 12. LẤY LỊCH SỬ LƯƠNG
  if (data.type === "getLichSuLuongNV") {
    var sheetGia = ss.getSheetByName("tbl_LichSuGiaCong");
    var dataGia = sheetGia ? sheetGia.getDataRange().getValues() : [];
    if (dataGia.length > 0) dataGia.shift();

    var ls = dataGia.filter(function (g) { return g[0].toString().trim() === data.tenNV; });
    ls.sort(function (a, b) { return new Date(b[1]) - new Date(a[1]); }); // Mới nhất lên đầu

    var result = ls.map(function (g) {
      return { ngay: g[1], gia: parseFloat(g[2]) || 0 };
    });
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }

  // 26. LẤY DỮ LIỆU DÒNG TIỀN (THU VÀO) TỪ NHẬT KÝ NỢ
  // Data mới: 06_DATA_TAI_CHINH_CONG_NO / tbl_NhatKyNo
  if (data.type === "getCashFlowData") {
    try {
      var sheetNK = getSheet_("TAI_CHINH", "tbl_NhatKyNo");
      var values = sheetNK.getDataRange().getValues();
      var result = [];

      function cfDateIso_(v) {
        if (v instanceof Date) return Utilities.formatDate(v, "GMT+7", "yyyy-MM-dd'T'HH:mm:ss");
        var s = String(v || "").trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
        var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
        if (m) return m[3] + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[1]).padStart(2, "0") + "T" + (m[4] || "00:00:00");
        var d = new Date(s);
        if (!isNaN(d.getTime())) return Utilities.formatDate(d, "GMT+7", "yyyy-MM-dd'T'HH:mm:ss");
        return s;
      }

      for (var i = values.length - 1; i >= 1; i--) {
        var maDT = normalizeText_(values[i][0]);
        var tenKH = normalizeText_(values[i][1]);
        var ngayGoc = values[i][2];
        var loaiGD = normalizeText_(values[i][3]).toLowerCase();
        var soTien = parseFloat(values[i][4]) || 0;

        var isThuTien = loaiGD.indexOf("chuyển khoản") > -1 ||
                        loaiGD.indexOf("chuyen khoan") > -1 ||
                        loaiGD.indexOf("tiền mặt") > -1 ||
                        loaiGD.indexOf("tien mat") > -1 ||
                        loaiGD.indexOf("khách trả tiền") > -1 ||
                        loaiGD.indexOf("khach tra tien") > -1;

        if (!isThuTien) continue;

        var hinhThuc = "Khác";
        if (loaiGD.indexOf("chuyển khoản") > -1 || loaiGD.indexOf("chuyen khoan") > -1) hinhThuc = "Chuyển khoản";
        else if (loaiGD.indexOf("tiền mặt") > -1 || loaiGD.indexOf("tien mat") > -1) hinhThuc = "Tiền mặt";
        else hinhThuc = "Chuyển khoản";

        result.push({
          ngay: cfDateIso_(ngayGoc),
          maDoiTuong: maDT,
          ten: tenKH,
          hinhThuc: hinhThuc,
          tien: Math.abs(soTien)
        });
      }

      return outJson_(result);
    } catch (e) {
      return outJson_([]);
    }
  }

    // API: SỬA THÔNG TIN MÂM RẬP
  // Giữ type "suaSoLopRap" để tương thích code cũ/phân quyền cũ.
  // Cho phép sửa: Tên nhà may, Mã rập, Tên sản phẩm, Số lớp.
  // Số lớp vẫn tự tính lại Tổng kế hoạch / Còn thiếu như chức năng cũ.
  if (data.type === "suaSoLopRap") {
    try {
      var sheet = rapEnsureRapDonHangSheet_();
      var id = normalizeText_(data.id);
      var newSoLopStr = normalizeText_(data.newSoLopStr);
      var nguoiSua = normalizeText_(data.nguoiSua || data.user || "Không rõ");

      if (!id) return outText_("Lỗi: Thiếu ID mâm rập");
      if (!newSoLopStr) return outText_("Lỗi: Thiếu số lớp");

      var rowIndex = rapFindRowIndexByMaMam_(sheet, id);
      if (rowIndex < 2) return outText_("Lỗi: Không tìm thấy mâm rập cần sửa");

      var lastCol = Math.max(sheet.getLastColumn(), RAP_DON_HEADERS.length);
      var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
      var don = rapMapDonHangRow_(row);

      // Tương thích caller cũ: nếu không gửi 3 trường mới thì giữ nguyên dữ liệu hiện tại.
      var hasNewNhaMay = Object.prototype.hasOwnProperty.call(data, "newNhaMay");
      var hasNewMaRap = Object.prototype.hasOwnProperty.call(data, "newMaRap");
      var hasNewTenSP = Object.prototype.hasOwnProperty.call(data, "newTenSP");

      var inputNhaMay = normalizeText_(data.newNhaMay);
      var inputMaRap = normalizeText_(data.newMaRap).toUpperCase();
      var inputTenSP = normalizeText_(data.newTenSP);

      if (hasNewNhaMay && !inputNhaMay) return outText_("Lỗi: Tên nhà may không được để trống");
      if (hasNewMaRap && !inputMaRap) return outText_("Lỗi: Rập không được để trống");
      if (hasNewTenSP && !inputTenSP) return outText_("Lỗi: Tên sản phẩm không được để trống");

      var newNhaMay = hasNewNhaMay ? inputNhaMay : normalizeText_(don.nhaMay);
      var newMaRap = hasNewMaRap ? inputMaRap : normalizeText_(don.maRap);
      var newTenSP = hasNewTenSP ? inputTenSP : normalizeText_(don.tenSp);

      // V62: Nhà may và Rập phải lấy từ danh mục có sẵn để sau khi sửa
      // đơn luôn rơi đúng vào tab Nhà may / đúng mã rập đang quản lý.
      if (hasNewNhaMay || hasNewMaRap) {
        var ssRapSuaTT = getSS_("RAP");

        if (hasNewNhaMay) {
          var dsNhaMaySuaTT = rapDocCotDanhMuc_(ssRapSuaTT, "tbl_NhaMay", 2);
          var keyNhaMaySuaTT = rapDMKey_(inputNhaMay);
          var canonicalNhaMaySuaTT = "";
          for (var nmST = 0; nmST < dsNhaMaySuaTT.length; nmST++) {
            if (rapDMKey_(dsNhaMaySuaTT[nmST]) === keyNhaMaySuaTT) {
              canonicalNhaMaySuaTT = normalizeText_(dsNhaMaySuaTT[nmST]);
              break;
            }
          }
          if (!canonicalNhaMaySuaTT) {
            return outText_("Lỗi: Nhà may không có trong danh mục. Vui lòng chọn nhà may có sẵn");
          }
          newNhaMay = canonicalNhaMaySuaTT;
        }

        if (hasNewMaRap) {
          var dsMaRapSuaTT = rapDMGetMaRapInfo_(ssRapSuaTT);
          var keyMaRapSuaTT = rapDMKey_(inputMaRap);
          var canonicalMaRapSuaTT = "";
          for (var mrST = 0; mrST < dsMaRapSuaTT.length; mrST++) {
            if (rapDMKey_(dsMaRapSuaTT[mrST].maRap) === keyMaRapSuaTT) {
              canonicalMaRapSuaTT = normalizeText_(dsMaRapSuaTT[mrST].maRap).toUpperCase();
              break;
            }
          }
          if (!canonicalMaRapSuaTT) {
            return outText_("Lỗi: Mã rập không có trong danh mục. Vui lòng chọn mã rập có sẵn");
          }
          newMaRap = canonicalMaRapSuaTT;
        }
      }

      var oldSoLopStr = normalizeText_(don.soLop);
      var newTong = rapTinhTongSoLuong_(newSoLopStr);
      var daGiao = rapGetNum_(don.soLuongGiao);
      var donGia = rapGetNum_(don.donGia);

      if (newTong <= 0) {
        return outText_("Lỗi: Không tính được tổng số lượng từ số lớp mới");
      }

      if (daGiao > newTong) {
        return outText_("Lỗi: Số lượng đã giao (" + daGiao + ") đang lớn hơn tổng mới (" + newTong + ")");
      }

      var conThieuMoi = Math.max(newTong - daGiao, 0);
      var thanhTienMoi = daGiao * donGia;
      var nowText = nowVN_();

      // 1) Cập nhật dữ liệu chính trên tbl_Rap_DonHang.
      sheet.getRange(rowIndex, RAP_DON_COL.NHA_MAY + 1, 1, 3).setValues([[
        newNhaMay,
        newMaRap,
        newTenSP
      ]]);
      sheet.getRange(rowIndex, RAP_DON_COL.SO_LOP + 1).setValue(newSoLopStr);
      sheet.getRange(rowIndex, RAP_DON_COL.TONG_KE_HOACH + 1).setValue(newTong);
      sheet.getRange(rowIndex, RAP_DON_COL.TONG_CON_THIEU + 1).setValue(conThieuMoi);
      sheet.getRange(rowIndex, RAP_DON_COL.THANH_TIEN_NHA_MAY + 1).setValue(thanhTienMoi);

      // Chỉ ghi lớp cũ khi thực sự đổi số lớp; sửa Nhà may/Rập/Tên SP không làm mất lịch sử lớp trước đó.
      if (oldSoLopStr !== newSoLopStr) {
        sheet.getRange(rowIndex, RAP_DON_COL.SO_LOP_CU + 1).setValue(oldSoLopStr);
      }
      sheet.getRange(rowIndex, RAP_DON_COL.NGUOI_SUA_LOP + 1).setValue(nguoiSua);
      sheet.getRange(rowIndex, RAP_DON_COL.TG_SUA_LOP + 1).setValue(nowText);
      sheet.getRange(rowIndex, RAP_DON_COL.CAP_NHAT_CUOI + 1).setValue(nowText);

      // 2) Đồng bộ các trường cấp phiếu để tránh card đã sửa nhưng phiếu Hàng nhà vẫn giữ Nhà may/Rập cũ.
      // Không sửa chi tiết màu/size/tên SP con vì đó là dữ liệu kế hoạch riêng từng dòng.
      var maPhieu = normalizeText_(don.maPhieuNhapRap);
      if (maPhieu) {
        try {
          var shPN = getSheet_("RAP", "tbl_Rap_PhieuNhap");
          if (shPN && shPN.getLastRow() >= 2) {
            var pnVals = shPN.getRange(2, 1, shPN.getLastRow() - 1, Math.max(shPN.getLastColumn(), RAP_HN_PHIEU_HEADERS.length)).getValues();
            for (var pni = 0; pni < pnVals.length; pni++) {
              if (normalizeText_(pnVals[pni][0]) !== maPhieu) continue;
              shPN.getRange(pni + 2, 5).setValue(newNhaMay); // E NhaMay
              shPN.getRange(pni + 2, 7).setValue(newMaRap);  // G MaRap
              if (shPN.getLastColumn() >= 16) shPN.getRange(pni + 2, 16).setValue(nowText); // P CapNhatCuoi
            }
          }
        } catch (syncPNError) {
          console.log("Sửa TT Rập - bỏ qua lỗi sync tbl_Rap_PhieuNhap: " + syncPNError.message);
        }
      }

      // 3) Đồng bộ MaRap trong kế hoạch size theo MaMam hoặc MaPhieuNhapRap.
      // Chỉ đổi MaRap; không ghi đè TenSP ở từng màu/size để tránh mất tên chi tiết sản phẩm.
      try {
        var shSize = getSheet_("RAP", "tbl_Rap_SizeKeHoach");
        if (shSize && shSize.getLastRow() >= 2) {
          var sizeVals = shSize.getRange(2, 1, shSize.getLastRow() - 1, Math.max(shSize.getLastColumn(), RAP_HN_SIZE_HEADERS.length)).getValues();
          for (var si = 0; si < sizeVals.length; si++) {
            var sameMam = normalizeText_(sizeVals[si][0]) === id;
            var samePhieu = maPhieu && normalizeText_(sizeVals[si][8]) === maPhieu;
            if (sameMam || samePhieu) {
              shSize.getRange(si + 2, 2).setValue(newMaRap); // B MaRap
            }
          }
        }
      } catch (syncSizeError) {
        console.log("Sửa TT Rập - bỏ qua lỗi sync tbl_Rap_SizeKeHoach: " + syncSizeError.message);
      }

      SpreadsheetApp.flush();
      return outText_("OK");

    } catch (err) {
      return outText_("Lỗi sửa thông tin Rập: " + err.message);
    }
  }
  // =================================================================
  // MODULE: QUẢN LÝ IN - NHÃN SIZE (Giống Dây Kéo)
  // =================================================================

  // 1. Lấy danh mục In Nhãn
  if (data.type === "getInNhanDanhMuc") {
    var sheetDM = ss.getSheetByName("tbl_InNhan_DanhMuc");
    if (!sheetDM) return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
    var values = sheetDM.getDataRange().getValues();
    values.shift();
    return ContentService.createTextOutput(JSON.stringify(values)).setMimeType(ContentService.MimeType.JSON);
  }

  // 2. Thêm Loại Mới / Cập nhật giá mới
  if (data.type === "saveLoaiInNhan") {
    var sheetDM = ss.getSheetByName("tbl_InNhan_DanhMuc");
    sheetDM.appendRow([data.ten.trim(), data.gia, data.ngay]);
    SpreadsheetApp.flush();
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // 3. Nhập Hàng In Nhãn
  if (data.type === "saveNhapInNhan") {
    var sheetNhap = ss.getSheetByName("tbl_InNhan_Nhap");
    var maNhap = "IN" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");

    data.details.forEach(function (item) {
      // ĐÃ THÊM: item.chiTiet vào vị trí số 4
      sheetNhap.appendRow([maNhap, data.ngay, item.tenSP, item.chiTiet, item.soLuong, item.donGia, item.thanhTien, data.nguoiNhap]);
    });
    SpreadsheetApp.flush();
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // 4. Lấy dữ liệu Báo cáo & Công nợ 
  if (data.type === "getInNhanReportFull") {
    var sheetNhap = ss.getSheetByName("tbl_InNhan_Nhap");
    var sheetTT = ss.getSheetByName("tbl_InNhan_ThanhToan");

    var nhapData = sheetNhap ? sheetNhap.getDataRange().getValues() : [];
    var ttData = sheetTT ? sheetTT.getDataRange().getValues() : [];

    if (nhapData.length > 0) nhapData.shift();
    if (ttData.length > 0) ttData.shift();

    return ContentService.createTextOutput(JSON.stringify({
      nhap: nhapData,
      thanhToan: ttData
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 5. Lưu Khoản Thanh Toán
  if (data.type === "saveThanhToanInNhan") {
    var sheetTT = ss.getSheetByName("tbl_InNhan_ThanhToan");
    if (!sheetTT) return ContentService.createTextOutput("Lỗi: Chưa tạo sheet tbl_InNhan_ThanhToan").setMimeType(ContentService.MimeType.TEXT);

    var maTT = "TTIN" + new Date().getTime();
    sheetTT.appendRow([maTT, data.ngay, data.soTien, data.ghiChu, data.nguoiTra]);
    SpreadsheetApp.flush();
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }
  // =================================================================
  // MODULE: QUẢN LÝ DÂY KÉO (GIÁ ĐỘNG VÀ CÔNG NỢ)
  // =================================================================

  // 1. Lấy danh mục dây kéo
  if (data.type === "getDayKeoDanhMuc") {
    var sheetDM = ss.getSheetByName("tbl_DayKeo_DanhMuc");
    if (!sheetDM) return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
    var values = sheetDM.getDataRange().getValues();
    values.shift();
    return ContentService.createTextOutput(JSON.stringify(values)).setMimeType(ContentService.MimeType.JSON);
  }

  // 2. Thêm Loại Mới / Cập nhật giá mới
  if (data.type === "saveLoaiDayKeo") {
    var sheetDM = ss.getSheetByName("tbl_DayKeo_DanhMuc");
    // Lưu mới: Tên | Giá | Ngày áp dụng
    sheetDM.appendRow([data.ten.trim(), data.gia, data.ngay]);
    SpreadsheetApp.flush();
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // 3. Nhập Hàng Dây Kéo
  if (data.type === "saveNhapDayKeo") {
    var sheetNhap = ss.getSheetByName("tbl_DayKeo_Nhap");
    var maNhap = "DK" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");

    data.details.forEach(function (item) {
      // Mã nhập | Ngày Nhập | Tên SP | SL | Đơn Giá | Thành Tiền | Người Nhập
      sheetNhap.appendRow([maNhap, data.ngay, item.tenSP, item.soLuong, item.donGia, item.thanhTien, data.nguoiNhap]);
    });
    SpreadsheetApp.flush();
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // 4. Lấy dữ liệu Báo cáo & Công nợ (Gộp cả Nhập và Trả)
  if (data.type === "getDayKeoReportFull") {
    var sheetNhap = ss.getSheetByName("tbl_DayKeo_Nhap");
    var sheetTT = ss.getSheetByName("tbl_DayKeo_ThanhToan");

    var nhapData = sheetNhap ? sheetNhap.getDataRange().getValues() : [];
    var ttData = sheetTT ? sheetTT.getDataRange().getValues() : [];

    if (nhapData.length > 0) nhapData.shift();
    if (ttData.length > 0) ttData.shift();

    return ContentService.createTextOutput(JSON.stringify({
      nhap: nhapData,
      thanhToan: ttData
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 5. Lưu Khoản Thanh Toán
  if (data.type === "saveThanhToanDayKeo") {
    var sheetTT = ss.getSheetByName("tbl_DayKeo_ThanhToan");
    if (!sheetTT) return ContentService.createTextOutput("Lỗi: Chưa tạo sheet tbl_DayKeo_ThanhToan").setMimeType(ContentService.MimeType.TEXT);

    var maTT = "TTDK" + new Date().getTime();
    // Mã TT | Ngày trả | Số tiền | Lý do | Người thao tác
    sheetTT.appendRow([maTT, data.ngay, data.soTien, data.ghiChu, data.nguoiTra]);
    SpreadsheetApp.flush();
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // =================================================================
  // MODULE: QUẢN LÝ THÊU
  // =================================================================

  if (data.type === "saveNhapTheu") {
    var sheetNhap = ss.getSheetByName("tbl_Theu_Nhap");
    var maNhap = Utilities.formatDate(new Date(), "GMT+7", "HH:mm dd/MM/yyyy");
    sheetNhap.appendRow([maNhap, data.thang, data.tien, data.nguoiNhap]);
    SpreadsheetApp.flush();
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  if (data.type === "getBaoCaoTheuFull") {
    var sheetNhap = ss.getSheetByName("tbl_Theu_Nhap");
    var sheetTT = ss.getSheetByName("tbl_Theu_ThanhToan");

    var nhapData = sheetNhap ? sheetNhap.getDataRange().getValues() : [];
    var ttData = sheetTT ? sheetTT.getDataRange().getValues() : [];

    if (nhapData.length > 0) nhapData.shift();
    if (ttData.length > 0) ttData.shift();

    return ContentService.createTextOutput(JSON.stringify({ nhap: nhapData, thanhToan: ttData })).setMimeType(ContentService.MimeType.JSON);
  }

  if (data.type === "saveThanhToanTheu") {
    var sheetTT = ss.getSheetByName("tbl_Theu_ThanhToan");
    var maTT = "TTTH" + new Date().getTime();
    sheetTT.appendRow([maTT, data.ngay, data.soTien, data.ghiChu, data.nguoiTra]);
    SpreadsheetApp.flush();
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }
    // --- MODULE QUẢN LÝ NHÀ MAY - THEO SCHEMA RAP MỚI A:AF ---
  // Không tạo sheet mới. Dùng đúng:
  // 04_DATA_SAN_XUAT_RAP / tbl_NhaMay_ChotDon
  // 04_DATA_SAN_XUAT_RAP / tbl_NhaMay_ThanhToan
  if (data.type === "getNhaMayGiaoDich") {
    try {
      var rowsNM = rapLayNhaMayGiaoDich_(data.tenNhaMay);
      return outJson_(rowsNM);
    } catch (err) {
      return outJson_({ ok: false, message: "Lỗi getNhaMayGiaoDich: " + err.message });
    }
  }

  if (data.type === "getChiTietBangKe") {
    try {
      var maBangKe = normalizeText_(data.maBangKe);
      var resultBK = rapLayChiTietBangKeNhaMay_(maBangKe);
      return outJson_(resultBK);
    } catch (err) {
      return outJson_({ ok: false, message: "Lỗi getChiTietBangKe: " + err.message });
    }
  }

  if (data.type === "saveThanhToanNhaMay") {
    try {
      var kqTTNM = rapLuuThanhToanNhaMay_(data);
      return outText_(kqTTNM);
    } catch (err) {
      return outText_("Lỗi saveThanhToanNhaMay: " + err.message);
    }
  }
  // =================================================================
  // MODULE: QUẢN LÝ THỢ CẮT - DATA MỚI
  // Dùng đúng sheet có sẵn trong 04_DATA_SAN_XUAT_RAP:
  // - tbl_DoiCat_BaoCao
  // - tbl_DoiCat_ThanhToan
  // Không tạo tbl_ThoCat_GiaoDich nữa.
  // =================================================================
  if (data.type === "getThoCatGiaoDich") {
    try {
      var rowsTC = rapLayThoCatGiaoDich_();
      return outJson_(rowsTC);
    } catch (err) {
      return outJson_({ ok: false, message: "Lỗi getThoCatGiaoDich: " + err.message });
    }
  }

  if (data.type === "saveThanhToanThoCat") {
    try {
      var kqTTTC = rapLuuThanhToanThoCat_(data, "Trừ Nợ");
      return outText_(kqTTTC);
    } catch (err) {
      return outText_("Lỗi saveThanhToanThoCat: " + err.message);
    }
  }

  if (data.type === "saveUngThoCat") {
    try {
      var kqUngTC = rapLuuThanhToanThoCat_(data, "Ứng");
      return outText_(kqUngTC);
    } catch (err) {
      return outText_("Lỗi saveUngThoCat: " + err.message);
    }
  }

  if (data.type === "getChiTietChotCat") {
    try {
      var resultTC = rapLayChiTietChotCat_(data.maChot);
      return outJson_(resultTC);
    } catch (err) {
      return outJson_({ ok: false, message: "Lỗi getChiTietChotCat: " + err.message });
    }
  }

  // =================================================================
  // MODULE: QUẢN LÝ VẢI
  // =================================================================

  // 1. Lấy danh sách Nhà Vải & Công nợ
  if (data.type === "getNhaVaiList") {
    var sheet = ss.getSheetByName("tbl_Vai_NhaCungCap");
    if (!sheet) return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
    var values = sheet.getDataRange().getValues();
    values.shift();
    var list = values.filter(function (r) { return r[0] !== ""; }).map(function (r) {
      return { ten: r[0], sdt: r[1], noHienTai: parseFloat(r[2]) || 0 };
    });
    return ContentService.createTextOutput(JSON.stringify(list)).setMimeType(ContentService.MimeType.JSON);
  }

  // 2. Thêm Nhà Vải mới
  if (data.type === "saveNhaVai") {
    var sheet = ss.getSheetByName("tbl_Vai_NhaCungCap");
    // Kiểm tra trùng
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (values[i][0].toString().trim().toLowerCase() === data.ten.trim().toLowerCase()) {
        return ContentService.createTextOutput("Tồn tại").setMimeType(ContentService.MimeType.TEXT);
      }
    }
    sheet.appendRow([data.ten.trim(), data.sdt, 0]);
    SpreadsheetApp.flush();
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // 3. Nhập Vải (Đã cập nhật tích hợp Thanh Toán ngay trong bill)
  if (data.type === "saveNhapVai") {
    var sheetNhap = ss.getSheetByName("tbl_Vai_Nhap");
    var sheetTT = ss.getSheetByName("tbl_Vai_ThanhToan");
    var sheetNCC = ss.getSheetByName("tbl_Vai_NhaCungCap");
    var maNhap = "VAI" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");
    var tongTienCongNo = 0; // Ghi nhận thay đổi nợ

    data.details.forEach(function (item) {
      if (item.loai === "Thanh Toán") {
        var maTT = "TTV" + new Date().getTime() + Math.floor(Math.random() * 1000);
        var tienTT = Math.abs(parseFloat(item.thanhTien));
        // Gắn thêm maNhap vào ghi chú để nối lại khi xem Popup chi tiết
        sheetTT.appendRow([maTT, item.ngay, data.nhaVai, tienTT, maNhap + " - " + item.tenVai, data.nguoiNhap]);
        tongTienCongNo -= tienTT;
      } else {
        // Lưu vào bảng Nhập/Trả
        sheetNhap.appendRow([maNhap, item.ngay, data.nhaVai, item.loai, item.tenVai, item.soCay, item.kgMet, item.khauHao, item.conLai, item.gia, item.thanhTien, data.nguoiNhap]);
        tongTienCongNo += parseFloat(item.thanhTien); // Nhập tăng nợ, Trả (gửi lên số âm) tự giảm nợ
      }
    });

    // Cập nhật nợ tổng
    var nccData = sheetNCC.getDataRange().getValues();
    for (var i = 1; i < nccData.length; i++) {
      if (nccData[i][0].toString().trim() === data.nhaVai.trim()) {
        var noCu = parseFloat(nccData[i][2]) || 0;
        sheetNCC.getRange(i + 1, 3).setValue(noCu + tongTienCongNo);
        break;
      }
    }
    SpreadsheetApp.flush();
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // 4. Thanh toán tiền Vải
  if (data.type === "saveThanhToanVai") {
    var sheetTT = ss.getSheetByName("tbl_Vai_ThanhToan");
    var sheetNCC = ss.getSheetByName("tbl_Vai_NhaCungCap");
    var maTT = "TTV" + new Date().getTime();

    sheetTT.appendRow([maTT, data.ngay, data.nhaVai, data.soTien, data.ghiChu, data.nguoiTra]);

    // Trừ nợ
    var nccData = sheetNCC.getDataRange().getValues();
    for (var i = 1; i < nccData.length; i++) {
      if (nccData[i][0].toString().trim() === data.nhaVai.trim()) {
        var noCu = parseFloat(nccData[i][2]) || 0;
        sheetNCC.getRange(i + 1, 3).setValue(noCu - parseFloat(data.soTien));
        break;
      }
    }
    SpreadsheetApp.flush();
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // 5. Lấy Giao dịch & Công nợ Vải (Chi tiết)
  if (data.type === "getVaiGiaoDich") {
    var sheetNhap = ss.getSheetByName("tbl_Vai_Nhap");
    var sheetTT = ss.getSheetByName("tbl_Vai_ThanhToan");
    var sheetNCC = ss.getSheetByName("tbl_Vai_NhaCungCap");

    var nhapData = sheetNhap ? sheetNhap.getDataRange().getValues() : [];
    var ttData = sheetTT ? sheetTT.getDataRange().getValues() : [];
    if (nhapData.length > 0) nhapData.shift();
    if (ttData.length > 0) ttData.shift();

    var noHienTai = 0;
    if (sheetNCC) {
      var nccData = sheetNCC.getDataRange().getValues();
      var rowNCC = nccData.find(function (r) { return r[0].toString().trim() === data.nhaVai.trim(); });
      if (rowNCC) noHienTai = parseFloat(rowNCC[2]) || 0;
    }

    // Gom nhóm Nhập theo Mã
    var nhapGroup = {};
    nhapData.filter(function (r) { return r[2].toString().trim() === data.nhaVai.trim(); }).forEach(function (r) {
      if (!nhapGroup[r[0]]) nhapGroup[r[0]] = { maNhap: r[0], ngay: r[1], nhaVai: r[2], tongTien: 0, items: [] };
      nhapGroup[r[0]].tongTien += parseFloat(r[10]);
      nhapGroup[r[0]].items.push({
        loai: r[3], tenVai: r[4], soCay: r[5], kgMet: r[6], khauHao: r[7], conLai: r[8], gia: r[9], thanhTien: r[10]
      });
    });

    var thanhToanList = ttData.filter(function (r) { return r[2].toString().trim() === data.nhaVai.trim(); }).map(function (r) {
      var ghiChu = r[4] ? r[4].toString() : "";

      // Bắt mã VAI... để nhét ngược lại dòng Thanh Toán vào bảng Popup Chi tiết
      var maNhapMatch = ghiChu.match(/VAI\d+/);
      if (maNhapMatch && nhapGroup[maNhapMatch[0]]) {
        nhapGroup[maNhapMatch[0]].items.push({
          loai: "Thanh Toán",
          tenVai: ghiChu.replace(maNhapMatch[0] + " - ", ""),
          soCay: "", kgMet: "", khauHao: "", conLai: "", gia: "",
          thanhTien: -parseFloat(r[3]) // Tiền âm để hiển thị trừ
        });
        nhapGroup[maNhapMatch[0]].tongTien -= parseFloat(r[3]); // Trừ vào tổng mã nhập
      }

      return { maTT: r[0], ngay: r[1], nhaVai: r[2], soTien: r[3], ghiChu: ghiChu, nguoiTra: r[5] };
    });

    return ContentService.createTextOutput(JSON.stringify({
      noHienTai: noHienTai,
      nhap: Object.values(nhapGroup),
      thanhToan: thanhToanList
    })).setMimeType(ContentService.MimeType.JSON);
  }
  // =========================================================
  // API: LẤY DỮ LIỆU BIỂU ĐỒ CẮT - NHẬN - BÁN
  // DATA MỚI:
  // RAP / tbl_Rap_DonHang
  // RAP / LichSuNhap nếu có
  // SALES / tbl_DonHang
  // SALES / tbl_ChiTietDonHang
  // =========================================================
  if (data.type === "getReportCatBan") {
    try {
      var sheetRap = getSheet_("RAP", "tbl_Rap_DonHang");
      var sheetDonHang = getSheet_("SALES", "tbl_DonHang");
      var sheetChiTiet = getSheet_("SALES", "tbl_ChiTietDonHang");

      var ssRap = getSS_("RAP");
      var sheetLS = ssRap.getSheetByName("LichSuNhap");

      var tuNgay = parseCatBanDate_(data.tuNgay);
      var denNgay = parseCatBanDate_(data.denNgay);

      if (!tuNgay || !denNgay) {
        return outJson_({ status: "ERROR", message: "Thiếu từ ngày / đến ngày" });
      }

      tuNgay.setHours(0, 0, 0, 0);
      denNgay.setHours(23, 59, 59, 999);

      var result = {};

      function parseCatBanDate_(v) {
        if (!v) return null;
        if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
        var s = String(v || "").trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
          var p1 = s.substring(0, 10).split("-");
          return new Date(Number(p1[0]), Number(p1[1]) - 1, Number(p1[2]));
        }
        var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        var d = new Date(s);
        if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        return null;
      }

      function ensureCatBanDay_(d) {
        var dateKey = Utilities.formatDate(d, "GMT+7", "yyyy-MM-dd");
        if (!result[dateKey]) {
          result[dateKey] = {
            display: Utilities.formatDate(d, "GMT+7", "dd/MM"),
            sort: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
            cut: 0,
            received: 0,
            sold: 0
          };
        }
        return result[dateKey];
      }

      function inRange_(d) {
        return d && d >= tuNgay && d <= denNgay;
      }

      // 1. Hàng cắt từ RAP / tbl_Rap_DonHang
      // Schema mới: D = NgayCat, K = TongKeHoach
      if (sheetRap && sheetRap.getLastRow() >= 2) {
        var rapData = sheetRap.getDataRange().getValues();
        for (var r = 1; r < rapData.length; r++) {
          var ngayCat = parseCatBanDate_(rapData[r][3]);
          if (!inRange_(ngayCat)) continue;
          var tongKeHoach = parseFloat(rapData[r][10]) || 0;
          if (tongKeHoach <= 0) continue;
          ensureCatBanDay_(ngayCat).cut += tongKeHoach;
        }
      }

      // 2. Hàng nhận từ RAP / LichSuNhap nếu sheet này còn dùng
      // LichSuNhap: A = ThoiGianNhap, C = SoLuongNhap
      if (sheetLS && sheetLS.getLastRow() >= 2) {
        var lsData = sheetLS.getDataRange().getValues();
        for (var l = 1; l < lsData.length; l++) {
          var ngayNhap = parseCatBanDate_(lsData[l][0]);
          if (!inRange_(ngayNhap)) continue;
          var soLuongNhap = parseFloat(lsData[l][2]) || 0;
          // Số âm là phiếu điều chỉnh giảm, vẫn phải được tính vào báo cáo nhận hàng.
          if (soLuongNhap === 0) continue;
          ensureCatBanDay_(ngayNhap).received += soLuongNhap;
        }
      }

      // 3. Hàng bán từ SALES / tbl_DonHang + tbl_ChiTietDonHang
      // tbl_DonHang: A MaHoaDon, B NgayTao, N TrangThaiHoaDon
      // tbl_ChiTietDonHang: B MaHoaDon, D SoLuong
      if (sheetDonHang && sheetChiTiet && sheetDonHang.getLastRow() >= 2 && sheetChiTiet.getLastRow() >= 2) {
        var dhData = sheetDonHang.getDataRange().getValues();
        var orderDateMap = {};
        for (var d = 1; d < dhData.length; d++) {
          var maHD = String(dhData[d][0] || "").trim();
          if (!maHD) continue;
          var trangThaiHoaDon = String(dhData[d][13] || "").trim();
          if (trangThaiHoaDon === "Đã xóa đơn") continue;
          var ngayDon = parseCatBanDate_(dhData[d][1]);
          if (!ngayDon) continue;
          orderDateMap[maHD] = ngayDon;
        }

        var ctData = sheetChiTiet.getDataRange().getValues();
        for (var c = 1; c < ctData.length; c++) {
          var maHDCT = String(ctData[c][1] || "").trim();
          var ngayBan = orderDateMap[maHDCT];
          if (!inRange_(ngayBan)) continue;
          var soLuongBan = parseFloat(ctData[c][3]) || 0;
          if (soLuongBan <= 0) continue;
          ensureCatBanDay_(ngayBan).sold += soLuongBan;
        }
      }

      var arr = Object.keys(result).map(function(key) { return result[key]; });
      arr.sort(function(a, b) { return a.sort - b.sort; });

      return outJson_({ status: "OK", data: arr });
    } catch (err) {
      return outJson_({ status: "ERROR", message: "Lỗi getReportCatBan: " + err.message });
    }
  }

  // API NHẬT - IN / TÙNG - IN được xử lý tập trung ở đầu doPostMain_
  // qua dmHandleNhanSuPhuLieuDataMoi_. Không giữ nhánh API trùng schema.

} // <-- Đóng hàm doPost
// =================================================================
// MODULE THỢ CẮT - SCHEMA MỚI A:AF
// Chốt TT theo tháng, ghi mã chốt vào cột Z MaChotThoCat
// Ghi chi tiết từng mâm vào 04_DATA_SAN_XUAT_RAP / tbl_DoiCat_BaoCao
// Thanh toán/Ứng tiền ghi vào 04_DATA_SAN_XUAT_RAP / tbl_DoiCat_ThanhToan
// =================================================================
function rapYearMonthTC_(giaTri) {
  if (!giaTri) return "";

  if (giaTri instanceof Date) {
    return Utilities.formatDate(giaTri, "GMT+7", "yyyy-MM");
  }

  var s = String(giaTri || "").trim();
  if (!s) return "";

  if (/^\d{4}-\d{2}/.test(s)) return s.substring(0, 7);

  // dd/MM/yyyy hoặc dd/MM/yyyy HH:mm:ss
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return m[3] + "-" + String(m[2]).padStart(2, "0");
  }

  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, "GMT+7", "yyyy-MM");
  }

  return "";
}

function rapDateAnyToIsoTC_(v) {
  if (!v) return "";
  if (v instanceof Date) {
    return Utilities.formatDate(v, "GMT+7", "yyyy-MM-dd'T'HH:mm:ss");
  }

  var s = String(v || "").trim();
  if (!s) return "";

  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + "T00:00:00";

  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    var dd = String(m[1]).padStart(2, "0");
    var mm = String(m[2]).padStart(2, "0");
    var yy = m[3];
    var hh = String(m[4] || "0").padStart(2, "0");
    var mi = String(m[5] || "0").padStart(2, "0");
    var ss = String(m[6] || "0").padStart(2, "0");
    return yy + "-" + mm + "-" + dd + "T" + hh + ":" + mi + ":" + ss;
  }

  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, "GMT+7", "yyyy-MM-dd'T'HH:mm:ss");
  }

  return s;
}

function rapFormatNgayTC_(v) {
  if (!v) return "";
  if (v instanceof Date) return Utilities.formatDate(v, "GMT+7", "dd/MM/yyyy");
  return String(v || "").trim();
}

function rapGetThangFromMaChotCat_(maChot) {
  maChot = normalizeText_(maChot);
  // CAT-202606-110626-143000 -> 2026-06
  var m = maChot.match(/CAT-(\d{4})(\d{2})-/);
  if (m) return m[1] + "-" + m[2];
  return "";
}

function rapLayThoCatGiaoDich_() {
  var sheetBC = getSheet_("RAP", "tbl_DoiCat_BaoCao");
  var sheetTT = getSheet_("RAP", "tbl_DoiCat_ThanhToan");

  var result = [];
  var groups = {};

  if (sheetBC.getLastRow() >= 2) {
    var bc = sheetBC.getDataRange().getValues();

    for (var i = 1; i < bc.length; i++) {
      var r = bc[i];
      var maChot = normalizeText_(r[0]); // A: MaBaoCaoCat
      if (!maChot) continue;

      var thang = rapGetThangFromMaChotCat_(maChot) || rapYearMonthTC_(r[1]);
      if (!thang) continue;

      if (!groups[maChot]) {
        groups[maChot] = {
          maChot: maChot,
          ngay: r[1],
          thang: thang,
          tongTien: 0,
          tongSL: 0,
          soMam: 0,
          nguoi: "Hệ thống",
          ghiChu: normalizeText_(r[11]) || ("Chốt tiền thợ cắt tháng " + thang)
        };
      }

      groups[maChot].tongTien += rapGetNum_(r[9]); // J: ThanhTien
      groups[maChot].tongSL += rapGetNum_(r[7]);   // H: TongSoLuong
      groups[maChot].soMam++;
    }
  }

  Object.keys(groups).forEach(function(k) {
    var g = groups[k];
    result.push([
      g.maChot,                     // 0 MaGiaoDich
      rapDateAnyToIsoTC_(g.ngay),   // 1 ThoiGian
      "Chốt",                       // 2 LoaiGiaoDich
      g.tongTien,                   // 3 SoTien
      g.ghiChu,                     // 4 GhiChu
      g.nguoi,                      // 5 NguoiThaoTac
      g.thang,                      // 6 ThangChot
      g.soMam,                      // 7 SoMam
      g.tongSL                      // 8 TongSoLuong
    ]);
  });

  if (sheetTT.getLastRow() >= 2) {
    var tt = sheetTT.getDataRange().getValues();

    for (var t = 1; t < tt.length; t++) {
      var p = tt[t];
      var maTT = normalizeText_(p[0]); // A
      if (!maTT) continue;

      var rawThangCell = p[3];                   // D: MaBaoCaoCat / Tháng chốt
      var maBaoCaoOrThang = normalizeText_(rawThangCell);
      var hinhThuc = normalizeText_(p[5]);        // F
      var ghiChu = normalizeText_(p[7]);          // H

      // FIX: Google Sheets có thể tự đổi "2026-07" thành Date.
      // Ưu tiên lấy tháng từ chính cột D trước, chỉ fallback về ngày giao dịch khi D không có tháng hợp lệ.
      var thangTT = /^\d{4}-\d{2}$/.test(maBaoCaoOrThang)
        ? maBaoCaoOrThang
        : (rapGetThangFromMaChotCat_(maBaoCaoOrThang)
          || rapYearMonthTC_(rawThangCell)
          || rapYearMonthTC_(p[1]));

      var loai = hinhThuc === "Ứng" ? "Ứng" : "Trừ Nợ";

      result.push([
        maTT,                         // 0
        rapDateAnyToIsoTC_(p[1]),     // 1
        loai,                         // 2
        rapGetNum_(p[4]),             // 3 SoTien
        ghiChu || hinhThuc,           // 4 GhiChu
        normalizeText_(p[6]),         // 5 NguoiTra
        thangTT,                      // 6 ThangChot
        "",                           // 7
        ""                            // 8
      ]);
    }
  }

  result.sort(function(a, b) {
    return new Date(b[1]).getTime() - new Date(a[1]).getTime();
  });

  return result;
}

function rapLuuThanhToanThoCat_(data, loai) {
  var sheetTT = getSheet_("RAP", "tbl_DoiCat_ThanhToan");

  var thangChot = rapYearMonthTC_(data.thangChot);
  var ngay = normalizeText_(data.ngay) || dateVN_();
  var soTien = rapGetNum_(data.soTien);
  var nguoi = normalizeText_(data.nguoiThaoTac || data.user || data.actorUser) || "Không rõ";
  var lyDo = normalizeText_(data.lyDo || data.ghiChu) || (loai === "Ứng" ? "Ứng tiền công thợ cắt" : "Thanh toán tiền công thợ cắt");

  if (!/^\d{4}-\d{2}$/.test(thangChot)) throw new Error("Tháng thanh toán/ứng không hợp lệ");
  if (soTien <= 0) throw new Error("Số tiền không hợp lệ");

  var prefix = loai === "Ứng" ? "UNGTC" : "TTTC";
  var maTT = prefix + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");
  var nextRow = sheetTT.getLastRow() + 1;

  // FIX: ép cột D là Plain text trước khi ghi để "2026-07" không bị Sheets đổi thành ngày.
  sheetTT.getRange(nextRow, 4).setNumberFormat("@");
  sheetTT.getRange(nextRow, 1, 1, 8).setValues([[
    maTT,                    // MaThanhToan
    ngay,                    // NgayThanhToan
    "Tổng hợp thợ cắt",      // TenDoiCat
    thangChot,               // MaBaoCaoCat: dùng tháng để frontend gom đúng tháng
    soTien,                  // SoTien
    loai === "Ứng" ? "Ứng" : "Tiền mặt", // HinhThuc
    nguoi,                   // NguoiTra
    lyDo                     // GhiChu
  ]]);

  SpreadsheetApp.flush();
  return "OK";
}

function rapLayChiTietChotCat_(maChot) {
  maChot = normalizeText_(maChot);
  if (!maChot) return [];

  var sheetBC = getSheet_("RAP", "tbl_DoiCat_BaoCao");
  if (sheetBC.getLastRow() < 2) return [];

  var data = sheetBC.getDataRange().getValues();
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (normalizeText_(r[0]) !== maChot) continue; // A: MaBaoCaoCat

    result.push({
      ngayCat: rapFormatNgayTC_(r[1]),       // B: NgayBaoCao/chốt
      maRap: normalizeText_(r[4]),           // E: MaRap
      mau: normalizeText_(r[5]),             // F: Mau
      soLop: normalizeText_(r[6]),           // G: SoLop
      tongSoLuong: rapGetNum_(r[7]),         // H
      donGia: rapGetNum_(r[8]),              // I
      thanhTien: rapGetNum_(r[9]),           // J
      thoCat: normalizeText_(r[2]),          // C
      tenSp: normalizeText_(r[11])           // L GhiChu có tên SP nếu có
    });
  }

  return result;
}

function chotThanhToanThoCatThang(thangChon, nguoiChot) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    thangChon = normalizeText_(thangChon);
    nguoiChot = normalizeText_(nguoiChot) || "Không rõ";

    if (!thangChon) throw new Error("Chưa chọn tháng cần chốt");

    var sheetRap = rapEnsureRapDonHangSheet_();
    var sheetBC = getSheet_("RAP", "tbl_DoiCat_BaoCao");

    if (sheetRap.getLastRow() < 2) {
      throw new Error("Chưa có dữ liệu rập");
    }

    var values = sheetRap.getRange(2, 1, sheetRap.getLastRow() - 1, Math.max(sheetRap.getLastColumn(), RAP_DON_HEADERS.length)).getValues();
    var now = new Date();
    var today = dateVN_();
    var maChot = "CAT-" + thangChon.replace("-", "") + "-" + Utilities.formatDate(now, "GMT+7", "ddMMyy-HHmmss");

    var tongSoMam = 0;
    var tongSoLuong = 0;
    var tongTien = 0;
    var donGiaCat = 0.9;

    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var don = rapMapDonHangRow_(row);

      var ngayCatYM = rapYearMonthTC_(don.ngayCat || don.ngayTao);
      var thoCat = normalizeText_(don.thoCat);
      var maChotCu = normalizeText_(don.maChotCat);
      var sl = rapGetNum_(don.tongSoLuong || don.tongKeHoach);

      var duDieuKien =
        ngayCatYM === thangChon &&
        thoCat &&
        sl > 0 &&
        !maChotCu;

      if (!duDieuKien) continue;

      var thanhTien = Math.round(sl * donGiaCat);
      var rowIndex = i + 2;

      sheetRap.getRange(rowIndex, RAP_DON_COL.MA_CHOT_THO_CAT + 1).setValue(maChot); // Z
      sheetRap.getRange(rowIndex, RAP_DON_COL.CAP_NHAT_CUOI + 1).setValue(nowVN_()); // AF

      sheetBC.appendRow([
        maChot,                         // MaBaoCaoCat
        today,                          // NgayBaoCao
        thoCat,                         // TenDoiCat
        don.maMam || don.thoiGianTao,    // MaMam
        don.maRap,                      // MaRap
        don.mau || don.size,             // Mau
        don.soLop,                      // SoLop
        sl,                             // TongSoLuong
        donGiaCat,                      // DonGia
        thanhTien,                      // ThanhTien
        "Đã báo cáo",                   // TrangThai
        (don.tenSp || "") + " | Chốt tháng " + thangChon + " | Người chốt: " + nguoiChot // GhiChu
      ]);

      tongSoMam++;
      tongSoLuong += sl;
      tongTien += thanhTien;
    }

    if (tongSoMam === 0) {
      throw new Error("Không có mâm thợ cắt nào chưa chốt trong tháng " + thangChon);
    }

    SpreadsheetApp.flush();

    return {
      status: "OK",
      maChot: maChot,
      soMam: tongSoMam,
      tongSoLuong: tongSoLuong,
      tongTien: tongTien
    };

  } catch (err) {
    throw new Error(err.message || err.toString());
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}


/****************************************************
 * QL RẬP - SCHEMA CHUẨN MỚI tbl_Rap_DonHang A:AF
 * Chỉ tác động module Rập. Các module khác giữ nguyên.
 *
 * A  MaMam
 * B  NgayTao
 * C  NguoiTao
 * D  NgayCat
 * E  NhaMay
 * F  MaRap
 * G  TenSP
 * H  Size
 * I  TiLeSize
 * J  SoLop
 * K  TongKeHoach
 * L  TongDaGiao
 * M  TongConThieu
 * N  NgayGiaoDuKien
 * O  LoaiMam
 * P  TenKhach
 * Q  MaKH
 * R  MaHoaDonDongBo
 * S  ThoCat
 * T  DonGiaNhaMay
 * U  ThanhTienNhaMay
 * V  TrangThaiSanXuat
 * W  TrangThaiNhanHang
 * X  TrangThaiThanhToan
 * Y  MaChotNhaMay
 * Z  MaChotThoCat
 * AA LinkAnh
 * AB SoLopCu
 * AC NguoiSuaLop
 * AD TGSuaLop
 * AE GhiChu
 * AF CapNhatCuoi
 ****************************************************/

var RAP_DON_HEADERS = [
  "MaMam", "NgayTao", "NguoiTao", "NgayCat", "NhaMay", "MaRap", "TenSP",
  "Size", "TiLeSize", "SoLop", "TongKeHoach", "TongDaGiao", "TongConThieu",
  "NgayGiaoDuKien", "LoaiMam", "TenKhach", "MaKH", "MaHoaDonDongBo", "ThoCat",
  "DonGiaNhaMay", "ThanhTienNhaMay", "TrangThaiSanXuat", "TrangThaiNhanHang",
  "TrangThaiThanhToan", "MaChotNhaMay", "MaChotThoCat", "LinkAnh", "SoLopCu",
  "NguoiSuaLop", "TGSuaLop", "GhiChu", "CapNhatCuoi",
  "MaPhieuNhapRap", "MaSP", "MaBanHang", "Hieu", "Mau", "SizeChung", "TiLeChung",
  "SoLuongSizeJson", "LinkAnhPhieuNhap", "KhoNhapDuKien", "TrangThaiNhapKho"
];

var RAP_DON_COL = {
  MA_MAM: 0, NGAY_TAO: 1, NGUOI_TAO: 2, NGAY_CAT: 3, NHA_MAY: 4,
  MA_RAP: 5, TEN_SP: 6, SIZE: 7, TI_LE_SIZE: 8, SO_LOP: 9,
  TONG_KE_HOACH: 10, TONG_DA_GIAO: 11, TONG_CON_THIEU: 12,
  NGAY_GIAO_DU_KIEN: 13, LOAI_MAM: 14, TEN_KHACH: 15, MA_KH: 16,
  MA_HOA_DON_DONG_BO: 17, THO_CAT: 18, DON_GIA_NHA_MAY: 19,
  THANH_TIEN_NHA_MAY: 20, TRANG_THAI_SAN_XUAT: 21,
  TRANG_THAI_NHAN_HANG: 22, TRANG_THAI_THANH_TOAN: 23,
  MA_CHOT_NHA_MAY: 24, MA_CHOT_THO_CAT: 25, LINK_ANH: 26,
  SO_LOP_CU: 27, NGUOI_SUA_LOP: 28, TG_SUA_LOP: 29,
  GHI_CHU: 30, CAP_NHAT_CUOI: 31,
  MA_PHIEU_NHAP_RAP: 32, MA_SP: 33, MA_BAN_HANG: 34, HIEU: 35, MAU: 36,
  SIZE_CHUNG: 37, TI_LE_CHUNG: 38, SO_LUONG_SIZE_JSON: 39,
  LINK_ANH_PHIEU_NHAP: 40, KHO_NHAP_DU_KIEN: 41, TRANG_THAI_NHAP_KHO: 42
};


function rapHNGetLastDonGiaNhaMay_(maRap, nhaMay) {
  maRap = rapHNText_(maRap).toUpperCase();
  nhaMay = rapHNText_(nhaMay).toUpperCase();
  if (!maRap || !nhaMay) return 0;

  try {
    var sh = rapEnsureRapDonHangSheet_();
    if (!sh || sh.getLastRow() < 2) return 0;

    var lastCol = Math.max(RAP_DON_HEADERS.length, sh.getLastColumn());
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getValues();

    // Duyệt từ cuối lên để lấy giá gần nhất theo đúng nhà may + mã rập.
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i] || [];
      var rMaRap = rapHNText_(r[RAP_DON_COL.MA_RAP]).toUpperCase();
      var rNhaMay = rapHNText_(r[RAP_DON_COL.NHA_MAY]).toUpperCase();
      if (rMaRap === maRap && rNhaMay === nhaMay) {
        var dg = rapHNNum_(r[RAP_DON_COL.DON_GIA_NHA_MAY]);
        if (dg > 0) return dg;
      }
    }
  } catch (err) {}

  return 0;
}

function rapHNGetDonGiaNhaMayTheoRapNhaMay(maRap, nhaMay) {
  try {
    var dg = rapHNGetLastDonGiaNhaMay_(maRap, nhaMay);
    return {
      ok: true,
      maRap: rapHNText_(maRap).toUpperCase(),
      nhaMay: rapHNText_(nhaMay),
      donGiaNhaMay: dg,
      found: dg > 0,
      source: dg > 0 ? "Lịch sử nhà may + mã rập" : ""
    };
  } catch (err) {
    return { ok: false, message: err.message || String(err), donGiaNhaMay: 0, found: false };
  }
}

function rapIsMaRap_(v) {
  var s = normalizeText_(v).toUpperCase();
  if (!s) return false;
  if (/^(TRG|MK|606|859)/.test(s)) return true;
  if (/^[A-Z0-9\-]+$/.test(s) && /\d/.test(s) && s.length <= 20) return true;
  return false;
}

function rapGetNum_(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  var s = String(v).replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  var n = Number(s);
  return isNaN(n) ? 0 : n;
}

function rapFormatNgay_(v) {
  if (!v) return "";
  if (v instanceof Date) return Utilities.formatDate(v, "GMT+7", "dd/MM/yyyy");
  var s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    var d = new Date(s);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, "GMT+7", "dd/MM/yyyy");
  }
  return s;
}

function rapFormatNgayGio_(v) {
  if (!v) return "";
  if (v instanceof Date) return Utilities.formatDate(v, "GMT+7", "dd/MM/yyyy HH:mm:ss");
  return String(v || "").trim();
}

function rapTinhTrangTT_(v) {
  var s = normalizeText_(v);
  var lower = s.toLowerCase();

  if (!s) return "Chưa";
  if (lower.indexOf("ép") > -1) return "Ép Chốt";
  if (lower.indexOf("chưa") > -1 || lower.indexOf("chua") > -1) return "Chưa";
  if (lower.indexOf("còn nợ") > -1 || lower.indexOf("con no") > -1) return "Chưa";
  if (lower.indexOf("đã") > -1 || lower.indexOf("da") > -1) return "Rồi";
  if (lower === "rồi" || lower === "roi") return "Rồi";
  if (lower.indexOf("thanh toán") > -1 || lower.indexOf("thanh toan") > -1) return "Rồi";

  return s;
}

function rapNormalizeLinkAnh_(v) {
  var raw = normalizeText_(v);
  if (!raw) return "";

  try {
    var arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr.map(function(x) { return normalizeText_(x); })
        .filter(function(x) { return x !== ""; })
        .join("\n");
    }
  } catch (err) {}

  return raw;
}

function rapCreateMaMam_() {
  return "MAM" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + "-" + Math.floor(Math.random() * 1000);
}

function rapEnsureRapDonHangSheet_() {
  var sheet = getSheet_("RAP", "tbl_Rap_DonHang");

  if (sheet.getMaxColumns() < RAP_DON_HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), RAP_DON_HEADERS.length - sheet.getMaxColumns());
  }

  // Không xóa dữ liệu cũ. Chỉ chuẩn hóa dòng tiêu đề.
  sheet.getRange(1, 1, 1, RAP_DON_HEADERS.length).setValues([RAP_DON_HEADERS]);

  return sheet;
}

// Giữ tên hàm cũ để các hàm Nhà May chưa sửa không bị lỗi.
// Không tạo thêm cột lung tung nữa, chỉ đảm bảo bảng Rập theo A:AF.
function rapEnsureNhaMayCols_() {
  return rapEnsureRapDonHangSheet_();
}

function rapIsLayoutMoiAF_(r) {
  // Layout mới: F = MaRap
  return rapIsMaRap_(r[5]);
}

function rapIsLayoutSaiAY_(r) {
  // Layout sai từng được ghi: C = NhaMay, D = MaRap
  return !rapIsMaRap_(r[2]) && rapIsMaRap_(r[3]);
}

function rapIsLayoutGocAS_(r) {
  // Layout gốc setup data: C = MaRap
  return rapIsMaRap_(r[2]);
}

function rapMapDonHangRow_(r) {
  r = r || [];

  // 1) Layout chuẩn mới A:AF
  if (rapIsLayoutMoiAF_(r)) {
    var tong = rapGetNum_(r[RAP_DON_COL.TONG_KE_HOACH]);
    var daGiao = rapGetNum_(r[RAP_DON_COL.TONG_DA_GIAO]);
    var conThieu = r[RAP_DON_COL.TONG_CON_THIEU] !== "" && r[RAP_DON_COL.TONG_CON_THIEU] !== undefined
      ? rapGetNum_(r[RAP_DON_COL.TONG_CON_THIEU])
      : Math.max(tong - daGiao, 0);

    var donGia = rapGetNum_(r[RAP_DON_COL.DON_GIA_NHA_MAY]);
    var thanhTien = rapGetNum_(r[RAP_DON_COL.THANH_TIEN_NHA_MAY]);
    if (!thanhTien && donGia > 0) thanhTien = daGiao * donGia;

    return {
      layoutRap: "MOI_AF",
      thoiGianTao: normalizeText_(r[RAP_DON_COL.MA_MAM]),
      maMam: normalizeText_(r[RAP_DON_COL.MA_MAM]),
      ngayTao: rapFormatNgayGio_(r[RAP_DON_COL.NGAY_TAO]),
      nguoiTao: normalizeText_(r[RAP_DON_COL.NGUOI_TAO]),
      ngayCat: rapFormatNgay_(r[RAP_DON_COL.NGAY_CAT]),
      nhaMay: normalizeText_(r[RAP_DON_COL.NHA_MAY]),
      maRap: normalizeText_(r[RAP_DON_COL.MA_RAP]),
      tenSp: normalizeText_(r[RAP_DON_COL.TEN_SP]),
      mauSanPham: normalizeText_(r[RAP_DON_COL.TEN_SP]),
      size: normalizeText_(r[RAP_DON_COL.SIZE]),
      mau: normalizeText_(r[RAP_DON_COL.MAU]) || normalizeText_(r[RAP_DON_COL.SIZE]),
      tiLeSize: normalizeText_(r[RAP_DON_COL.TI_LE_SIZE]),
      soLop: normalizeText_(r[RAP_DON_COL.SO_LOP]),
      tongSoLuong: tong,
      tongKeHoach: tong,
      soLuongGiao: daGiao,
      tongDaGiao: daGiao,
      tongConThieu: conThieu,
      ngayGiao: rapFormatNgay_(r[RAP_DON_COL.NGAY_GIAO_DU_KIEN]) || "Hàng xưởng",
      ngayGiaoDuKien: rapFormatNgay_(r[RAP_DON_COL.NGAY_GIAO_DU_KIEN]),
      loaiMam: normalizeText_(r[RAP_DON_COL.LOAI_MAM]),
      tenKhach: normalizeText_(r[RAP_DON_COL.TEN_KHACH]),
      maKH: normalizeText_(r[RAP_DON_COL.MA_KH]),
      maHoaDon: normalizeText_(r[RAP_DON_COL.MA_HOA_DON_DONG_BO]),
      thoCat: normalizeText_(r[RAP_DON_COL.THO_CAT]),
      donGia: donGia,
      donGiaNhaMay: donGia,
      thanhTien: thanhTien,
      thanhTienNhaMay: thanhTien,
      trangThaiSanXuat: normalizeText_(r[RAP_DON_COL.TRANG_THAI_SAN_XUAT]),
      trangThaiNhanHang: normalizeText_(r[RAP_DON_COL.TRANG_THAI_NHAN_HANG]),
      trangThai: rapTinhTrangTT_(r[RAP_DON_COL.TRANG_THAI_THANH_TOAN]),
      trangThaiThanhToan: rapTinhTrangTT_(r[RAP_DON_COL.TRANG_THAI_THANH_TOAN]),
      maChotNhaMay: normalizeText_(r[RAP_DON_COL.MA_CHOT_NHA_MAY]),
      maChotCat: normalizeText_(r[RAP_DON_COL.MA_CHOT_THO_CAT]),
      linkAnh: rapNormalizeLinkAnh_(r[RAP_DON_COL.LINK_ANH]),
      soLopSua: normalizeText_(r[RAP_DON_COL.SO_LOP_CU]),
      nguoiSuaLop: normalizeText_(r[RAP_DON_COL.NGUOI_SUA_LOP]),
      thoiGianSuaLop: rapFormatNgayGio_(r[RAP_DON_COL.TG_SUA_LOP]),
      ghiChu: normalizeText_(r[RAP_DON_COL.GHI_CHU]),
      capNhatCuoi: rapFormatNgayGio_(r[RAP_DON_COL.CAP_NHAT_CUOI]),
      maPhieuNhapRap: normalizeText_(r[RAP_DON_COL.MA_PHIEU_NHAP_RAP]),
      maSP: normalizeText_(r[RAP_DON_COL.MA_SP]),
      maBanHang: normalizeText_(r[RAP_DON_COL.MA_BAN_HANG]),
      hieu: normalizeText_(r[RAP_DON_COL.HIEU]),
      mauChuan: normalizeText_(r[RAP_DON_COL.MAU]),
      sizeChung: normalizeText_(r[RAP_DON_COL.SIZE_CHUNG]),
      tiLeChung: normalizeText_(r[RAP_DON_COL.TI_LE_CHUNG]),
      soLuongSizeJson: normalizeText_(r[RAP_DON_COL.SO_LUONG_SIZE_JSON]),
      linkAnhPhieuNhap: normalizeText_(r[RAP_DON_COL.LINK_ANH_PHIEU_NHAP]),
      khoNhapDuKien: normalizeText_(r[RAP_DON_COL.KHO_NHAP_DU_KIEN]),
      trangThaiNhapKho: normalizeText_(r[RAP_DON_COL.TRANG_THAI_NHAP_KHO])
    };
  }

  // 2) Layout sai A:Y đã lỡ ghi trước đó: C=NhaMay, D=MaRap, Q=LinkAnh
  if (rapIsLayoutSaiAY_(r)) {
    var tongSai = rapGetNum_(r[7]);
    var giaoSai = rapGetNum_(r[9]);

    return {
      layoutRap: "SAI_AY",
      thoiGianTao: rapFormatNgayGio_(r[0]),
      maMam: rapFormatNgayGio_(r[0]),
      ngayTao: rapFormatNgayGio_(r[0]),
      nguoiTao: "",
      ngayCat: rapFormatNgay_(r[1]),
      nhaMay: normalizeText_(r[2]),
      maRap: normalizeText_(r[3]),
      tenSp: normalizeText_(r[8]),
      mauSanPham: normalizeText_(r[8]),
      size: normalizeText_(r[4]),
      mau: normalizeText_(r[4]),
      tiLeSize: normalizeText_(r[5]),
      soLop: normalizeText_(r[6]),
      tongSoLuong: tongSai,
      tongKeHoach: tongSai,
      soLuongGiao: giaoSai,
      tongDaGiao: giaoSai,
      tongConThieu: Math.max(tongSai - giaoSai, 0),
      ngayGiao: rapFormatNgay_(r[13]) || "Hàng xưởng",
      ngayGiaoDuKien: rapFormatNgay_(r[13]),
      loaiMam: normalizeText_(r[12]) ? "Khách đặt" : "Hàng xưởng",
      tenKhach: normalizeText_(r[12]),
      maKH: normalizeText_(r[18]),
      maHoaDon: normalizeText_(r[17]),
      thoCat: normalizeText_(r[14]),
      donGia: rapGetNum_(r[10]),
      donGiaNhaMay: rapGetNum_(r[10]),
      thanhTien: rapGetNum_(r[11]),
      thanhTienNhaMay: rapGetNum_(r[11]),
      trangThaiSanXuat: "",
      trangThaiNhanHang: "",
      trangThai: rapTinhTrangTT_(r[15]),
      trangThaiThanhToan: rapTinhTrangTT_(r[15]),
      maChotNhaMay: "",
      maChotCat: normalizeText_(r[22]),
      linkAnh: rapNormalizeLinkAnh_(r[16]),
      soLopSua: normalizeText_(r[19]),
      nguoiSuaLop: normalizeText_(r[20]),
      thoiGianSuaLop: rapFormatNgayGio_(r[21]),
      ghiChu: normalizeText_(r[12]),
      capNhatCuoi: rapFormatNgayGio_(r[21])
    };
  }

  // 3) Layout gốc A:S từ file setup ban đầu
  var tongGoc = rapGetNum_(r[8]);
  var giaoGoc = rapGetNum_(r[9]);
  var rawTT = normalizeText_(r[18]) || normalizeText_(r[7]);

  return {
    layoutRap: "GOC_AS",
    thoiGianTao: normalizeText_(r[0]),
    maMam: normalizeText_(r[0]),
    ngayTao: rapFormatNgay_(r[1]),
    nguoiTao: normalizeText_(r[13]),
    ngayCat: rapFormatNgay_(r[1]),
    nhaMay: normalizeText_(r[6]),
    maRap: normalizeText_(r[2]),
    tenSp: normalizeText_(r[3]),
    mauSanPham: normalizeText_(r[3]),
    size: normalizeText_(r[4]),
    mau: normalizeText_(r[4]),
    tiLeSize: "",
    soLop: normalizeText_(r[5]),
    tongSoLuong: tongGoc,
    tongKeHoach: tongGoc,
    soLuongGiao: giaoGoc,
    tongDaGiao: giaoGoc,
    tongConThieu: r[10] !== "" && r[10] !== undefined ? rapGetNum_(r[10]) : Math.max(tongGoc - giaoGoc, 0),
    ngayGiao: rapFormatNgay_(r[11]) || "Hàng xưởng",
    ngayGiaoDuKien: rapFormatNgay_(r[11]),
    loaiMam: "Hàng xưởng",
    tenKhach: "",
    maKH: "",
    maHoaDon: "",
    thoCat: "",
    donGia: 0,
    donGiaNhaMay: 0,
    thanhTien: 0,
    thanhTienNhaMay: 0,
    trangThaiSanXuat: normalizeText_(r[7]),
    trangThaiNhanHang: normalizeText_(r[17]),
    trangThai: rapTinhTrangTT_(rawTT),
    trangThaiThanhToan: rapTinhTrangTT_(rawTT),
    maChotNhaMay: normalizeText_(r[15]),
    maChotCat: normalizeText_(r[16]),
    linkAnh: "",
    soLopSua: "",
    nguoiSuaLop: "",
    thoiGianSuaLop: "",
    ghiChu: normalizeText_(r[12]),
    capNhatCuoi: rapFormatNgayGio_(r[14])
  };
}

function rapFindRowIndexByMaMam_(sheet, id) {
  id = normalizeText_(id);
  if (!id) return -1;

  var last = sheet.getLastRow();
  if (last < 2) return -1;

  var values = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var v = values[i][0] instanceof Date
      ? Utilities.formatDate(values[i][0], "GMT+7", "dd/MM/yyyy HH:mm:ss")
      : normalizeText_(values[i][0]);

    if (v === id) return i + 2;
  }

  return -1;
}

function rapTinhTrangNhanHang_(tong, daGiao) {
  tong = rapGetNum_(tong);
  daGiao = rapGetNum_(daGiao);

  if (daGiao <= 0) return "Chưa nhận";
  if (daGiao < tong) return "Đang nhận";
  if (daGiao === tong) return "Đã nhận đủ";
  return "Nhận dư";
}

function layDanhSachDonHang() {
  try {
    var sheet = getSheet_("RAP", "tbl_Rap_DonHang");

    var dongCuoi = sheet.getLastRow();
    if (dongCuoi < 2) return [];

    var soCotCanLay = Math.max(sheet.getLastColumn(), RAP_DON_HEADERS.length);
    var duLieu = sheet.getRange(2, 1, dongCuoi - 1, soCotCanLay).getValues();

    duLieu.reverse();

    return duLieu
      .filter(function(r) {
        return (
          normalizeText_(r[0]) ||
          normalizeText_(r[2]) ||
          normalizeText_(r[3]) ||
          normalizeText_(r[5]) ||
          normalizeText_(r[6]) ||
          rapGetNum_(r[10]) > 0 ||
          rapGetNum_(r[7]) > 0 ||
          rapGetNum_(r[8]) > 0
        );
      })
      .map(function(r) {
        return rapMapDonHangRow_(r);
      });

  } catch (err) {
    throw new Error("Lỗi layDanhSachDonHang: " + err.message);
  }
}

function laySoLuongChuaGiao() {
  /****************************************************
   * TASK 06Y - THỐNG KÊ SL CHƯA GIAO THEO QUY TẮC MỚI
   * - Màu đỏ: chỉ hàng nhà chưa thanh toán, còn thiếu/chưa giao.
   * - Màu vàng: chỉ hàng khách đặt chưa thanh toán, còn thiếu/chưa giao.
   * - Đã thanh toán rồi thì bỏ qua, dù còn thiếu.
   * - Riêng BAY + 859DUI/859DAI: tách khỏi màu đỏ, gom vào 2 nhóm riêng.
   ****************************************************/
  try {
    var sheet = getSheet_("RAP", "tbl_Rap_DonHang");

    if (sheet.getLastRow() < 2) return {};

    var soCotCanLay = Math.max(sheet.getLastColumn(), RAP_DON_HEADERS.length);
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, soCotCanLay).getValues();

    function nhaMayKey_(v) {
      return normalizeText_(v)
        .toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/Đ/g, "D")
        .replace(/[^A-Z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function ensure_(map, key) {
      key = nhaMayKey_(key);
      if (!key) key = "KHAC";
      if (!map[key]) {
        map[key] = {
          tong: 0,          // hàng nhà bình thường còn thiếu/chưa giao, chưa thanh toán
          khachDat: 0,      // hàng khách đặt còn thiếu/chưa giao, chưa thanh toán
          bay859DUI: 0,     // BAY - mã 859DUI tách riêng
          bay859DAI: 0      // BAY - mã 859DAI tách riêng
        };
      }
      return map[key];
    }

    function isDaXoa_(don) {
      var sx = normalizeText_(don.trangThaiSanXuat || don.trangThaiNhanHang || don.trangThai);
      var lower = sx.toLowerCase();
      return lower === "đã xóa" || lower === "da xoa" || lower === "xóa" || lower === "xoa";
    }

    function isChuaThanhToan_(don) {
      var tt = normalizeText_(don.trangThaiThanhToan || don.trangThai);
      var lower = tt.toLowerCase();

      if (!tt) return true;
      if (lower.indexOf("ép") > -1 || lower.indexOf("ep") > -1) return true;
      if (lower.indexOf("chưa") > -1 || lower.indexOf("chua") > -1) return true;
      if (lower.indexOf("còn nợ") > -1 || lower.indexOf("con no") > -1) return true;

      if (lower === "rồi" || lower === "roi") return false;
      if (lower.indexOf("đã") > -1 || lower.indexOf("da") > -1) return false;
      if (lower.indexOf("thanh toán") > -1 || lower.indexOf("thanh toan") > -1) return false;

      // Trạng thái lạ thì coi như chưa thanh toán để không lọt mâm.
      return true;
    }

    function isKhachDat_(don) {
      var tenKhach = normalizeText_(don.tenKhach);
      var loaiMam = normalizeText_(don.loaiMam).toLowerCase();
      var maKH = normalizeText_(don.maKH);
      var maHD = normalizeText_(don.maHoaDon);

      if (loaiMam.indexOf("khách") > -1 || loaiMam.indexOf("khach") > -1) return true;
      if (maKH || maHD) return true;
      if (!tenKhach) return false;

      var k = tenKhach.toLowerCase();
      if (k === "không có" || k === "khong co" || k === "hàng xưởng" || k === "hang xuong") return false;
      return true;
    }

    var ketQua = {};
    ensure_(ketQua, "ALL");

    for (var i = 0; i < data.length; i++) {
      var don = rapMapDonHangRow_(data[i]);

      if (isDaXoa_(don)) continue;
      if (!isChuaThanhToan_(don)) continue;

      var nhaMay = normalizeText_(don.nhaMay);
      if (!nhaMay) continue;

      var tong = rapGetNum_(don.tongSoLuong || don.tongKeHoach);
      var daGiao = rapGetNum_(don.soLuongGiao || don.tongDaGiao);
      var conLai = Math.max(tong - daGiao, 0);
      if (conLai <= 0) continue;

      var key = nhaMayKey_(nhaMay);
      var item = ensure_(ketQua, key);
      var all = ensure_(ketQua, "ALL");
      var maRap = normalizeText_(don.maRap).toUpperCase();
      var laKhachDat = isKhachDat_(don);

      if (laKhachDat) {
        item.khachDat += conLai;
        all.khachDat += conLai;
        continue;
      }

      if (key === "BAY" && maRap === "859DUI") {
        item.bay859DUI += conLai;
        all.bay859DUI += conLai;
        continue;
      }

      if (key === "BAY" && maRap === "859DAI") {
        item.bay859DAI += conLai;
        all.bay859DAI += conLai;
        continue;
      }

      item.tong += conLai;
      all.tong += conLai;
    }

    return ketQua;

  } catch (err) {
    return {};
  }
}

function rapEnsureLichSuNhap_() {
  var ssRap = getSS_("RAP");
  var sheet = ssRap.getSheetByName("LichSuNhap");

  if (!sheet) {
    sheet = ssRap.insertSheet("LichSuNhap");
    sheet.getRange(1, 1, 1, 8).setValues([[
      "ThoiGianNhap",
      "MaRap",
      "SoLuongNhap",
      "NguoiNhap",
      "GhiChu",
      "IDDonHang",
      "ThoiGianDuyet",
      "NguoiDuyet"
    ]]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}
function xoaDonHangTrenSheet(id, ownerPass) {
  try {
    if (!kiemTraMatKhauOwnerRap_(ownerPass)) {
      throw new Error("Sai mật khẩu OWNER");
    }

    var sheetDH = getSheet_("RAP", "tbl_Rap_DonHang");
    var rowIndex = rapFindRowIndexByMaMam_(sheetDH, id);

    if (rowIndex < 2) {
      throw new Error("Không tìm thấy mâm rập để xóa");
    }

    var row = sheetDH.getRange(rowIndex, 1, 1, Math.max(sheetDH.getLastColumn(), RAP_DON_HEADERS.length)).getValues()[0];
    var don = rapMapDonHangRow_(row);
    var soLuongDaGiao = rapGetNum_(don.soLuongGiao);

    if (soLuongDaGiao > 0) {
      throw new Error("Mâm này đã có hàng nhập về, không thể xóa trực tiếp");
    }

    sheetDH.deleteRow(rowIndex);
    SpreadsheetApp.flush();

    return "Đã xóa";

  } catch (err) {
    throw new Error("Lỗi xóa rập: " + err.message);
  }
}

function xulyNhapHangMoi(thongTin) {
  try {
    thongTin = thongTin || {};

    var sheetLS = rapEnsureLichSuNhap_();
    var sheetDH = rapEnsureRapDonHangSheet_();

    var id = normalizeText_(thongTin.id);
    var maRap = normalizeText_(thongTin.maRap);
    var soLuongNhap = Number(thongTin.soLuongNhap || 0);
    var nguoiNhap = normalizeText_(thongTin.nguoiNhap || "Chưa rõ");
    var ghiChu = normalizeText_(thongTin.ghiChu);

    if (!id) throw new Error("Thiếu ID mâm rập");
    if (!maRap) throw new Error("Thiếu mã rập");
    if (!isFinite(soLuongNhap) || soLuongNhap === 0) {
      throw new Error("Số lượng nhận/điều chỉnh phải là số khác 0");
    }
    if (Math.floor(soLuongNhap) !== soLuongNhap) {
      throw new Error("Số lượng nhận/điều chỉnh phải là số nguyên");
    }

    var rowIndex = rapFindRowIndexByMaMam_(sheetDH, id);
    if (rowIndex < 2) {
      throw new Error("Không tìm thấy mâm hàng trong tbl_Rap_DonHang");
    }

    var lastCol = Math.max(sheetDH.getLastColumn(), RAP_DON_HEADERS.length);
    var row = sheetDH.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
    var don = rapMapDonHangRow_(row);

    // Mâm đã chốt phải đi qua phiếu hàng vét để khoản bổ sung không làm
    // thay đổi bảng kê cũ và vẫn được tạo công nợ riêng.
    if (normalizeText_(don.maChotNhaMay)) {
      throw new Error("Mâm đã chốt nhà may. Hãy dùng nút Thêm dòng tại bảng Chốt TT.");
    }

    var tongKeHoach = rapGetNum_(don.tongSoLuong);
    var daGiaoCu = rapGetNum_(don.soLuongGiao);
    var daGiaoMoi = daGiaoCu + soLuongNhap;

    // Cho phép nhập số âm để điều chỉnh giảm sau khi kiểm đếm,
    // nhưng không cho tổng số đã nhận của mâm xuống dưới 0.
    if (daGiaoMoi < 0) {
      throw new Error("Không thể trừ vượt quá số đã nhận hiện tại (" + daGiaoCu + " cái)");
    }

    var conThieuMoi = Math.max(tongKeHoach - daGiaoMoi, 0);

    var trangThaiNhan = rapTinhTrangNhanHang_(tongKeHoach, daGiaoMoi);
    var trangThaiSanXuat = conThieuMoi <= 0 ? "Đã xong" : "Đang cắt / chưa đủ";

    var donGia = rapGetNum_(don.donGia);
    var thanhTienMoi = daGiaoMoi * donGia;
    var nowText = nowVN_();

    // Ghi lịch sử nhập
    sheetLS.appendRow([
      new Date(),     // A: ThoiGianNhap
      maRap,          // B: MaRap
      soLuongNhap,    // C: SoLuongNhap
      nguoiNhap,      // D: NguoiNhap
      ghiChu,         // E: GhiChu
      id,             // F: IDDonHang / MaMam
      "",             // G: ThoiGianDuyet
      ""              // H: NguoiDuyet
    ]);

    // Cập nhật đúng schema mới A:AF
    sheetDH.getRange(rowIndex, RAP_DON_COL.TONG_DA_GIAO + 1).setValue(daGiaoMoi);           // L
    sheetDH.getRange(rowIndex, RAP_DON_COL.TONG_CON_THIEU + 1).setValue(conThieuMoi);       // M
    sheetDH.getRange(rowIndex, RAP_DON_COL.THANH_TIEN_NHA_MAY + 1).setValue(thanhTienMoi);  // U
    sheetDH.getRange(rowIndex, RAP_DON_COL.TRANG_THAI_SAN_XUAT + 1).setValue(trangThaiSanXuat); // V
    sheetDH.getRange(rowIndex, RAP_DON_COL.TRANG_THAI_NHAN_HANG + 1).setValue(trangThaiNhan);    // W
    try {
      var trangThaiNhapKhoCu = normalizeText_(sheetDH.getRange(rowIndex, RAP_DON_COL.TRANG_THAI_NHAP_KHO + 1).getValue());
      if (trangThaiNhapKhoCu !== "Đã nhập kho") {
        sheetDH.getRange(rowIndex, RAP_DON_COL.TRANG_THAI_NHAP_KHO + 1).setValue("Chờ khai size thiếu");
      }
    } catch (eNhapKhoStatus) {}
    sheetDH.getRange(rowIndex, RAP_DON_COL.CAP_NHAT_CUOI + 1).setValue(nowText);            // AF

    SpreadsheetApp.flush();
    return "Thành công";

  } catch (err) {
    throw new Error("Lỗi nhập hàng rập: " + err.message);
  }
}

function layLichSuChoDon(idDonHang, maRap) {
  try {
    var sheetLS = rapEnsureLichSuNhap_();

    if (sheetLS.getLastRow() < 2) return [];

    var data = sheetLS.getDataRange().getValues();
    var ketQua = [];

    var idDonHangStr = String(idDonHang || "").trim();
    var maRapStr = String(maRap || "").trim();

    for (var i = data.length - 1; i >= 1; i--) {
      var maTrongSheet = String(data[i][1] || "").trim();
      var idTrongSheet = data[i][5];

      var isMatch = false;

      if (idTrongSheet && idTrongSheet !== "") {
        var idChuan = idTrongSheet instanceof Date
          ? Utilities.formatDate(idTrongSheet, "GMT+7", "dd/MM/yyyy HH:mm:ss")
          : String(idTrongSheet || "").trim();

        if (idChuan === idDonHangStr) isMatch = true;
      } else {
        if (maTrongSheet === maRapStr) isMatch = true;
      }

      if (isMatch) {
        ketQua.push({
          rowIdx: Number(i + 1),
          ngayGio: data[i][0] instanceof Date
            ? Utilities.formatDate(data[i][0], "GMT+7", "dd/MM/yyyy HH:mm")
            : String(data[i][0] || ""),
          soLuong: Number(data[i][2]) || 0,
          ghiChu: String(data[i][4] || ""),
          nguoiNhap: String(data[i][3] || "Chưa rõ"),
          ngayGioTick: data[i][6] instanceof Date
            ? Utilities.formatDate(data[i][6], "GMT+7", "HH:mm dd/MM")
            : String(data[i][6] || ""),
          nguoiTick: String(data[i][7] || "")
        });
      }
    }

    return ketQua;

  } catch (err) {
    throw new Error("Lỗi lấy lịch sử nhập rập: " + err.message);
  }
}
function rapDateAnyToIso_(v) {
  if (!v) return "";

  if (v instanceof Date) {
    return Utilities.formatDate(v, "GMT+7", "yyyy-MM-dd'T'HH:mm:ss");
  }

  var s = String(v || "").trim();
  if (!s) return "";

  // Đã là dạng ISO/HTML date
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + "T00:00:00";

  // Dạng Việt Nam: dd/MM/yyyy hoặc dd/MM/yyyy HH:mm:ss
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    var dd = String(m[1]).padStart(2, "0");
    var mm = String(m[2]).padStart(2, "0");
    var yy = m[3];
    var hh = String(m[4] || "0").padStart(2, "0");
    var mi = String(m[5] || "0").padStart(2, "0");
    var ss = String(m[6] || "0").padStart(2, "0");
    return yy + "-" + mm + "-" + dd + "T" + hh + ":" + mi + ":" + ss;
  }

  return s;
}

function rapSameName_(a, b) {
  return normalizeText_(a).toLowerCase() === normalizeText_(b).toLowerCase();
}

function rapCapNhatNoNhaMay_(tenNhaMay) {
  tenNhaMay = normalizeText_(tenNhaMay);
  if (!tenNhaMay) return 0;

  var sheetChot = getSheet_("RAP", "tbl_NhaMay_ChotDon");
  var sheetNM = getSheet_("RAP", "tbl_NhaMay");

  var valuesChot = sheetChot.getDataRange().getValues();
  var conNo = 0;

  for (var i = 1; i < valuesChot.length; i++) {
    if (!rapSameName_(valuesChot[i][2], tenNhaMay)) continue; // C: TenNhaMay
    conNo += rapGetNum_(valuesChot[i][7]);                    // H: ConLai
  }

  if (conNo <= 1) conNo = 0;

  var valuesNM = sheetNM.getDataRange().getValues();
  for (var n = 1; n < valuesNM.length; n++) {
    if (rapSameName_(valuesNM[n][1], tenNhaMay)) {             // B: TenNhaMay
      sheetNM.getRange(n + 1, 5).setValue(conNo);             // E: NoHienTai
      SpreadsheetApp.flush();
      return conNo;
    }
  }

  // Nếu chưa có nhà may trong danh mục thì thêm cuối, không đụng cột cũ.
  sheetNM.appendRow([
    "NM" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss"),
    tenNhaMay,
    "",
    "",
    conNo,
    "Đang làm",
    "Tự thêm từ chốt/TT nhà may"
  ]);

  SpreadsheetApp.flush();
  return conNo;
}

function rapLayNhaMayGiaoDich_(tenNhaMay) {
  tenNhaMay = normalizeText_(tenNhaMay);
  if (!tenNhaMay) return [];

  var sheetChot = getSheet_("RAP", "tbl_NhaMay_ChotDon");
  var sheetTT = getSheet_("RAP", "tbl_NhaMay_ThanhToan");

  var result = [];

  var chotData = sheetChot.getDataRange().getValues();
  for (var i = 1; i < chotData.length; i++) {
    var r = chotData[i];
    if (!rapSameName_(r[2], tenNhaMay)) continue; // C: TenNhaMay

    var maChot = normalizeText_(r[0]);
    var ngayIso = rapDateAnyToIso_(r[1]);
    var thanhTien = rapGetNum_(r[5]);

    result.push([
      maChot,                         // 0 MaGiaoDich / MaBangKe
      ngayIso,                         // 1 ThoiGian dạng JS đọc được
      normalizeText_(r[2]),            // 2 TenNhaMay
      "Chốt",                         // 3 LoaiGiaoDich
      thanhTien,                       // 4 SoTien
      normalizeText_(r[9]),            // 5 GhiChu
      normalizeText_(r[10]),           // 6 NguoiThaoTac
      maChot,                          // 7 MaBangKe
      normalizeText_(r[8]),            // 8 TrangThai
      ngayIso                          // 9 CapNhatCuoi
    ]);
  }

  var ttData = sheetTT.getDataRange().getValues();
  for (var t = 1; t < ttData.length; t++) {
    var p = ttData[t];
    if (!rapSameName_(p[2], tenNhaMay)) continue; // C: TenNhaMay

    var maTT = normalizeText_(p[0]);
    var ngayTTIso = rapDateAnyToIso_(p[1]);
    var soTienTT = rapGetNum_(p[4]);
    var ghiChuTT = normalizeText_(p[7]);
    var hinhThuc = normalizeText_(p[5]);

    result.push([
      maTT,                            // 0 MaGiaoDich
      ngayTTIso,                        // 1 ThoiGian
      normalizeText_(p[2]),             // 2 TenNhaMay
      "Trừ Nợ",                        // 3 LoaiGiaoDich
      soTienTT,                         // 4 SoTien
      ghiChuTT || hinhThuc,             // 5 GhiChu
      normalizeText_(p[6]),             // 6 NguoiThaoTac
      normalizeText_(p[3]),             // 7 MaBangKe/MaChot
      "Đã thanh toán",                 // 8 TrangThai
      ngayTTIso                         // 9 CapNhatCuoi
    ]);
  }

  result.sort(function(a, b) {
    return new Date(b[1]).getTime() - new Date(a[1]).getTime();
  });

  return result;
}

function rapLayChiTietBangKeNhaMay_(maBangKe) {
  maBangKe = normalizeText_(maBangKe);
  if (!maBangKe) return [];

  var sheetRap = rapEnsureRapDonHangSheet_();
  var values = sheetRap.getLastRow() < 2 ? [] : sheetRap.getRange(
    2, 1, sheetRap.getLastRow() - 1,
    Math.max(sheetRap.getLastColumn(), RAP_DON_HEADERS.length)
  ).getValues();

  // Bảng kê cũ giữ nguyên số tiền lúc chốt; bảng kê bổ sung chỉ hiện hàng vét.
  return hvChiTietBangKe_(maBangKe, values);
}

function rapLuuThanhToanNhaMay_(data) {
  var sheetChot = getSheet_("RAP", "tbl_NhaMay_ChotDon");
  var sheetTT = getSheet_("RAP", "tbl_NhaMay_ThanhToan");

  var tenNhaMay = normalizeText_(data.tenNhaMay);
  var ngayTT = normalizeText_(data.ngay) || dateVN_();
  var soTien = rapGetNum_(data.soTien);
  var nguoiTT = normalizeText_(data.nguoiThaoTac || data.user || data.actorUser) || "Không rõ";
  var lyDo = normalizeText_(data.lyDo || data.ghiChu) || "Thanh toán công gia công cắt may";
  var hinhThuc = normalizeText_(data.hinhThuc) || "Tiền mặt";

  if (!tenNhaMay) throw new Error("Chưa chọn nhà may");
  if (soTien <= 0) throw new Error("Số tiền không hợp lệ");

  var values = sheetChot.getDataRange().getValues();
  var remain = soTien;
  var daGhi = 0;

  // Trừ vào các bảng kê còn nợ từ cũ tới mới.
  for (var i = 1; i < values.length && remain > 0; i++) {
    var r = values[i];
    if (!rapSameName_(r[2], tenNhaMay)) continue; // C: TenNhaMay

    var maChot = normalizeText_(r[0]);
    var daThanhToan = rapGetNum_(r[6]);           // G: DaThanhToan
    var conLai = rapGetNum_(r[7]);                // H: ConLai
    if (conLai <= 1) continue;

    var tienTru = Math.min(remain, conLai);
    var daMoi = daThanhToan + tienTru;
    var conMoi = Math.max(conLai - tienTru, 0);
    if (conMoi <= 1) conMoi = 0;

    sheetChot.getRange(i + 1, 7).setValue(daMoi);                       // G
    sheetChot.getRange(i + 1, 8).setValue(conMoi);                      // H
    sheetChot.getRange(i + 1, 9).setValue(conMoi > 0 ? "Còn nợ" : "Đã thanh toán"); // I

    var maTT = "TTNM-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + "-" + (i + 1);
    sheetTT.appendRow([
      maTT,
      ngayTT,
      tenNhaMay,
      maChot,
      tienTru,
      hinhThuc,
      nguoiTT,
      lyDo
    ]);

    remain -= tienTru;
    daGhi += tienTru;
  }

  // Nếu trả dư hoặc chưa có bảng kê, vẫn ghi lại thanh toán để không mất lịch sử.
  if (remain > 0) {
    var maTTDu = "TTNM-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + "-DU";
    sheetTT.appendRow([
      maTTDu,
      ngayTT,
      tenNhaMay,
      "",
      remain,
      hinhThuc,
      nguoiTT,
      lyDo + " (chưa phân bổ bảng kê / trả dư)"
    ]);
    daGhi += remain;
  }

  rapCapNhatNoNhaMay_(tenNhaMay);
  SpreadsheetApp.flush();
  return "OK";
}

function chotThanhToanNhieuDonRap(danhSachIds, nguoiChot, tenNhaMay) {
  try {
    var sheetDH = rapEnsureRapDonHangSheet_();
    var sheetChot = getSheet_("RAP", "tbl_NhaMay_ChotDon");

    danhSachIds = Array.isArray(danhSachIds) ? danhSachIds.map(String) : [];
    nguoiChot = normalizeText_(nguoiChot) || "Không rõ";
    tenNhaMay = normalizeText_(tenNhaMay);

    if (danhSachIds.length === 0) throw new Error("Chưa chọn mâm để chốt");
    if (!tenNhaMay) throw new Error("Thiếu tên nhà may");

    var data = sheetDH.getDataRange().getValues();
    var nowText = nowVN_();
    var today = dateVN_();
    var maChot = "CNM-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");

    var tongSoLuong = 0;
    var tongTien = 0;
    var donGiaDauTien = "";
    var soMamChot = 0;

    for (var i = 1; i < data.length; i++) {
      var don = rapMapDonHangRow_(data[i]);
      var idDong = normalizeText_(don.maMam || don.thoiGianTao);

      if (danhSachIds.indexOf(idDong) === -1) continue;
      if (normalizeText_(don.maChotNhaMay)) continue;
      if (!rapSameName_(don.nhaMay, tenNhaMay)) continue;

      var slGiao = rapGetNum_(don.soLuongGiao);
      var donGia = rapGetNum_(don.donGia);
      var thanhTien = slGiao * donGia;

      if (slGiao <= 0 || thanhTien <= 0) continue;

      if (donGiaDauTien === "") donGiaDauTien = donGia;
      tongSoLuong += slGiao;
      tongTien += thanhTien;
      soMamChot++;

      sheetDH.getRange(i + 1, RAP_DON_COL.MA_CHOT_NHA_MAY + 1).setValue(maChot);              // Y
      sheetDH.getRange(i + 1, RAP_DON_COL.THANH_TIEN_NHA_MAY + 1).setValue(thanhTien);        // U
      sheetDH.getRange(i + 1, RAP_DON_COL.TRANG_THAI_THANH_TOAN + 1).setValue("Đã chốt");    // X
      sheetDH.getRange(i + 1, RAP_DON_COL.CAP_NHAT_CUOI + 1).setValue(nowText);               // AF
    }

    if (soMamChot === 0 || tongTien <= 0) {
      throw new Error("Không có mâm hợp lệ để chốt. Mâm cần có đã giao > 0, đơn giá > 0, đúng nhà may và chưa chốt.");
    }

    sheetChot.appendRow([
      maChot,                               // MaChot
      today,                                // NgayChot
      tenNhaMay,                            // TenNhaMay
      tongSoLuong,                          // TongSoLuong
      donGiaDauTien,                        // DonGia
      tongTien,                             // ThanhTien
      0,                                    // DaThanhToan
      tongTien,                             // ConLai
      "Còn nợ",                             // TrangThai
      "Chốt " + soMamChot + " mâm",         // GhiChu
      nguoiChot                             // NguoiChot
    ]);

    rapCapNhatNoNhaMay_(tenNhaMay);
    SpreadsheetApp.flush();
    return "OK";

  } catch (err) {
    throw new Error("Lỗi chốt thanh toán nhà may: " + err.message);
  }
}

// AZALAS V79: đã bỏ bản xacNhanThanhToanSheet cũ; dùng bản an toàn ở cuối file.


// =========================================================================
// ==================== BƯỚC 5: TẠO ĐƠN KÉP (RẬP + HÓA ĐƠN) ================
// =========================================================================

function taoMaHoaDonTuDongAppB() {
  var now = new Date();
  var y = String(now.getFullYear()).slice(-2);
  var m = String(now.getMonth() + 1).padStart(2, "0");
  var d = String(now.getDate()).padStart(2, "0");
  var h = String(now.getHours()).padStart(2, "0");
  var min = String(now.getMinutes()).padStart(2, "0");
  var sec = String(now.getSeconds()).padStart(2, "0");
  var rand = Math.floor(Math.random() * 10);

  return "HD" + y + m + d + h + min + sec + rand;
}

function rapTinhTongSoLuong_(soLopText) {
  var txt = normalizeText_(soLopText);
  if (!txt) return 0;

  // Ví dụ: 20x5=100 hoặc M10 L20 = 30
  if (txt.indexOf("=") > -1) {
    var sauBang = txt.split("=").pop();
    var num = parseFloat(String(sauBang).replace(/[^\d.-]/g, ""));
    return isNaN(num) ? 0 : num;
  }

  // Nếu nhập dạng 10+20+30 thì cộng
  if (txt.indexOf("+") > -1) {
    var parts = txt.match(/\d+(\.\d+)?/g) || [];
    return parts.reduce(function(sum, n) {
      return sum + (parseFloat(n) || 0);
    }, 0);
  }

  var first = parseFloat(txt.replace(/[^\d.-]/g, ""));
  return isNaN(first) ? 0 : first;
}

function rapUploadAnh_(danhSachAnh, maRap) {
  var links = [];

  if (!danhSachAnh || !Array.isArray(danhSachAnh) || danhSachAnh.length === 0) {
    return links;
  }

  var folder = getFolder_("ANH_SAN_PHAM");

  danhSachAnh.forEach(function(anh, index) {
    if (!anh || !anh.anhData || String(anh.anhData).indexOf(",") === -1) return;

    var dataUrl = String(anh.anhData);
    var contentType = "image/jpeg";

    try {
      contentType = dataUrl.substring(5, dataUrl.indexOf(";")) || "image/jpeg";
    } catch (e) {}

    var bytes = Utilities.base64Decode(dataUrl.split(",")[1]);
    var tenFile = "RAP_" + normalizeText_(maRap).replace(/[^\w\-]/g, "_") + "_" + new Date().getTime() + "_" + (index + 1) + ".jpg";
    var blob = Utilities.newBlob(bytes, contentType, tenFile);
    var file = folder.createFile(blob);

    // Ảnh mới sẽ cố gắng mở quyền xem để thumbnail hiển thị trong WebApp.
    // Nếu tài khoản triển khai không có quyền mở chia sẻ, vẫn lưu link để xử lý thủ công.
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      Logger.log("Không setSharing được ảnh rập mới: " + e.message);
    }

    links.push(file.getUrl());
  });

  return links;
}


/****************************************************
 * QL RẬP - ẢNH DRIVE FALLBACK
 * Trả ảnh dạng data URL để Index hiển thị khi Drive thumbnail bị chặn.
 * Không đổi cột / không đổi dữ liệu sheet.
 ****************************************************/
function rapGetImageDataUrlById(fileId) {
  try {
    fileId = normalizeText_(fileId).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!fileId) {
      return { ok: false, message: "Thiếu fileId" };
    }

    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var mime = blob.getContentType() || "image/jpeg";
    var bytes = blob.getBytes();

    // Tránh trả file quá nặng làm chậm app. 8MB là đủ cho ảnh xem nhanh.
    if (bytes.length > 8 * 1024 * 1024) {
      return {
        ok: false,
        message: "Ảnh quá nặng, vui lòng giảm dung lượng hoặc mở quyền Drive để dùng thumbnail."
      };
    }

    return {
      ok: true,
      dataUrl: "data:" + mime + ";base64," + Utilities.base64Encode(bytes)
    };
  } catch (err) {
    return {
      ok: false,
      message: "Không đọc được ảnh Drive: " + err.message
    };
  }
}

function rapTimHoacTaoKhach_(sheetKH, tenKhach) {
  tenKhach = normalizeText_(tenKhach);

  if (!tenKhach || tenKhach === "Không có") {
    return "";
  }

  var dataKH = sheetKH.getDataRange().getValues();

  for (var i = 1; i < dataKH.length; i++) {
    if (normalizeText_(dataKH[i][1]).toLowerCase() === tenKhach.toLowerCase()) {
      return dataKH[i][0] || "";
    }
  }

  var maKH = "KH" + new Date().getTime();
  var now = nowVN_();

  sheetKH.appendRow([
    maKH,              // MaKH
    tenKhach,          // TenKhach
    "",                // SDT
    "",                // DiaChi
    0,                 // NoHienTai
    "Khách lẻ",        // NhomKhach
    "",                // Zalo
    "",                // KhuVuc
    "Đang mua",        // TrangThai
    "Tạo tự động từ Thêm Rập", // GhiChu
    dateVN_(),          // NgayTao
    now                // CapNhatCuoi
  ]);

  return maKH;
}

// Hàm chính: Lưu đơn hàng mới từ giao diện Thêm Rập
function luuDonHangMoi(thongTin) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    thongTin = thongTin || {};

    var sheetRap = rapEnsureRapDonHangSheet_();
    var sheetDonHang = getSheet_("SALES", "tbl_DonHang");
    var sheetKH = getSheet_("SALES", "tbl_KhachHang");

    var ngayCat = normalizeText_(thongTin.ngayCat);
    var nhaMay = normalizeText_(thongTin.nhaMay);
    var maRap = normalizeText_(thongTin.maRap);
    var size = normalizeText_(thongTin.size);
    var tiLeSize = normalizeText_(thongTin.tiLeSize);
    var soLop = normalizeText_(thongTin.soLop);
    var tenSp = normalizeText_(thongTin.tenSp);
    var donGia = parseFloat(thongTin.donGia) || 0;
    var thoCat = normalizeText_(thongTin.thoCat);
    var tenKhach = normalizeText_(thongTin.tenKhach);
    var ngayGiao = normalizeText_(thongTin.ngayGiao);
    var nguoiTao = normalizeText_(thongTin.nguoiTao || thongTin.user || thongTin.actorUser || "RẬP");

    if (!ngayCat || !nhaMay || !maRap || !size || !tiLeSize || !soLop || !tenSp || !thoCat) {
      throw new Error("Thiếu thông tin bắt buộc khi thêm rập");
    }

    var coKhach = tenKhach && tenKhach !== "Không có" && tenKhach !== "Hàng xưởng";
    if (coKhach && !ngayGiao) {
      throw new Error("Đơn khách đặt phải có ngày giao");
    }

    var now = nowVN_();
    var maMam = rapCreateMaMam_();
    var tongKeHoach = rapTinhTongSoLuong_(soLop);
    var tongDaGiao = 0;
    var tongConThieu = tongKeHoach;
    var thanhTien = 0; // Chưa nhận hàng nên chưa tính tiền thanh toán nhà may

    var danhSachLinkAnh = rapUploadAnh_(thongTin.danhSachAnh || [], maRap);
    var anhJson = JSON.stringify(danhSachLinkAnh);

    var maKH = coKhach ? rapTimHoacTaoKhach_(sheetKH, tenKhach) : "";
    var maHoaDon = coKhach ? taoMaHoaDonTuDongAppB() : "";

    // Ghi đúng schema mới A:AF của tbl_Rap_DonHang
    sheetRap.appendRow([
      maMam,                              // A  MaMam
      now,                                // B  NgayTao
      nguoiTao,                           // C  NguoiTao
      ngayCat,                            // D  NgayCat
      nhaMay,                             // E  NhaMay
      maRap,                              // F  MaRap
      tenSp,                              // G  TenSP
      size,                               // H  Size
      tiLeSize,                           // I  TiLeSize
      soLop,                              // J  SoLop
      tongKeHoach,                        // K  TongKeHoach
      tongDaGiao,                         // L  TongDaGiao
      tongConThieu,                       // M  TongConThieu
      coKhach ? ngayGiao : "",            // N  NgayGiaoDuKien
      coKhach ? "Khách đặt" : "Hàng xưởng", // O LoaiMam
      coKhach ? tenKhach : "",            // P  TenKhach
      maKH,                               // Q  MaKH
      maHoaDon,                           // R  MaHoaDonDongBo
      thoCat,                             // S  ThoCat
      donGia,                             // T  DonGiaNhaMay
      thanhTien,                          // U  ThanhTienNhaMay
      "Đang cắt / chưa đủ",               // V  TrangThaiSanXuat
      "Chưa nhận",                        // W  TrangThaiNhanHang
      "Chưa thanh toán",                  // X  TrangThaiThanhToan
      "",                                 // Y  MaChotNhaMay
      "",                                 // Z  MaChotThoCat
      anhJson,                            // AA LinkAnh
      "",                                 // AB SoLopCu
      "",                                 // AC NguoiSuaLop
      "",                                 // AD TGSuaLop
      "",                                 // AE GhiChu
      now                                 // AF CapNhatCuoi
    ]);

    // Nếu là khách đặt thì tạo thêm hóa đơn bên SALES, giữ nguyên layout SALES hiện tại
    if (coKhach) {
      sheetDonHang.appendRow([
        maHoaDon,                    // A: MaHoaDon
        dateVN_(),                    // B: NgayTao
        tenKhach,                     // C: TenKhach
        "Khách đặt",                 // D: LoaiDon
        ngayGiao,                     // E: NgayGiao
        "Đơn đồng bộ từ Mã Rập: " + maRap + " / Mâm: " + maMam, // F
        "Mới",                       // G: TrangThai
        anhJson,                      // H: AnhZaloJson
        maKH,                         // I: MaKH
        "",                           // J: NguoiSoan
        0,                            // K: NoTrongHoaDon
        0,                            // L: TongTien
        0,                            // M: DaThanhToan
        "",                            // N: TrangThaiHoaDon
        "",                           // O: GhiChuNV
        "",                           // P: GioSoanXong
        "",                           // Q: ThoiGianHuy
        "",                           // R: NguoiHuy
        nguoiTao,                     // S: NguoiTao
        "Đơn từ rập",                 // T: KieuDon
        "RẬP",                        // U: KenhBan
        now                           // V: CapNhatCuoi
      ]);
    }

    SpreadsheetApp.flush();

    return {
      status: "OK",
      maMam: maMam,
      maHoaDon: maHoaDon,
      maKH: maKH,
      tongSoLuong: tongKeHoach,
      thanhTien: thanhTien
    };

  } catch (err) {
    throw new Error("Lỗi luuDonHangMoi: " + err.message);
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}


// =========================================================================
// =================== HỆ THỐNG BACKUP TỰ ĐỘNG MỖI ĐÊM =====================
// =========================================================================

function backupDataToEmail() {
  // Đã đổi sang email nhận duy nhất theo đúng yêu cầu của bạn
  var emailNhan = "azalassportdata@gmail.com";
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssId = ss.getId();

  // Lấy ngày giờ hiện tại theo giờ Việt Nam
  var date = Utilities.formatDate(new Date(), "GMT+7", "dd-MM-yyyy");

  // Tạo đường dẫn để xuất toàn bộ Google Sheets thành file Excel (.xlsx)
  var url = "https://docs.google.com/spreadsheets/d/" + ssId + "/export?format=xlsx";
  var token = ScriptApp.getOAuthToken();

  // Tải file về bộ nhớ tạm
  var response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + token
    }
  });

  // Đặt tên file đính kèm (Chuyển dữ liệu Sheet thành file đính kèm)
  var blob = response.getBlob().setName("Azalas_Backup_" + date + ".xlsx");

  // Soạn tiêu đề và nội dung Email
  var subject = "📦 SAO LƯU DỮ LIỆU AZALAS SPORT - NGÀY " + date;
  var body = "Chào sếp,\n\n" +
    "Đây là file sao lưu tự động toàn bộ dữ liệu hệ thống (Khách hàng, Đơn hàng, Công nợ, Rập...) ngày " + date + ".\n\n" +
    "File đính kèm là định dạng Excel (.xlsx). Sếp hãy giữ email này cẩn thận để phòng hờ rủi ro nhé.\n\n" +
    "Chúc sếp ngủ ngon! 🌙\n" +
    "--- Hệ thống tự động Azalas ---";

  // Tiến hành gửi: CHỈ đính kèm đúng file blob chứa dữ liệu Sheet, không đính kèm bất kỳ ảnh nào khác
  GmailApp.sendEmail(emailNhan, subject, body, {
    attachments: [blob]
  });
}
// Hàm Ép Chốt Đơn Hàng (Đổi trạng thái thành Ép Chốt)
function epChotDonHang(id, ownerPass) {
  try {
    if (!kiemTraMatKhauOwnerRap_(ownerPass)) {
      throw new Error("Sai mật khẩu OWNER");
    }

    var sheet = rapEnsureRapDonHangSheet_();
    var rowIndex = rapFindRowIndexByMaMam_(sheet, id);

    if (rowIndex < 2) {
      throw new Error("Không tìm thấy mâm rập để ép chốt");
    }

    var nowText = nowVN_();

    sheet.getRange(rowIndex, RAP_DON_COL.TRANG_THAI_THANH_TOAN + 1).setValue("Ép Chốt"); // X
    sheet.getRange(rowIndex, RAP_DON_COL.TRANG_THAI_SAN_XUAT + 1).setValue("Ép chốt / chưa đủ"); // V
    sheet.getRange(rowIndex, RAP_DON_COL.CAP_NHAT_CUOI + 1).setValue(nowText); // AF

    SpreadsheetApp.flush();
    return "OK";

  } catch (err) {
    throw new Error("Lỗi ép chốt: " + err.message);
  }
}


function layYearMonthRapTC(giaTri) {
  if (!giaTri) return "";

  if (giaTri instanceof Date) {
    return Utilities.formatDate(giaTri, "GMT+7", "yyyy-MM");
  }

  var s = String(giaTri).trim();
  if (s === "") return "";

  // Nếu dạng dd/MM/yyyy hoặc dd/MM/yyyy HH:mm
  var datePart = s.split(" ")[0];
  var parts = datePart.split("/");

  if (parts.length === 3) {
    var mm = parts[1];
    var yyyy = parts[2];
    return yyyy + "-" + String(mm).padStart(2, "0");
  }

  // Nếu dạng yyyy-MM-dd
  if (/^\d{4}-\d{2}/.test(s)) {
    return s.substring(0, 7);
  }

  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, "GMT+7", "yyyy-MM");
  }

  return "";
}

function formatNgayRapTC(giaTri) {
  if (!giaTri) return "";

  if (giaTri instanceof Date) {
    return Utilities.formatDate(giaTri, "GMT+7", "dd/MM/yyyy");
  }

  return String(giaTri);
}

function normalizeThangChotTC(giaTri) {
  if (!giaTri) return "";

  if (giaTri instanceof Date) {
    return Utilities.formatDate(giaTri, "GMT+7", "yyyy-MM");
  }

  var s = String(giaTri).trim();
  if (s === "") return "";

  // Đúng dạng 2026-05
  if (/^\d{4}-\d{2}$/.test(s)) {
    return s;
  }

  // Dạng 2026-05-01 hoặc ISO timestamp
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.substring(0, 7);
  }

  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, "GMT+7", "yyyy-MM");
  }

  return s;
}
function kiemTraMatKhauOwnerRap_(matKhauNhap) {
  try {
    var passNhap = normalizeText_(matKhauNhap);

    if (!passNhap) return false;

    var sheetTK = getSheet_("SYSTEM", "tbl_TaiKhoan");
    var values = sheetTK.getDataRange().getValues();

    for (var i = 1; i < values.length; i++) {
      var passTrongSheet = normalizeText_(values[i][1]); // B: Pass
      var role = normalizeRole_(values[i][3]);           // D: Role
      var trangThai = normalizeText_(values[i][6]);      // G: TrangThai

      var dangHoatDong =
        !trangThai ||
        trangThai === "Đang hoạt động" ||
        trangThai === "Dang hoat dong" ||
        trangThai.toUpperCase() === "ACTIVE";

      if (hasAppRole_(role, "OWNER") && passTrongSheet === passNhap && dangHoatDong) {
        return true;
      }
    }

    return false;

  } catch (err) {
    return false;
  }
}


// rapEnsureNhaMayCols_ đã được định nghĩa ở block QL RẬP chuẩn mới.


function rapEnsureNhaMayGiaoDich_() {
  var ssTC = getSS_("TAI_CHINH");
  var sheet = ssTC.getSheetByName("tbl_NhaMay_GiaoDich");

  if (!sheet) {
    sheet = ssTC.insertSheet("tbl_NhaMay_GiaoDich");
    sheet.getRange(1, 1, 1, 10).setValues([[
      "MaGiaoDich",
      "ThoiGian",
      "TenNhaMay",
      "LoaiGiaoDich",
      "SoTien",
      "GhiChu",
      "NguoiThaoTac",
      "MaBangKe",
      "TrangThai",
      "CapNhatCuoi"
    ]]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}


function rapExtractDriveFileIds_(text) {
  text = String(text || "");
  var ids = [];

  // Bắt dạng /file/d/FILE_ID/
  var re1 = /\/file\/d\/([a-zA-Z0-9_-]+)/g;
  var m;
  while ((m = re1.exec(text)) !== null) {
    ids.push(m[1]);
  }

  // Bắt dạng ?id=FILE_ID hoặc &id=FILE_ID
  var re2 = /[?&]id=([a-zA-Z0-9_-]+)/g;
  while ((m = re2.exec(text)) !== null) {
    ids.push(m[1]);
  }

  // Loại trùng
  var seen = {};
  return ids.filter(function(id) {
    if (seen[id]) return false;
    seen[id] = true;
    return true;
  });
}

function capQuyenAnhRapHienCo() {
  var sheet = getSheet_("RAP", "tbl_Rap_DonHang");
  var data = sheet.getDataRange().getValues();

  var ok = 0;
  var fail = 0;
  var idsAll = [];

  for (var r = 1; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      var cell = data[r][c];
      if (!cell) continue;

      var ids = rapExtractDriveFileIds_(cell);
      ids.forEach(function(id) {
        idsAll.push(id);
      });
    }
  }

  var seen = {};
  idsAll.forEach(function(id) {
    if (seen[id]) return;
    seen[id] = true;

    try {
      var file = DriveApp.getFileById(id);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      ok++;
    } catch (err) {
      fail++;
      Logger.log("Không mở quyền được file " + id + ": " + err.message);
    }
  });

  Logger.log("Đã mở quyền ảnh rập. OK=" + ok + " | FAIL=" + fail);

  return {
    ok: ok,
    fail: fail
  };
}


/****************************************************
 * DATA MỚI - NHÂN SỰ + PHỤ LIỆU
 * Bản vá ổn định theo cấu trúc file mới:
 * - 07_DATA_NHAN_SU
 * - 05_DATA_PHU_LIEU_MUA_HANG
 * Không đụng QL Rập / Sales / Công nợ khách.
 ****************************************************/

/****************************************************
 * AZ_IN_PARTNER_V1 - NHẬT IN / TÙNG IN
 * Hai đối tác dùng chung nghiệp vụ nhưng tách tuyệt đối dữ liệu.
 * Schema bắt buộc A:K:
 * MaChot | Thang | Nam | TenDonVi | Loai | SoTien |
 * FilePDF | DaThanhToan | ConLai | TrangThai | GhiChu
 ****************************************************/
function dmInPartnerConfig_(value) {
  var key = dmText_(value || "NHAT").toUpperCase()
    .replace(/Đ/g, "D")
    .replace(/[^A-Z0-9]/g, "");

  if (key === "TUNG" || key === "TUNGIN") {
    return {
      key: "TUNG",
      label: "TÙNG - IN",
      tenDonVi: "Tùng - In",
      sheetName: "tbl_TungIn_GiaoDich",
      prefix: "TGI",
      folderName: "TUNG_IN"
    };
  }

  return {
    key: "NHAT",
    label: "NHẬT - IN",
    tenDonVi: "Nhật - In",
    sheetName: "tbl_NhatIn_GiaoDich",
    prefix: "NHI",
    folderName: "NHAT_IN"
  };
}

function dmInPartnerSheet_(value) {
  var cfg = dmInPartnerConfig_(value);
  var ss = getSS_("PHU_LIEU");
  var sh = ss.getSheetByName(cfg.sheetName);

  // Hỗ trợ chuyển tiếp trong lúc triển khai: NHẬT có thể tạm đọc sheet cũ.
  if (!sh && cfg.key === "NHAT") {
    sh = ss.getSheetByName("tbl_InNhan_ChotTien");
  }

  if (!sh) {
    throw new Error("Không tìm thấy sheet " + cfg.sheetName);
  }

  var expected = [
    "MaChot", "Thang", "Nam", "TenDonVi", "Loai", "SoTien",
    "FilePDF", "DaThanhToan", "ConLai", "TrangThai", "GhiChu"
  ];

  if (sh.getLastColumn() < expected.length) {
    throw new Error("Sheet " + sh.getName() + " chưa đúng cấu trúc A:K. Cần đủ 11 cột.");
  }

  var actual = sh.getRange(1, 1, 1, expected.length).getDisplayValues()[0];
  for (var i = 0; i < expected.length; i++) {
    if (dmText_(actual[i]) !== expected[i]) {
      throw new Error(
        "Sheet " + sh.getName() +
        " sai tiêu đề cột " + String.fromCharCode(65 + i) +
        ". Cần là '" + expected[i] + "'."
      );
    }
  }

  return { cfg: cfg, sheet: sh };
}

function dmInPartnerFolder_(cfg) {
  var parent = getFolder_("FILE_PHU_LIEU");
  var folders = parent.getFoldersByName(cfg.folderName);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(cfg.folderName);
}

function dmGetInPartnerDanhMuc_(bundle) {
  var cfg = bundle.cfg;
  var sh = bundle.sheet;
  var today = dmTodayISO_();
  var result = [];

  // Dữ liệu danh mục cũ thuộc NHẬT nên chỉ NHẬT được đọc phần kế thừa này.
  if (cfg.key === "NHAT") {
    try {
      var shDM = getSheet_("PHU_LIEU", "tbl_PhuLieu_DanhMuc");
      var rowsDM = shDM.getDataRange().getValues();
      rowsDM.shift();
      rowsDM.forEach(function(r) {
        var nhom = dmText_(r[2]).toLowerCase();
        var ten = dmText_(r[1]);
        if (!ten || nhom.indexOf("in") === -1) return;
        var note = dmText_(r[6]);
        var gia = 0;
        var ngay = today;
        var mg = note.match(/Gia\s*:\s*([\d.,-]+)/i);
        var mn = note.match(/Ngay\s*:\s*([^;|]+)/i);
        if (mg) gia = dmNum_(mg[1]);
        if (mn) ngay = dmDateISOFromValue_(mn[1]) || today;
        result.push([ten, gia, ngay]);
      });
    } catch (eOldDm) {}
  }

  var rows = sh.getDataRange().getValues();
  rows.shift();
  rows.forEach(function(r) {
    var loai = dmText_(r[4]);
    var meta = dmSafeParse_(r[10], {});

    if (loai === "GIA_DANH_MUC" && meta.tenSP) {
      result.push([
        dmText_(meta.tenSP),
        dmNum_(meta.donGia || r[5]),
        dmDateISOFromValue_(meta.ngay) || today
      ]);
    }

    if (loai === "NHAP_CHI_TIET" && meta.tenSP) {
      result.push([
        dmText_(meta.tenSP),
        dmNum_(meta.donGia),
        dmDateISOFromValue_(meta.ngay) || today
      ]);
    }
  });

  var seen = {};
  return result.filter(function(r) {
    var key = dmText_(r[0]).toLowerCase() + "|" + dmNum_(r[1]) + "|" + dmText_(r[2]);
    if (!dmText_(r[0]) || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function dmSaveInPartnerDanhMuc_(bundle, data) {
  var cfg = bundle.cfg;
  var sh = bundle.sheet;
  var ngay = dmDateISOFromValue_(data.ngay) || dmTodayISO_();
  var mp = dmMonthParts_(ngay);
  var gia = dmNum_(data.gia);
  var ten = dmText_(data.ten);

  if (!ten || gia <= 0) {
    throw new Error("Tên sản phẩm hoặc giá chưa hợp lệ.");
  }

  var id = cfg.prefix + "GIA" +
    Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") +
    Math.floor(Math.random() * 100);

  var meta = JSON.stringify({
    ngay: ngay,
    tenSP: ten,
    donGia: gia,
    nguoiNhap: dmText_(data.nguoiNhap || data.nguoiThaoTac || "app")
  });

  sh.appendRow([
    id, mp.thang, mp.nam, cfg.tenDonVi, "GIA_DANH_MUC",
    gia, "", 0, 0, "Danh mục", meta
  ]);
  SpreadsheetApp.flush();
  return outText_("OK");
}


function dmHandleNhanSuPhuLieuDataMoi_(data) {
  var type = normalizeText_(data && data.type);

  var nhanSuTypes = {
    getNhanVienList: true,
    saveChamCong: true,
    saveUngLuong: true,
    updateGiaCong: true,
    updateChamCong: true,
    getUngLuongList: true,
    updateUngLuong: true,
    getHRReportData: true,
    saveNhanVien: true,
    getDSNhanVien: true,
    updateNhanVienStatus: true,
    updateSdtNhanVien: true,
    getLichSuLuongNV: true
  };

  var phuLieuTypes = {
    getNhaVaiList: true,
    saveNhaVai: true,
    saveNhapVai: true,
    saveThanhToanVai: true,
    getVaiGiaoDich: true,

    getDayKeoDanhMuc: true,
    saveLoaiDayKeo: true,
    saveNhapDayKeo: true,
    getDayKeoReportFull: true,
    saveThanhToanDayKeo: true,
    getDayKeoGiaoDichNew: true,
    saveThanhToanDayKeoNew: true,
    saveUngDayKeo: true,

    saveNhapTheu: true,
    getBaoCaoTheuFull: true,
    saveThanhToanTheu: true,

    // AZ_THCN_V1: Công nợ Thêu theo tháng, API riêng không chồng chéo module cũ.
    getTheuGiaoDichNew: true,
    saveThanhToanTheuNew: true,
    saveUngTheu: true,

    getInNhanDanhMuc: true,
    saveLoaiInNhan: true,
    saveNhapInNhan: true,
    getInNhanReportFull: true,
    saveThanhToanInNhan: true,

    getInNhanGiaoDich: true,
    saveChotInNhan: true,
    saveThanhToanInNhanNew: true,
    saveUngInNhan: true
  };

  if (nhanSuTypes[type]) {
    return dmRouteNhanSu_(data);
  }

  if (phuLieuTypes[type]) {
    return dmRoutePhuLieu_(data);
  }

  return null;
}

function dmText_(v) {
  return String(v === null || v === undefined ? "" : v).trim();
}

function dmNum_(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  var s = String(v).replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  var n = Number(s);
  return isNaN(n) ? 0 : n;
}

/**
 * V68 - Parser RIÊNG cho Số Công.
 * Số công là số thập phân, KHÔNG được xem dấu "." là dấu phân cách hàng nghìn.
 * Ví dụ:
 *   23.3  -> 23.3
 *   23,3  -> 23.3
 *   30    -> 30
 *
 * Không dùng hàm này cho tiền / đơn giá / số lượng hàng.
 */
function dmCongNum_(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;

  var s = String(v).trim().replace(/\s+/g, "");
  if (!s) return 0;

  // Người dùng Việt Nam có thể nhập dấu phẩy làm phần thập phân.
  s = s.replace(/,/g, ".");

  // Chỉ giữ số, dấu âm và dấu chấm thập phân.
  s = s.replace(/[^\d.-]/g, "");

  // Nếu lỡ có nhiều dấu chấm, giữ dấu chấm đầu tiên và bỏ các dấu sau.
  var firstDot = s.indexOf(".");
  if (firstDot >= 0) {
    s = s.substring(0, firstDot + 1) + s.substring(firstDot + 1).replace(/\./g, "");
  }

  var n = Number(s);
  return isNaN(n) ? 0 : n;
}

function dmTodayISO_() {
  return Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd");
}

function dmDateISOFromValue_(v) {
  if (!v) return "";
  if (v instanceof Date) return Utilities.formatDate(v, "GMT+7", "yyyy-MM-dd");

  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) return s + "-01";

  var p = s.split(" ")[0].split("/");
  if (p.length === 3) {
    return p[2] + "-" + String(p[1]).padStart(2, "0") + "-" + String(p[0]).padStart(2, "0");
  }

  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, "GMT+7", "yyyy-MM-dd");

  return s;
}

function dmYMFromValue_(v) {
  if (!v) return "";

  if (v instanceof Date) {
    return Utilities.formatDate(v, "GMT+7", "yyyy-MM");
  }

  var s = String(v).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 7);
  if (/^\d{2}\/\d{4}$/.test(s)) {
    var p1 = s.split("/");
    return p1[1] + "-" + p1[0];
  }

  var p = s.split(" ")[0].split("/");
  if (p.length === 3) {
    return p[2] + "-" + String(p[1]).padStart(2, "0");
  }

  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, "GMT+7", "yyyy-MM");
  return s;
}

function dmMonthParts_(v) {
  var ym = dmYMFromValue_(v) || dmYMFromValue_(new Date());
  var p = ym.split("-");
  return {
    ym: ym,
    nam: p[0] || Utilities.formatDate(new Date(), "GMT+7", "yyyy"),
    thang: p[1] || Utilities.formatDate(new Date(), "GMT+7", "MM")
  };
}

function dmSafeParse_(txt, fallback) {
  try {
    if (!txt) return fallback;
    return JSON.parse(txt);
  } catch (e) {
    return fallback;
  }
}

function dmFindNhaVaiRow_(sheet, ten) {
  ten = dmText_(ten).toLowerCase();
  if (!ten) return -1;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (dmText_(values[i][0]).toLowerCase() === ten) return i + 1;
  }
  return -1;
}

function dmUpdateNhaVaiDebt_(ten, delta) {
  var sheet = getSheet_("PHU_LIEU", "tbl_Vai_NhaCungCap");
  var rowIndex = dmFindNhaVaiRow_(sheet, ten);
  if (rowIndex < 2) return;
  var oldNo = dmNum_(sheet.getRange(rowIndex, 3).getValue());
  sheet.getRange(rowIndex, 3).setValue(oldNo + dmNum_(delta));
}

/****************************************************
 * NHÂN SỰ - 07_DATA_NHAN_SU
 ****************************************************/
function dmRouteNhanSu_(data) {
  try {
    var type = dmText_(data.type);

    if (type === "getNhanVienList") {
      var shNVList = getSheet_("NHAN_SU", "tbl_NhanVien");
      var rowsNVList = shNVList.getDataRange().getValues();
      rowsNVList.shift();
      var list = rowsNVList
        .filter(function(r) {
          return dmText_(r[0]) && dmText_(r[2]) !== "Đã nghỉ";
        })
        .map(function(r) { return dmText_(r[0]); });
      return outJson_(list);
    }

    if (type === "saveChamCong") {
      var shCC = getSheet_("NHAN_SU", "tbl_ChamCong");
      var tenCC = dmText_(data.tenNV);
      var ymCC = dmYMFromValue_(data.thangNam);
      var ngayCC = ymCC ? ymCC + "-01" : dmTodayISO_();
      var rowsCC = shCC.getDataRange().getValues();

      for (var c = 1; c < rowsCC.length; c++) {
        if (dmText_(rowsCC[c][1]) === tenCC && dmYMFromValue_(rowsCC[c][0]) === ymCC) {
          return outText_("Lỗi: Tháng này đã nhập công rồi. Hãy vào mục Chỉnh sửa!");
        }
      }

      var ghiChuCC = "Thưởng: " + dmNum_(data.thuong);
      shCC.appendRow([
        ngayCC,
        tenCC,
        "THÁNG",
        dmCongNum_(data.soCong),
        dmNum_(data.tangCa),
        ghiChuCC,
        dmText_(data.nguoiNhap || data.nguoiSua || data.user || "app")
      ]);
      SpreadsheetApp.flush();
      return outText_("OK");
    }

    if (type === "saveUngLuong") {
      var shUL = getSheet_("NHAN_SU", "tbl_UngLuong");
      var maUng = "UL" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + Math.floor(Math.random() * 100);
      shUL.appendRow([
        maUng,
        dmDateISOFromValue_(data.ngayUng),
        dmText_(data.tenNV),
        dmNum_(data.soTien),
        dmText_(data.lyDo),
        dmText_(data.nguoiDuyet || data.nguoiSua || data.user || "app")
      ]);
      SpreadsheetApp.flush();
      return outText_("OK");
    }

        if (type === "updateGiaCong") {
      var shGiaNV = getSheet_("NHAN_SU", "tbl_NhanVien");
      var rowsGiaNV = shGiaNV.getDataRange().getValues();

      var tenGia = dmText_(data.tenNV);
      var ngayMoi = dmDateISOFromValue_(data.ngayApDung) || dmTodayISO_();
      var giaMoi = dmNum_(data.giaCong);

      if (!tenGia) return outText_("Lỗi: Thiếu tên nhân viên!");
      if (!giaMoi) return outText_("Lỗi: Thiếu giá công mới!");

      for (var g = 1; g < rowsGiaNV.length; g++) {
        if (dmText_(rowsGiaNV[g][0]) === tenGia) {
          var rowNV = rowsGiaNV[g];

          var giaCu = dmNum_(rowNV[4]); // E = LuongNgay hiện tại
          var ngayVao = dmDateISOFromValue_(rowNV[5]) || ngayMoi; // F = NgayVao
          var noteCu = dmText_(rowNV[6]); // G = GhiChu

          // Lấy lịch sử lương hiện có trong ghi chú
          var lichSu = dmBuildLuongHistory_(rowNV);

          // Nếu chưa có lịch sử, lưu lại mức lương cũ từ ngày vào
          if (lichSu.length === 0 && giaCu > 0) {
            lichSu.push({
              ngay: ngayVao,
              gia: giaCu
            });
          }

          // Thêm/cập nhật mức lương mới theo ngày áp dụng
          var existed = false;
          for (var h = 0; h < lichSu.length; h++) {
            if (lichSu[h].ngay === ngayMoi) {
              lichSu[h].gia = giaMoi;
              existed = true;
              break;
            }
          }

          if (!existed) {
            lichSu.push({
              ngay: ngayMoi,
              gia: giaMoi
            });
          }

          lichSu.sort(function(a, b) {
            return new Date(a.ngay) - new Date(b.ngay);
          });

          // Cột E vẫn là lương hiện tại để màn danh sách nhân viên hiển thị nhanh
          shGiaNV.getRange(g + 1, 5).setValue(giaMoi);

          // Cột G lưu lịch sử giá công, không cần thêm cột mới
          var historyText = dmLuongHistoryToText_(lichSu);
          var logText = "Cập nhật giá công " + nowVN_() +
                        " | Từ ngày " + ngayMoi +
                        " = " + giaMoi +
                        " | Bởi " + dmText_(data.nguoiSua || "app");

          shGiaNV.getRange(g + 1, 7).setValue(historyText + " | " + logText);

          SpreadsheetApp.flush();
          return outText_("OK");
        }
      }

      return outText_("Lỗi: Không tìm thấy nhân viên!");
    }

    if (type === "updateChamCong") {
      var shUpdateCC = getSheet_("NHAN_SU", "tbl_ChamCong");
      var rowsUpdateCC = shUpdateCC.getDataRange().getValues();
      var tenUpdateCC = dmText_(data.tenNV);
      var ymUpdateCC = dmYMFromValue_(data.thangNam);

      for (var uc = 1; uc < rowsUpdateCC.length; uc++) {
        if (dmText_(rowsUpdateCC[uc][1]) === tenUpdateCC && dmYMFromValue_(rowsUpdateCC[uc][0]) === ymUpdateCC) {
          var oldGhiChu = dmText_(rowsUpdateCC[uc][5]);
          var oldThuong = dmExtractThuong_(oldGhiChu);
          var newCong = data.soCong !== "" && data.soCong !== undefined ? dmCongNum_(data.soCong) : dmCongNum_(rowsUpdateCC[uc][3]);
          var newTC = data.tangCa !== "" && data.tangCa !== undefined ? dmNum_(data.tangCa) : dmNum_(rowsUpdateCC[uc][4]);
          var newThuong = data.thuong !== "" && data.thuong !== undefined ? dmNum_(data.thuong) : oldThuong;
          shUpdateCC.getRange(uc + 1, 4).setValue(newCong);
          shUpdateCC.getRange(uc + 1, 5).setValue(newTC);
          shUpdateCC.getRange(uc + 1, 6).setValue("Thưởng: " + newThuong + " | Sửa bởi " + dmText_(data.nguoiSua || "app") + " lúc " + nowVN_());
          SpreadsheetApp.flush();
          return outText_("OK");
        }
      }

      return outText_("Lỗi: Không tìm thấy dữ liệu công của tháng này!");
    }

    if (type === "getUngLuongList") {
      var shListUL = getSheet_("NHAN_SU", "tbl_UngLuong");
      var rowsListUL = shListUL.getDataRange().getValues();
      rowsListUL.shift();
      var targetMMYYYY = dmText_(data.thangNam);
      var arrUL = rowsListUL.map(dmMapUngLuongOld_).filter(function(r) {
        return !targetMMYYYY || r[5] === targetMMYYYY;
      });
      arrUL.reverse();
      return outJson_(arrUL);
    }

    if (type === "updateUngLuong") {
      var shEditUL = getSheet_("NHAN_SU", "tbl_UngLuong");
      var rowsEditUL = shEditUL.getDataRange().getValues();
      var maEditUL = dmText_(data.maPhieu);

      for (var eu = 1; eu < rowsEditUL.length; eu++) {
        if (dmText_(rowsEditUL[eu][0]) === maEditUL) {
          if (data.action === "Xoa") {
            shEditUL.deleteRow(eu + 1);
            SpreadsheetApp.flush();
            return outText_("OK");
          }
          shEditUL.getRange(eu + 1, 4).setValue(dmNum_(data.soTien));
          SpreadsheetApp.flush();
          return outText_("OK");
        }
      }
      return outText_("Không tìm thấy phiếu ứng này!");
    }

        if (type === "getHRReportData") {
      var shReportCC = getSheet_("NHAN_SU", "tbl_ChamCong");
      var shReportUL = getSheet_("NHAN_SU", "tbl_UngLuong");
      var shReportNV = getSheet_("NHAN_SU", "tbl_NhanVien");

      var ccRows = shReportCC.getDataRange().getValues();
      var ulRows = shReportUL.getDataRange().getValues();
      var nvRows = shReportNV.getDataRange().getValues();

      ccRows.shift();
      ulRows.shift();
      nvRows.shift();

      var giaCongRows = [];

      nvRows.forEach(function(r) {
        var ten = dmText_(r[0]);
        if (!ten) return;

        var lichSu = dmBuildLuongHistory_(r);

        // Nếu nhân viên cũ chưa có lịch sử, dùng lương hiện tại từ ngày vào
        if (lichSu.length === 0) {
          var ngayVao = dmDateISOFromValue_(r[5]) || dmTodayISO_();
          var giaHienTai = dmNum_(r[4]);

          if (giaHienTai > 0) {
            lichSu.push({
              ngay: ngayVao,
              gia: giaHienTai
            });
          }
        }

        lichSu.forEach(function(item) {
          giaCongRows.push([
            ten,
            item.ngay,
            item.gia
          ]);
        });
      });

      return outJson_({
        chamCong: ccRows
          .filter(function(r) { return dmText_(r[1]); })
          .map(dmMapChamCongOld_),

        ungLuong: ulRows
          .filter(function(r) { return dmText_(r[0]); })
          .map(dmMapUngLuongOld_),

        giaCong: giaCongRows
      });
    }

        if (type === "saveNhanVien") {
      var shNewNV = getSheet_("NHAN_SU", "tbl_NhanVien");
      var rowsNewNV = shNewNV.getDataRange().getValues();

      var tenNewNV = dmText_(data.tenNV);
      var ngayVaoNewNV = dmDateISOFromValue_(data.ngayVao) || dmTodayISO_();
      var giaCongNewNV = dmNum_(data.giaCong);

      if (!tenNewNV) {
        return outText_("Lỗi: Thiếu tên nhân viên!");
      }

      for (var nn = 1; nn < rowsNewNV.length; nn++) {
        if (dmText_(rowsNewNV[nn][0]).toLowerCase() === tenNewNV.toLowerCase()) {
          return outText_("Lỗi: Tên nhân viên này đã tồn tại!");
        }
      }

      shNewNV.appendRow([
        tenNewNV,                                      // A TenNhanVien
        dmText_(data.sdt),                             // B SDT
        "Đang làm",                                    // C TrangThai
        dmText_(data.chucVu || "Công nhân"),           // D ChucVu
        giaCongNewNV,                                  // E LuongNgay hiện tại
        ngayVaoNewNV,                                  // F NgayVao
        "LS_LUONG:" + ngayVaoNewNV + "=" + giaCongNewNV +
          " | Tạo từ app bởi " + dmText_(data.nguoiSua || "app") // G GhiChu
      ]);

      SpreadsheetApp.flush();
      return outText_("OK");
    }

    if (type === "getDSNhanVien") {
      var shDSNV = getSheet_("NHAN_SU", "tbl_NhanVien");
      var rowsDSNV = shDSNV.getDataRange().getValues();
      rowsDSNV.shift();
      var ds = rowsDSNV.filter(function(r) { return dmText_(r[0]); }).map(function(r) {
        return {
          ten: dmText_(r[0]),
          sdt: dmText_(r[1]),
          trangThai: dmText_(r[2]) || "Đang làm",
          ngayVao: dmDateISOFromValue_(r[5]),
          giaHienTai: dmNum_(r[4])
        };
      });
      return outJson_(ds);
    }

    if (type === "updateNhanVienStatus") {
      var shStatusNV = getSheet_("NHAN_SU", "tbl_NhanVien");
      var rowsStatusNV = shStatusNV.getDataRange().getValues();
      for (var st = 1; st < rowsStatusNV.length; st++) {
        if (dmText_(rowsStatusNV[st][0]) === dmText_(data.tenNV)) {
          shStatusNV.getRange(st + 1, 3).setValue(dmText_(data.status));
          SpreadsheetApp.flush();
          return outText_("OK");
        }
      }
      return outText_("Lỗi: Không tìm thấy nhân viên!");
    }

    if (type === "updateSdtNhanVien") {
      var shSdtNV = getSheet_("NHAN_SU", "tbl_NhanVien");
      var rowsSdtNV = shSdtNV.getDataRange().getValues();
      for (var sd = 1; sd < rowsSdtNV.length; sd++) {
        if (dmText_(rowsSdtNV[sd][0]) === dmText_(data.tenNV)) {
          shSdtNV.getRange(sd + 1, 2).setValue(dmText_(data.sdtMoi));
          SpreadsheetApp.flush();
          return outText_("OK");
        }
      }
      return outText_("Lỗi không tìm thấy!");
    }

        if (type === "getLichSuLuongNV") {
      var shLSNV = getSheet_("NHAN_SU", "tbl_NhanVien");
      var rowsLSNV = shLSNV.getDataRange().getValues();

      var tenLS = dmText_(data.tenNV);

      for (var ls = 1; ls < rowsLSNV.length; ls++) {
        if (dmText_(rowsLSNV[ls][0]) === tenLS) {
          var lichSuLuong = dmBuildLuongHistory_(rowsLSNV[ls]);

          if (lichSuLuong.length === 0) {
            lichSuLuong.push({
              ngay: dmDateISOFromValue_(rowsLSNV[ls][5]) || dmTodayISO_(),
              gia: dmNum_(rowsLSNV[ls][4])
            });
          }

          return outJson_(lichSuLuong);
        }
      }

      return outJson_([]);
    }

    return null;
  } catch (err) {
    return outText_("Lỗi Nhân sự data mới: " + err.message);
  }
}

function dmExtractThuong_(ghiChu) {
  var s = dmText_(ghiChu);
  var m = s.match(/Thưởng\s*:\s*([\d.,-]+)/i);
  return m ? dmNum_(m[1]) : 0;
}
function dmBuildLuongHistory_(nvRow) {
  nvRow = nvRow || [];

  var note = dmText_(nvRow[6]);      // GhiChu
  var ngayVao = dmDateISOFromValue_(nvRow[5]) || dmTodayISO_();
  var giaHienTai = dmNum_(nvRow[4]); // LuongNgay

  var map = {};

  function addLuong(ngay, gia) {
    ngay = dmDateISOFromValue_(ngay);
    gia = dmNum_(gia);

    if (!ngay || gia <= 0) return;

    map[ngay] = gia;
  }

  // Dạng mới: LS_LUONG:2026-06-01=370;2026-07-01=400
  var reNew = /(\d{4}-\d{2}-\d{2})\s*=\s*([\d.,-]+)/g;
  var m;

  while ((m = reNew.exec(note)) !== null) {
    addLuong(m[1], m[2]);
  }

  // Dạng cũ từng lưu: Đổi lương ngày 2026-07-01: 400
  var reOld = /Đổi lương ngày\s+(\d{4}-\d{2}-\d{2})\s*:\s*([\d.,-]+)/gi;

  while ((m = reOld.exec(note)) !== null) {
    addLuong(m[1], m[2]);
  }

  var arr = Object.keys(map).map(function(ngay) {
    return {
      ngay: ngay,
      gia: map[ngay]
    };
  });

  arr.sort(function(a, b) {
    return new Date(a.ngay) - new Date(b.ngay);
  });

  // Nếu hoàn toàn chưa có lịch sử thì trả rỗng,
  // chỗ gọi sẽ tự dùng lương hiện tại từ ngày vào.
  return arr;
}

function dmLuongHistoryToText_(lichSu) {
  lichSu = lichSu || [];

  var clean = {};
  lichSu.forEach(function(item) {
    var ngay = dmDateISOFromValue_(item.ngay);
    var gia = dmNum_(item.gia);

    if (ngay && gia > 0) {
      clean[ngay] = gia;
    }
  });

  var arr = Object.keys(clean)
    .sort(function(a, b) {
      return new Date(a) - new Date(b);
    })
    .map(function(ngay) {
      return ngay + "=" + clean[ngay];
    });

  return "LS_LUONG:" + arr.join(";");
}
function dmMapChamCongOld_(r) {
  var ym = dmYMFromValue_(r[0]);
  var maCC = "CC-" + dmText_(r[1]) + "-" + ym;
  return [
    maCC,
    dmText_(r[1]),
    ym,
    dmNum_(r[3]),
    dmNum_(r[4]),
    dmExtractThuong_(r[5])
  ];
}

function dmMapUngLuongOld_(r) {
  var d = dmDateISOFromValue_(r[1]);
  var ym = dmYMFromValue_(d);
  var p = ym.split("-");
  return [
    dmText_(r[0]),
    dmText_(r[2]),
    d,
    dmNum_(r[3]),
    dmText_(r[4]),
    (p[1] || "") + "/" + (p[0] || "")
  ];
}

/****************************************************
 * PHỤ LIỆU - 05_DATA_PHU_LIEU_MUA_HANG
 ****************************************************/
function dmRoutePhuLieu_(data) {
  try {
    var type = dmText_(data.type);

    /*************** VẢI ***************/
    if (type === "getNhaVaiList") {
      var shNhaVai = getSheet_("PHU_LIEU", "tbl_Vai_NhaCungCap");
      var rowsNhaVai = shNhaVai.getDataRange().getValues();
      rowsNhaVai.shift();
      return outJson_(rowsNhaVai.filter(function(r) {
        return dmText_(r[0]) && dmText_(r[4]) !== "Đã xóa";
      }).map(function(r) {
        return {
          ten: dmText_(r[0]),
          sdt: dmText_(r[1]),
          noHienTai: dmNum_(r[2])
        };
      }));
    }

    if (type === "saveNhaVai") {
      var shSaveNhaVai = getSheet_("PHU_LIEU", "tbl_Vai_NhaCungCap");
      var tenNhaVai = dmText_(data.ten);
      var oldRowsNVai = shSaveNhaVai.getDataRange().getValues();
      for (var nv = 1; nv < oldRowsNVai.length; nv++) {
        if (dmText_(oldRowsNVai[nv][0]).toLowerCase() === tenNhaVai.toLowerCase()) return outText_("Tồn tại");
      }
      shSaveNhaVai.appendRow([tenNhaVai, dmText_(data.sdt), 0, "", "Đang mua", "Tạo từ app"]);
      SpreadsheetApp.flush();
      return outText_("OK");
    }

    if (type === "saveNhapVai") {
      var shVaiNhap = getSheet_("PHU_LIEU", "tbl_Vai_Nhap");
      var shVaiTT = getSheet_("PHU_LIEU", "tbl_Vai_ThanhToan");
      var maPV = "VAI" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");
      var deltaNo = 0;
      var detailsVai = data.details || [];
      detailsVai.forEach(function(item, index) {
        var loaiItem = dmText_(item.loai);
        var tien = dmNum_(item.thanhTien);
        var ngay = dmDateISOFromValue_(item.ngay) || dmTodayISO_();

        if (loaiItem === "Thanh Toán") {
          var maTTV = "TTV" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + index;
          shVaiTT.appendRow([maTTV, ngay, dmText_(data.nhaVai), Math.abs(tien), "Thanh toán", dmText_(data.nguoiNhap || "app"), maPV + " - " + dmText_(item.tenVai), maPV]);
          deltaNo -= Math.abs(tien);
          return;
        }

        var meta = {
          loaiGoc: loaiItem,
          soCay: dmNum_(item.soCay),
          kgMet: dmNum_(item.kgMet),
          khauHao: dmNum_(item.khauHao),
          conLai: dmNum_(item.conLai)
        };

        var tienXe = loaiItem === "Tiền Xe" ? tien : 0;
        var tongCong = tien;
        var conLai = tien;
        shVaiNhap.appendRow([
          maPV,
          ngay,
          dmText_(data.nhaVai),
          loaiItem,
          dmText_(item.tenVai),
          dmNum_(item.kgMet || item.conLai || item.soCay),
          dmNum_(item.gia),
          tien,
          tienXe,
          tongCong,
          0,
          conLai,
          dmText_(data.nguoiNhap || "app"),
          JSON.stringify(meta)
        ]);
        deltaNo += tien;
      });
      dmUpdateNhaVaiDebt_(data.nhaVai, deltaNo);
      SpreadsheetApp.flush();
      return outText_(maPV);
    }

    if (type === "saveThanhToanVai") {
      var shPayVai = getSheet_("PHU_LIEU", "tbl_Vai_ThanhToan");
      var maPayVai = "TTV" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + Math.floor(Math.random() * 100);
      var tienPayVai = dmNum_(data.soTien);
      shPayVai.appendRow([maPayVai, dmDateISOFromValue_(data.ngay), dmText_(data.nhaVai), tienPayVai, "Thanh toán", dmText_(data.nguoiTra || "app"), dmText_(data.ghiChu), ""]);
      dmUpdateNhaVaiDebt_(data.nhaVai, -tienPayVai);
      SpreadsheetApp.flush();
      return outText_("OK");
    }

    if (type === "getVaiGiaoDich") {
      var shGVNhap = getSheet_("PHU_LIEU", "tbl_Vai_Nhap");
      var shGVTT = getSheet_("PHU_LIEU", "tbl_Vai_ThanhToan");
      var shGVNCC = getSheet_("PHU_LIEU", "tbl_Vai_NhaCungCap");
      var tenGV = dmText_(data.nhaVai);
      var nhapRows = shGVNhap.getDataRange().getValues();
      var ttRows = shGVTT.getDataRange().getValues();
      var nccRows = shGVNCC.getDataRange().getValues();
      nhapRows.shift();
      ttRows.shift();

      var noHienTai = 0;
      for (var gn = 1; gn < nccRows.length; gn++) {
        if (dmText_(nccRows[gn][0]) === tenGV) {
          noHienTai = dmNum_(nccRows[gn][2]);
          break;
        }
      }

      var group = {};
      nhapRows.filter(function(r) { return dmText_(r[2]) === tenGV; }).forEach(function(r) {
        var ma = dmText_(r[0]);
        if (!group[ma]) group[ma] = { maNhap: ma, ngay: dmDateISOFromValue_(r[1]), nhaVai: dmText_(r[2]), tongTien: 0, items: [] };
        var meta = dmSafeParse_(r[13], {});
        var ttien = dmNum_(r[9] || r[7]);
        group[ma].tongTien += ttien;
        group[ma].items.push({
          loai: meta.loaiGoc || dmText_(r[3]),
          tenVai: dmText_(r[4]),
          soCay: dmNum_(meta.soCay),
          kgMet: dmNum_(meta.kgMet || r[5]),
          khauHao: dmNum_(meta.khauHao),
          conLai: dmNum_(meta.conLai || r[5]),
          gia: dmNum_(r[6]),
          thanhTien: ttien
        });
      });

      var thanhToanList = ttRows.filter(function(r) { return dmText_(r[2]) === tenGV; }).map(function(r) {
        var ghiChu = dmText_(r[6]);
        var maNhap = dmText_(r[7]);
        if (maNhap && group[maNhap]) {
          group[maNhap].items.push({
            loai: "Thanh Toán",
            tenVai: ghiChu || "Thanh toán",
            soCay: "", kgMet: "", khauHao: "", conLai: "", gia: "",
            thanhTien: -Math.abs(dmNum_(r[3]))
          });
          group[maNhap].tongTien -= Math.abs(dmNum_(r[3]));
        }
        return { maTT: dmText_(r[0]), ngay: dmDateISOFromValue_(r[1]), nhaVai: dmText_(r[2]), soTien: dmNum_(r[3]), ghiChu: ghiChu, nguoiTra: dmText_(r[5]) };
      });

      return outJson_({ noHienTai: noHienTai, nhap: Object.keys(group).map(function(k) { return group[k]; }), thanhToan: thanhToanList });
    }

    /*************** DÂY KÉO ***************/
    if (type === "getDayKeoDanhMuc") {
      return outJson_(dmGetDanhMucTheoNhom_("Dây kéo", "tbl_DayKeo_Nhap"));
    }

    if (type === "saveLoaiDayKeo") {
      dmSaveDanhMucPhuLieu_(dmText_(data.ten), "Dây kéo", dmNum_(data.gia), dmDateISOFromValue_(data.ngay));
      return outText_("OK");
    }

    if (type === "saveNhapDayKeo") {
      var shDK = getSheet_("PHU_LIEU", "tbl_DayKeo_Nhap");
      var maDK = "DK" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");
      (data.details || []).forEach(function(item) {
        shDK.appendRow([maDK, dmDateISOFromValue_(data.ngay), "", dmText_(item.tenSP), "", "", dmNum_(item.soLuong), dmNum_(item.donGia), dmNum_(item.thanhTien), "Nhập bởi " + dmText_(data.nguoiNhap || "app")]);
      });
      SpreadsheetApp.flush();
      return outText_("OK");
    }

    if (type === "getDayKeoReportFull") {
      // Giữ API cũ nhưng dùng cùng một nguồn chuẩn với giao diện công nợ mới.
      var ledgerDK = dmGetDayKeoGiaoDichNew_();
      var nhapDK = [];
      var payDK = [];
      ledgerDK.forEach(function(r) {
        var loai = dmText_(r[2]);
        if (loai === "Mua hàng") {
          nhapDK.push([r[0], r[1], r[7], r[8], r[9], r[3], r[4]]);
        } else if (loai === "Trừ Nợ" || loai === "Ứng") {
          payDK.push([r[0], r[1], r[3], r[4], r[5], loai, r[6]]);
        }
      });
      return outJson_({ nhap: nhapDK, thanhToan: payDK });
    }

    if (type === "saveThanhToanDayKeo") {
      var shDKPay = getSheet_("PHU_LIEU", "tbl_DayKeo_Nhap");
      var maDKPay = "TTDK" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");
      var tienDKPay = dmNum_(data.soTien);
      shDKPay.appendRow([maDKPay, dmDateISOFromValue_(data.ngay), dmText_(data.nguoiTra || "app"), "__THANH_TOAN__", "", "", 0, 0, -Math.abs(tienDKPay), dmText_(data.ghiChu)]);
      SpreadsheetApp.flush();
      return outText_("OK");
    }

    // AZ_DKCN_V1: API riêng cho giao diện Công nợ Dây kéo theo tháng.
    // Không dùng chung tên hàm/API với In - Nhãn Size.
    if (type === "getDayKeoGiaoDichNew") {
      return outJson_(dmGetDayKeoGiaoDichNew_());
    }

    if (type === "saveThanhToanDayKeoNew") {
      return dmSaveDayKeoCongNoRow_("Trừ Nợ", data);
    }

    if (type === "saveUngDayKeo") {
      return dmSaveDayKeoCongNoRow_("Ứng", data);
    }

    /*************** THÊU ***************/
    if (type === "saveNhapTheu") {
      var shTheu = getSheet_("PHU_LIEU", "tbl_Theu_ChotTien");
      var mpTheu = dmMonthParts_(data.thang);
      var maTheu = "CTH" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");
      var tienTheu = dmNum_(data.tien);
      shTheu.appendRow([maTheu, mpTheu.thang, mpTheu.nam, "Xưởng thêu", tienTheu, 0, tienTheu, "Còn nợ", "Chốt tháng " + mpTheu.ym + " bởi " + dmText_(data.nguoiNhap || "app")]);
      SpreadsheetApp.flush();
      return outText_("OK");
    }

    if (type === "getBaoCaoTheuFull") {
      var shTheuR = getSheet_("PHU_LIEU", "tbl_Theu_ChotTien");
      var rowsTheu = shTheuR.getDataRange().getValues();
      rowsTheu.shift();
      var nhapTheu = [];
      var ttTheu = [];
      rowsTheu.forEach(function(r) {
        var ma = dmText_(r[0]);
        var ym = dmText_(r[2]) + "-" + String(r[1]).padStart(2, "0");
        if (ma.indexOf("TTTH") === 0 || dmText_(r[7]) === "Thanh toán") {
          ttTheu.push([ma, dmExtractNgayFromNote_(r[8]) || (ym + "-01"), Math.abs(dmNum_(r[5])), dmText_(r[8]), dmText_(r[3])]);
        } else {
          nhapTheu.push([ma, ym, dmNum_(r[4]), dmText_(r[3]), dmText_(r[8])]);
          if (dmNum_(r[5]) > 0) ttTheu.push([ma + "-PAY", ym + "-01", dmNum_(r[5]), "Đã thanh toán trong dòng chốt", dmText_(r[3])]);
        }
      });
      return outJson_({ nhap: nhapTheu, thanhToan: ttTheu });
    }

    if (type === "saveThanhToanTheu") {
      var shTheuPay = getSheet_("PHU_LIEU", "tbl_Theu_ChotTien");
      var ngayTheuPay = dmDateISOFromValue_(data.ngay) || dmTodayISO_();
      var mpTheuPay = dmMonthParts_(ngayTheuPay);
      var maTheuPay = "TTTH" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");
      var tienTheuPay = dmNum_(data.soTien);
      shTheuPay.appendRow([maTheuPay, mpTheuPay.thang, mpTheuPay.nam, "Thanh toán thêu", 0, tienTheuPay, -tienTheuPay, "Thanh toán", "Ngay:" + ngayTheuPay + " | " + dmText_(data.ghiChu) + " | " + dmText_(data.nguoiTra || "app")]);
      SpreadsheetApp.flush();
      return outText_("OK");
    }

    // AZ_THCN_V1: API mới cho giao diện Công nợ Thêu theo từng tháng.
    // Giữ nguyên API cũ ở trên để dữ liệu/chức năng cũ không bị ảnh hưởng.
    if (type === "getTheuGiaoDichNew") {
      return outJson_(dmGetTheuGiaoDichNew_());
    }

    if (type === "saveThanhToanTheuNew") {
      return dmSaveTheuCongNoRow_("Trừ Nợ", data);
    }

    if (type === "saveUngTheu") {
      return dmSaveTheuCongNoRow_("Ứng", data);
    }

    /*************** NHẬT - IN / TÙNG - IN ***************/
    if (type === "getInNhanDanhMuc") {
      return outJson_(dmGetInPartnerDanhMuc_(dmInPartnerSheet_(data.doiTac)));
    }

    if (type === "saveLoaiInNhan") {
      return dmSaveInPartnerDanhMuc_(dmInPartnerSheet_(data.doiTac), data);
    }

    if (type === "saveNhapInNhan") {
      var bundleINNhap = dmInPartnerSheet_(data.doiTac);
      var cfgINNhap = bundleINNhap.cfg;
      var shINNhap = bundleINNhap.sheet;
      var maINNhap = cfgINNhap.prefix + "N" +
        Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");
      var mpINNhap = dmMonthParts_(data.ngay);

      (data.details || []).forEach(function(item, idx) {
        var metaIN = JSON.stringify({
          ngay: dmDateISOFromValue_(data.ngay),
          tenSP: dmText_(item.tenSP),
          chiTiet: dmText_(item.chiTiet),
          soLuong: dmNum_(item.soLuong),
          donGia: dmNum_(item.donGia),
          nguoiNhap: dmText_(data.nguoiNhap || "app")
        });

        shINNhap.appendRow([
          maINNhap + "-" + idx,
          mpINNhap.thang,
          mpINNhap.nam,
          cfgINNhap.tenDonVi,
          "NHAP_CHI_TIET",
          dmNum_(item.thanhTien),
          "",
          0,
          dmNum_(item.thanhTien),
          "Chi tiết",
          metaIN
        ]);
      });

      SpreadsheetApp.flush();
      return outText_("OK");
    }

    if (type === "getInNhanReportFull") {
      var bundleINReport = dmInPartnerSheet_(data.doiTac);
      var shINReport = bundleINReport.sheet;
      var rowsINReport = shINReport.getDataRange().getValues();
      rowsINReport.shift();
      var nhapIN = [];
      var payIN = [];

      rowsINReport.forEach(function(r) {
        var loai = dmText_(r[4]);
        var meta = dmSafeParse_(r[10], {});

        if (loai === "NHAP_CHI_TIET") {
          nhapIN.push([
            dmText_(r[0]),
            meta.ngay || (dmText_(r[2]) + "-" + String(r[1]).padStart(2, "0") + "-01"),
            meta.tenSP || loai,
            meta.chiTiet || "",
            meta.soLuong || 0,
            meta.donGia || 0,
            dmNum_(r[5]),
            meta.nguoiNhap || ""
          ]);
        }

        if (loai === "Trừ Nợ") {
          payIN.push([
            dmText_(r[0]),
            dmExtractNgayFromNote_(r[10]) ||
              (dmText_(r[2]) + "-" + String(r[1]).padStart(2, "0") + "-01"),
            dmNum_(r[5]),
            dmText_(r[10]),
            dmText_(r[3])
          ]);
        }
      });

      return outJson_({ nhap: nhapIN, thanhToan: payIN });
    }

    if (type === "saveThanhToanInNhan") {
      return dmSaveInNhanPayRow_("Trừ Nợ", data);
    }

    if (type === "getInNhanGiaoDich") {
      var bundleINGD = dmInPartnerSheet_(data.doiTac);
      var cfgINGD = bundleINGD.cfg;
      var shINGD = bundleINGD.sheet;
      var rowsINGD = shINGD.getDataRange().getValues();
      rowsINGD.shift();
      var gdIN = [];

      rowsINGD.forEach(function(r) {
        var ma = dmText_(r[0]);
        var loaiGD = dmText_(r[4]);

        if (!ma || loaiGD === "NHAP_CHI_TIET" || loaiGD === "GIA_DANH_MUC") return;

        var ym = dmText_(r[2]) + "-" + String(r[1]).padStart(2, "0");
        var ngayGD = dmExtractNgayFromNote_(r[10]) || (ym + "-01");
        var fileUrl = dmText_(r[6]);
        var loaiHienThi = loaiGD === "Chốt" ? "Chốt" : loaiGD;

        gdIN.push([
          ma,
          ngayGD,
          loaiHienThi,
          dmNum_(r[5]),
          dmText_(r[10]),
          dmText_(r[3]) || cfgINGD.label,
          ym,
          fileUrl ? "File PDF" : "",
          fileUrl
        ]);
      });

      return outJson_(gdIN);
    }

    if (type === "saveChotInNhan") {
      var bundleChotIN = dmInPartnerSheet_(data.doiTac);
      var cfgChotIN = bundleChotIN.cfg;
      var shChotIN = bundleChotIN.sheet;
      var mpChotIN = dmMonthParts_(data.thangChot);
      var tienChotIN = dmNum_(data.soTien);

      if (!data.thangChot) throw new Error("Chưa chọn tháng chốt.");
      if (tienChotIN <= 0) throw new Error("Số tiền chốt phải lớn hơn 0.");

      var fileUrl = "";
      var fileName = dmText_(data.fileName);

      if (data.fileBase64 && fileName) {
        var folderIN = dmInPartnerFolder_(cfgChotIN);
        var base64 = String(data.fileBase64).split(",")[1] || "";
        var bytes = Utilities.base64Decode(base64);
        var blob = Utilities.newBlob(
          bytes,
          dmText_(data.mimeType) || "application/pdf",
          fileName
        );
        var file = folderIN.createFile(blob);
        try {
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (eShareIN) {}
        fileUrl = file.getUrl();
      }

      var maChotIN = cfgChotIN.prefix + "C" +
        Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") +
        Math.floor(Math.random() * 100);

      var actorIN = dmText_(data.nguoiThaoTac || "app");
      var noteIN = dmText_(data.ghiChu);
      if (fileName) noteIN += (noteIN ? " | " : "") + "File:" + fileName;
      noteIN += (noteIN ? " | " : "") + "Nguoi:" + actorIN;

      shChotIN.appendRow([
        maChotIN,
        mpChotIN.thang,
        mpChotIN.nam,
        cfgChotIN.tenDonVi,
        "Chốt",
        tienChotIN,
        fileUrl,
        0,
        tienChotIN,
        "Còn nợ",
        noteIN
      ]);

      SpreadsheetApp.flush();
      return outText_("OK");
    }

    if (type === "saveThanhToanInNhanNew") {
      return dmSaveInNhanPayRow_("Trừ Nợ", data);
    }

    if (type === "saveUngInNhan") {
      return dmSaveInNhanPayRow_("Ứng", data);
    }

    return null;
  } catch (err) {
    return outText_("Lỗi Phụ liệu data mới: " + err.message);
  }
}

function dmSaveDanhMucPhuLieu_(ten, nhom, gia, ngay) {
  var shDM = getSheet_("PHU_LIEU", "tbl_PhuLieu_DanhMuc");
  var ma = "PL" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + Math.floor(Math.random() * 100);
  shDM.appendRow([ma, ten, nhom, "cái", "", "", "Gia:" + dmNum_(gia) + ";Ngay:" + (ngay || dmTodayISO_())]);
  SpreadsheetApp.flush();
}

function dmGetDanhMucTheoNhom_(nhom, sheetGiaoDichName) {
  var result = [];
  var today = dmTodayISO_();

  try {
    var shDM = getSheet_("PHU_LIEU", "tbl_PhuLieu_DanhMuc");
    var rowsDM = shDM.getDataRange().getValues();
    rowsDM.shift();
    rowsDM.forEach(function(r) {
      var n = dmText_(r[2]);
      var ten = dmText_(r[1]);
      if (!ten) return;
      if (n.toLowerCase().indexOf(nhom.toLowerCase().split(" ")[0]) === -1 && nhom !== "In - Nhãn") return;
      var note = dmText_(r[6]);
      var gia = 0;
      var ngay = today;
      var mg = note.match(/Gia\s*:\s*([\d.,-]+)/i);
      var mn = note.match(/Ngay\s*:\s*([^;|]+)/i);
      if (mg) gia = dmNum_(mg[1]);
      if (mn) ngay = dmDateISOFromValue_(mn[1]);
      result.push([ten, gia, ngay]);
    });
  } catch (e1) {}

  try {
    if (sheetGiaoDichName === "tbl_DayKeo_Nhap") {
      var shDK = getSheet_("PHU_LIEU", "tbl_DayKeo_Nhap");
      var rowsDK = shDK.getDataRange().getValues();
      rowsDK.shift();
      rowsDK.forEach(function(r) {
        var tenDK = dmText_(r[3]);
        if (!tenDK || /^__.*__$/.test(tenDK)) return;
        result.push([tenDK, dmNum_(r[7]), dmDateISOFromValue_(r[1]) || today]);
      });
    }

    if (
      sheetGiaoDichName === "tbl_InNhan_ChotTien" ||
      sheetGiaoDichName === "tbl_NhatIn_GiaoDich" ||
      sheetGiaoDichName === "tbl_TungIn_GiaoDich"
    ) {
      var shIN = getSheet_("PHU_LIEU", sheetGiaoDichName);
      var rowsIN = shIN.getDataRange().getValues();
      rowsIN.shift();
      rowsIN.forEach(function(r) {
        var loai = dmText_(r[4]);
        if (loai === "NHAP_CHI_TIET") {
          var meta = dmSafeParse_(r[10], {});
          if (meta.tenSP) result.push([meta.tenSP, dmNum_(meta.donGia), meta.ngay || today]);
        }
        if (loai === "Chốt") result.push(["In/Nhãn size", 0, today]);
      });
    }
  } catch (e2) {}

  var seen = {};
  return result.filter(function(r) {
    var key = dmText_(r[0]).toLowerCase() + "|" + dmNum_(r[1]) + "|" + dmText_(r[2]);
    if (seen[key]) return false;
    seen[key] = true;
    return dmText_(r[0]);
  });
}

function dmExtractNgayFromNote_(note) {
  var s = dmText_(note);
  var m = s.match(/Ngay\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : "";
}

/****************************************************
 * AZ_DKCN_V1 - CÔNG NỢ DÂY KÉO THEO THÁNG
 * - Dùng nguyên tbl_DayKeo_Nhap, không tạo sheet mới.
 * - Mua hàng: dòng nhập hiện hữu.
 * - Thanh toán: marker __THANH_TOAN__.
 * - Ứng tiền: marker __UNG__.
 * - Tháng đích được lưu trong GhiChu: Thang:yyyy-MM.
 ****************************************************/
function dmDayKeoMonthKey_(value) {
  if (!value) return "";
  if (value instanceof Date) return Utilities.formatDate(value, "GMT+7", "yyyy-MM");

  var s = dmText_(value);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 7);

  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, "GMT+7", "yyyy-MM");
  return "";
}

function dmDayKeoToken_(note, key) {
  var re = new RegExp("(?:^|\\|)\\s*" + key + "\\s*:\\s*([^|]+)", "i");
  var m = dmText_(note).match(re);
  return m ? dmText_(m[1]) : "";
}

function dmDayKeoCleanNote_(note) {
  var s = dmText_(note)
    .replace(/(?:^|\|)\s*Thang\s*:\s*[^|]+/ig, "")
    .replace(/(?:^|\|)\s*Ngay\s*:\s*[^|]+/ig, "")
    .replace(/^\s*\|+|\|+\s*$/g, "")
    .replace(/\s*\|\s*\|\s*/g, " | ")
    .trim();
  return s;
}

function dmDayKeoNhapActor_(note, fallback) {
  var s = dmText_(note);
  var m = s.match(/Nhập\s*bởi\s*(.+)$/i);
  return m ? dmText_(m[1]) : dmText_(fallback);
}

function dmGetDayKeoGiaoDichNew_() {
  var sh = getSheet_("PHU_LIEU", "tbl_DayKeo_Nhap");
  var rows = sh.getDataRange().getValues();
  if (rows.length) rows.shift();

  var out = [];
  var seenPaymentIds = {};

  rows.forEach(function(r) {
    var ma = dmText_(r[0]);
    if (!ma) return;

    var ngay = dmDateISOFromValue_(r[1]);
    var marker = dmText_(r[3]);
    var isSpecial = marker === "__THANH_TOAN__" || marker === "__UNG__";

    if (isSpecial) {
      var noteRaw = dmText_(r[9]);
      var ymPay = dmDayKeoMonthKey_(dmDayKeoToken_(noteRaw, "Thang")) || dmDayKeoMonthKey_(ngay);
      var loaiPay = marker === "__UNG__" ? "Ứng" : "Trừ Nợ";
      var tienPay = Math.abs(dmNum_(r[8]));
      if (tienPay <= 0) return;

      out.push([
        ma,
        ngay,
        loaiPay,
        tienPay,
        dmDayKeoCleanNote_(noteRaw),
        dmText_(r[2]),
        ymPay,
        "",
        0,
        0
      ]);
      seenPaymentIds[ma] = true;
      return;
    }

    // Schema mới A:J: Ma, Ngay, Nguoi/blank, Ten, blank, blank, SL, Gia, ThanhTien, GhiChu.
    // Hỗ trợ luôn dữ liệu cũ A:G để không mất lịch sử.
    var isNewSchema =
      dmNum_(r[8]) !== 0 ||
      dmNum_(r[7]) !== 0 ||
      (dmNum_(r[6]) !== 0 && !dmText_(r[2]));
    var tenSP = isNewSchema ? dmText_(r[3]) : dmText_(r[2]);
    var soLuong = isNewSchema ? dmNum_(r[6]) : dmNum_(r[3]);
    var donGia = isNewSchema ? dmNum_(r[7]) : dmNum_(r[4]);
    var thanhTien = Math.abs(isNewSchema ? dmNum_(r[8]) : dmNum_(r[5]));
    var noteNhap = isNewSchema ? dmText_(r[9]) : "";
    var nguoiNhap = isNewSchema ? dmDayKeoNhapActor_(noteNhap, r[2]) : dmText_(r[6]);
    var ymNhap = dmDayKeoMonthKey_(ngay);

    if (!tenSP || thanhTien <= 0 || !ymNhap) return;
    out.push([ma, ngay, "Mua hàng", thanhTien, noteNhap, nguoiNhap, ymNhap, tenSP, soLuong, donGia]);
  });

  // Bổ sung thanh toán legacy nếu còn sheet cũ, nhưng không cộng trùng mã đã hợp nhất.
  try {
    var legacy = getSS_("PHU_LIEU").getSheetByName("tbl_DayKeo_ThanhToan");
    if (legacy && legacy.getLastRow() >= 2) {
      var legacyRows = legacy.getRange(2, 1, legacy.getLastRow() - 1, legacy.getLastColumn()).getValues();
      legacyRows.forEach(function(r) {
        var ma = dmText_(r[0]);
        if (!ma || seenPaymentIds[ma]) return;
        var ngay = dmDateISOFromValue_(r[1]);
        var tien = Math.abs(dmNum_(r[2]));
        if (tien <= 0) return;
        out.push([ma, ngay, "Trừ Nợ", tien, dmText_(r[3]), dmText_(r[4]), dmDayKeoMonthKey_(ngay), "", 0, 0]);
      });
    }
  } catch (legacyErr) {}

  out.sort(function(a, b) {
    var da = new Date(a[1]).getTime() || 0;
    var db = new Date(b[1]).getTime() || 0;
    return db - da;
  });
  return out;
}

function dmDayKeoBalanceMonth_(month) {
  var rows = dmGetDayKeoGiaoDichNew_();
  var buy = 0;
  var paid = 0;
  rows.forEach(function(r) {
    if (dmDayKeoMonthKey_(r[6]) !== month) return;
    var type = dmText_(r[2]);
    var amount = Math.abs(dmNum_(r[3]));
    if (type === "Mua hàng") buy += amount;
    if (type === "Trừ Nợ" || type === "Ứng") paid += amount;
  });
  return buy - paid;
}

function dmSaveDayKeoCongNoRow_(type, data) {
  var month = dmDayKeoMonthKey_(data.thangChot);
  var date = dmDateISOFromValue_(data.ngay) || dmTodayISO_();
  var amount = Math.abs(dmNum_(data.soTien));
  var actor = dmText_(data.nguoiThaoTac || data.nguoiTra || "app");
  var note = dmText_(data.ghiChu);

  if (!month) return outText_("Lỗi: Chưa chọn tháng giao dịch");
  if (amount <= 0) return outText_("Lỗi: Số tiền không hợp lệ");

  if (type === "Trừ Nợ") {
    var remaining = dmDayKeoBalanceMonth_(month);
    if (remaining <= 1) return outText_("Lỗi: Tháng này không còn công nợ để thanh toán");
    if (amount - remaining > 1) return outText_("Lỗi: Số tiền thanh toán lớn hơn số còn lại của tháng");
  }

  var marker = type === "Ứng" ? "__UNG__" : "__THANH_TOAN__";
  var prefix = type === "Ứng" ? "UNGDK" : "TTDK";
  var id = prefix + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + Math.floor(Math.random() * 100);
  var storedNote = "Thang:" + month + " | Ngay:" + date + (note ? " | " + note : "");

  var sh = getSheet_("PHU_LIEU", "tbl_DayKeo_Nhap");
  sh.appendRow([id, date, actor, marker, "", "", 0, 0, -amount, storedNote]);
  SpreadsheetApp.flush();
  return outText_("OK");
}


/****************************************************
 * AZ_THCN_V1 - CÔNG NỢ THÊU THEO THÁNG
 * - Dùng nguyên tbl_Theu_ChotTien, không tạo sheet mới.
 * - Chốt tháng: dòng hiện hữu có tiền ở cột E.
 * - Thanh toán: dòng trạng thái "Thanh toán".
 * - Ứng tiền: dòng trạng thái "Ứng".
 * - Tháng đích của giao dịch mới được lưu trong GhiChu:
 *   Thang:yyyy-MM | Ngay:yyyy-MM-dd | Nguoi:<tên>
 ****************************************************/
function dmTheuMonthKey_(value) {
  if (!value) return "";
  if (value instanceof Date) return Utilities.formatDate(value, "GMT+7", "yyyy-MM");

  var s = dmText_(value);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 7);
  if (/^\d{2}\/\d{4}$/.test(s)) {
    var p0 = s.split("/");
    return p0[1] + "-" + String(p0[0]).padStart(2, "0");
  }

  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, "GMT+7", "yyyy-MM");
  return "";
}

function dmTheuMonthFromCols_(thang, nam) {
  var m = parseInt(dmText_(thang), 10);
  var y = parseInt(dmText_(nam), 10);
  if (y > 1900 && m >= 1 && m <= 12) {
    return String(y) + "-" + String(m).padStart(2, "0");
  }

  var combined = dmText_(nam) + "-" + String(dmText_(thang)).padStart(2, "0");
  return dmTheuMonthKey_(combined);
}

function dmTheuToken_(note, key) {
  var re = new RegExp("(?:^|\\|)\\s*" + key + "\\s*:\\s*([^|]+)", "i");
  var m = dmText_(note).match(re);
  return m ? dmText_(m[1]) : "";
}

function dmTheuCleanNote_(note) {
  return dmText_(note)
    .replace(/(?:^|\|)\s*Thang\s*:\s*[^|]+/ig, "")
    .replace(/(?:^|\|)\s*Ngay\s*:\s*[^|]+/ig, "")
    .replace(/(?:^|\|)\s*Nguoi\s*:\s*[^|]+/ig, "")
    .replace(/^\s*\|+|\|+\s*$/g, "")
    .replace(/\s*\|\s*\|\s*/g, " | ")
    .trim();
}

function dmTheuActor_(note, fallback) {
  var s = dmText_(note);
  var byToken = dmTheuToken_(s, "Nguoi");
  if (byToken) return byToken;

  var byMatch = s.match(/bởi\s+([^|]+)$/i);
  if (byMatch && dmText_(byMatch[1])) return dmText_(byMatch[1]);

  // Hỗ trợ ghi chú thanh toán cũ: Ngay:... | Ghi chú | Tên người.
  var parts = s.split("|").map(function(x) { return dmText_(x); }).filter(function(x) { return !!x; });
  if (parts.length >= 3) {
    var last = parts[parts.length - 1];
    if (!/^(Thang|Ngay|Nguoi)\s*:/i.test(last)) return last;
  }

  return dmText_(fallback);
}

function dmGetTheuGiaoDichNew_() {
  var sh = getSheet_("PHU_LIEU", "tbl_Theu_ChotTien");
  var rows = sh.getDataRange().getValues();
  if (rows.length) rows.shift();

  var out = [];

  rows.forEach(function(r) {
    var ma = dmText_(r[0]);
    if (!ma) return;

    var noteRaw = dmText_(r[8]);
    var monthCols = dmTheuMonthFromCols_(r[1], r[2]);
    var month = dmTheuMonthKey_(dmTheuToken_(noteRaw, "Thang")) || monthCols;
    if (!month) return;

    var ngay = dmDateISOFromValue_(dmTheuToken_(noteRaw, "Ngay")) || (month + "-01");
    var tenXuong = dmText_(r[3]) || "Xưởng thêu";
    var status = dmText_(r[7]);
    var statusKey = status.toLowerCase();
    var tenKey = tenXuong.toLowerCase();
    var maKey = ma.toUpperCase();

    var tienChot = Math.abs(dmNum_(r[4]));
    var tienDaTra = Math.abs(dmNum_(r[5]));
    var conLai = dmNum_(r[6]);
    var isAdvance =
      statusKey.indexOf("ứng") !== -1 ||
      statusKey.indexOf("ung") !== -1 ||
      tenKey.indexOf("ứng") !== -1 ||
      tenKey.indexOf("ung") !== -1 ||
      maKey.indexOf("UNGTH") === 0;
    var isPayment =
      !isAdvance && (
        statusKey.indexOf("thanh toán") !== -1 ||
        statusKey.indexOf("thanh toan") !== -1 ||
        statusKey.indexOf("trừ nợ") !== -1 ||
        statusKey.indexOf("tru no") !== -1 ||
        tenKey.indexOf("thanh toán") !== -1 ||
        tenKey.indexOf("thanh toan") !== -1 ||
        maKey.indexOf("TTTH") === 0
      );

    var actor = dmTheuActor_(noteRaw, tenXuong);
    var cleanNote = dmTheuCleanNote_(noteRaw);

    if (isAdvance || isPayment) {
      var money = tienDaTra || Math.abs(conLai) || tienChot;
      if (money <= 0) return;

      out.push([
        ma,
        ngay,
        isAdvance ? "Ứng" : "Trừ Nợ",
        money,
        cleanNote,
        actor,
        month,
        "Xưởng thêu",
        0,
        0
      ]);
      return;
    }

    if (tienChot > 0) {
      out.push([
        ma,
        ngay,
        "Chốt",
        tienChot,
        cleanNote,
        actor,
        month,
        tenXuong,
        0,
        0
      ]);
    }

    if (tienDaTra > 0) {
      out.push([
        ma + "-PAY",
        ngay,
        "Trừ Nợ",
        tienDaTra,
        "Đã thanh toán trong dòng chốt",
        actor,
        month,
        tenXuong,
        0,
        0
      ]);
    }
  });

  out.sort(function(a, b) {
    var da = new Date(a[1]).getTime() || 0;
    var db = new Date(b[1]).getTime() || 0;
    return db - da;
  });

  return out;
}

function dmTheuBalanceMonth_(month) {
  var rows = dmGetTheuGiaoDichNew_();
  var totalChot = 0;
  var totalPaid = 0;

  rows.forEach(function(r) {
    if (dmTheuMonthKey_(r[6]) !== month) return;
    var type = dmText_(r[2]);
    var amount = Math.abs(dmNum_(r[3]));

    if (type === "Chốt") totalChot += amount;
    if (type === "Trừ Nợ" || type === "Ứng") totalPaid += amount;
  });

  return totalChot - totalPaid;
}

function dmSaveTheuCongNoRow_(type, data) {
  var month = dmTheuMonthKey_(data.thangChot);
  var date = dmDateISOFromValue_(data.ngay) || dmTodayISO_();
  var amount = Math.abs(dmNum_(data.soTien));
  var actor = dmText_(data.nguoiThaoTac || data.nguoiTra || "app");
  var note = dmText_(data.ghiChu);

  if (!month) return outText_("Lỗi: Chưa chọn tháng giao dịch");
  if (amount <= 0) return outText_("Lỗi: Số tiền không hợp lệ");

  if (type === "Trừ Nợ") {
    var remaining = dmTheuBalanceMonth_(month);
    if (remaining <= 1) return outText_("Lỗi: Tháng này không còn công nợ để thanh toán");
    if (amount - remaining > 1) return outText_("Lỗi: Số tiền thanh toán lớn hơn số còn lại của tháng");
  }

  var mp = dmMonthParts_(month);
  var isAdvance = type === "Ứng";
  var prefix = isAdvance ? "UNGTH" : "TTTHN";
  var id = prefix + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + Math.floor(Math.random() * 100);
  var status = isAdvance ? "Ứng" : "Thanh toán";
  var storedNote =
    "Thang:" + month +
    " | Ngay:" + date +
    " | Nguoi:" + actor +
    (note ? " | " + note : "");

  var sh = getSheet_("PHU_LIEU", "tbl_Theu_ChotTien");
  sh.appendRow([
    id,
    mp.thang,
    mp.nam,
    "Xưởng thêu",
    0,
    amount,
    -amount,
    status,
    storedNote
  ]);

  SpreadsheetApp.flush();
  return outText_("OK");
}


function dmSaveInNhanPayRow_(loai, data) {
  var bundle = dmInPartnerSheet_(data && data.doiTac);
  var cfg = bundle.cfg;
  var sh = bundle.sheet;
  var mp = dmMonthParts_(data.thangChot || data.ngay || new Date());
  var ngay = dmDateISOFromValue_(data.ngay) || dmTodayISO_();
  var tien = dmNum_(data.soTien);

  if (tien <= 0) {
    throw new Error("Số tiền phải lớn hơn 0.");
  }

  var isAdvance = loai === "Ứng";

  // Thanh toán phải bám đúng công nợ còn lại của tháng trên chính sheet đối tác.
  if (!isAdvance) {
    var rows = sh.getDataRange().getValues();
    var conLaiThang = 0;

    for (var i = 1; i < rows.length; i++) {
      if (
        dmNum_(rows[i][1]) !== dmNum_(mp.thang) ||
        dmNum_(rows[i][2]) !== dmNum_(mp.nam)
      ) continue;

      var rowType = dmText_(rows[i][4]);
      var rowAmount = dmNum_(rows[i][5]);

      if (rowType === "Chốt") conLaiThang += rowAmount;
      if (rowType === "Trừ Nợ" || rowType === "Ứng") conLaiThang -= rowAmount;
    }

    conLaiThang = Math.max(conLaiThang, 0);
    if (tien > conLaiThang + 1) {
      throw new Error(
        "Số tiền thanh toán vượt công nợ còn lại của " +
        cfg.label + " trong tháng này."
      );
    }
  }

  var prefix = isAdvance ? cfg.prefix + "U" : cfg.prefix + "T";
  var ma = prefix +
    Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") +
    Math.floor(Math.random() * 100);

  var actor = dmText_(data.nguoiThaoTac || data.nguoiTra || "app");
  var storedNote =
    "Thang:" + mp.nam + "-" + String(mp.thang).padStart(2, "0") +
    " | Ngay:" + ngay +
    " | Nguoi:" + actor +
    (dmText_(data.ghiChu) ? " | " + dmText_(data.ghiChu) : "");

  sh.appendRow([
    ma,
    mp.thang,
    mp.nam,
    cfg.tenDonVi,
    loai,
    tien,
    "",
    tien,
    -tien,
    isAdvance ? "Ứng" : "Thanh toán",
    storedNote
  ]);

  SpreadsheetApp.flush();
  return outText_("OK");
}


/****************************************************
 * KHO THÀNH PHẨM - GỢI Ý SẢN XUẤT / CẦN CẮT THÊM PHẦN 20
 * - Chỉ đọc dữ liệu tồn kho + bán hàng
 * - Không cộng/trừ tồn
 ****************************************************/
function khoGYSXParseDate_(v) {
  if (!v) return null;
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  var s = String(v || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    var p = s.substring(0, 10).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  var d = new Date(s);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return null;
}

function khoGYSXBadStatus_(s) {
  s = khoText_(s).toLowerCase();
  return s.indexOf("xóa") !== -1 || s.indexOf("xoá") !== -1 || s.indexOf("hủy") !== -1 || s.indexOf("huỷ") !== -1;
}

function khoGYSXParseFromMaBH_(maBH) {
  var parts = khoText_(maBH).split("-").filter(function(x) { return x; });
  return {
    maRap: parts[0] || "",
    hieu: parts[1] || "",
    mau: parts.slice(2).join("-") || ""
  };
}

function khoGetGoiYSanXuat_(data) {
  data = data || {};
  var q = khoText_(data.q).toLowerCase();
  var limit = khoNum_(data.limit || 80);
  if (limit <= 0) limit = 80;
  if (limit > 200) limit = 200;

  var nguongSize = khoNum_(data.nguongSize || 40);       // size <= ngưỡng này xem là thiếu
  var mucTieuSize = khoNum_(data.mucTieuSize || 80);     // cần cắt lên tới mức này
  var nguongMau = khoNum_(data.nguongMau || 150);        // tổng màu <= ngưỡng này xem là thấp
  var banManh = khoNum_(data.banManh || 30);             // bán >= ngưỡng này xem là bán mạnh
  var banCham = khoNum_(data.banCham || 5);              // bán <= ngưỡng này xem là chậm
  var tonNhieu = khoNum_(data.tonNhieu || 150);          // khả dụng >= ngưỡng này mà bán chậm thì hạn chế

  var today = new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  var from = khoGYSXParseDate_(data.from);
  var to = khoGYSXParseDate_(data.to);
  if (!to) to = today;
  if (!from) {
    from = new Date(to.getTime());
    from.setDate(from.getDate() - 30);
  }
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  function fmtDate_(d) {
    return Utilities.formatDate(d, "GMT+7", "dd/MM/yyyy");
  }

  function norm_(x) {
    return khoText_(x).toLowerCase();
  }

  var hhMap = {};
  try {
    var shHH = getSheet_("KHO", "tbl_Kho_HangHoa");
    var hh = shHH.getDataRange().getValues();
    for (var ihh = 1; ihh < hh.length; ihh++) {
      var maSP = khoText_(hh[ihh][0]);
      if (!maSP) continue;
      hhMap[maSP] = {
        maSP: maSP,
        maRap: khoText_(hh[ihh][1]),
        mauSanPham: khoText_(hh[ihh][2]),
        hieu: khoText_(hh[ihh][3]),
        tenSP: khoText_(hh[ihh][4])
      };
    }
  } catch (eHH) {}

  var btByNB = {};
  var btByBH = {};
  try {
    var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
    var bt = shBT.getDataRange().getValues();
    for (var ibt = 1; ibt < bt.length; ibt++) {
      var maNB = khoText_(bt[ibt][0]);
      var maBH = khoText_(bt[ibt][1]);
      var maSPbt = khoText_(bt[ibt][2]);
      var hhInfo = hhMap[maSPbt] || {};
      var info = {
        maHangNoiBo: maNB,
        maBanHang: maBH,
        maSP: maSPbt,
        maRap: khoText_(bt[ibt][3] || hhInfo.maRap),
        mauSanPham: khoText_(bt[ibt][4] || hhInfo.mauSanPham),
        hieu: khoText_(bt[ibt][5] || hhInfo.hieu),
        mau: khoText_(bt[ibt][6]),
        size: khoText_(bt[ibt][7]),
        tenSP: khoText_(hhInfo.tenSP || bt[ibt][8] || bt[ibt][4])
      };
      if (maNB) btByNB[maNB] = info;
      if (maBH && !btByBH[maBH]) btByBH[maBH] = info;
    }
  } catch (eBT) {}

  var tenMap = {};
  try {
    var shCTTen = getSheet_("SALES", "tbl_ChiTietDonHang");
    var ctTen = shCTTen.getDataRange().getValues();
    for (var iten = 1; iten < ctTen.length; iten++) {
      var tenBH = khoText_(ctTen[iten][2]);
      var maBHten = khoText_(ctTen[iten][6]);
      var maNBten = khoText_(ctTen[iten][7]);
      if (maBHten && tenBH && !tenMap[maBHten]) tenMap[maBHten] = tenBH;
      if (maNBten && tenBH && !tenMap[maNBten]) tenMap[maNBten] = tenBH;
    }
  } catch (eTen) {}

  var groupMap = {};
  function ensureGroup_(info) {
    info = info || {};
    var maBH = khoText_(info.maBanHang || info.maHangNoiBo || "KHONG_RO");
    var parsed = khoGYSXParseFromMaBH_(maBH);
    var btInfo = btByBH[maBH] || btByNB[khoText_(info.maHangNoiBo)] || {};
    if (!groupMap[maBH]) {
      groupMap[maBH] = {
        maBanHang: maBH,
        maRap: khoText_(info.maRap || btInfo.maRap || parsed.maRap),
        hieu: khoText_(info.hieu || btInfo.hieu || parsed.hieu),
        mau: khoText_(info.mau || btInfo.mau || parsed.mau),
        tenSP: khoText_(info.tenSP || tenMap[maBH] || btInfo.tenSP || btInfo.mauSanPham || parsed.maRap || maBH),
        soLuongBan: 0,
        doanhThu: 0,
        soDon: 0,
        donMap: {},
        tonThucTe: 0,
        tonGiu: 0,
        khaDung: 0,
        hangLoi: 0,
        choHoanThien: 0,
        sizes: {}
      };
    }
    var g = groupMap[maBH];
    if (!g.maRap && (info.maRap || btInfo.maRap || parsed.maRap)) g.maRap = khoText_(info.maRap || btInfo.maRap || parsed.maRap);
    if (!g.hieu && (info.hieu || btInfo.hieu || parsed.hieu)) g.hieu = khoText_(info.hieu || btInfo.hieu || parsed.hieu);
    if (!g.mau && (info.mau || btInfo.mau || parsed.mau)) g.mau = khoText_(info.mau || btInfo.mau || parsed.mau);
    if ((!g.tenSP || g.tenSP === maBH) && (info.tenSP || tenMap[maBH] || btInfo.tenSP)) g.tenSP = khoText_(info.tenSP || tenMap[maBH] || btInfo.tenSP);
    return g;
  }

  // Tồn hiện tại.
  try {
    var shTon = getSheet_("KHO", "tbl_Kho_Ton");
    var ton = shTon.getDataRange().getValues();
    for (var iton = 1; iton < ton.length; iton++) {
      var maNBton = khoText_(ton[iton][0]);
      var maBHton = khoText_(ton[iton][1]) || (btByNB[maNBton] ? btByNB[maNBton].maBanHang : maNBton);
      if (!maBHton && !maNBton) continue;
      var btTon = btByNB[maNBton] || btByBH[maBHton] || {};
      var gTon = ensureGroup_({
        maBanHang: maBHton,
        maHangNoiBo: maNBton,
        maRap: khoText_(ton[iton][4] || btTon.maRap),
        hieu: khoText_(ton[iton][5] || btTon.hieu),
        mau: khoText_(ton[iton][6] || btTon.mau),
        tenSP: btTon.tenSP
      });
      gTon.tonThucTe += khoNum_(ton[iton][8]);
      gTon.tonGiu += khoNum_(ton[iton][9]);
      gTon.khaDung += khoNum_(ton[iton][10]);
      gTon.choHoanThien += khoNum_(ton[iton][11]);
      gTon.hangLoi += khoNum_(ton[iton][13]);
      var sizeTon = khoText_(ton[iton][7] || btTon.size || "?");
      if (!gTon.sizes[sizeTon]) gTon.sizes[sizeTon] = { size: sizeTon, ban: 0, khaDung: 0, tonThucTe: 0, tonGiu: 0, hangLoi: 0, choHoanThien: 0 };
      gTon.sizes[sizeTon].khaDung += khoNum_(ton[iton][10]);
      gTon.sizes[sizeTon].tonThucTe += khoNum_(ton[iton][8]);
      gTon.sizes[sizeTon].tonGiu += khoNum_(ton[iton][9]);
      gTon.sizes[sizeTon].choHoanThien += khoNum_(ton[iton][11]);
      gTon.sizes[sizeTon].hangLoi += khoNum_(ton[iton][13]);
    }
  } catch (eTon) {}

  // Đơn hàng hợp lệ trong khoảng ngày.
  var orderMap = {};
  try {
    var shDH = getSheet_("SALES", "tbl_DonHang");
    var dh = shDH.getDataRange().getValues();
    for (var idh = 1; idh < dh.length; idh++) {
      var maHD = khoText_(dh[idh][0]);
      if (!maHD) continue;
      if (khoGYSXBadStatus_(dh[idh][6]) || khoGYSXBadStatus_(dh[idh][13])) continue;
      var dDH = khoGYSXParseDate_(dh[idh][1]);
      if (!dDH) continue;
      dDH.setHours(12, 0, 0, 0);
      if (dDH < from || dDH > to) continue;
      orderMap[maHD] = { ngay: dDH, tenKhach: khoText_(dh[idh][2]), maKH: khoText_(dh[idh][8]) };
    }
  } catch (eDH) {}

  // Bán theo size đã xuất.
  var totalQty = 0;
  try {
    var shSize = getSheet_("SALES", "tbl_DonHang_CT_Size");
    var sizeRows = shSize.getDataRange().getValues();
    for (var isz = 1; isz < sizeRows.length; isz++) {
      var maHDsz = khoText_(sizeRows[isz][0]);
      if (!orderMap[maHDsz]) continue;
      var trangThaiXuat = khoText_(sizeRows[isz][12]);
      if (trangThaiXuat !== "Đã xuất" && trangThaiXuat !== "Đã trừ tồn") continue;
      var slBan = khoNum_(sizeRows[isz][9]);
      if (slBan <= 0) continue;
      var maNBsz = khoText_(sizeRows[isz][3]);
      var maBHsz = khoText_(sizeRows[isz][2]) || (btByNB[maNBsz] ? btByNB[maNBsz].maBanHang : maNBsz);
      var btSz = btByNB[maNBsz] || btByBH[maBHsz] || {};
      var gBan = ensureGroup_({
        maBanHang: maBHsz,
        maHangNoiBo: maNBsz,
        maRap: khoText_(sizeRows[isz][5] || btSz.maRap),
        hieu: btSz.hieu,
        mau: khoText_(sizeRows[isz][6] || btSz.mau),
        tenSP: tenMap[maBHsz] || btSz.tenSP
      });
      var tienBan = khoNum_(sizeRows[isz][11]);
      if (!tienBan) tienBan = slBan * khoNum_(sizeRows[isz][10]);
      gBan.soLuongBan += slBan;
      gBan.doanhThu += tienBan;
      totalQty += slBan;
      if (!gBan.donMap[maHDsz]) {
        gBan.donMap[maHDsz] = true;
        gBan.soDon += 1;
      }
      var sizeBan = khoText_(sizeRows[isz][7] || btSz.size || "?");
      if (!gBan.sizes[sizeBan]) gBan.sizes[sizeBan] = { size: sizeBan, ban: 0, khaDung: 0, tonThucTe: 0, tonGiu: 0, hangLoi: 0, choHoanThien: 0 };
      gBan.sizes[sizeBan].ban += slBan;
    }
  } catch (eSize) {}

  var all = Object.keys(groupMap).map(function(k) {
    var g = groupMap[k];
    var sizeList = Object.keys(g.sizes).map(function(sz) {
      var s = g.sizes[sz];
      var kd = khoNum_(s.khaDung);
      var ban = khoNum_(s.ban);
      var canCat = 0;
      if (kd <= nguongSize || ban >= Math.max(1, Math.floor(banManh / 3))) {
        canCat = Math.max(0, mucTieuSize - kd);
      }
      return {
        size: s.size,
        ban: ban,
        khaDung: kd,
        tonThucTe: khoNum_(s.tonThucTe),
        tonGiu: khoNum_(s.tonGiu),
        hangLoi: khoNum_(s.hangLoi),
        choHoanThien: khoNum_(s.choHoanThien),
        canCat: canCat,
        thieu: kd <= nguongSize
      };
    }).sort(function(a, b) {
      if ((b.canCat || 0) !== (a.canCat || 0)) return (b.canCat || 0) - (a.canCat || 0);
      return String(a.size).localeCompare(String(b.size), "vi", { numeric: true });
    });

    var totalCanCat = sizeList.reduce(function(s, x) { return s + khoNum_(x.canCat); }, 0);
    var lowSizeCount = sizeList.filter(function(x) { return x.khaDung <= nguongSize; }).length;
    var isFast = g.soLuongBan >= banManh;
    var isLowColor = g.khaDung <= nguongMau;
    var isSlowOverstock = g.khaDung >= tonNhieu && g.soLuongBan <= banCham;
    var status = "THEO_DÕI";
    var actionText = "Theo dõi thêm";
    var priority = 0;

    if (isSlowOverstock) {
      status = "HAN_CHE";
      actionText = "Hạn chế sản xuất";
      priority = g.khaDung - g.soLuongBan;
    } else if (totalCanCat > 0 && (isFast || isLowColor || lowSizeCount > 0)) {
      status = "NEN_CAT";
      actionText = "Nên cắt thêm";
      priority = totalCanCat + (g.soLuongBan * 2) + Math.max(0, nguongMau - g.khaDung);
    } else if (isLowColor || g.tonGiu > 0 || (g.hangLoi + g.choHoanThien) > 0) {
      status = "THEO_DÕI";
      actionText = "Theo dõi thêm";
      priority = Math.max(0, nguongMau - g.khaDung) + g.tonGiu + g.hangLoi + g.choHoanThien;
    }

    g.sizes = sizeList;
    g.canCat = totalCanCat;
    g.lowSizeCount = lowSizeCount;
    g.status = status;
    g.actionText = actionText;
    g.priority = priority;
    g.searchText = norm_([g.maBanHang, g.maRap, g.hieu, g.mau, g.tenSP].join(" "));
    return g;
  }).filter(function(g) {
    return !q || g.searchText.indexOf(q) !== -1;
  });

  var nenCat = all.filter(function(g) { return g.status === "NEN_CAT"; }).sort(function(a, b) {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.soLuongBan - a.soLuongBan;
  }).slice(0, limit);

  var theoDoi = all.filter(function(g) { return g.status === "THEO_DÕI" && g.priority > 0; }).sort(function(a, b) {
    return b.priority - a.priority;
  }).slice(0, limit);

  var hanChe = all.filter(function(g) { return g.status === "HAN_CHE"; }).sort(function(a, b) {
    if (b.khaDung !== a.khaDung) return b.khaDung - a.khaDung;
    return a.soLuongBan - b.soLuongBan;
  }).slice(0, limit);

  return outJson_({
    ok: true,
    from: fmtDate_(from),
    to: fmtDate_(to),
    params: {
      q: q,
      nguongSize: nguongSize,
      mucTieuSize: mucTieuSize,
      nguongMau: nguongMau,
      banManh: banManh,
      banCham: banCham,
      tonNhieu: tonNhieu
    },
    summary: {
      tongMaTheoLoc: all.length,
      tongSLBan: totalQty,
      soMaNenCat: nenCat.length,
      tongCanCat: nenCat.reduce(function(s, x) { return s + khoNum_(x.canCat); }, 0),
      soMaTheoDoi: theoDoi.length,
      soMaHanChe: hanChe.length
    },
    nenCat: nenCat,
    theoDoi: theoDoi,
    hanChe: hanChe
  });
}


/****************************************************
 * KHO THÀNH PHẨM - BÁO CÁO HÀNG TỒN LÂU PHẦN 21
 * - Chỉ đọc tồn kho + thẻ kho
 * - Không cộng/trừ tồn
 ****************************************************/
function khoTonLauParseDate_(v) {
  if (!v) return null;
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  var s = String(v || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    var p = s.substring(0, 10).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  var d = new Date(s);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return null;
}

function khoTonLauDaysBetween_(fromDate, toDate) {
  if (!fromDate || !toDate) return 9999;
  var a = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate()).getTime();
  var b = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate()).getTime();
  return Math.max(0, Math.floor((b - a) / 86400000));
}

function khoTonLauFmtDate_(d) {
  if (!d) return "Chưa có";
  return Utilities.formatDate(d, "GMT+7", "dd/MM/yyyy");
}

function khoGetBaoCaoTonLau_(data) {
  data = data || {};
  var q = khoText_(data.q).toLowerCase();
  var soNgay = khoNum_(data.soNgay || 60);
  var nguongTon = khoNum_(data.nguongTon || 80);
  var limit = khoNum_(data.limit || 120);
  if (soNgay <= 0) soNgay = 60;
  if (nguongTon < 0) nguongTon = 0;
  if (limit <= 0) limit = 120;
  if (limit > 300) limit = 300;

  var today = new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  var hhMap = {};
  try {
    var shHH = getSheet_("KHO", "tbl_Kho_HangHoa");
    var hh = shHH.getDataRange().getValues();
    for (var ihh = 1; ihh < hh.length; ihh++) {
      var maSP = khoText_(hh[ihh][0]);
      if (!maSP) continue;
      hhMap[maSP] = {
        maSP: maSP,
        maRap: khoText_(hh[ihh][1]),
        mauSanPham: khoText_(hh[ihh][2]),
        hieu: khoText_(hh[ihh][3]),
        tenSP: khoText_(hh[ihh][4])
      };
    }
  } catch (eHH) {}

  var btByNB = {};
  var btByBH = {};
  try {
    var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
    var bt = shBT.getDataRange().getValues();
    for (var ibt = 1; ibt < bt.length; ibt++) {
      var maNB = khoText_(bt[ibt][0]);
      var maBH = khoText_(bt[ibt][1]);
      var maSPbt = khoText_(bt[ibt][2]);
      var hhInfo = hhMap[maSPbt] || {};
      var info = {
        maHangNoiBo: maNB,
        maBanHang: maBH,
        maSP: maSPbt,
        maRap: khoText_(bt[ibt][3] || hhInfo.maRap),
        mauSanPham: khoText_(bt[ibt][4] || hhInfo.mauSanPham),
        hieu: khoText_(bt[ibt][5] || hhInfo.hieu),
        mau: khoText_(bt[ibt][6]),
        size: khoText_(bt[ibt][7]),
        tenSP: khoText_(hhInfo.tenSP || bt[ibt][8] || bt[ibt][4])
      };
      if (maNB) btByNB[maNB] = info;
      if (maBH && !btByBH[maBH]) btByBH[maBH] = info;
    }
  } catch (eBT) {}

  var moveMap = {};
  function ensureMove_(maNB, maBH) {
    var key = khoText_(maNB || maBH);
    if (!key) key = khoMakeId_("UNK-");
    if (!moveMap[key]) {
      moveMap[key] = {
        maHangNoiBo: khoText_(maNB),
        maBanHang: khoText_(maBH),
        ngayCuoi: null,
        ngayXuatCuoi: null,
        ngayNhapCuoi: null,
        slXuat90: 0,
        slNhap90: 0,
        tongXuat: 0,
        tongNhap: 0,
        soLanXuat: 0,
        soLanNhap: 0
      };
    }
    if (maBH && !moveMap[key].maBanHang) moveMap[key].maBanHang = khoText_(maBH);
    return moveMap[key];
  }

  try {
    var shTK = getSheet_("KHO", "tbl_Kho_TheKho");
    var tk = shTK.getDataRange().getValues();
    var date90 = new Date(today.getTime());
    date90.setDate(date90.getDate() - 90);
    for (var itk = 1; itk < tk.length; itk++) {
      var dTK = khoTonLauParseDate_(tk[itk][1]);
      if (!dTK) continue;
      var loai = khoText_(tk[itk][2]).toUpperCase();
      var maNBTK = khoText_(tk[itk][4]);
      var maBHTK = khoText_(tk[itk][5]) || (btByNB[maNBTK] ? btByNB[maNBTK].maBanHang : "");
      if (!maNBTK && !maBHTK) continue;
      var mv = ensureMove_(maNBTK, maBHTK);
      if (!mv.ngayCuoi || dTK > mv.ngayCuoi) mv.ngayCuoi = dTK;
      var sl = khoNum_(tk[itk][7]);
      var isXuat = sl < 0 || loai.indexOf("XUAT") !== -1 || loai.indexOf("TRU") !== -1;
      var isNhap = sl > 0 || loai.indexOf("NHAP") !== -1 || loai.indexOf("HOAN") !== -1;
      if (isXuat) {
        var abs = Math.abs(sl || 0);
        if (!mv.ngayXuatCuoi || dTK > mv.ngayXuatCuoi) mv.ngayXuatCuoi = dTK;
        mv.tongXuat += abs;
        mv.soLanXuat += 1;
        if (dTK >= date90) mv.slXuat90 += abs;
      } else if (isNhap) {
        var absN = Math.abs(sl || 0);
        if (!mv.ngayNhapCuoi || dTK > mv.ngayNhapCuoi) mv.ngayNhapCuoi = dTK;
        mv.tongNhap += absN;
        mv.soLanNhap += 1;
        if (dTK >= date90) mv.slNhap90 += absN;
      }
    }
  } catch (eTK) {}

  var groupMap = {};
  function ensureGroup_(info) {
    info = info || {};
    var maBH = khoText_(info.maBanHang || info.maHangNoiBo || "KHONG_RO");
    var btInfo = btByBH[maBH] || btByNB[khoText_(info.maHangNoiBo)] || {};
    if (!groupMap[maBH]) {
      groupMap[maBH] = {
        maBanHang: maBH,
        maRap: khoText_(info.maRap || btInfo.maRap),
        hieu: khoText_(info.hieu || btInfo.hieu),
        mau: khoText_(info.mau || btInfo.mau),
        tenSP: khoText_(info.tenSP || btInfo.tenSP || btInfo.mauSanPham || maBH),
        tonThucTe: 0,
        tonGiu: 0,
        khaDung: 0,
        hangLoi: 0,
        choHoanThien: 0,
        slXuat90: 0,
        tongXuat: 0,
        ngayXuatCuoi: null,
        ngayNhapCuoi: null,
        ngayCuoi: null,
        daysSinceXuat: 9999,
        daysSinceMove: 9999,
        sizes: {}
      };
    }
    return groupMap[maBH];
  }

  try {
    var shTon = getSheet_("KHO", "tbl_Kho_Ton");
    var ton = shTon.getDataRange().getValues();
    for (var iton = 1; iton < ton.length; iton++) {
      var maNBton = khoText_(ton[iton][0]);
      var maBHton = khoText_(ton[iton][1]) || (btByNB[maNBton] ? btByNB[maNBton].maBanHang : maNBton);
      if (!maNBton && !maBHton) continue;
      var btTon = btByNB[maNBton] || btByBH[maBHton] || {};
      var g = ensureGroup_({
        maBanHang: maBHton,
        maHangNoiBo: maNBton,
        maRap: khoText_(ton[iton][4] || btTon.maRap),
        hieu: khoText_(ton[iton][5] || btTon.hieu),
        mau: khoText_(ton[iton][6] || btTon.mau),
        tenSP: btTon.tenSP
      });
      var size = khoText_(ton[iton][7] || btTon.size || "?");
      var kd = khoNum_(ton[iton][10]);
      var tt = khoNum_(ton[iton][8]);
      var giu = khoNum_(ton[iton][9]);
      var cho = khoNum_(ton[iton][11]);
      var loi = khoNum_(ton[iton][13]);
      g.tonThucTe += tt;
      g.tonGiu += giu;
      g.khaDung += kd;
      g.choHoanThien += cho;
      g.hangLoi += loi;

      var mv = moveMap[maNBton] || moveMap[maBHton] || {};
      var dx = khoTonLauDaysBetween_(mv.ngayXuatCuoi, today);
      var dm = khoTonLauDaysBetween_(mv.ngayCuoi, today);
      if (!g.ngayXuatCuoi || (mv.ngayXuatCuoi && mv.ngayXuatCuoi > g.ngayXuatCuoi)) g.ngayXuatCuoi = mv.ngayXuatCuoi || g.ngayXuatCuoi;
      if (!g.ngayNhapCuoi || (mv.ngayNhapCuoi && mv.ngayNhapCuoi > g.ngayNhapCuoi)) g.ngayNhapCuoi = mv.ngayNhapCuoi || g.ngayNhapCuoi;
      if (!g.ngayCuoi || (mv.ngayCuoi && mv.ngayCuoi > g.ngayCuoi)) g.ngayCuoi = mv.ngayCuoi || g.ngayCuoi;
      g.slXuat90 += khoNum_(mv.slXuat90);
      g.tongXuat += khoNum_(mv.tongXuat);

      if (!g.sizes[size]) {
        g.sizes[size] = { size: size, tonThucTe: 0, khaDung: 0, tonGiu: 0, hangLoi: 0, choHoanThien: 0, ngayXuatCuoi: null, daysSinceXuat: 9999, slXuat90: 0 };
      }
      g.sizes[size].tonThucTe += tt;
      g.sizes[size].khaDung += kd;
      g.sizes[size].tonGiu += giu;
      g.sizes[size].choHoanThien += cho;
      g.sizes[size].hangLoi += loi;
      g.sizes[size].slXuat90 += khoNum_(mv.slXuat90);
      if (!g.sizes[size].ngayXuatCuoi || (mv.ngayXuatCuoi && mv.ngayXuatCuoi > g.sizes[size].ngayXuatCuoi)) g.sizes[size].ngayXuatCuoi = mv.ngayXuatCuoi || g.sizes[size].ngayXuatCuoi;
      g.sizes[size].daysSinceXuat = Math.min(g.sizes[size].daysSinceXuat, dx);
    }
  } catch (eTon) {}

  var all = Object.keys(groupMap).map(function(k) {
    var g = groupMap[k];
    g.daysSinceXuat = khoTonLauDaysBetween_(g.ngayXuatCuoi, today);
    g.daysSinceMove = khoTonLauDaysBetween_(g.ngayCuoi, today);
    g.ngayXuatCuoiText = khoTonLauFmtDate_(g.ngayXuatCuoi);
    g.ngayNhapCuoiText = khoTonLauFmtDate_(g.ngayNhapCuoi);
    g.ngayCuoiText = khoTonLauFmtDate_(g.ngayCuoi);
    g.sizes = Object.keys(g.sizes).map(function(sz) {
      var s = g.sizes[sz];
      s.daysSinceXuat = khoTonLauDaysBetween_(s.ngayXuatCuoi, today);
      s.ngayXuatCuoiText = khoTonLauFmtDate_(s.ngayXuatCuoi);
      return s;
    }).sort(function(a, b) {
      if ((b.daysSinceXuat || 0) !== (a.daysSinceXuat || 0)) return (b.daysSinceXuat || 0) - (a.daysSinceXuat || 0);
      return String(a.size).localeCompare(String(b.size), "vi", { numeric: true });
    });
    g.searchText = khoText_([g.maBanHang, g.maRap, g.hieu, g.mau, g.tenSP].join(" ")).toLowerCase();
    g.isTonLau = g.khaDung >= nguongTon && g.daysSinceXuat >= soNgay;
    g.isKhongDong = g.tonThucTe > 0 && g.daysSinceMove >= soNgay;
    if (g.isTonLau) g.nhanXet = "Tồn lâu - nên kiểm tra / xả hàng";
    else if (g.isKhongDong) g.nhanXet = "Ít biến động - cần theo dõi";
    else g.nhanXet = "Bình thường";
    return g;
  }).filter(function(g) {
    if (q && g.searchText.indexOf(q) === -1) return false;
    return g.khaDung > 0 || g.tonGiu > 0 || g.hangLoi > 0 || g.choHoanThien > 0;
  });

  var tonLau = all.filter(function(g) { return g.isTonLau; }).sort(function(a, b) {
    if (b.daysSinceXuat !== a.daysSinceXuat) return b.daysSinceXuat - a.daysSinceXuat;
    return b.khaDung - a.khaDung;
  }).slice(0, limit);

  var khongDong = all.filter(function(g) { return !g.isTonLau && g.isKhongDong; }).sort(function(a, b) {
    if (b.daysSinceMove !== a.daysSinceMove) return b.daysSinceMove - a.daysSinceMove;
    return b.tonThucTe - a.tonThucTe;
  }).slice(0, limit);

  var binhThuong = all.filter(function(g) { return !g.isTonLau && !g.isKhongDong; }).sort(function(a, b) {
    return b.khaDung - a.khaDung;
  }).slice(0, Math.min(50, limit));

  return outJson_({
    ok: true,
    params: { q: q, soNgay: soNgay, nguongTon: nguongTon },
    summary: {
      tongMa: all.length,
      soMaTonLau: tonLau.length,
      soMaKhongDong: khongDong.length,
      tongKhaDungTonLau: tonLau.reduce(function(s, x) { return s + khoNum_(x.khaDung); }, 0),
      tongTonThucTeTonLau: tonLau.reduce(function(s, x) { return s + khoNum_(x.tonThucTe); }, 0)
    },
    tonLau: tonLau,
    khongDong: khongDong,
    binhThuong: binhThuong
  });
}

/****************************************************
 * KHO THÀNH PHẨM - QUẢN LÝ MÃ BÁN HÀNG / BIẾN THỂ PHẦN 22
 * - Xem MaBanHang, MaHangNoiBo, size, tồn, ảnh
 * - Chỉ đọc dữ liệu, không cộng/trừ tồn
 ****************************************************/
function khoGetBienTheManager_(data) {
  var q = khoText_(data && data.q).toLowerCase();
  var limit = khoNum_(data && data.limit || 300);
  if (limit <= 0) limit = 300;
  if (limit > 800) limit = 800;

  var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
  var shTon = getSheet_("KHO", "tbl_Kho_Ton");
  var bt = shBT.getDataRange().getValues();
  var ton = shTon.getDataRange().getValues();

  var hhMap = {};
  try {
    var shHH = getSheet_("KHO", "tbl_Kho_HangHoa");
    var hh = shHH.getDataRange().getValues();
    for (var ih = 1; ih < hh.length; ih++) {
      var maSPH = khoText_(hh[ih][0]);
      if (!maSPH) continue;
      hhMap[maSPH] = {
        maSP: maSPH,
        maRap: khoText_(hh[ih][1]),
        mauSanPham: khoText_(hh[ih][2]),
        hieu: khoText_(hh[ih][3]),
        tenSP: khoText_(hh[ih][4]),
        nhomHang: khoText_(hh[ih][5]),
        trangThai: khoText_(hh[ih][8]),
        ghiChu: khoText_(hh[ih][9])
      };
    }
  } catch (eHH) {}

  var anhMap = khoGetAnhMaBanHangMap_ ? khoGetAnhMaBanHangMap_() : {};
  var tonByNoiBo = {};
  var tonByBanHang = {};

  for (var it = 1; it < ton.length; it++) {
    var maNB = khoText_(ton[it][0]);
    var maBH = khoText_(ton[it][1]);
    if (!maNB && !maBH) continue;

    var rowTon = {
      maHangNoiBo: maNB,
      maBanHang: maBH,
      kho: khoText_(ton[it][2]),
      viTri: khoText_(ton[it][3]),
      maRap: khoText_(ton[it][4]),
      hieu: khoText_(ton[it][5]),
      mau: khoText_(ton[it][6]),
      size: khoText_(ton[it][7]),
      tonThucTe: khoNum_(ton[it][8]),
      tonGiu: khoNum_(ton[it][9]),
      khaDung: khoNum_(ton[it][10]),
      choHoanThien: khoNum_(ton[it][11]),
      daCotRi: khoNum_(ton[it][12]),
      hangLoi: khoNum_(ton[it][13]),
      capNhatCuoi: khoText_(ton[it][14])
    };

    if (!tonByNoiBo[maNB]) tonByNoiBo[maNB] = { tonThucTe:0, tonGiu:0, khaDung:0, choHoanThien:0, hangLoi:0, rows:[] };
    tonByNoiBo[maNB].tonThucTe += rowTon.tonThucTe;
    tonByNoiBo[maNB].tonGiu += rowTon.tonGiu;
    tonByNoiBo[maNB].khaDung += rowTon.khaDung;
    tonByNoiBo[maNB].choHoanThien += rowTon.choHoanThien;
    tonByNoiBo[maNB].hangLoi += rowTon.hangLoi;
    tonByNoiBo[maNB].rows.push(rowTon);

    if (!tonByBanHang[maBH]) tonByBanHang[maBH] = { tonThucTe:0, tonGiu:0, khaDung:0, choHoanThien:0, hangLoi:0, rows:[] };
    tonByBanHang[maBH].tonThucTe += rowTon.tonThucTe;
    tonByBanHang[maBH].tonGiu += rowTon.tonGiu;
    tonByBanHang[maBH].khaDung += rowTon.khaDung;
    tonByBanHang[maBH].choHoanThien += rowTon.choHoanThien;
    tonByBanHang[maBH].hangLoi += rowTon.hangLoi;
    tonByBanHang[maBH].rows.push(rowTon);
  }

  var map = {};
  function ensureGroup_(maBH) {
    maBH = khoText_(maBH);
    if (!maBH) maBH = "KHONG-RO";
    if (!map[maBH]) {
      map[maBH] = {
        maBanHang: maBH,
        maSP: "",
        maRap: "",
        hieu: "",
        mau: "",
        tenSP: "",
        mauSanPham: "",
        nhomHang: "",
        coAnh: false,
        linkAnhChinh: "",
        linkAnhPhu: "",
        tonThucTe: 0,
        tonGiu: 0,
        khaDung: 0,
        choHoanThien: 0,
        hangLoi: 0,
        soSize: 0,
        soBienThe: 0,
        sizes: [],
        searchText: ""
      };
    }
    return map[maBH];
  }

  for (var ib = 1; ib < bt.length; ib++) {
    var maHangNoiBo = khoText_(bt[ib][0]);
    var maBanHang = khoText_(bt[ib][1]) || maHangNoiBo;
    if (!maHangNoiBo && !maBanHang) continue;

    var maSP = khoText_(bt[ib][2]);
    var hhInfo = hhMap[maSP] || {};
    var g = ensureGroup_(maBanHang);
    var t = tonByNoiBo[maHangNoiBo] || { tonThucTe:0, tonGiu:0, khaDung:0, choHoanThien:0, hangLoi:0, rows:[] };

    g.maSP = g.maSP || maSP;
    g.maRap = g.maRap || khoText_(bt[ib][3]) || hhInfo.maRap || "";
    g.mauSanPham = g.mauSanPham || khoText_(bt[ib][4]) || hhInfo.mauSanPham || "";
    g.hieu = g.hieu || khoText_(bt[ib][5]) || hhInfo.hieu || "";
    g.mau = g.mau || khoText_(bt[ib][6]) || "";
    g.tenSP = g.tenSP || hhInfo.tenSP || khoText_(bt[ib][8]) || g.mauSanPham || g.maRap;
    g.nhomHang = g.nhomHang || hhInfo.nhomHang || "";

    g.tonThucTe += t.tonThucTe;
    g.tonGiu += t.tonGiu;
    g.khaDung += t.khaDung;
    g.choHoanThien += t.choHoanThien;
    g.hangLoi += t.hangLoi;
    g.soBienThe++;

    g.sizes.push({
      maHangNoiBo: maHangNoiBo,
      maBanHang: maBanHang,
      maSP: maSP,
      maRap: g.maRap,
      hieu: g.hieu,
      mau: g.mau,
      size: khoText_(bt[ib][7]),
      tenHienThi: khoText_(bt[ib][8]),
      coBan: khoText_(bt[ib][9]),
      ghiChu: khoText_(bt[ib][10]),
      tonThucTe: t.tonThucTe,
      tonGiu: t.tonGiu,
      khaDung: t.khaDung,
      choHoanThien: t.choHoanThien,
      hangLoi: t.hangLoi,
      khoRows: t.rows
    });
  }

  // Nếu có tồn kho nhưng chưa có biến thể trong tbl_Kho_BienThe thì vẫn hiện để dễ phát hiện dữ liệu thiếu.
  Object.keys(tonByBanHang).forEach(function(maBH2) {
    if (!maBH2 || map[maBH2]) return;
    var tg = tonByBanHang[maBH2];
    var first = tg.rows[0] || {};
    var g2 = ensureGroup_(maBH2);
    g2.maRap = first.maRap || "";
    g2.hieu = first.hieu || "";
    g2.mau = first.mau || "";
    g2.tenSP = first.maRap || maBH2;
    g2.tonThucTe = tg.tonThucTe;
    g2.tonGiu = tg.tonGiu;
    g2.khaDung = tg.khaDung;
    g2.choHoanThien = tg.choHoanThien;
    g2.hangLoi = tg.hangLoi;
    g2.soBienThe = 0;
    g2.sizes = tg.rows.map(function(r) {
      return {
        maHangNoiBo: r.maHangNoiBo,
        maBanHang: r.maBanHang,
        maRap: r.maRap,
        hieu: r.hieu,
        mau: r.mau,
        size: r.size,
        tenHienThi: r.maHangNoiBo,
        coBan: "Thiếu biến thể",
        ghiChu: "Có tồn nhưng chưa thấy trong tbl_Kho_BienThe",
        tonThucTe: r.tonThucTe,
        tonGiu: r.tonGiu,
        khaDung: r.khaDung,
        choHoanThien: r.choHoanThien,
        hangLoi: r.hangLoi,
        khoRows: [r]
      };
    });
  });

  var list = Object.keys(map).map(function(k) {
    var g = map[k];
    var anh = anhMap[g.maBanHang] || {};
    g.coAnh = !!(anh.linkAnhChinh || anh.linkAnhPhu);
    g.linkAnhChinh = anh.linkAnhChinh || "";
    g.linkAnhPhu = anh.linkAnhPhu || "";
    g.soSize = g.sizes.length;
    g.sizes.sort(function(a, b) {
      return khoText_(a.size).localeCompare(khoText_(b.size), 'vi', { numeric: true });
    });
    g.searchText = [g.maBanHang, g.maSP, g.maRap, g.hieu, g.mau, g.tenSP, g.mauSanPham, g.nhomHang]
      .join(' ').toLowerCase();
    return g;
  }).filter(function(g) {
    if (q && g.searchText.indexOf(q) === -1) return false;
    return true;
  }).sort(function(a, b) {
    var ak = [a.maRap, a.hieu, a.mau, a.maBanHang].join('|');
    var bk = [b.maRap, b.hieu, b.mau, b.maBanHang].join('|');
    return ak.localeCompare(bk, 'vi', { numeric: true });
  });

  var fullCount = list.length;
  list = list.slice(0, limit);

  var summary = {
    soMaBanHang: fullCount,
    soMaDangHien: list.length,
    soBienThe: list.reduce(function(s, x) { return s + khoNum_(x.soSize); }, 0),
    tongTonThucTe: list.reduce(function(s, x) { return s + khoNum_(x.tonThucTe); }, 0),
    tongKhaDung: list.reduce(function(s, x) { return s + khoNum_(x.khaDung); }, 0),
    tongTonGiu: list.reduce(function(s, x) { return s + khoNum_(x.tonGiu); }, 0),
    soMaChuaAnh: list.filter(function(x) { return !x.coAnh; }).length
  };

  return outJson_({ ok: true, params: { q:q, limit:limit }, summary: summary, data: list });
}

/****************************************************
 * KHO THÀNH PHẨM - KIỂM KÊ / ĐIỀU CHỈNH TỒN PHẦN 23
 * - Tải danh sách mã/size đang có tồn
 * - Nhập tồn thực tế sau khi kiểm đếm
 * - Tự tính lệch, cập nhật TonThucTe + KhaDung
 * - Ghi lịch sử vào tbl_Kho_TheKho
 ****************************************************/
function khoGetKiemKeList_(data) {
  var q = khoText_(data && data.q).toLowerCase();
  var limit = khoNum_(data && data.limit || 250);
  if (limit <= 0) limit = 250;
  if (limit > 800) limit = 800;

  var shTon = getSheet_("KHO", "tbl_Kho_Ton");
  var ton = shTon.getDataRange().getValues();

  var btMap = {};
  var hhMap = {};
  try {
    var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
    var bt = shBT.getDataRange().getValues();
    for (var ib = 1; ib < bt.length; ib++) {
      var maNB = khoText_(bt[ib][0]);
      if (!maNB) continue;
      btMap[maNB] = {
        maHangNoiBo: maNB,
        maBanHang: khoText_(bt[ib][1]),
        maSP: khoText_(bt[ib][2]),
        maRap: khoText_(bt[ib][3]),
        mauSanPham: khoText_(bt[ib][4]),
        hieu: khoText_(bt[ib][5]),
        mau: khoText_(bt[ib][6]),
        size: khoText_(bt[ib][7]),
        tenHienThi: khoText_(bt[ib][8])
      };
    }
  } catch(eBT) {}

  try {
    var shHH = getSheet_("KHO", "tbl_Kho_HangHoa");
    var hh = shHH.getDataRange().getValues();
    for (var ih = 1; ih < hh.length; ih++) {
      var maSP = khoText_(hh[ih][0]);
      if (!maSP) continue;
      hhMap[maSP] = {
        maSP: maSP,
        maRap: khoText_(hh[ih][1]),
        mauSanPham: khoText_(hh[ih][2]),
        hieu: khoText_(hh[ih][3]),
        tenSP: khoText_(hh[ih][4]),
        nhomHang: khoText_(hh[ih][5])
      };
    }
  } catch(eHH) {}

  var list = [];
  var summary = {
    tongDong: 0,
    tongTonThucTe: 0,
    tongKhaDung: 0,
    tongDangGiu: 0,
    tongLoiCho: 0
  };

  for (var i = 1; i < ton.length; i++) {
    var maHangNoiBo = khoText_(ton[i][0]);
    var maBanHang = khoText_(ton[i][1]);
    if (!maHangNoiBo && !maBanHang) continue;

    var btInfo = btMap[maHangNoiBo] || {};
    var hhInfo = hhMap[btInfo.maSP] || {};
    var row = {
      rowIndex: i + 1,
      maHangNoiBo: maHangNoiBo,
      maBanHang: maBanHang || btInfo.maBanHang || maHangNoiBo,
      maSP: btInfo.maSP || "",
      kho: khoText_(ton[i][2]),
      viTri: khoText_(ton[i][3]),
      maRap: khoText_(ton[i][4]) || btInfo.maRap || hhInfo.maRap || "",
      hieu: khoText_(ton[i][5]) || btInfo.hieu || hhInfo.hieu || "",
      mau: khoText_(ton[i][6]) || btInfo.mau || "",
      size: khoText_(ton[i][7]) || btInfo.size || "",
      tenSP: hhInfo.tenSP || btInfo.tenHienThi || btInfo.mauSanPham || "",
      tonThucTe: khoNum_(ton[i][8]),
      tonGiu: khoNum_(ton[i][9]),
      khaDung: khoNum_(ton[i][10]),
      choHoanThien: khoNum_(ton[i][11]),
      daCotRi: khoNum_(ton[i][12]),
      hangLoi: khoNum_(ton[i][13]),
      capNhatCuoi: khoText_(ton[i][14])
    };
    row.loiCho = row.choHoanThien + row.hangLoi;
    row.searchText = khoText_([row.maHangNoiBo, row.maBanHang, row.maRap, row.hieu, row.mau, row.size, row.tenSP, row.kho].join(" ")).toLowerCase();

    if (q && row.searchText.indexOf(q) === -1) continue;

    summary.tongDong++;
    summary.tongTonThucTe += row.tonThucTe;
    summary.tongKhaDung += row.khaDung;
    summary.tongDangGiu += row.tonGiu;
    summary.tongLoiCho += row.loiCho;
    list.push(row);
  }

  list.sort(function(a, b) {
    var ak = [a.maRap, a.hieu, a.mau, a.size].join(" ");
    var bk = [b.maRap, b.hieu, b.mau, b.size].join(" ");
    return ak.localeCompare(bk, "vi", { numeric: true });
  });

  return outJson_({
    ok: true,
    params: { q: q, limit: limit },
    summary: summary,
    data: list.slice(0, limit)
  });
}

function khoDieuChinhKiemKe_(data) {
  var maHangNoiBo = khoText_(data && data.maHangNoiBo);
  var kho = khoText_(data && data.kho);
  var viTri = khoText_(data && data.viTri);
  var tonMoi = khoNum_(data && data.tonMoi);
  var nguoi = khoText_(data && (data.nguoi || data.user || data.actorUser)) || "app";
  var ghiChu = khoText_(data && data.ghiChu);

  if (!maHangNoiBo) return outJson_({ ok:false, message:"Thiếu mã hàng nội bộ" });
  if (tonMoi < 0) return outJson_({ ok:false, message:"Tồn thực tế mới không được âm" });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    var shTon = getSheet_("KHO", "tbl_Kho_Ton");
    var shTheKho = getSheet_("KHO", "tbl_Kho_TheKho");
    var rows = shTon.getDataRange().getValues();
    var targetRow = -1;
    var rowData = null;

    for (var i = 1; i < rows.length; i++) {
      if (khoText_(rows[i][0]) !== maHangNoiBo) continue;
      if (kho && khoText_(rows[i][2]) !== kho) continue;
      if (viTri && khoText_(rows[i][3]) !== viTri) continue;
      targetRow = i + 1;
      rowData = rows[i];
      break;
    }

    if (targetRow === -1 || !rowData) {
      return outJson_({ ok:false, message:"Không tìm thấy dòng tồn kho của mã: " + maHangNoiBo });
    }

    var tonCu = khoNum_(rowData[8]);
    var tonGiu = khoNum_(rowData[9]);
    var delta = tonMoi - tonCu;
    var khaDungMoi = Math.max(tonMoi - tonGiu, 0);
    var now = nowVN_();
    var maChungTu = khoMakeId_("KK-");

    shTon.getRange(targetRow, 9).setValue(tonMoi);       // I TonThucTe
    shTon.getRange(targetRow, 11).setValue(khaDungMoi);  // K KhaDung
    shTon.getRange(targetRow, 15).setValue(now);         // O CapNhatCuoi

    shTheKho.appendRow([
      khoMakeId_("TK-"),
      now,
      "KIEM_KE_DIEU_CHINH",
      maChungTu,
      maHangNoiBo,
      khoText_(rowData[1]),
      khoText_(rowData[2]),
      delta,
      tonMoi,
      nguoi,
      "Kiểm kê điều chỉnh: " + tonCu + " → " + tonMoi + " (lệch " + delta + ")" + (ghiChu ? ". " + ghiChu : "")
    ]);

    SpreadsheetApp.flush();
    return outJson_({
      ok: true,
      message: "Đã điều chỉnh tồn kiểm kê",
      maChungTu: maChungTu,
      maHangNoiBo: maHangNoiBo,
      tonCu: tonCu,
      tonMoi: tonMoi,
      delta: delta,
      khaDungMoi: khaDungMoi
    });
  } finally {
    try { lock.releaseLock(); } catch(eLock) {}
  }
}


/****************************************************
 * KHO THÀNH PHẨM - NHẬT KÝ KHO PHẦN 24
 * - Xem lịch sử cộng/trừ/điều chỉnh kho từ tbl_Kho_TheKho
 * - Chỉ đọc dữ liệu, không cộng/trừ tồn
 ****************************************************/
function khoParseDateYMD_(ymd, endOfDay) {
  ymd = khoText_(ymd);
  if (!ymd) return null;
  var m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return d.getTime();
}

function khoParseVNDateTimeMs_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getTime();
  var s = khoText_(v);
  if (!s) return 0;
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    var d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    return d.getTime();
  }
  var d2 = new Date(s);
  return isNaN(d2.getTime()) ? 0 : d2.getTime();
}

function khoNhatKyLoaiNhom_(loai, qty) {
  var s = khoText_(loai).toUpperCase();
  if (s.indexOf('XUAT') !== -1 || qty < 0) return 'XUAT';
  if (s.indexOf('NHAP') !== -1) return 'NHAP';
  if (s.indexOf('KIEM_KE') !== -1 || s.indexOf('DIEU_CHINH') !== -1) return 'KIEMKE';
  if (s.indexOf('LOI') !== -1 || s.indexOf('CHO') !== -1 || s.indexOf('HOAN_THIEN') !== -1) return 'LOI_CHO';
  if (s.indexOf('HOAN') !== -1 || s.indexOf('HUY') !== -1) return 'HOAN';
  return 'KHAC';
}

function khoGetNhatKyKhoList_(data) {
  var q = khoText_(data && data.q).toLowerCase();
  var loaiFilter = khoText_(data && data.loai).toUpperCase();
  var fromMs = khoParseDateYMD_(data && data.fromDate, false);
  var toMs = khoParseDateYMD_(data && data.toDate, true);
  var limit = khoNum_(data && data.limit || 300);
  if (limit <= 0) limit = 300;
  if (limit > 1000) limit = 1000;

  var btMap = {};
  var hhMap = {};
  try {
    var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
    var bt = shBT.getDataRange().getValues();
    for (var ib = 1; ib < bt.length; ib++) {
      var maNB = khoText_(bt[ib][0]);
      if (!maNB) continue;
      btMap[maNB] = {
        maHangNoiBo: maNB,
        maBanHang: khoText_(bt[ib][1]),
        maSP: khoText_(bt[ib][2]),
        maRap: khoText_(bt[ib][3]),
        mauSanPham: khoText_(bt[ib][4]),
        hieu: khoText_(bt[ib][5]),
        mau: khoText_(bt[ib][6]),
        size: khoText_(bt[ib][7]),
        tenHienThi: khoText_(bt[ib][8])
      };
    }
  } catch(eBT) {}

  try {
    var shHH = getSheet_("KHO", "tbl_Kho_HangHoa");
    var hh = shHH.getDataRange().getValues();
    for (var ih = 1; ih < hh.length; ih++) {
      var maSP = khoText_(hh[ih][0]);
      if (!maSP) continue;
      hhMap[maSP] = {
        maSP: maSP,
        maRap: khoText_(hh[ih][1]),
        mauSanPham: khoText_(hh[ih][2]),
        hieu: khoText_(hh[ih][3]),
        tenSP: khoText_(hh[ih][4]),
        nhomHang: khoText_(hh[ih][5])
      };
    }
  } catch(eHH) {}

  var sh = getSheet_("KHO", "tbl_Kho_TheKho");
  var rows = sh.getDataRange().getValues();
  var list = [];
  var summary = {
    tongDong: 0,
    tongNhap: 0,
    tongXuat: 0,
    tongKiemKe: 0,
    tongLoiCho: 0,
    tongHoan: 0,
    tongKhac: 0,
    slNhap: 0,
    slXuat: 0,
    slTang: 0,
    slGiam: 0
  };

  for (var i = rows.length - 1; i >= 1; i--) {
    var r = rows[i];
    var timeMs = khoParseVNDateTimeMs_(r[1]);
    if (fromMs && timeMs && timeMs < fromMs) continue;
    if (toMs && timeMs && timeMs > toMs) continue;

    var maHangNoiBo = khoText_(r[4]);
    var btInfo = btMap[maHangNoiBo] || {};
    var hhInfo = hhMap[btInfo.maSP] || {};
    var qty = khoNum_(r[7]);
    var loai = khoText_(r[2]);
    var nhom = khoNhatKyLoaiNhom_(loai, qty);
    if (loaiFilter && loaiFilter !== 'ALL' && nhom !== loaiFilter) continue;

    var row = {
      rowIndex: i + 1,
      maGiaoDichKho: khoText_(r[0]),
      thoiGian: khoText_(r[1]),
      timeMs: timeMs,
      loaiGiaoDich: loai,
      nhomLoai: nhom,
      maChungTu: khoText_(r[3]),
      maHangNoiBo: maHangNoiBo,
      maBanHang: khoText_(r[5]) || btInfo.maBanHang || maHangNoiBo,
      kho: khoText_(r[6]),
      soLuongThayDoi: qty,
      tonSau: khoNum_(r[8]),
      nguoiThaoTac: khoText_(r[9]),
      ghiChu: khoText_(r[10]),
      maSP: btInfo.maSP || '',
      maRap: btInfo.maRap || hhInfo.maRap || '',
      hieu: btInfo.hieu || hhInfo.hieu || '',
      mau: btInfo.mau || '',
      size: btInfo.size || '',
      tenSP: hhInfo.tenSP || btInfo.tenHienThi || btInfo.mauSanPham || ''
    };
    row.searchText = khoText_([
      row.maGiaoDichKho, row.thoiGian, row.loaiGiaoDich, row.maChungTu,
      row.maHangNoiBo, row.maBanHang, row.kho, row.nguoiThaoTac, row.ghiChu,
      row.maRap, row.hieu, row.mau, row.size, row.tenSP
    ].join(' ')).toLowerCase();
    if (q && row.searchText.indexOf(q) === -1) continue;

    summary.tongDong++;
    if (nhom === 'NHAP') summary.tongNhap++;
    else if (nhom === 'XUAT') summary.tongXuat++;
    else if (nhom === 'KIEMKE') summary.tongKiemKe++;
    else if (nhom === 'LOI_CHO') summary.tongLoiCho++;
    else if (nhom === 'HOAN') summary.tongHoan++;
    else summary.tongKhac++;

    if (qty > 0) {
      summary.slNhap += qty;
      summary.slTang += qty;
    } else if (qty < 0) {
      summary.slXuat += Math.abs(qty);
      summary.slGiam += Math.abs(qty);
    }

    list.push(row);
    if (list.length >= limit) break;
  }

  return outJson_({
    ok: true,
    params: { q: q, loai: loaiFilter || 'ALL', fromDate: data && data.fromDate, toDate: data && data.toDate, limit: limit },
    summary: summary,
    data: list
  });
}
 


function soanCheckOrderLockedAfterExport_(maHoaDon) {
  maHoaDon = normalizeText_(maHoaDon);
  var result = { locked: false, rows: 0, message: "" };
  if (!maHoaDon) return result;
  try {
    var sh = getSheet_("SALES", "tbl_DonHang_CT_Size");
    var values = sh.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (normalizeText_(values[i][0]) !== maHoaDon) continue;
      var st = normalizeText_(values[i][12]);
      if (st === "Đã xuất" || st === "Đã trừ tồn" || st === "Đã hoàn tồn") {
        result.locked = true;
        result.rows++;
      }
    }
  } catch (err) {}
  if (result.locked) {
    result.message = "Đơn " + maHoaDon + " đã xuất kho/hoàn tồn, không cho sửa trực tiếp chi tiết hàng. Muốn sửa hãy tạo hàng trả hoặc phiếu điều chỉnh riêng.";
  }
  return result;
}


/****************************************************
 * ĐƠN HÀNG - YÊU CẦU SỬA SAU XUẤT KHO
 * - Đơn đã xuất kho không cho sửa trực tiếp chi tiết hàng
 * - Nhân viên tạo yêu cầu sửa, chủ/quản lý duyệt hoặc từ chối
 * - Chỉ lưu yêu cầu và lịch sử, không tự cộng/trừ tồn kho
 ****************************************************/
function donEnsureYeuCauSuaSauXuatSheet_() {
  var headers = [
    "MaYeuCau", "ThoiGian", "MaHoaDon", "MaKH", "TenKhach", "LoaiYeuCau",
    "LyDo", "NoiDung", "TrangThai", "NguoiYeuCau", "NguoiDuyet",
    "ThoiGianDuyet", "GhiChuDuyet", "KhoaDon", "ChiTietJson"
  ];
  var ss = getSS_("SALES");
  var sh = ss.getSheetByName("tbl_DonHang_YeuCauSuaSauXuat");
  if (!sh) sh = ss.insertSheet("tbl_DonHang_YeuCauSuaSauXuat");
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var empty = first.every(function(v) { return !khoText_(v); });
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function donGetOrderBasicInfo_(maHoaDon) {
  var info = { maHoaDon: khoText_(maHoaDon), maKH: "", tenKhach: "", trangThai: "", trangThaiHoaDon: "" };
  if (!info.maHoaDon) return info;
  try {
    var sh = getSheet_("SALES", "tbl_DonHang");
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (khoText_(rows[i][0]) !== info.maHoaDon) continue;
      info.tenKhach = khoText_(rows[i][2]);
      info.trangThai = khoText_(rows[i][6]);
      info.maKH = khoText_(rows[i][8]);
      info.trangThaiHoaDon = khoText_(rows[i][13]);
      break;
    }
  } catch (err) {}
  return info;
}

function donCreateYeuCauSuaSauXuat_(data) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    hasLock = lock.tryLock(15000);
    if (!hasLock) return outJson_({ ok:false, message:"Hệ thống đang xử lý yêu cầu khác. Vui lòng thử lại sau." });

    var maHoaDon = khoText_(data.maHoaDon);
    var loaiYeuCau = khoText_(data.loaiYeuCau || "Sửa đơn sau xuất");
    var lyDo = khoText_(data.lyDo);
    var noiDung = khoText_(data.noiDung);
    var nguoiYeuCau = khoText_(data.nguoiYeuCau || data.user || data.actorUser || "app");
    var chiTiet = data.chiTiet || data.items || [];

    if (!maHoaDon) return outJson_({ ok:false, message:"Thiếu mã hóa đơn" });
    if (!noiDung && !lyDo) return outJson_({ ok:false, message:"Vui lòng nhập lý do hoặc nội dung cần sửa" });

    var lockInfo = soanCheckOrderLockedAfterExport_(maHoaDon);
    if (!lockInfo.locked) {
      return outJson_({ ok:false, message:"Đơn này chưa có trạng thái đã xuất kho. Nếu cần sửa, hãy sửa theo luồng soạn đơn bình thường." });
    }

    var orderInfo = donGetOrderBasicInfo_(maHoaDon);
    var sh = donEnsureYeuCauSuaSauXuatSheet_();
    var now = nowVN_();
    var maYeuCau = "YC-SUA-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + "-" + Math.floor(Math.random() * 1000);

    sh.appendRow([
      maYeuCau,
      now,
      maHoaDon,
      khoText_(data.maKH || orderInfo.maKH),
      khoText_(data.tenKhach || orderInfo.tenKhach),
      loaiYeuCau,
      lyDo,
      noiDung,
      "Chờ duyệt",
      nguoiYeuCau,
      "",
      "",
      "",
      lockInfo.locked ? "Đã khóa sửa trực tiếp" : "",
      JSON.stringify(chiTiet || [])
    ]);

    try {
      auditLog_("donCreateYeuCauSuaSauXuat", "DON_HANG", "CREATE", maHoaDon, nguoiYeuCau, true, "Tạo yêu cầu sửa đơn sau xuất kho", { maYeuCau: maYeuCau, loaiYeuCau: loaiYeuCau });
    } catch (eAudit) {}

    return outJson_({ ok:true, message:"Đã tạo yêu cầu sửa đơn. Chủ/quản lý duyệt trước khi xử lý.", maYeuCau:maYeuCau });
  } catch (err) {
    return outJson_({ ok:false, message:"Lỗi tạo yêu cầu sửa đơn: " + err.message });
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

function donGetYeuCauSuaSauXuatList_(data) {
  try {
    var sh = donEnsureYeuCauSuaSauXuatSheet_();
    var rows = sh.getDataRange().getValues();
    var q = khoText_(data.q).toLowerCase();
    var trangThai = khoText_(data.trangThai || "ALL");
    var limit = khoNum_(data.limit || 100);
    if (limit <= 0) limit = 100;
    if (limit > 300) limit = 300;

    var list = [];
    var summary = { total: 0, choDuyet: 0, daDuyet: 0, tuChoi: 0, daXuLy: 0 };

    for (var i = rows.length - 1; i >= 1; i--) {
      var r = rows[i];
      var st = khoText_(r[8]) || "Chờ duyệt";
      summary.total++;
      if (st === "Chờ duyệt") summary.choDuyet++;
      else if (st === "Đã duyệt") summary.daDuyet++;
      else if (st === "Từ chối") summary.tuChoi++;
      else if (st === "Đã xử lý") summary.daXuLy++;

      if (trangThai && trangThai !== "ALL" && st !== trangThai) continue;
      var searchText = [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[12]].join(" ").toLowerCase();
      if (q && searchText.indexOf(q) === -1) continue;

      list.push({
        rowIndex: i + 1,
        maYeuCau: khoText_(r[0]),
        thoiGian: khoText_(r[1]),
        maHoaDon: khoText_(r[2]),
        maKH: khoText_(r[3]),
        tenKhach: khoText_(r[4]),
        loaiYeuCau: khoText_(r[5]),
        lyDo: khoText_(r[6]),
        noiDung: khoText_(r[7]),
        trangThai: st,
        nguoiYeuCau: khoText_(r[9]),
        nguoiDuyet: khoText_(r[10]),
        thoiGianDuyet: khoText_(r[11]),
        ghiChuDuyet: khoText_(r[12]),
        khoaDon: khoText_(r[13])
      });
      if (list.length >= limit) break;
    }

    return outJson_({ ok:true, summary:summary, data:list });
  } catch (err) {
    return outJson_({ ok:false, message:"Lỗi tải yêu cầu sửa đơn: " + err.message });
  }
}

function donUpdateYeuCauSuaSauXuat_(data) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    hasLock = lock.tryLock(15000);
    if (!hasLock) return outJson_({ ok:false, message:"Hệ thống đang xử lý yêu cầu khác. Vui lòng thử lại sau." });

    var maYeuCau = khoText_(data.maYeuCau);
    var action = khoText_(data.action).toUpperCase();
    var nguoi = khoText_(data.nguoiDuyet || data.user || data.actorUser || "app");
    var ghiChu = khoText_(data.ghiChuDuyet || data.ghiChu);
    if (!maYeuCau) return outJson_({ ok:false, message:"Thiếu mã yêu cầu" });

    var nextStatus = "";
    if (action === "DUYET") nextStatus = "Đã duyệt";
    else if (action === "TU_CHOI") nextStatus = "Từ chối";
    else if (action === "DA_XU_LY") nextStatus = "Đã xử lý";
    else return outJson_({ ok:false, message:"Thao tác không hợp lệ" });

    var sh = donEnsureYeuCauSuaSauXuatSheet_();
    var rows = sh.getDataRange().getValues();
    var row = -1;
    var maHoaDon = "";
    for (var i = 1; i < rows.length; i++) {
      if (khoText_(rows[i][0]) === maYeuCau) {
        row = i + 1;
        maHoaDon = khoText_(rows[i][2]);
        break;
      }
    }
    if (row === -1) return outJson_({ ok:false, message:"Không tìm thấy yêu cầu " + maYeuCau });

    sh.getRange(row, 9).setValue(nextStatus);       // I TrangThai
    sh.getRange(row, 11).setValue(nguoi);           // K NguoiDuyet
    sh.getRange(row, 12).setValue(nowVN_());        // L ThoiGianDuyet
    sh.getRange(row, 13).setValue(ghiChu);          // M GhiChuDuyet

    try {
      auditLog_("donUpdateYeuCauSuaSauXuat", "DON_HANG", "UPDATE", maHoaDon || maYeuCau, nguoi, true, "Cập nhật yêu cầu sửa đơn sau xuất kho", { maYeuCau: maYeuCau, trangThai: nextStatus });
    } catch (eAudit) {}

    return outJson_({ ok:true, message:"Đã cập nhật yêu cầu: " + nextStatus });
  } catch (err) {
    return outJson_({ ok:false, message:"Lỗi cập nhật yêu cầu sửa đơn: " + err.message });
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

/****************************************************
 * KHO THÀNH PHẨM - PHẦN 62
 * - Phiếu xuất kho thủ công
 * - Dashboard kho tổng gọn theo luồng nhập -> xuất
 ****************************************************/
function khoEnsurePhieuXuatManualSheet_() {
  var headers = [
    "MaPhieuXuat", "ThoiGian", "LoaiXuat", "NguonTon", "MaThamChieu",
    "KhoXuat", "TongSoLuong", "TrangThai", "NguoiXuat", "GhiChu", "ChiTietJson"
  ];
  var ss = getSS_("KHO");
  var sh = ss.getSheetByName("tbl_Kho_PhieuXuat_ThuCong");
  if (!sh) sh = ss.insertSheet("tbl_Kho_PhieuXuat_ThuCong");
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var empty = first.every(function(v) { return !khoText_(v); });
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function khoSavePhieuXuatManual_(data) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    hasLock = lock.tryLock(25000);
    if (!hasLock) return outJson_({ ok:false, message:"Hệ thống đang có người xuất kho. Vui lòng thử lại sau vài giây." });

    var items = Array.isArray(data.items) ? data.items : [];
    var loaiXuat = khoText_(data.loaiXuat || "Xuất thủ công");
    var nguonTon = khoText_(data.nguonTon || "HANG_TOT").toUpperCase();
    var khoMacDinh = khoText_(data.khoXuat || data.kho || "");
    var maThamChieu = khoText_(data.maThamChieu || "");
    var nguoi = khoText_(data.nguoiXuat || data.user || data.actorUser || "app");
    var ghiChu = khoText_(data.ghiChu);
    var now = nowVN_();
    var maPhieu = "PXK-TC" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss");

    if (!items.length) return outJson_({ ok:false, message:"Chưa có dòng xuất kho" });

    var shTon = getSheet_("KHO", "tbl_Kho_Ton");
    var shTheKho = getSheet_("KHO", "tbl_Kho_TheKho");
    var tonRows = shTon.getDataRange().getValues();
    var clean = [];

    items.forEach(function(item) {
      var maNB = khoText_(item.maHangNoiBo);
      var qty = khoNum_(item.soLuong);
      if (!maNB || qty <= 0) return;
      clean.push({
        maHangNoiBo: maNB,
        maBanHang: khoText_(item.maBanHang),
        kho: khoText_(item.kho || item.khoXuat || khoMacDinh),
        viTri: khoText_(item.viTri),
        soLuong: qty,
        ghiChu: khoText_(item.ghiChu)
      });
    });

    if (!clean.length) return outJson_({ ok:false, message:"Dòng xuất thiếu mã hàng nội bộ hoặc số lượng" });

    // Precheck + lập kế hoạch trước, không cập nhật nửa chừng nếu thiếu tồn.
    var work = [];
    for (var w = 0; w < tonRows.length; w++) {
      work.push({
        maHangNoiBo: khoText_(tonRows[w][0]),
        maBanHang: khoText_(tonRows[w][1]),
        kho: khoText_(tonRows[w][2]),
        viTri: khoText_(tonRows[w][3]),
        tonThucTe: khoNum_(tonRows[w][8]),
        tonGiu: khoNum_(tonRows[w][9]),
        khaDung: khoNum_(tonRows[w][10]),
        cho: khoNum_(tonRows[w][11]),
        loi: khoNum_(tonRows[w][13])
      });
    }

    // Kiểm tra đủ tồn cho toàn bộ phiếu trước khi tạo kho đích/cập nhật dữ liệu.
    // Nếu thiếu tồn, hệ thống trả lỗi ngay và không tạo dòng kho mới.
    var preWork = work.map(function(x) {
      return {
        maHangNoiBo:x.maHangNoiBo,
        kho:x.kho,
        viTri:x.viTri,
        tonThucTe:x.tonThucTe,
        tonGiu:x.tonGiu,
        cho:x.cho,
        loi:x.loi
      };
    });
    clean.forEach(function(item) {
      var remainingCheck = item.soLuong;
      for (var pi = 1; pi < preWork.length && remainingCheck > 0; pi++) {
        var pr = preWork[pi];
        if (pr.maHangNoiBo !== item.maHangNoiBo) continue;
        if (khoText_(pr.kho).toUpperCase() !== item.khoNguon.toUpperCase()) continue;
        if (item.viTriNguon && khoText_(pr.viTri).toUpperCase() !== item.viTriNguon.toUpperCase()) continue;
        var availableCheck = 0;
        if (nguonTon === "HANG_LOI") availableCheck = pr.loi;
        else if (nguonTon === "CHO_KIEM") availableCheck = pr.cho;
        else availableCheck = Math.max(pr.tonThucTe - pr.tonGiu, 0);
        if (availableCheck <= 0) continue;
        var takeCheck = Math.min(remainingCheck, availableCheck);
        if (nguonTon === "HANG_LOI") pr.loi = Math.max(pr.loi - takeCheck, 0);
        else if (nguonTon === "CHO_KIEM") pr.cho = Math.max(pr.cho - takeCheck, 0);
        else pr.tonThucTe = Math.max(pr.tonThucTe - takeCheck, 0);
        remainingCheck -= takeCheck;
      }
      if (remainingCheck > 0) {
        throw new Error("Không đủ tồn để chuyển mã " + item.maHangNoiBo + " từ kho " + item.khoNguon + ". Còn thiếu " + remainingCheck);
      }
    });

    var plan = [];
    clean.forEach(function(item) {
      var remaining = item.soLuong;
      var preferredKho = khoText_(item.kho).toUpperCase();
      var preferredViTri = khoText_(item.viTri).toUpperCase();

      for (var i = 1; i < work.length && remaining > 0; i++) {
        var r = work[i];
        if (r.maHangNoiBo !== item.maHangNoiBo) continue;
        if (preferredKho && khoText_(r.kho).toUpperCase() !== preferredKho) continue;
        if (preferredViTri && khoText_(r.viTri).toUpperCase() !== preferredViTri) continue;

        var available = 0;
        if (nguonTon === "HANG_LOI") available = r.loi;
        else if (nguonTon === "CHO_KIEM") available = r.cho;
        else available = Math.max(r.tonThucTe - r.tonGiu, 0);
        if (available <= 0) continue;

        var move = Math.min(remaining, available);
        if (nguonTon === "HANG_LOI") r.loi = Math.max(r.loi - move, 0);
        else if (nguonTon === "CHO_KIEM") r.cho = Math.max(r.cho - move, 0);
        else r.tonThucTe = Math.max(r.tonThucTe - move, 0);
        r.khaDung = Math.max(r.tonThucTe - r.tonGiu, 0);

        plan.push({ item:item, rowIndex:i + 1, workIndex:i, soLuong:move });
        remaining -= move;
      }

      if (remaining > 0) {
        throw new Error("Không đủ tồn để xuất mã " + item.maHangNoiBo + (item.kho ? (" tại kho " + item.kho) : "") + ". Còn thiếu " + remaining);
      }
    });

    var total = 0;
    var details = [];
    plan.forEach(function(p) {
      var r = work[p.workIndex];
      shTon.getRange(p.rowIndex, 9).setValue(r.tonThucTe);
      shTon.getRange(p.rowIndex, 11).setValue(r.khaDung);
      shTon.getRange(p.rowIndex, 12).setValue(r.cho);
      shTon.getRange(p.rowIndex, 14).setValue(r.loi);
      shTon.getRange(p.rowIndex, 15).setValue(now);

      shTheKho.appendRow([
        khoMakeId_("TK-"),
        now,
        "XUAT_KHO_THU_CONG",
        maPhieu,
        p.item.maHangNoiBo,
        p.item.maBanHang || r.maBanHang,
        r.kho,
        -p.soLuong,
        nguonTon === "HANG_LOI" ? r.loi : (nguonTon === "CHO_KIEM" ? r.cho : r.tonThucTe),
        nguoi,
        loaiXuat + (maThamChieu ? (" | Tham chiếu: " + maThamChieu) : "") + (ghiChu ? (" | " + ghiChu) : "") + (p.item.ghiChu ? (" | " + p.item.ghiChu) : "")
      ]);

      details.push({ maHangNoiBo:p.item.maHangNoiBo, maBanHang:p.item.maBanHang || r.maBanHang, kho:r.kho, viTri:r.viTri, soLuong:p.soLuong, nguonTon:nguonTon });
      total += p.soLuong;
    });

    var shPX = khoEnsurePhieuXuatManualSheet_();
    shPX.appendRow([
      maPhieu,
      now,
      loaiXuat,
      nguonTon,
      maThamChieu,
      khoMacDinh,
      total,
      "Đã xuất",
      nguoi,
      ghiChu,
      JSON.stringify(details)
    ]);

    SpreadsheetApp.flush();
    return outJson_({ ok:true, maPhieuXuat:maPhieu, tongSoLuong:total, soDong:details.length, details:details, message:"Đã xuất kho thủ công " + total + " cái" });
  } catch (err) {
    return outJson_({ ok:false, message:"Lỗi xuất kho thủ công: " + err.message });
  } finally {
    try { if (hasLock) lock.releaseLock(); } catch (e) {}
  }
}

function khoGetDashboardKhoTongHop_(data) {
  try {
    var shTon = getSheet_("KHO", "tbl_Kho_Ton");
    var tonRows = shTon.getDataRange().getValues();
    var summary = {
      tongSKU:0, tonThucTe:0, khaDung:0, tonGiu:0, choHoanThien:0, hangLoi:0,
      sapHetHang:0, amTon:0, giuVuotTon:0,
      nhapHomNay:0, xuatHomNay:0, soDongNhatKyHomNay:0
    };
    var sku = {};
    var lowList = [];
    var issueList = [];
    var nguongSapHet = khoNum_(data && data.nguongSapHet) || 10;

    for (var i = 1; i < tonRows.length; i++) {
      var maNB = khoText_(tonRows[i][0]);
      if (!maNB) continue;
      sku[maNB] = true;
      var ton = khoNum_(tonRows[i][8]);
      var giu = khoNum_(tonRows[i][9]);
      var kha = khoNum_(tonRows[i][10]);
      var cho = khoNum_(tonRows[i][11]);
      var loi = khoNum_(tonRows[i][13]);
      summary.tonThucTe += ton;
      summary.tonGiu += giu;
      summary.khaDung += kha;
      summary.choHoanThien += cho;
      summary.hangLoi += loi;
      if (kha > 0 && kha <= nguongSapHet) {
        summary.sapHetHang++;
        if (lowList.length < 20) lowList.push({ maHangNoiBo:maNB, maBanHang:khoText_(tonRows[i][1]), kho:khoText_(tonRows[i][2]), mau:khoText_(tonRows[i][6]), size:khoText_(tonRows[i][7]), khaDung:kha, tonThucTe:ton, tonGiu:giu });
      }
      if (ton < 0 || giu > ton || kha !== Math.max(ton - giu, 0)) {
        if (ton < 0) summary.amTon++;
        if (giu > ton) summary.giuVuotTon++;
        if (issueList.length < 20) issueList.push({ maHangNoiBo:maNB, maBanHang:khoText_(tonRows[i][1]), kho:khoText_(tonRows[i][2]), tonThucTe:ton, tonGiu:giu, khaDung:kha, khaDungDung:Math.max(ton - giu, 0) });
      }
    }
    summary.tongSKU = Object.keys(sku).length;

    try {
      var shTK = getSheet_("KHO", "tbl_Kho_TheKho");
      var tkRows = shTK.getDataRange().getValues();
      var today = dateVN_();
      for (var t = 1; t < tkRows.length; t++) {
        var timeText = khoText_(tkRows[t][1]);
        if (timeText.indexOf(today) !== 0) continue;
        var qty = khoNum_(tkRows[t][7]);
        if (qty > 0) summary.nhapHomNay += qty;
        if (qty < 0) summary.xuatHomNay += Math.abs(qty);
        summary.soDongNhatKyHomNay++;
      }
    } catch (eTK) {}

    return outJson_({ ok:true, summary:summary, sapHetHang:lowList, canhBao:issueList, params:{ nguongSapHet:nguongSapHet } });
  } catch (err) {
    return outJson_({ ok:false, message:"Lỗi dashboard kho tổng: " + err.message });
  }
}


/****************************************************
 * KHO THÀNH PHẨM - QUẢN LÝ MÃ HÀNG / BIẾN THỂ
 * Chỉ sửa thông tin mã, trạng thái bán và gộp mã bán hàng.
 * Không cộng/trừ số lượng tồn.
 ****************************************************/
function khoHasOwn_(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function khoUpdateTonMaBanHangByMaNoiBo_(maHangNoiBo, maBanHangMoi) {
  maHangNoiBo = khoText_(maHangNoiBo);
  maBanHangMoi = khoText_(maBanHangMoi);
  if (!maHangNoiBo || !maBanHangMoi) return 0;
  var updated = 0;
  try {
    var shTon = getSheet_("KHO", "tbl_Kho_Ton");
    var rows = shTon.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (khoText_(rows[i][0]) === maHangNoiBo) {
        shTon.getRange(i + 1, 2).setValue(maBanHangMoi); // B MaBanHang
        updated++;
      }
    }
  } catch (e) {}
  return updated;
}

function khoSaveBienTheInfo_(data) {
  data = data || {};
  var maHangNoiBo = khoText_(data.maHangNoiBo);
  if (!maHangNoiBo) return outJson_({ ok:false, message:"Thiếu mã hàng nội bộ" });

  var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
  var rows = shBT.getDataRange().getValues();
  var row = -1;
  for (var i = 1; i < rows.length; i++) {
    if (khoText_(rows[i][0]) === maHangNoiBo) { row = i + 1; break; }
  }
  if (row === -1) return outJson_({ ok:false, message:"Không tìm thấy biến thể: " + maHangNoiBo });

  var oldMaBanHang = khoText_(shBT.getRange(row, 2).getValue());
  var newMaBanHang = khoText_(data.maBanHang);
  var changes = [];

  if (newMaBanHang && newMaBanHang !== oldMaBanHang) {
    shBT.getRange(row, 2).setValue(newMaBanHang); // B MaBanHang
    khoUpdateTonMaBanHangByMaNoiBo_(maHangNoiBo, newMaBanHang);
    changes.push("Mã bán hàng: " + oldMaBanHang + " → " + newMaBanHang);
  }

  if (khoHasOwn_(data, "tenHienThi")) {
    shBT.getRange(row, 9).setValue(khoText_(data.tenHienThi)); // I TenHienThi
    changes.push("Tên hiển thị");
  }

  if (khoHasOwn_(data, "coBan")) {
    var coBan = khoText_(data.coBan) || "Có";
    shBT.getRange(row, 10).setValue(coBan); // J CoBan
    changes.push("Trạng thái bán: " + coBan);
  }

  if (khoHasOwn_(data, "ghiChu")) {
    shBT.getRange(row, 11).setValue(khoText_(data.ghiChu)); // K GhiChu
    changes.push("Ghi chú");
  }

  SpreadsheetApp.flush();
  return outJson_({
    ok:true,
    message: changes.length ? ("Đã lưu biến thể: " + maHangNoiBo) : "Không có thay đổi cần lưu",
    maHangNoiBo: maHangNoiBo,
    maBanHangCu: oldMaBanHang,
    maBanHangMoi: newMaBanHang || oldMaBanHang,
    changes: changes
  });
}

function khoSetMaBanHangStatus_(data) {
  data = data || {};
  var maBanHang = khoText_(data.maBanHang);
  var coBan = khoText_(data.coBan) || "Có";
  if (!maBanHang) return outJson_({ ok:false, message:"Thiếu mã bán hàng" });

  var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
  var rows = shBT.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < rows.length; i++) {
    if (khoText_(rows[i][1]) === maBanHang) {
      shBT.getRange(i + 1, 10).setValue(coBan); // J CoBan
      if (khoHasOwn_(data, "ghiChu") && khoText_(data.ghiChu)) {
        shBT.getRange(i + 1, 11).setValue(khoText_(data.ghiChu)); // K GhiChu
      }
      count++;
    }
  }
  if (!count) return outJson_({ ok:false, message:"Không tìm thấy mã bán hàng: " + maBanHang });
  SpreadsheetApp.flush();
  return outJson_({ ok:true, message:"Đã cập nhật " + count + " biến thể của mã " + maBanHang, maBanHang:maBanHang, coBan:coBan, count:count });
}

function khoMergeMaBanHang_(data) {
  data = data || {};
  var maNguon = khoText_(data.maNguon || data.from || data.source);
  var maDich = khoText_(data.maDich || data.to || data.target);
  if (!maNguon || !maDich) return outJson_({ ok:false, message:"Thiếu mã nguồn hoặc mã đích" });
  if (maNguon === maDich) return outJson_({ ok:false, message:"Mã nguồn và mã đích đang giống nhau" });

  var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
  var rowsBT = shBT.getDataRange().getValues();
  var countBT = 0;
  var targetExists = false;
  for (var i = 1; i < rowsBT.length; i++) {
    if (khoText_(rowsBT[i][1]) === maDich) targetExists = true;
  }
  for (var j = 1; j < rowsBT.length; j++) {
    if (khoText_(rowsBT[j][1]) === maNguon) {
      shBT.getRange(j + 1, 2).setValue(maDich); // B MaBanHang
      var oldNote = khoText_(rowsBT[j][10]);
      var addNote = "Gộp từ " + maNguon + " sang " + maDich + " lúc " + nowVN_();
      shBT.getRange(j + 1, 11).setValue(oldNote ? (oldNote + " | " + addNote) : addNote);
      countBT++;
    }
  }
  if (!countBT) return outJson_({ ok:false, message:"Không tìm thấy mã nguồn trong biến thể: " + maNguon });

  var countTon = 0;
  try {
    var shTon = getSheet_("KHO", "tbl_Kho_Ton");
    var rowsTon = shTon.getDataRange().getValues();
    for (var t = 1; t < rowsTon.length; t++) {
      if (khoText_(rowsTon[t][1]) === maNguon) {
        shTon.getRange(t + 1, 2).setValue(maDich); // B MaBanHang
        countTon++;
      }
    }
  } catch(eTon) {}

  try {
    var shAnh = khoEnsureAnhSanPhamSheet_();
    var rowsAnh = shAnh.getDataRange().getValues();
    var sourceRow = -1;
    var targetRow = -1;
    for (var a = 1; a < rowsAnh.length; a++) {
      if (khoText_(rowsAnh[a][1]) === maNguon) sourceRow = a + 1;
      if (khoText_(rowsAnh[a][1]) === maDich) targetRow = a + 1;
    }
    if (sourceRow > -1 && targetRow === -1) {
      shAnh.getRange(sourceRow, 2).setValue(maDich); // B MaBanHang
      shAnh.getRange(sourceRow, 11).setValue("Ảnh chuyển từ " + maNguon + " sang " + maDich + " lúc " + nowVN_());
    } else if (sourceRow > -1 && targetRow > -1) {
      shAnh.getRange(sourceRow, 10).setValue("Đã gộp");
      shAnh.getRange(sourceRow, 11).setValue("Mã đã gộp sang " + maDich + " lúc " + nowVN_());
    }
  } catch(eAnh) {}

  SpreadsheetApp.flush();
  return outJson_({
    ok:true,
    message:"Đã gộp " + maNguon + " sang " + maDich + ". Biến thể: " + countBT + ", dòng tồn cập nhật: " + countTon + (targetExists ? "" : ". Lưu ý: mã đích trước đó chưa có biến thể."),
    maNguon: maNguon,
    maDich: maDich,
    countBienThe: countBT,
    countTon: countTon
  });
}


/****************************************************
 * KHO THÀNH PHẨM - CHUYỂN KHO NỘI BỘ
 * - Trừ ở kho nguồn, cộng ở kho đích
 * - Không làm thay đổi tổng tồn toàn hệ thống
 * - Ghi phiếu chuyển kho và thẻ kho 2 chiều
 ****************************************************/
function khoEnsureChuyenKhoNoiBoSheet_() {
  var headers = [
    "MaPhieuChuyen", "ThoiGian", "NguonTon", "KhoNguon", "ViTriNguon",
    "KhoDich", "ViTriDich", "TongSoLuong", "TrangThai", "NguoiChuyen", "GhiChu", "ChiTietJson"
  ];
  var ss = getSS_("KHO");
  var sh = ss.getSheetByName("tbl_Kho_ChuyenKhoNoiBo");
  if (!sh) sh = ss.insertSheet("tbl_Kho_ChuyenKhoNoiBo");
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var empty = first.every(function(v) { return !khoText_(v); });
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function khoGetOrCreateTonRowForTransfer_(shTon, work, sourceInfo, maHangNoiBo, khoDich, viTriDich, now) {
  khoDich = khoText_(khoDich || "KHO CHÍNH");
  viTriDich = khoText_(viTriDich);

  for (var i = 1; i < work.length; i++) {
    if (
      work[i].maHangNoiBo === maHangNoiBo &&
      khoText_(work[i].kho).toUpperCase() === khoDich.toUpperCase() &&
      khoText_(work[i].viTri).toUpperCase() === viTriDich.toUpperCase()
    ) {
      return { rowIndex: i + 1, workIndex: i, item: work[i] };
    }
  }

  shTon.appendRow([
    maHangNoiBo,
    khoText_(sourceInfo.maBanHang),
    khoDich,
    viTriDich,
    khoText_(sourceInfo.maRap),
    khoText_(sourceInfo.hieu || "AZALAS"),
    khoText_(sourceInfo.mau),
    khoText_(sourceInfo.size),
    0,
    0,
    0,
    0,
    0,
    0,
    now
  ]);

  var newIndex = work.length;
  work.push({
    maHangNoiBo: maHangNoiBo,
    maBanHang: khoText_(sourceInfo.maBanHang),
    kho: khoDich,
    viTri: viTriDich,
    maRap: khoText_(sourceInfo.maRap),
    hieu: khoText_(sourceInfo.hieu || "AZALAS"),
    mau: khoText_(sourceInfo.mau),
    size: khoText_(sourceInfo.size),
    tonThucTe: 0,
    tonGiu: 0,
    khaDung: 0,
    cho: 0,
    daCotRi: 0,
    loi: 0
  });

  return { rowIndex: shTon.getLastRow(), workIndex: newIndex, item: work[newIndex] };
}

function khoSaveChuyenKhoNoiBo_(data) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    hasLock = lock.tryLock(25000);
    if (!hasLock) return outJson_({ ok:false, message:"Hệ thống đang có người thao tác kho. Vui lòng thử lại sau vài giây." });

    var items = Array.isArray(data.items) ? data.items : [];
    var nguonTon = khoText_(data.nguonTon || "HANG_TOT").toUpperCase();
    var khoNguonMacDinh = khoText_(data.khoNguon || "");
    var viTriNguonMacDinh = khoText_(data.viTriNguon || "");
    var khoDichMacDinh = khoText_(data.khoDich || "");
    var viTriDichMacDinh = khoText_(data.viTriDich || "");
    var nguoi = khoText_(data.nguoiChuyen || data.user || data.actorUser || "app");
    var ghiChu = khoText_(data.ghiChu);
    var now = nowVN_();
    var maPhieu = "CKNB" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + "-" + Math.floor(Math.random() * 1000);

    if (!["HANG_TOT", "HANG_LOI", "CHO_KIEM"].some(function(x){ return x === nguonTon; })) {
      return outJson_({ ok:false, message:"Nguồn tồn chuyển kho không hợp lệ" });
    }
    if (!items.length) return outJson_({ ok:false, message:"Chưa có dòng chuyển kho" });

    var clean = [];
    items.forEach(function(item) {
      var maNB = khoText_(item.maHangNoiBo);
      var qty = khoNum_(item.soLuong);
      var kNguon = khoText_(item.khoNguon || item.kho || khoNguonMacDinh);
      var vNguon = khoText_(item.viTriNguon || viTriNguonMacDinh);
      var kDich = khoText_(item.khoDich || khoDichMacDinh);
      var vDich = khoText_(item.viTriDich || viTriDichMacDinh);
      if (!maNB || qty <= 0) return;
      if (!kNguon || !kDich) throw new Error("Dòng chuyển mã " + maNB + " thiếu kho nguồn hoặc kho đích");
      if (khoText_(kNguon).toUpperCase() === khoText_(kDich).toUpperCase() && khoText_(vNguon).toUpperCase() === khoText_(vDich).toUpperCase()) {
        throw new Error("Dòng chuyển mã " + maNB + " có kho/vị trí nguồn trùng kho/vị trí đích");
      }
      clean.push({
        maHangNoiBo: maNB,
        soLuong: qty,
        khoNguon: kNguon,
        viTriNguon: vNguon,
        khoDich: kDich,
        viTriDich: vDich,
        ghiChu: khoText_(item.ghiChu)
      });
    });

    if (!clean.length) return outJson_({ ok:false, message:"Dòng chuyển thiếu mã hàng nội bộ hoặc số lượng" });

    var shTon = getSheet_("KHO", "tbl_Kho_Ton");
    var shTheKho = getSheet_("KHO", "tbl_Kho_TheKho");
    var tonRows = shTon.getDataRange().getValues();
    var work = [];

    for (var w = 0; w < tonRows.length; w++) {
      work.push({
        maHangNoiBo: khoText_(tonRows[w][0]),
        maBanHang: khoText_(tonRows[w][1]),
        kho: khoText_(tonRows[w][2]),
        viTri: khoText_(tonRows[w][3]),
        maRap: khoText_(tonRows[w][4]),
        hieu: khoText_(tonRows[w][5]),
        mau: khoText_(tonRows[w][6]),
        size: khoText_(tonRows[w][7]),
        tonThucTe: khoNum_(tonRows[w][8]),
        tonGiu: khoNum_(tonRows[w][9]),
        khaDung: khoNum_(tonRows[w][10]),
        cho: khoNum_(tonRows[w][11]),
        daCotRi: khoNum_(tonRows[w][12]),
        loi: khoNum_(tonRows[w][13])
      });
    }

    var plan = [];
    clean.forEach(function(item) {
      var remaining = item.soLuong;
      for (var i = 1; i < work.length && remaining > 0; i++) {
        var src = work[i];
        if (src.maHangNoiBo !== item.maHangNoiBo) continue;
        if (khoText_(src.kho).toUpperCase() !== item.khoNguon.toUpperCase()) continue;
        if (item.viTriNguon && khoText_(src.viTri).toUpperCase() !== item.viTriNguon.toUpperCase()) continue;

        var available = 0;
        if (nguonTon === "HANG_LOI") available = src.loi;
        else if (nguonTon === "CHO_KIEM") available = src.cho;
        else available = Math.max(src.tonThucTe - src.tonGiu, 0);
        if (available <= 0) continue;

        var move = Math.min(remaining, available);
        var dstWrap = khoGetOrCreateTonRowForTransfer_(shTon, work, src, item.maHangNoiBo, item.khoDich, item.viTriDich, now);
        var dst = dstWrap.item;

        if (nguonTon === "HANG_LOI") {
          src.loi = Math.max(src.loi - move, 0);
          dst.loi += move;
        } else if (nguonTon === "CHO_KIEM") {
          src.cho = Math.max(src.cho - move, 0);
          dst.cho += move;
        } else {
          src.tonThucTe = Math.max(src.tonThucTe - move, 0);
          dst.tonThucTe += move;
        }
        src.khaDung = Math.max(src.tonThucTe - src.tonGiu, 0);
        dst.khaDung = Math.max(dst.tonThucTe - dst.tonGiu, 0);

        plan.push({ item:item, soLuong:move, srcIndex:i, srcRow:i + 1, dstIndex:dstWrap.workIndex, dstRow:dstWrap.rowIndex });
        remaining -= move;
      }

      if (remaining > 0) {
        throw new Error("Không đủ tồn để chuyển mã " + item.maHangNoiBo + " từ kho " + item.khoNguon + ". Còn thiếu " + remaining);
      }
    });

    var total = 0;
    var details = [];
    plan.forEach(function(p) {
      var src = work[p.srcIndex];
      var dst = work[p.dstIndex];

      shTon.getRange(p.srcRow, 9).setValue(src.tonThucTe);
      shTon.getRange(p.srcRow, 11).setValue(src.khaDung);
      shTon.getRange(p.srcRow, 12).setValue(src.cho);
      shTon.getRange(p.srcRow, 14).setValue(src.loi);
      shTon.getRange(p.srcRow, 15).setValue(now);

      shTon.getRange(p.dstRow, 9).setValue(dst.tonThucTe);
      shTon.getRange(p.dstRow, 10).setValue(dst.tonGiu);
      shTon.getRange(p.dstRow, 11).setValue(dst.khaDung);
      shTon.getRange(p.dstRow, 12).setValue(dst.cho);
      shTon.getRange(p.dstRow, 14).setValue(dst.loi);
      shTon.getRange(p.dstRow, 15).setValue(now);

      shTheKho.appendRow([
        khoMakeId_("TK-"), now, "CHUYEN_KHO_XUAT", maPhieu,
        p.item.maHangNoiBo, src.maBanHang, src.kho, -p.soLuong,
        nguonTon === "HANG_LOI" ? src.loi : (nguonTon === "CHO_KIEM" ? src.cho : src.tonThucTe),
        nguoi,
        "Chuyển kho sang " + dst.kho + (dst.viTri ? (" / " + dst.viTri) : "") + (ghiChu ? (" | " + ghiChu) : "") + (p.item.ghiChu ? (" | " + p.item.ghiChu) : "")
      ]);
      shTheKho.appendRow([
        khoMakeId_("TK-"), now, "CHUYEN_KHO_NHAP", maPhieu,
        p.item.maHangNoiBo, dst.maBanHang || src.maBanHang, dst.kho, p.soLuong,
        nguonTon === "HANG_LOI" ? dst.loi : (nguonTon === "CHO_KIEM" ? dst.cho : dst.tonThucTe),
        nguoi,
        "Nhận chuyển kho từ " + src.kho + (src.viTri ? (" / " + src.viTri) : "") + (ghiChu ? (" | " + ghiChu) : "") + (p.item.ghiChu ? (" | " + p.item.ghiChu) : "")
      ]);

      details.push({
        maHangNoiBo:p.item.maHangNoiBo,
        maBanHang:src.maBanHang,
        nguonTon:nguonTon,
        khoNguon:src.kho,
        viTriNguon:src.viTri,
        khoDich:dst.kho,
        viTriDich:dst.viTri,
        soLuong:p.soLuong
      });
      total += p.soLuong;
    });

    var shCK = khoEnsureChuyenKhoNoiBoSheet_();
    shCK.appendRow([
      maPhieu,
      now,
      nguonTon,
      khoNguonMacDinh,
      viTriNguonMacDinh,
      khoDichMacDinh,
      viTriDichMacDinh,
      total,
      "Đã chuyển",
      nguoi,
      ghiChu,
      JSON.stringify(details)
    ]);

    SpreadsheetApp.flush();
    return outJson_({ ok:true, maPhieuChuyen:maPhieu, tongSoLuong:total, soDong:details.length, details:details, message:"Đã chuyển kho nội bộ " + total + " cái" });
  } catch (err) {
    return outJson_({ ok:false, message:"Lỗi chuyển kho nội bộ: " + err.message });
  } finally {
    try { if (hasLock) lock.releaseLock(); } catch (e) {}
  }
}

function khoGetChuyenKhoNoiBoList_(data) {
  try {
    var q = khoText_(data.q).toLowerCase();
    var limit = khoNum_(data.limit || 100);
    if (limit <= 0) limit = 100;
    if (limit > 300) limit = 300;
    var sh = khoEnsureChuyenKhoNoiBoSheet_();
    var rows = sh.getDataRange().getValues();
    var out = [];
    var summary = { total:0, tongSoLuong:0 };

    for (var i = rows.length - 1; i >= 1 && out.length < limit; i--) {
      var r = rows[i];
      var detailText = khoText_(r[11]);
      var hay = [r[0], r[2], r[3], r[5], r[8], r[9], r[10], detailText].join(" ").toLowerCase();
      if (q && hay.indexOf(q) === -1) continue;
      var details = safeParseJson_(detailText, []);
      var item = {
        maPhieuChuyen:khoText_(r[0]),
        thoiGian:khoText_(r[1]),
        nguonTon:khoText_(r[2]),
        khoNguon:khoText_(r[3]),
        viTriNguon:khoText_(r[4]),
        khoDich:khoText_(r[5]),
        viTriDich:khoText_(r[6]),
        tongSoLuong:khoNum_(r[7]),
        trangThai:khoText_(r[8]),
        nguoiChuyen:khoText_(r[9]),
        ghiChu:khoText_(r[10]),
        details:details
      };
      summary.total++;
      summary.tongSoLuong += item.tongSoLuong;
      out.push(item);
    }
    return outJson_({ ok:true, summary:summary, data:out });
  } catch (err) {
    return outJson_({ ok:false, message:"Lỗi tải phiếu chuyển kho: " + err.message });
  }
}


/****************************************************
 * KHO THÀNH PHẨM - PHIẾU KHÁCH TRẢ HÀNG
 * - Nhận hàng khách trả về kho
 * - Phân loại: hàng tốt / hàng lỗi / không nhập lại kho
 * - Ghi phiếu trả hàng và nhật ký kho
 ****************************************************/
function khoEnsureKhachTraHangSheet_() {
  var headers = [
    "MaPhieuTra", "ThoiGian", "MaHoaDon", "MaKH", "TenKhach", "KhoNhap", "ViTriNhap",
    "TinhTrangTra", "TongSoLuong", "SoLuongNhapKho", "TrangThai", "NguoiNhan", "LyDo", "GhiChu", "ChiTietJson"
  ];
  var ss = getSS_("KHO");
  var sh = ss.getSheetByName("tbl_Kho_KhachTraHang");
  if (!sh) sh = ss.insertSheet("tbl_Kho_KhachTraHang");
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var empty = first.every(function(v) { return !khoText_(v); });
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function khoGetBienTheInfoForReturn_(maHangNoiBo) {
  maHangNoiBo = khoText_(maHangNoiBo);
  var info = {
    maHangNoiBo: maHangNoiBo,
    maBanHang: maHangNoiBo,
    maSP: "",
    maRap: "",
    mauSanPham: "",
    hieu: "AZALAS",
    mau: "",
    size: "",
    tenHienThi: ""
  };
  if (!maHangNoiBo) return info;
  try {
    var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
    var rows = shBT.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (khoText_(rows[i][0]) === maHangNoiBo) {
        info.maBanHang = khoText_(rows[i][1]) || maHangNoiBo;
        info.maSP = khoText_(rows[i][2]);
        info.maRap = khoText_(rows[i][3]);
        info.mauSanPham = khoText_(rows[i][4]);
        info.hieu = khoText_(rows[i][5]) || "AZALAS";
        info.mau = khoText_(rows[i][6]);
        info.size = khoText_(rows[i][7]);
        info.tenHienThi = khoText_(rows[i][8]);
        break;
      }
    }
  } catch (err) {}
  return info;
}

function khoFindOrCreateTonRowForReturn_(shTon, work, info, khoNhap, viTriNhap, now) {
  var maHangNoiBo = khoText_(info.maHangNoiBo);
  khoNhap = khoText_(khoNhap || "KHO CHÍNH");
  viTriNhap = khoText_(viTriNhap);

  for (var i = 1; i < work.length; i++) {
    if (
      work[i].maHangNoiBo === maHangNoiBo &&
      khoText_(work[i].kho).toUpperCase() === khoNhap.toUpperCase() &&
      khoText_(work[i].viTri).toUpperCase() === viTriNhap.toUpperCase()
    ) {
      return { rowIndex: i + 1, workIndex: i, item: work[i] };
    }
  }

  shTon.appendRow([
    maHangNoiBo,
    khoText_(info.maBanHang || maHangNoiBo),
    khoNhap,
    viTriNhap,
    khoText_(info.maRap),
    khoText_(info.hieu || "AZALAS"),
    khoText_(info.mau),
    khoText_(info.size),
    0, 0, 0, 0, 0, 0,
    now
  ]);

  var newIndex = work.length;
  work.push({
    maHangNoiBo: maHangNoiBo,
    maBanHang: khoText_(info.maBanHang || maHangNoiBo),
    kho: khoNhap,
    viTri: viTriNhap,
    maRap: khoText_(info.maRap),
    hieu: khoText_(info.hieu || "AZALAS"),
    mau: khoText_(info.mau),
    size: khoText_(info.size),
    tonThucTe: 0,
    tonGiu: 0,
    khaDung: 0,
    cho: 0,
    daCotRi: 0,
    loi: 0
  });

  return { rowIndex: shTon.getLastRow(), workIndex: newIndex, item: work[newIndex] };
}

function khoNormalizeTinhTrangTra_(value) {
  var s = khoText_(value || "HANG_TOT").toUpperCase();
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/Đ/g, "D");
  if (s.indexOf("LOI") !== -1 || s === "HANG_LOI") return "HANG_LOI";
  if (s.indexOf("KHONG") !== -1 || s.indexOf("KO") !== -1 || s === "KHONG_NHAP_LAI") return "KHONG_NHAP_LAI";
  return "HANG_TOT";
}

function khoLabelTinhTrangTra_(key) {
  key = khoNormalizeTinhTrangTra_(key);
  if (key === "HANG_LOI") return "Hàng lỗi";
  if (key === "KHONG_NHAP_LAI") return "Không nhập lại kho";
  return "Hàng tốt";
}

function khoSaveKhachTraHang_(data) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    hasLock = lock.tryLock(25000);
    if (!hasLock) return outJson_({ ok:false, message:"Hệ thống đang có người thao tác kho. Vui lòng thử lại sau vài giây." });

    var items = Array.isArray(data.items) ? data.items : [];
    var maHoaDon = khoText_(data.maHoaDon);
    var maKH = khoText_(data.maKH);
    var tenKhach = khoText_(data.tenKhach);
    var khoNhapMacDinh = khoText_(data.khoNhap || data.kho || "KHO CHÍNH");
    var viTriNhapMacDinh = khoText_(data.viTriNhap || data.viTri);
    var tinhTrangMacDinh = khoNormalizeTinhTrangTra_(data.tinhTrangTra || "HANG_TOT");
    var nguoi = khoText_(data.nguoiNhan || data.user || data.actorUser || "app");
    var lyDo = khoText_(data.lyDo);
    var ghiChu = khoText_(data.ghiChu);
    var now = nowVN_();
    var maPhieu = "KTH" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + "-" + Math.floor(Math.random() * 1000);

    if (!items.length) return outJson_({ ok:false, message:"Chưa có dòng hàng trả" });

    var clean = [];
    items.forEach(function(item) {
      var maNB = khoText_(item.maHangNoiBo);
      var qty = khoNum_(item.soLuong);
      var kNhap = khoText_(item.khoNhap || item.kho || khoNhapMacDinh);
      var vNhap = khoText_(item.viTriNhap || item.viTri || viTriNhapMacDinh);
      var tinhTrang = khoNormalizeTinhTrangTra_(item.tinhTrangTra || tinhTrangMacDinh);
      if (!maNB || qty <= 0) return;
      if (!kNhap && tinhTrang !== "KHONG_NHAP_LAI") throw new Error("Dòng trả mã " + maNB + " thiếu kho nhập lại");
      clean.push({
        maHangNoiBo: maNB,
        soLuong: qty,
        khoNhap: kNhap || khoNhapMacDinh,
        viTriNhap: vNhap,
        tinhTrangTra: tinhTrang,
        ghiChu: khoText_(item.ghiChu)
      });
    });

    if (!clean.length) return outJson_({ ok:false, message:"Dòng trả thiếu mã hàng nội bộ hoặc số lượng" });

    var shTon = getSheet_("KHO", "tbl_Kho_Ton");
    var shTheKho = getSheet_("KHO", "tbl_Kho_TheKho");
    var tonRows = shTon.getDataRange().getValues();
    var work = [];
    for (var w = 0; w < tonRows.length; w++) {
      work.push({
        maHangNoiBo: khoText_(tonRows[w][0]),
        maBanHang: khoText_(tonRows[w][1]),
        kho: khoText_(tonRows[w][2]),
        viTri: khoText_(tonRows[w][3]),
        maRap: khoText_(tonRows[w][4]),
        hieu: khoText_(tonRows[w][5]),
        mau: khoText_(tonRows[w][6]),
        size: khoText_(tonRows[w][7]),
        tonThucTe: khoNum_(tonRows[w][8]),
        tonGiu: khoNum_(tonRows[w][9]),
        khaDung: khoNum_(tonRows[w][10]),
        cho: khoNum_(tonRows[w][11]),
        daCotRi: khoNum_(tonRows[w][12]),
        loi: khoNum_(tonRows[w][13])
      });
    }

    var details = [];
    var tongSL = 0;
    var soLuongNhapKho = 0;

    clean.forEach(function(item) {
      var info = khoGetBienTheInfoForReturn_(item.maHangNoiBo);
      var rowInfo = null;
      var tonSau = 0;
      var soLuongThayDoi = item.tinhTrangTra === "KHONG_NHAP_LAI" ? 0 : item.soLuong;

      if (item.tinhTrangTra !== "KHONG_NHAP_LAI") {
        rowInfo = khoFindOrCreateTonRowForReturn_(shTon, work, info, item.khoNhap, item.viTriNhap, now);
        var ton = rowInfo.item;
        if (item.tinhTrangTra === "HANG_LOI") {
          ton.loi += item.soLuong;
          tonSau = ton.loi;
        } else {
          ton.tonThucTe += item.soLuong;
          ton.khaDung = Math.max(ton.tonThucTe - ton.tonGiu, 0);
          tonSau = ton.tonThucTe;
        }

        shTon.getRange(rowInfo.rowIndex, 9).setValue(ton.tonThucTe);
        shTon.getRange(rowInfo.rowIndex, 10).setValue(ton.tonGiu);
        shTon.getRange(rowInfo.rowIndex, 11).setValue(ton.khaDung);
        shTon.getRange(rowInfo.rowIndex, 12).setValue(ton.cho);
        shTon.getRange(rowInfo.rowIndex, 13).setValue(ton.daCotRi);
        shTon.getRange(rowInfo.rowIndex, 14).setValue(ton.loi);
        shTon.getRange(rowInfo.rowIndex, 15).setValue(now);
        soLuongNhapKho += item.soLuong;
      }

      shTheKho.appendRow([
        khoMakeId_("TK-"),
        now,
        item.tinhTrangTra === "HANG_LOI" ? "KHACH_TRA_HANG_LOI" : (item.tinhTrangTra === "KHONG_NHAP_LAI" ? "KHACH_TRA_KHONG_NHAP_KHO" : "KHACH_TRA_HANG_TOT"),
        maPhieu,
        item.maHangNoiBo,
        info.maBanHang || item.maHangNoiBo,
        item.khoNhap || khoNhapMacDinh,
        soLuongThayDoi,
        tonSau,
        nguoi,
        "Khách trả hàng" + (maHoaDon ? " từ hóa đơn " + maHoaDon : "") + " | " + khoLabelTinhTrangTra_(item.tinhTrangTra) + (lyDo ? " | " + lyDo : "") + (item.ghiChu ? " | " + item.ghiChu : "")
      ]);

      tongSL += item.soLuong;
      details.push({
        maHangNoiBo: item.maHangNoiBo,
        maBanHang: info.maBanHang || item.maHangNoiBo,
        maSP: info.maSP || "",
        maRap: info.maRap || "",
        mau: info.mau || "",
        size: info.size || "",
        soLuong: item.soLuong,
        khoNhap: item.khoNhap || khoNhapMacDinh,
        viTriNhap: item.viTriNhap || "",
        tinhTrangTra: item.tinhTrangTra,
        tinhTrangText: khoLabelTinhTrangTra_(item.tinhTrangTra),
        ghiChu: item.ghiChu || ""
      });
    });

    khoEnsureKhachTraHangSheet_().appendRow([
      maPhieu,
      now,
      maHoaDon,
      maKH,
      tenKhach,
      khoNhapMacDinh,
      viTriNhapMacDinh,
      khoLabelTinhTrangTra_(tinhTrangMacDinh),
      tongSL,
      soLuongNhapKho,
      "Đã nhận",
      nguoi,
      lyDo,
      ghiChu,
      JSON.stringify(details)
    ]);

    SpreadsheetApp.flush();
    return outJson_({ ok:true, message:"Đã lưu phiếu khách trả " + tongSL + " cái. Nhập lại kho: " + soLuongNhapKho + " cái.", maPhieuTra:maPhieu, tongSoLuong:tongSL, soLuongNhapKho:soLuongNhapKho });
  } catch (err) {
    return outJson_({ ok:false, message:"Lỗi phiếu khách trả: " + err.message });
  } finally {
    try { if (hasLock) lock.releaseLock(); } catch(e) {}
  }
}

function khoGetKhachTraHangList_(data) {
  try {
    var q = khoText_(data.q).toLowerCase();
    var limit = khoNum_(data.limit || 100);
    if (limit <= 0) limit = 100;
    if (limit > 300) limit = 300;
    var sh = khoEnsureKhachTraHangSheet_();
    var rows = sh.getDataRange().getValues();
    var list = [];
    var tongSL = 0;
    var tongNhapKho = 0;

    for (var i = rows.length - 1; i >= 1 && list.length < limit; i--) {
      var r = rows[i];
      if (!khoText_(r[0])) continue;
      var text = r.join(" ").toLowerCase();
      if (q && text.indexOf(q) === -1) continue;
      var details = safeParseJson_(khoText_(r[14]), []);
      var item = {
        maPhieuTra: khoText_(r[0]),
        thoiGian: khoText_(r[1]),
        maHoaDon: khoText_(r[2]),
        maKH: khoText_(r[3]),
        tenKhach: khoText_(r[4]),
        khoNhap: khoText_(r[5]),
        viTriNhap: khoText_(r[6]),
        tinhTrangTra: khoText_(r[7]),
        tongSoLuong: khoNum_(r[8]),
        soLuongNhapKho: khoNum_(r[9]),
        trangThai: khoText_(r[10]),
        nguoiNhan: khoText_(r[11]),
        lyDo: khoText_(r[12]),
        ghiChu: khoText_(r[13]),
        details: Array.isArray(details) ? details : []
      };
      tongSL += item.tongSoLuong;
      tongNhapKho += item.soLuongNhapKho;
      list.push(item);
    }

    return outJson_({ ok:true, data:list, summary:{ total:list.length, tongSoLuong:tongSL, soLuongNhapKho:tongNhapKho } });
  } catch (err) {
    return outJson_({ ok:false, message:"Lỗi tải phiếu khách trả: " + err.message });
  }
}


/****************************************************
 * AZALAS - BỔ SUNG QUẢN TRỊ VẬN HÀNH
 * - Công nợ khách hàng có thu tiền và lịch sử
 * - Báo cáo lợi nhuận lọc theo ngày / mã / nhóm form
 * - Checklist test hệ thống chi tiết
 * Chỉ bổ sung API riêng, không thay luồng kho/rập/đơn hàng hiện có.
 ****************************************************/
function azMngParseDateLoose_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  var s = azMngText_(v);
  if (!s) return null;
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function azMngDateKey_(v) {
  var d = azMngParseDateLoose_(v);
  if (!d) return "";
  return Utilities.formatDate(d, "GMT+7", "yyyy-MM-dd");
}
function azMngDateInRange_(v, from, to) {
  var d = azMngParseDateLoose_(v);
  if (!d) return true;
  var f = azMngParseDateLoose_(from);
  var t = azMngParseDateLoose_(to);
  if (f) { f.setHours(0,0,0,0); if (d < f) return false; }
  if (t) { t.setHours(23,59,59,999); if (d > t) return false; }
  return true;
}
function azMngCustomerPaymentSheet_() {
  return azMngEnsureSheet_("SALES", "tbl_KhachHang_ThanhToan", [
    "MaThanhToan", "ThoiGian", "MaKH", "TenKhach", "SoTien", "PhuongThuc", "MaHoaDon", "NguoiThu", "GhiChu", "TrangThai"
  ]);
}
function azMngCustomerPaymentMap_() {
  var out = {};
  try {
    var sh = azMngCustomerPaymentSheet_();
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var st = azMngText_(rows[i][9]).toLowerCase();
      if (st && st.indexOf("hủy") !== -1) continue;
      var ma = azMngText_(rows[i][2]);
      var ten = azMngText_(rows[i][3]);
      var k = ma || ten;
      if (!k) continue;
      out[k] = (out[k] || 0) + azMngNum_(rows[i][4]);
    }
  } catch (err) {}
  return out;
}
function azMngGetCustomerDebt_(data) {
  var q = azMngText_(data.q).toLowerCase();
  var kh = azMngRows_("SALES", "tbl_KhachHang", 8000);
  var payments = azMngCustomerPaymentMap_();
  var out = [];
  kh.rows.forEach(function(r) {
    var maKH = azMngText_(azMngPick_(r, kh.map, ["MaKH", "MaKhachHang", "MaKhach"], 0));
    var ten = azMngText_(azMngPick_(r, kh.map, ["TenKhach", "TenKhachHang", "KhachHang", "Ten"], 1));
    var sdt = azMngText_(azMngPick_(r, kh.map, ["SDT", "DienThoai", "Phone"], 2));
    var baseNo = 0;
    for (var i = 0; i < r.length; i++) {
      var hRaw = azMngText_(kh.headers[i]);
      var h = hRaw.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/Đ/g, "D");
      if (h.indexOf("NO") !== -1 || h.indexOf("CONG") !== -1 || h.indexOf("CON LAI") !== -1) {
        baseNo = Math.max(baseNo, Math.abs(azMngNum_(r[i])));
      }
    }
    var daThu = (payments[maKH] || 0) + (!maKH ? 0 : 0);
    if (!daThu && payments[ten]) daThu = payments[ten];
    var conNo = Math.max(baseNo - daThu, 0);
    var hay = [maKH, ten, sdt, conNo].join(" ").toLowerCase();
    if (q && hay.indexOf(q) === -1) return;
    out.push({ maKH: maKH, tenKhach: ten, sdt: sdt, noGoc: baseNo, daThu: daThu, conNo: conNo, ghiChu: azMngText_(r[6]) });
  });
  out.sort(function(a,b){ return b.conNo - a.conNo; });
  return { ok: true, summary: {
    soKhach: out.length,
    tongNoGoc: out.reduce(function(s,x){ return s + x.noGoc; }, 0),
    tongDaThu: out.reduce(function(s,x){ return s + x.daThu; }, 0),
    tongNo: out.reduce(function(s,x){ return s + x.conNo; }, 0)
  }, data: out.slice(0, azMngNum_(data.limit || 300) || 300) };
}
function azMngSaveCustomerPayment_(data) {
  azMngAssertFull_(data);
  var maKH = azMngText_(data.maKH);
  var ten = azMngText_(data.tenKhach);
  var soTien = azMngNum_(data.soTien);
  if (!maKH && !ten) return { ok: false, message: "Thiếu mã khách hoặc tên khách" };
  if (soTien <= 0) return { ok: false, message: "Số tiền thu phải lớn hơn 0" };
  var sh = azMngCustomerPaymentSheet_();
  var now = azMngNow_();
  var id = azMngMakeId_("TTKH-");
  sh.appendRow([
    id, now, maKH, ten, soTien, azMngText_(data.phuongThuc || "Tiền mặt"), azMngText_(data.maHoaDon),
    azMngText_(data.actorUser || data.user || "app"), azMngText_(data.ghiChu), "Đã thu"
  ]);
  return { ok: true, message: "Đã ghi nhận thu tiền khách", maThanhToan: id };
}
function azMngGetCustomerPaymentHistory_(data) {
  data = data || {};
  var q = azMngText_(data.q).toLowerCase();
  var from = data.fromDate || data.tuNgay;
  var to = data.toDate || data.denNgay;
  var limit = azMngNum_(data.limit || 300) || 300;
  var out = [];
  var seen = {};

  function pushPay_(x) {
    x = x || {};
    x.soTien = azMngNum_(x.soTien);
    if (x.soTien <= 0) return;
    var hay = [
      x.maThanhToan, x.maKH, x.tenKhach, x.maHoaDon,
      x.nguoiThu, x.ghiChu, x.phuongThuc
    ].join(" ").toLowerCase();
    if (q && hay.indexOf(q) === -1) return;
    if (!azMngDateInRange_(x.thoiGian, from, to)) return;
    var key = azMngText_(x.maThanhToan) || (azMngText_(x.maHoaDon) + "|" + azMngText_(x.thoiGian) + "|" + x.soTien);
    if (key && seen[key]) return;
    if (key) seen[key] = true;
    out.push({
      maThanhToan: azMngText_(x.maThanhToan),
      thoiGian: x.thoiGian || "",
      maKH: azMngText_(x.maKH),
      tenKhach: azMngText_(x.tenKhach),
      soTien: x.soTien,
      phuongThuc: azMngText_(x.phuongThuc || "Theo hóa đơn"),
      maHoaDon: azMngText_(x.maHoaDon),
      nguoiThu: azMngText_(x.nguoiThu),
      ghiChu: azMngText_(x.ghiChu),
      trangThai: azMngText_(x.trangThai || "Đã ghi nhận")
    });
  }

  // 1) Nguồn chuẩn: bảng thu tiền khách.
  try {
    var sh = azMngCustomerPaymentSheet_();
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var tt = azMngText_(rows[i][9]).toLowerCase();
      if (tt && (tt.indexOf("hủy") !== -1 || tt.indexOf("huy") !== -1 || tt.indexOf("xóa") !== -1 || tt.indexOf("xoa") !== -1)) continue;
      pushPay_({
        maThanhToan: rows[i][0],
        thoiGian: rows[i][1],
        maKH: rows[i][2],
        tenKhach: rows[i][3],
        soTien: rows[i][4],
        phuongThuc: rows[i][5],
        maHoaDon: rows[i][6],
        nguoiThu: rows[i][7],
        ghiChu: rows[i][8],
        trangThai: rows[i][9]
      });
    }
  } catch (errPaySheet) {}

  // 2) Fallback: nhiều đơn cũ chỉ lưu tiền đã thanh toán ngay trên tbl_DonHang.
  // Nhờ fallback này tab Dòng tiền không bị trắng khi chưa dùng bảng thu tiền mới.
  try {
    var dh = azMngRows_("SALES", "tbl_DonHang", 30000);
    dh.rows.forEach(function(r) {
      var maHD = azMngText_(azMngPick_(r, dh.map, ["MaHoaDon", "MaDon", "MaHD"], 0));
      if (!maHD) return;

      var trangThai = azMngText_(azMngPick_(r, dh.map, ["TrangThai"], 6));
      var trangThaiHD = azMngText_(azMngPick_(r, dh.map, ["TrangThaiHoaDon", "TrangThaiHD"], 13));
      if (azMngIsCanceledExec_(trangThai) || azMngIsCanceledExec_(trangThaiHD)) return;

      var daThu = azMngNum_(azMngPick_(r, dh.map, ["DaThanhToan", "DaThu", "TienDaThu", "TienKhachTra"], 12));
      if (daThu <= 0) return;

      var thoiGian = azMngPick_(r, dh.map, ["CapNhatCuoi", "ThoiGianCapNhat", "NgayChot", "NgayThu"], 21) ||
                    azMngPick_(r, dh.map, ["NgayTao", "Ngay", "NgayDon", "ThoiGian", "ThoiGianTao"], 1);

      pushPay_({
        maThanhToan: "HD-" + maHD,
        thoiGian: thoiGian,
        maKH: azMngPick_(r, dh.map, ["MaKH", "MaKhach"], 8),
        tenKhach: azMngPick_(r, dh.map, ["TenKhach", "KhachHang"], 2),
        soTien: daThu,
        phuongThuc: azMngPick_(r, dh.map, ["PhuongThuc", "HinhThucThanhToan", "KieuThanhToan"], -1) || "Theo hóa đơn",
        maHoaDon: maHD,
        nguoiThu: azMngPick_(r, dh.map, ["NguoiTao", "NguoiSoan", "NguoiThu"], 18),
        ghiChu: "Tự lấy từ cột Đã thanh toán của hóa đơn",
        trangThai: trangThaiHD || trangThai || "Đã ghi nhận"
      });
    });
  } catch (errPayOrder) {}

  out.sort(function(a, b) {
    var da = azMngParseDateLoose_(a.thoiGian);
    var db = azMngParseDateLoose_(b.thoiGian);
    return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
  });

  return {
    ok: true,
    summary: {
      soDong: out.length,
      tongThu: out.reduce(function(s, x) { return s + azMngNum_(x.soTien); }, 0)
    },
    data: out.slice(0, limit)
  };
}
function azMngOrderDateMap_() {
  var map = {};
  var orders = azMngRows_("SALES", "tbl_DonHang", 20000);
  orders.rows.forEach(function(r) {
    var ma = azMngText_(azMngPick_(r, orders.map, ["MaHoaDon", "MaDon", "MaHD"], 0));
    var ngay = azMngPick_(r, orders.map, ["NgayTao", "Ngay", "NgayDon", "ThoiGian", "ThoiGianTao"], 1);
    if (ma) map[ma] = ngay;
  });
  return map;
}
function azMngGetProfitReport_(data) {
  var q = azMngText_(data.q).toLowerCase();
  var from = data.fromDate || data.tuNgay;
  var to = data.toDate || data.denNgay;
  var groupBy = azMngText_(data.groupBy || data.nhom || "ITEM").toUpperCase();
  var rows = azMngRows_("SALES", "tbl_DonHang_CT_Size", 30000).rows;
  var orderDates = azMngOrderDateMap_();
  var cost = azMngCostMap_();
  var byItem = {};
  var totalQty = 0, totalRevenue = 0, totalCost = 0, missingCost = 0;
  rows.forEach(function(r) {
    var maHD = azMngText_(r[0]);
    var maBH = azMngText_(r[2]);
    var maNB = azMngText_(r[3]);
    var mau = azMngText_(r[6]);
    var size = azMngText_(r[7]);
    var qty = azMngNum_(r[9]);
    var price = azMngNum_(r[10]);
    var amount = azMngNum_(r[11]) || qty * price;
    if (qty <= 0) return;
    var ngay = orderDates[maHD] || "";
    if (!azMngDateInRange_(ngay, from, to)) return;
    var form = azMngFormKey_(maNB || maBH);
    var hay = [maHD, maNB, maBH, form, mau, size].join(" ").toLowerCase();
    if (q && hay.indexOf(q) === -1) return;
    var gv = azMngLookupCost_(cost, maNB, maBH, "");
    if (gv <= 0) missingCost += 1;
    var key = groupBy === "FORM" ? (form || maNB || maBH || "KHONG_MA") : (maNB || maBH || "KHONG_MA");
    if (!byItem[key]) byItem[key] = { maForm: form, maHangNoiBo: groupBy === "FORM" ? "" : maNB, maBanHang: groupBy === "FORM" ? "" : maBH, mau: groupBy === "FORM" ? "Tổng form" : mau, size: groupBy === "FORM" ? "" : size, soLuong: 0, doanhThu: 0, giaVon: gv, tongVon: 0, loiNhuan: 0, nguonGiaVon: azMngCostSource_(cost, maNB, maBH, "") };
    byItem[key].soLuong += qty;
    byItem[key].doanhThu += amount;
    byItem[key].tongVon += gv * qty;
    byItem[key].loiNhuan = byItem[key].doanhThu - byItem[key].tongVon;
    totalQty += qty; totalRevenue += amount; totalCost += gv * qty;
  });
  var arr = Object.keys(byItem).map(function(k) { return byItem[k]; }).sort(function(a,b){ return b.doanhThu - a.doanhThu; });
  return { ok: true, summary: { soLuong: totalQty, doanhThu: totalRevenue, giaVon: totalCost, loiNhuan: totalRevenue - totalCost, thieuGiaVon: missingCost, nhom: groupBy }, data: arr.slice(0, azMngNum_(data.limit || 300) || 300) };
}
function azMngGetAdminTestPlan_(data) {
  return { ok: true, data: [
    { nhom: "Đăng nhập", viec: "OWNER vào đủ menu, ADMIN vào đủ menu, MEMBER chỉ hiện mục được cấp", ketQuaDung: "Menu và quyền đúng theo từng tài khoản" },
    { nhom: "Công nợ khách", viec: "Vào Quản trị tổng > Công nợ KH, tìm khách, ghi nhận thu thử 1.000đ", ketQuaDung: "Có lịch sử thu, công nợ hiển thị giảm theo phần đã thu trong app" },
    { nhom: "Giá vốn", viec: "Lưu giá vốn form 859DUI, tìm các mã 859DUI-...", ketQuaDung: "Các màu/size cùng form hiện cùng giá vốn" },
    { nhom: "Lợi nhuận", viec: "Vào tab Lợi nhuận, lọc theo form và theo ngày", ketQuaDung: "Doanh thu, vốn, lãi thay đổi theo bộ lọc" },
    { nhom: "Backup", viec: "Tạo backup ngay", ketQuaDung: "Drive có folder theo ngày/giờ và log có link mở folder" },
    { nhom: "Kho", viec: "Nhập kho, xuất kho thủ công, chuyển kho, khách trả", ketQuaDung: "Tồn thay đổi đúng, không trắng màn" },
    { nhom: "Kiểm kê", viec: "Gửi duyệt tồn rồi duyệt", ketQuaDung: "Chỉ sau khi duyệt tồn mới thay đổi" },
    { nhom: "QL Rập", viec: "OWNER/ADMIN vào xem đơn, nhà may, thợ cắt; MEMBER vào xem đơn", ketQuaDung: "OWNER/ADMIN đầy đủ, MEMBER chỉ nhập/lịch sử" },
    { nhom: "Giao diện", viec: "Test PC và điện thoại: menu trái, popup, thanh trượt, gợi ý mã", ketQuaDung: "Dễ bấm, không hiện popup trình duyệt xấu" }
  ] };
}

function azMngDateKeyExec_(v) {
  if (!v) return "";
  var d = null;
  if (v instanceof Date && !isNaN(v.getTime())) d = v;
  else {
    var s = azMngText_(v);
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    else d = new Date(s);
  }
  if (!d || isNaN(d.getTime())) return "";
  return Utilities.formatDate(d, "GMT+7", "yyyy-MM-dd");
}
function azMngLabelDateExec_(key) {
  if (!key) return "";
  var p = String(key).split("-");
  if (p.length !== 3) return key;
  return p[2] + "/" + p[1];
}
function azMngIsCanceledExec_(s) {
  var t = azMngText_(s).toLowerCase();
  return t.indexOf("xóa") > -1 || t.indexOf("xoa") > -1 || t.indexOf("hủy") > -1 || t.indexOf("huy") > -1;
}


/****************************************************
 * QUẢN TRỊ TỔNG - CÔNG NỢ MỞ RỘNG
 * - Chỉ đọc dữ liệu, không ghi/sửa sheet.
 * - Bổ sung: công nợ nhà may, phụ liệu, nhân viên.
 ****************************************************/
function azMngDebtPositive_(n) {
  n = azMngNum_(n);
  return n > 1 ? n : 0;
}

function azMngGetNhaMayDebt_(data) {
  data = data || {};
  var q = azMngText_(data.q).toLowerCase();
  var rowsInfo = { rows: [], map: {}, headers: [] };
  try { rowsInfo = azMngRows_("RAP", "tbl_NhaMay", 8000); } catch (e) { rowsInfo = { rows: [], map: {}, headers: [] }; }

  var out = [];
  rowsInfo.rows.forEach(function(r) {
    var ten = azMngText_(azMngPick_(r, rowsInfo.map, ["TenNhaMay", "NhaMay", "Ten", "Tên nhà may"], 1)) || azMngText_(r[1] || r[0]);
    var ma = azMngText_(azMngPick_(r, rowsInfo.map, ["MaNhaMay", "MaNM", "Ma"], 0)) || azMngText_(r[0]);
    var no = azMngDebtPositive_(azMngPick_(r, rowsInfo.map, ["NoHienTai", "No", "CongNo", "ConNo"], 4));
    var trangThai = azMngText_(azMngPick_(r, rowsInfo.map, ["TrangThai", "Status"], 2));
    var ghiChu = azMngText_(azMngPick_(r, rowsInfo.map, ["GhiChu", "Note"], 3));
    var hay = [ma, ten, no, trangThai, ghiChu].join(" ").toLowerCase();
    if (!ten || no <= 0) return;
    if (q && hay.indexOf(q) === -1) return;
    out.push({ loai: "Nhà may", ma: ma, ten: ten, no: no, conNo: no, trangThai: trangThai, ghiChu: ghiChu });
  });

  out.sort(function(a,b){ return b.no - a.no; });
  var total = out.reduce(function(s,x){ return s + x.no; }, 0);
  return { ok: true, summary: { soNhaMay: out.length, tongNo: total }, data: out.slice(0, azMngNum_(data.limit || 300) || 300) };
}

function azMngAddDebtItem_(map, nhom, ten, no, meta) {
  ten = azMngText_(ten || nhom);
  no = azMngNum_(no);
  if (!ten || Math.abs(no) <= 1) return;
  var key = nhom + "|" + ten;
  if (!map[key]) map[key] = { nhom: nhom, ten: ten, no: 0, conNo: 0, ghiChu: "" };
  map[key].no += no;
  map[key].conNo = map[key].no;
  if (meta) {
    Object.keys(meta).forEach(function(k){ map[key][k] = meta[k]; });
  }
}

function azMngGetPhuLieuDebt_(data) {
  data = data || {};
  var q = azMngText_(data.q).toLowerCase();
  var map = {};

  // Vải: lấy theo từng nhà vải / nhà cung cấp.
  try {
    var vai = azMngRows_("PHU_LIEU", "tbl_Vai_NhaCungCap", 8000);
    vai.rows.forEach(function(r) {
      var ten = azMngText_(azMngPick_(r, vai.map, ["TenNhaCungCap", "NhaCungCap", "TenNhaVai", "Ten", "Tên"], 0)) || azMngText_(r[0]);
      var sdt = azMngText_(azMngPick_(r, vai.map, ["SDT", "Phone", "DienThoai"], 1));
      var no = azMngDebtPositive_(azMngPick_(r, vai.map, ["NoHienTai", "No", "CongNo", "ConNo"], 2));
      azMngAddDebtItem_(map, "Vải", ten, no, { sdt: sdt });
    });
  } catch (eVai) {}

  // Dây kéo: chỉ có 1 nhà bán dây kéo nên không tách theo từng loại DK.
  // Gom tất cả phát sinh nhập - thanh toán của mọi tháng thành đúng 1 dòng tổng.
  try {
    var dk = azMngRows_("PHU_LIEU", "tbl_DayKeo_Nhap", 12000);
    var tongDayKeo = 0;
    var thangDayKeoMap = {};

    dk.rows.forEach(function(r) {
      var tienDK = azMngNum_(r[8]);
      if (Math.abs(tienDK) <= 1) return;

      tongDayKeo += tienDK;

      var ymDK = "";
      try { ymDK = dmYMFromValue_(r[1]); }
      catch(eYmDK) { ymDK = azMngDateKeyExec_(r[1]).substring(0, 7); }
      if (ymDK) thangDayKeoMap[ymDK] = true;
    });

    var soThangDK = Object.keys(thangDayKeoMap).length;
    azMngAddDebtItem_(map, "Dây kéo", "Tổng dây kéo", tongDayKeo, {
      ghiChu: soThangDK ? ("Tổng công nợ dây kéo " + soThangDK + " tháng") : "Tổng công nợ dây kéo"
    });
  } catch (eDK) {}

  // Thêu: cột còn lại đang nằm ở G/index 6 theo module phụ liệu mới.
  try {
    var th = azMngRows_("PHU_LIEU", "tbl_Theu_ChotTien", 12000);
    th.rows.forEach(function(r) {
      var tenTh = azMngText_(r[3]) || "Xưởng thêu";
      var noTh = azMngNum_(r[6]);
      azMngAddDebtItem_(map, "Thêu", tenTh, noTh, { ghiChu: azMngText_(r[8]) });
    });
  } catch (eTh) {}

  // NHẬT - IN / TÙNG - IN: hai sổ độc lập, cùng schema A:K.
  [
    { sheet: "tbl_NhatIn_GiaoDich", label: "Nhật - In" },
    { sheet: "tbl_TungIn_GiaoDich", label: "Tùng - In" }
  ].forEach(function(cfgIn) {
    try {
      var inn = azMngRows_("PHU_LIEU", cfgIn.sheet, 12000);
      var tongNoIn = 0;
      var ghiChuIn = "";
      inn.rows.forEach(function(r) {
        tongNoIn += azMngNum_(r[8]);
        if (azMngText_(r[10])) ghiChuIn = azMngText_(r[10]);
      });
      azMngAddDebtItem_(map, "In", cfgIn.label, Math.max(tongNoIn, 0), {
        ghiChu: ghiChuIn
      });
    } catch (eInPartner) {}
  });

  var out = Object.keys(map).map(function(k){ return map[k]; })
    .filter(function(x){
      x.no = azMngDebtPositive_(x.no);
      x.conNo = x.no;
      var hay = [x.nhom, x.ten, x.sdt, x.no, x.ghiChu].join(" ").toLowerCase();
      return x.no > 0 && (!q || hay.indexOf(q) !== -1);
    })
    .sort(function(a,b){ return b.no - a.no; });

  var summary = { tongNo: 0, soDoiTac: out.length, vai: 0, dayKeo: 0, theu: 0, inNhan: 0, thieuInDayKeo: 0 };
  out.forEach(function(x){
    summary.tongNo += x.no;
    if (x.nhom === "Vải") summary.vai += x.no;
    else if (x.nhom === "Dây kéo") { summary.dayKeo += x.no; summary.thieuInDayKeo += x.no; }
    else if (x.nhom === "Thêu") { summary.theu += x.no; summary.thieuInDayKeo += x.no; }
    else if (x.nhom === "In / nhãn") { summary.inNhan += x.no; summary.thieuInDayKeo += x.no; }
  });

  var vaiChart = out.filter(function(x){ return x.nhom === "Vải"; }).slice(0, 12);
  var thieuInDayKeoChart = out.filter(function(x){ return x.nhom === "Thêu" || x.nhom === "In / nhãn" || x.nhom === "Dây kéo"; })
    .map(function(x){
      return {
        nhom: x.nhom,
        ten: x.ten,
        label: x.nhom === "Dây kéo" ? "Dây kéo" : (x.nhom + " - " + x.ten),
        no: x.no,
        conNo: x.conNo,
        ghiChu: x.ghiChu || ""
      };
    }).slice(0, 12);

  return { ok: true, summary: summary, data: out.slice(0, azMngNum_(data.limit || 300) || 300), vaiChart: vaiChart, thieuInDayKeoChart: thieuInDayKeoChart };
}

function azMngEmployeeSalaryForMonth_(ten, ym, histories) {
  var arr = histories[ten] || [];
  if (!arr.length) return 0;
  var target = new Date(ym + "-28T00:00:00");
  arr.sort(function(a,b){ return new Date(b.ngay) - new Date(a.ngay); });
  for (var i = 0; i < arr.length; i++) {
    var d = new Date(arr[i].ngay + "T00:00:00");
    if (!isNaN(d.getTime()) && d <= target) return azMngNum_(arr[i].gia);
  }
  return azMngNum_(arr[arr.length - 1].gia);
}

function azMngGetEmployeeDebt_(data) {
  data = data || {};
  var now = new Date();
  var useRange = data.onlyRange === true || data.useRange === true;
  var from = data.fromDate || data.tuNgay || "";
  var to = data.toDate || data.denNgay || "";
  var fromYM = from ? Utilities.formatDate(azMngParseDateLoose_(from) || new Date(2000, 0, 1), "GMT+7", "yyyy-MM") : "0000-00";
  var toYM = to ? Utilities.formatDate(azMngParseDateLoose_(to) || now, "GMT+7", "yyyy-MM") : "9999-12";
  var q = azMngText_(data.q).toLowerCase();

  var nvRows = [], ccRows = [], ulRows = [];
  try { nvRows = azMngRows_("NHAN_SU", "tbl_NhanVien", 8000).rows; } catch(eNV) { nvRows = []; }
  try { ccRows = azMngRows_("NHAN_SU", "tbl_ChamCong", 30000).rows; } catch(eCC) { ccRows = []; }
  try { ulRows = azMngRows_("NHAN_SU", "tbl_UngLuong", 30000).rows; } catch(eUL) { ulRows = []; }

  var histories = {};
  nvRows.forEach(function(r) {
    var ten = azMngText_(r[0]);
    if (!ten) return;
    var lichSu = [];
    try { lichSu = dmBuildLuongHistory_(r) || []; } catch(e) { lichSu = []; }
    if (!lichSu.length) {
      var ngayVao = (typeof dmDateISOFromValue_ === "function" ? dmDateISOFromValue_(r[5]) : "") || Utilities.formatDate(now, "GMT+7", "yyyy-MM-dd");
      var gia = azMngNum_(r[4]);
      if (gia > 0) lichSu.push({ ngay: ngayVao, gia: gia });
    }
    histories[ten] = lichSu;
  });

  var monthMap = {};
  function ensureMonth(ten, ym) {
    ym = ym || "Không rõ tháng";
    var key = ten + "|" + ym;
    if (!monthMap[key]) monthMap[key] = { ten: ten, thang: ym, soCong: 0, tienTangCa: 0, thuong: 0, thanhTien: 0, tongLuong: 0, ung: 0, daThanhToan: 0, conNo: 0, ungTruoc: 0 };
    return monthMap[key];
  }

  ccRows.forEach(function(r) {
    var ym = "";
    try { ym = dmYMFromValue_(r[0]); } catch(e) { ym = azMngDateKey_(r[0]).substring(0,7); }
    if (useRange && (!ym || ym < fromYM || ym > toYM)) return;
    var ten = azMngText_(r[1]);
    if (!ten) return;
    var cong = azMngNum_(r[3]);
    var tc = azMngNum_(r[4]);
    var thuong = 0;
    try { thuong = dmExtractThuong_(r[5]); } catch(eT) { thuong = azMngNum_(r[5]); }
    var gia = azMngEmployeeSalaryForMonth_(ten, ym, histories);
    var tienTangCa = tc * 30;
    var thanhTien = (cong * gia) + tienTangCa + thuong;
    var item = ensureMonth(ten, ym);
    item.soCong += cong;
    item.tienTangCa += tienTangCa;
    item.thuong += thuong;
    item.thanhTien += thanhTien;
    item.tongLuong = item.thanhTien;
  });

  ulRows.forEach(function(r) {
    // Cấu trúc mới: A MaUng, B NgayUng, C TenNV, D SoTien.
    // Cấu trúc cũ từng map: A MaPhieu, B TenNV, C NgayUng, D SoTien.
    var ngayUng = r[1];
    var ten = azMngText_(r[2]);
    var ym = "";
    try { ym = dmYMFromValue_(ngayUng); } catch(e) { ym = azMngDateKey_(ngayUng).substring(0,7); }

    if (!ym) {
      ngayUng = r[2];
      ten = azMngText_(r[1]);
      try { ym = dmYMFromValue_(ngayUng); } catch(e2) { ym = azMngDateKey_(ngayUng).substring(0,7); }
    }

    if (useRange && (!ym || ym < fromYM || ym > toYM)) return;
    var soTien = azMngNum_(r[3]);
    if (!ten || soTien <= 0) return;
    ensureMonth(ten, ym).ung += soTien;
  });

  var months = Object.keys(monthMap).map(function(k){
    var x = monthMap[k];
    var net = x.thanhTien - x.ung - x.daThanhToan;
    x.conNo = net > 1 ? net : 0;
    x.ungTruoc = net < -1 ? Math.abs(net) : 0;
    x.tongLuong = x.thanhTien;
    return x;
  }).filter(function(x){
    var hay = [x.ten, x.thang, x.conNo, x.ungTruoc].join(" ").toLowerCase();
    return (x.conNo > 0 || x.ungTruoc > 0 || x.thanhTien > 0 || x.ung > 0) && (!q || hay.indexOf(q) !== -1);
  }).sort(function(a,b){
    if (a.ten !== b.ten) return a.ten.localeCompare(b.ten, "vi");
    return String(a.thang).localeCompare(String(b.thang));
  });

  var personMap = {};
  months.forEach(function(m) {
    var ten = m.ten;
    if (!personMap[ten]) personMap[ten] = { ten: ten, soThang: 0, thang: "", thangList: [], thanhTien: 0, tongLuong: 0, ung: 0, daThanhToan: 0, conNo: 0, ungTruoc: 0, detail: [] };
    var p = personMap[ten];
    p.soThang += 1;
    p.thangList.push(m.thang);
    p.thanhTien += azMngNum_(m.thanhTien);
    p.tongLuong += azMngNum_(m.thanhTien);
    p.ung += azMngNum_(m.ung);
    p.daThanhToan += azMngNum_(m.daThanhToan);
    p.detail.push(m);
  });

  var out = Object.keys(personMap).map(function(ten){
    var p = personMap[ten];
    var net = p.thanhTien - p.ung - p.daThanhToan;
    p.conNo = net > 1 ? net : 0;          // Công ty còn phải trả nhân viên
    p.ungTruoc = net < -1 ? Math.abs(net) : 0; // Nhân viên đã ứng vượt tổng lương
    p.thang = p.soThang + " tháng";
    p.thangListText = p.thangList.join(", ");
    return p;
  }).filter(function(x){
    return x.conNo > 0 || x.ungTruoc > 0 || x.thanhTien > 0 || x.ung > 0;
  }).sort(function(a,b){ return b.conNo - a.conNo; });

  var summary = { soDong: out.length, soNhanVien: out.length, soThang: months.length, tongLuong: 0, tongUng: 0, tongDaThanhToan: 0, tongPhaiTra: 0, tongUngTruoc: 0 };
  out.forEach(function(x){
    summary.tongLuong += x.thanhTien;
    summary.tongUng += x.ung;
    summary.tongDaThanhToan += x.daThanhToan;
    summary.tongPhaiTra += x.conNo;
    summary.tongUngTruoc += x.ungTruoc;
  });

  return {
    ok: true,
    allTime: !useRange,
    fromDate: useRange ? from : "",
    toDate: useRange ? to : "",
    summary: summary,
    data: out.slice(0, azMngNum_(data.limit || 300) || 300),
    months: months.slice(0, azMngNum_(data.monthLimit || 1000) || 1000)
  };
}

function azMngGetExecutiveDebtCenter_(data) {
  data = data || {};
  var kh = { summary: {}, data: [] }, nm = { summary: {}, data: [] }, pl = { summary: {}, data: [] }, nv = { summary: {}, data: [] };
  try { kh = azMngGetCustomerDebt_({ q: data.q, limit: 50 }) || kh; } catch(eKH) {}
  try { nm = azMngGetNhaMayDebt_({ q: data.q, limit: 50 }) || nm; } catch(eNM) {}
  try { pl = azMngGetPhuLieuDebt_({ q: data.q, limit: 80 }) || pl; } catch(ePL) {}
  try { nv = azMngGetEmployeeDebt_({ q: data.q, allTime: true, limit: 80, monthLimit: 1000 }) || nv; } catch(eNV) {}

  var tongPhaiThu = azMngNum_(kh.summary && kh.summary.tongNo);
  var tongNhaMay = azMngNum_(nm.summary && nm.summary.tongNo);
  var tongPhuLieu = azMngNum_(pl.summary && pl.summary.tongNo);
  var tongNhanVien = azMngNum_(nv.summary && nv.summary.tongPhaiTra);
  var tongPhaiTra = tongNhaMay + tongPhuLieu + tongNhanVien;

  return {
    ok: true,
    summary: {
      tongPhaiThu: tongPhaiThu,
      tongPhaiTra: tongPhaiTra,
      tongCongNo: tongPhaiThu + tongPhaiTra,
      noKhach: tongPhaiThu,
      noNhaMay: tongNhaMay,
      noPhuLieu: tongPhuLieu,
      noNhanVien: tongNhanVien,
      ungTruocNhanVien: azMngNum_(nv.summary && nv.summary.tongUngTruoc)
    },
    mix: [
      { name: "Khách phải thu", value: tongPhaiThu },
      { name: "Nhà may", value: tongNhaMay },
      { name: "Phụ liệu", value: tongPhuLieu },
      { name: "Nhân viên", value: tongNhanVien }
    ].filter(function(x){ return x.value > 0; }),
    khachHang: kh,
    nhaMay: nm,
    phuLieu: pl,
    nhanVien: nv
  };
}

function azMngGetExecutiveDashboard_(data) {
  data = data || {};
  var now = new Date();
  var from = data.fromDate || data.tuNgay || "";
  var to = data.toDate || data.denNgay || "";
  if (!from) {
    var df = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    from = Utilities.formatDate(df, "GMT+7", "yyyy-MM-dd");
  }
  if (!to) to = Utilities.formatDate(now, "GMT+7", "yyyy-MM-dd");

  var owner = { summary: {}, profit: {}, topBan: [], congNo: {}, topNo: [] };
  try { owner = azMngGetOwnerDashboard_({ limit: 8 }) || owner; } catch (eOwner) {}

  var profit = { summary: {}, data: [] };
  try { profit = azMngGetProfitReport_({ fromDate: from, toDate: to, groupBy: "FORM", limit: 12 }) || profit; } catch (eProfit) {}

  var debt = { summary: {}, data: [] };
  try { debt = azMngGetCustomerDebt_({ limit: 12 }) || debt; } catch (eDebt) {}

  var debtCenter = { summary: {}, mix: [] };
  try { debtCenter = azMngGetExecutiveDebtCenter_({ fromDate: from, toDate: to, limit: 12 }) || debtCenter; } catch (eDebtCenter) {}

  var ton = [];
  try { ton = azMngRows_("KHO", "tbl_Kho_Ton", 30000).rows; } catch (eTon) { ton = []; }
  var inventory = { tonThucTe: 0, tonGiu: 0, khaDung: 0, choKiem: 0, hangLoi: 0 };
  var topTonMap = {};
  ton.forEach(function(r) {
    var maNB = azMngText_(r[0]);
    var maBH = azMngText_(r[1]);
    var mau = azMngText_(r[6]);
    var size = azMngText_(r[7]);
    var key = maNB || maBH || "KHONG_MA";
    var tt = azMngNum_(r[8]), giu = azMngNum_(r[9]), kd = azMngNum_(r[10]), cho = azMngNum_(r[11]), loi = azMngNum_(r[13]);
    inventory.tonThucTe += tt; inventory.tonGiu += giu; inventory.khaDung += kd; inventory.choKiem += cho; inventory.hangLoi += loi;
    if (!topTonMap[key]) topTonMap[key] = { ten: key, maHangNoiBo: maNB, maBanHang: maBH, mau: mau, size: size, khaDung: 0, tonThucTe: 0, hangLoi: 0 };
    topTonMap[key].khaDung += kd; topTonMap[key].tonThucTe += tt; topTonMap[key].hangLoi += loi;
  });
  var topTon = Object.keys(topTonMap).map(function(k){ return topTonMap[k]; }).sort(function(a,b){ return b.khaDung - a.khaDung; }).slice(0, 12);

  var orderSet = {};
  var trendMap = {};
  var statusMap = {};
  var summary = {
    updatedAt: azMngNow_ ? azMngNow_() : Utilities.formatDate(now, "GMT+7", "dd/MM/yyyy HH:mm:ss"),
    doanhThuThang: 0,
    soDonThang: 0,
    donMoi: 0,
    donChuaSoan: 0,
    donDangSoan: 0,
    donDaSoan: 0,
    donHoaDon: 0,
    hoaDonChuaGui: 0,
    hoaDonDaGui: 0,
    donNo: 0,
    donHoanThanh: 0,
    donHuy: 0,
    tongDon: 0,
    tongMamRap: (owner.summary && owner.summary.tongMamRap) || 0,
    noKhach: (debt.summary && debt.summary.tongNo) || 0,
    noPhaiTra: (debtCenter.summary && debtCenter.summary.tongPhaiTra) || 0,
    noTongCong: (debtCenter.summary && debtCenter.summary.tongCongNo) || 0,
    khaDung: inventory.khaDung
  };

  // Đếm đơn theo ngày tạo đơn trước. Không dùng CapNhatCuoi làm ưu tiên vì sẽ làm lọc kỳ bị rỗng.
  var ordersObj = azMngRows_("SALES", "tbl_DonHang", 30000);
  var orders = ordersObj.rows || [];
  summary.tongDon = orders.length;
  orders.forEach(function(r) {
    var maHD = azMngText_(azMngPick_(r, ordersObj.map, ["MaHoaDon", "MaDon", "MaHD"], 0));
    if (!maHD) return;

    var d = azMngPick_(r, ordersObj.map, ["NgayTao", "Ngay", "NgayDon", "ThoiGian", "ThoiGianTao"], 1) ||
            azMngPick_(r, ordersObj.map, ["CapNhatCuoi", "ThoiGianCapNhat"], 21);
    if (!azMngDateInRange_(d, from, to)) return;

    var trangThai = azMngText_(azMngPick_(r, ordersObj.map, ["TrangThai"], 6));
    var trangThaiHD = azMngText_(azMngPick_(r, ordersObj.map, ["TrangThaiHoaDon", "TrangThaiHD"], 13));
    var noTrongHD = azMngNum_(azMngPick_(r, ordersObj.map, ["NoTrongHoaDon", "ConNo", "NoDon"], 10));
    var tongTien = azMngNum_(azMngPick_(r, ordersObj.map, ["TongTien", "ThanhTien", "TongCong"], 11));
    var nguoiSoan = azMngText_(azMngPick_(r, ordersObj.map, ["NguoiSoan", "NguoiSoanHang"], 9));
    var gioSoanXong = azMngText_(azMngPick_(r, ordersObj.map, ["GioSoanXong", "ThoiGianSoanXong"], 15));
    var thoiGianHuy = azMngText_(azMngPick_(r, ordersObj.map, ["ThoiGianHuy", "NgayHuy"], 16));

    var keyDate = azMngDateKeyExec_(d);
    if (!trendMap[keyDate]) trendMap[keyDate] = { day: keyDate, label: azMngLabelDateExec_(keyDate), revenue: 0, orders: 0 };

    var statusG = trangThai.toLowerCase();
    var statusN = trangThaiHD.toLowerCase();

    var canceled = azMngIsCanceledExec_(trangThai) || azMngIsCanceledExec_(trangThaiHD) || !!thoiGianHuy;
    var isChuaSoanV58 = statusG === "mới" || statusG === "moi" || (!statusG && !nguoiSoan && !gioSoanXong);
    var isDangSoanV58 = /đang soạn|dang soan|đang xử lý|dang xu ly|soạn hàng|soan hang/.test(statusG);
    var isDaSoanV58 = /đã soạn|da soan/.test(statusG);
    var isHoanTatV58 = /hoàn tất|hoan tat|hoàn thành|hoan thanh|đã xong|da xong|done/.test(statusG);
    var isReadyGuiHoaDonV58 = isDaSoanV58 || isHoanTatV58;
    var isHDDaGuiV58 = /đã gửi|da gui/.test(statusN);
    var isHDChuaGuiV58 = isReadyGuiHoaDonV58 && !isHDDaGuiV58 && (!statusN || /chưa gửi|chua gui/.test(statusN));
    var isNoDonV59 = /nợ đơn|no don/.test(statusG);

    summary.soDonThang += 1;
    summary.tongDon = summary.tongDon || 0;

    if (canceled) {
      summary.donHuy += 1;
      statusMap["Hủy"] = (statusMap["Hủy"] || 0) + 1;
      orderSet[maHD] = true;
      return;
    }

    // V58:
    // - Tạo đơn mới không ghi cột N nữa.
    // - HĐ chưa gửi chỉ tính khi cột G đã soạn/hoàn tất và cột N rỗng hoặc còn dữ liệu cũ "Chưa gửi đơn".
    // - Nợ đơn là trạng thái nghiệp vụ cột G = "Nợ đơn" (không dựa vào tiền còn nợ cột K).
    // - Biểu đồ doanh thu & số đơn chỉ tính các đơn đã chốt/gửi hóa đơn và có doanh thu.
    if (isChuaSoanV58) summary.donChuaSoan += 1;
    if (isDangSoanV58) summary.donDangSoan += 1;
    if (isDaSoanV58 || isHoanTatV58 || isHDDaGuiV58 || nguoiSoan || gioSoanXong) summary.donDaSoan += 1;
    if (isHDChuaGuiV58) summary.hoaDonChuaGui += 1;
    if (isHDDaGuiV58) {
      summary.hoaDonDaGui += 1;
      summary.donHoaDon += 1;
    }
    if (isNoDonV59) summary.donNo += 1;
    if (isHoanTatV58) summary.donHoanThanh += 1;
    summary.donMoi = summary.donChuaSoan;

    if (isChuaSoanV58) statusMap["Đơn chưa soạn"] = (statusMap["Đơn chưa soạn"] || 0) + 1;
    if (isDangSoanV58) statusMap["Đang soạn"] = (statusMap["Đang soạn"] || 0) + 1;
    if (isHDChuaGuiV58) statusMap["HĐ chưa gửi"] = (statusMap["HĐ chưa gửi"] || 0) + 1;
    if (isHDDaGuiV58) statusMap["HĐ đã gửi"] = (statusMap["HĐ đã gửi"] || 0) + 1;
    if (isNoDonV59) statusMap["Nợ đơn"] = (statusMap["Nợ đơn"] || 0) + 1;

    if (isHDDaGuiV58 && tongTien > 0) {
      trendMap[keyDate].revenue += tongTien;
      trendMap[keyDate].orders += 1;
      summary.doanhThuThang += tongTien;
    }

    orderSet[maHD] = true;
  });

  // Nếu cột tổng tiền ở đơn chưa cập nhật nhưng chi tiết size có doanh thu, dùng chi tiết size làm fallback.
  var profitRevenue = azMngNum_(profit.summary && profit.summary.doanhThu);
  if (summary.doanhThuThang <= 0 && profitRevenue > 0) {
    summary.doanhThuThang = profitRevenue;
  }

  // Nếu số đơn vẫn rỗng nhưng có dữ liệu chi tiết bán, lấy số hóa đơn khác nhau từ bảng size để tab Đơn hàng không trống.
  if (summary.soDonThang <= 0 && profitRevenue > 0) {
    try {
      var ct = azMngRows_("SALES", "tbl_DonHang_CT_Size", 30000);
      var orderDates = azMngOrderDateMap_();
      ct.rows.forEach(function(r) {
        var ma = azMngText_(azMngPick_(r, ct.map, ["MaHoaDon", "MaDon", "MaHD"], 0));
        if (!ma || orderSet[ma]) return;
        var ngay = orderDates[ma] || "";
        if (!azMngDateInRange_(ngay, from, to)) return;
        orderSet[ma] = true;
        var k = azMngDateKeyExec_(ngay) || azMngDateKeyExec_(from);
        if (!trendMap[k]) trendMap[k] = { day: k, label: azMngLabelDateExec_(k), revenue: 0, orders: 0 };
        trendMap[k].orders += 1;
      });
      summary.soDonThang = Object.keys(orderSet).length;
      if (summary.soDonThang > 0 && !Object.keys(statusMap).length) {
        summary.donHoaDon = summary.soDonThang;
        statusMap["Hóa đơn"] = summary.soDonThang;
      }
    } catch (eCtOrder) {}
  }

  var salesTrend = Object.keys(trendMap).sort().map(function(k){ return trendMap[k]; });
  var orderStatusColors = {
    "Đơn chưa soạn": "#64748b",
    "Đang soạn": "#7c3aed",
    "HĐ chưa gửi": "#f59e0b",
    "HĐ đã gửi": "#16a34a",
    "Nợ đơn": "#ef4444",
    "Hủy": "#0f172a"
  };
  var orderStatusOrder = ["Đơn chưa soạn", "Đang soạn", "HĐ chưa gửi", "HĐ đã gửi", "Nợ đơn", "Hủy"];
  var orderStatus = orderStatusOrder.map(function(k){
    return { name: k, value: statusMap[k] || 0, color: orderStatusColors[k] || "#2563eb" };
  });

  var rapRows = [];
  try { rapRows = azMngRows_("RAP", "tbl_Rap_DonHang", 10000).rows; } catch (eRap) { rapRows = []; }
  var rap = { tongMamRap: rapRows.length, dangChay: 0, daNhap: 0, tre: 0 };
  rapRows.forEach(function(r) {
    var st = azMngText_(r[13] || r[12] || r[8]).toLowerCase();
    if (st.indexOf("nhập") > -1 || st.indexOf("nhap") > -1 || st.indexOf("xong") > -1) rap.daNhap++;
    else rap.dangChay++;
  });

  var topBan = (profit.data || []).slice(0, 10).map(function(x){
    return { ten: x.maForm || x.maHangNoiBo || x.maBanHang || "Không mã", maForm: x.maForm, soLuong: x.soLuong, doanhThu: x.doanhThu, loiNhuan: x.loiNhuan };
  });
  var topNo = (debt.data || []).slice(0, 10);
  var alerts = [];
  if (azMngNum_(profit.summary && profit.summary.thieuGiaVon) > 0) alerts.push({ level: "danger", title: "Thiếu giá vốn", desc: "Có " + profit.summary.thieuGiaVon + " dòng/mã chưa có giá vốn. Lợi nhuận chỉ là tạm tính." });
  if (azMngNum_(debtCenter.summary && debtCenter.summary.tongPhaiTra) > 0) alerts.push({ level: "warning", title: "Công nợ phải trả cần theo dõi", desc: "Nhà may + phụ liệu + nhân viên còn khoảng " + Math.round(debtCenter.summary.tongPhaiTra).toLocaleString("vi-VN") + "đ." });
  if (inventory.hangLoi > 0) alerts.push({ level: "warning", title: "Có hàng lỗi", desc: "Hàng lỗi trong kho: " + inventory.hangLoi + ". Cần xử lý để không lệch tồn bán." });
  if (inventory.choKiem > 0) alerts.push({ level: "warning", title: "Hàng chờ kiểm/hoàn thiện", desc: "Có " + inventory.choKiem + " sản phẩm đang chờ xử lý." });

  return {
    ok: true,
    fromDate: from,
    toDate: to,
    summary: summary,
    profit: profit.summary || {},
    inventory: inventory,
    debt: debt.summary || {},
    debtCenter: debtCenter || {},
    rap: rap,
    salesTrend: salesTrend,
    orderStatus: orderStatus,
    topBan: topBan,
    topNo: topNo,
    topTon: topTon,
    alerts: alerts,
    updatedAt: summary.updatedAt
  };
}


/****************************************************
 * TASK05D - QUẢN TRỊ TỔNG: CẢNH BÁO ĐIỀU HÀNH
 * Chỉ đọc dữ liệu. Không ghi/sửa/xóa sheet.
 * Làm các nhóm: Lợi nhuận, Kho, Rập/Xưởng, Hệ thống.
 * Không đưa cảnh báo công nợ vào tab này theo yêu cầu.
 ****************************************************/
function azMngAlert05DText_(v) {
  try { return azMngText_(v); } catch(e) { return String(v === null || v === undefined ? "" : v).trim(); }
}
function azMngAlert05DNum_(v) {
  try { return azMngNum_(v); } catch(e) {
    if (typeof v === "number") return isNaN(v) ? 0 : v;
    var s = String(v === null || v === undefined ? "" : v).replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    var n = Number(s);
    return isNaN(n) ? 0 : n;
  }
}
function azMngAlert05DDate_(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  var s = azMngAlert05DText_(v);
  if (!s) return null;
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    var d1 = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d1.getTime()) ? null : d1;
  }
  var d2 = new Date(s);
  return isNaN(d2.getTime()) ? null : d2;
}
function azMngAlert05DDays_(v, now) {
  var d = azMngAlert05DDate_(v);
  if (!d) return -1;
  now = now || new Date();
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
}
function azMngAlert05DMoney_(n) {
  n = azMngAlert05DNum_(n);
  return Math.round(n).toLocaleString("vi-VN") + "đ";
}
function azMngAlert05DCompact_(n) {
  n = azMngAlert05DNum_(n);
  if (Math.abs(n) >= 1000000000) return (n / 1000000000).toFixed(1).replace(".0", "") + " tỷ";
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1).replace(".0", "") + " tr";
  return Math.round(n).toLocaleString("vi-VN");
}
function azMngAlert05DLevelRank_(level) {
  level = azMngAlert05DText_(level).toLowerCase();
  if (level === "danger") return 3;
  if (level === "warning") return 2;
  return 1;
}
function azMngAlert05DPush_(bag, group, level, title, desc, items, actionTab) {
  if (!bag[group]) bag[group] = [];
  var a = {
    group: group,
    level: level || "warning",
    title: title || "Cảnh báo",
    desc: desc || "",
    items: items || [],
    actionTab: actionTab || ""
  };
  bag[group].push(a);
  bag.all.push(a);
}
function azMngAlert05DIsDone_(txt) {
  txt = azMngAlert05DText_(txt).toLowerCase();
  if (!txt) return false;
  return txt.indexOf("xong") > -1 || txt.indexOf("hoàn") > -1 || txt.indexOf("hoan") > -1 ||
    txt.indexOf("đã nhập") > -1 || txt.indexOf("da nhap") > -1 || txt.indexOf("đã nhận") > -1 ||
    txt.indexOf("da nhan") > -1 || txt.indexOf("đã giao") > -1 || txt.indexOf("da giao") > -1 ||
    txt.indexOf("đóng") > -1 || txt.indexOf("dong") > -1;
}
function azMngGetExecutiveAlerts_(data) {
  data = data || {};
  var now = new Date();
  var from = data.fromDate || data.tuNgay || "";
  var to = data.toDate || data.denNgay || "";
  if (!from) {
    var df = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    from = Utilities.formatDate(df, "GMT+7", "yyyy-MM-dd");
  }
  if (!to) to = Utilities.formatDate(now, "GMT+7", "yyyy-MM-dd");

  var groups = { profit: [], kho: [], rap: [], system: [], all: [] };
  var errors = [];

  // 2. Cảnh báo lợi nhuận.
  var profit = { summary: {}, data: [] };
  try { profit = azMngGetProfitReport_({ fromDate: from, toDate: to, groupBy: "FORM", limit: 300 }) || profit; }
  catch(eProfit) { errors.push("Lợi nhuận: " + eProfit.message); }

  var pSummary = profit.summary || {};
  var pRows = profit.data || [];
  var missingCostRows = pRows.filter(function(x) {
    var source = azMngAlert05DText_(x.nguonGiaVon).toLowerCase();
    return azMngAlert05DNum_(x.soLuong) > 0 && (azMngAlert05DNum_(x.tongVon) <= 0 || source.indexOf("thiếu") > -1 || source.indexOf("thieu") > -1 || source.indexOf("chưa") > -1 || source.indexOf("chua") > -1);
  }).slice(0, 10).map(function(x) {
    return { name: x.maForm || x.maHangNoiBo || x.maBanHang || "Không mã", value: azMngAlert05DCompact_(x.soLuong) + " cái", note: "Doanh thu " + azMngAlert05DMoney_(x.doanhThu) };
  });

  if (azMngAlert05DNum_(pSummary.thieuGiaVon) > 0 || missingCostRows.length) {
    azMngAlert05DPush_(groups, "profit", "danger", "Thiếu giá vốn", "Có mã/dòng bán ra chưa có giá vốn nên lợi nhuận chỉ là tạm tính.", missingCostRows, "system");
    azMngAlert05DPush_(groups, "profit", "warning", "Đơn chưa đủ dữ liệu tính lời", "Cần bổ sung giá vốn trước khi chốt báo cáo lời/lỗ.", missingCostRows.slice(0, 6), "profit");
  }

  var lowMarginRows = pRows.filter(function(x) {
    var dt = azMngAlert05DNum_(x.doanhThu), ln = azMngAlert05DNum_(x.loiNhuan), sl = azMngAlert05DNum_(x.soLuong);
    if (dt <= 0 || sl <= 0) return false;
    var margin = ln / dt;
    return (sl >= 3 && margin <= 0.12) || ln <= 0;
  }).sort(function(a,b){
    var ma = azMngAlert05DNum_(a.doanhThu) ? azMngAlert05DNum_(a.loiNhuan) / azMngAlert05DNum_(a.doanhThu) : 9;
    var mb = azMngAlert05DNum_(b.doanhThu) ? azMngAlert05DNum_(b.loiNhuan) / azMngAlert05DNum_(b.doanhThu) : 9;
    return ma - mb;
  }).slice(0, 10).map(function(x) {
    var dt = azMngAlert05DNum_(x.doanhThu), ln = azMngAlert05DNum_(x.loiNhuan);
    var pct = dt ? Math.round(ln / dt * 1000) / 10 : 0;
    return { name: x.maForm || x.maHangNoiBo || x.maBanHang || "Không mã", value: pct + "%", note: "Lãi " + azMngAlert05DMoney_(ln) + " / DT " + azMngAlert05DMoney_(dt) };
  });
  if (lowMarginRows.length) {
    azMngAlert05DPush_(groups, "profit", "warning", "Mã bán nhiều nhưng lời thấp", "Các mã này bán ra nhưng biên lợi nhuận thấp, nên xem lại giá bán hoặc giá vốn.", lowMarginRows, "profit");
  }
  if (!pRows.length) {
    azMngAlert05DPush_(groups, "profit", "warning", "Chưa có dữ liệu lợi nhuận theo bộ lọc", "Khoảng thời gian đang chọn chưa có dòng bán phù hợp để tính lợi nhuận.", [], "profit");
  }

  // 3. Cảnh báo kho.
  var tonRows = [];
  try { tonRows = azMngRows_("KHO", "tbl_Kho_Ton", 40000).rows; }
  catch(eTon) { errors.push("Tồn kho: " + eTon.message); tonRows = []; }

  var inv = { tonThucTe: 0, tonGiu: 0, khaDung: 0, choKiem: 0, hangLoi: 0 };
  var stockByForm = {}, issueByItem = {};
  tonRows.forEach(function(r) {
    var maNB = azMngAlert05DText_(r[0]), maBH = azMngAlert05DText_(r[1]);
    var keyRaw = maNB || maBH || "KHONG_MA";
    var form = "";
    try { form = azMngFormKey_(keyRaw); } catch(eForm) { form = keyRaw; }
    var mau = azMngAlert05DText_(r[6]), size = azMngAlert05DText_(r[7]);
    var tt = azMngAlert05DNum_(r[8]), giu = azMngAlert05DNum_(r[9]), kd = azMngAlert05DNum_(r[10]), cho = azMngAlert05DNum_(r[11]), loi = azMngAlert05DNum_(r[13]);
    inv.tonThucTe += tt; inv.tonGiu += giu; inv.khaDung += kd; inv.choKiem += cho; inv.hangLoi += loi;
    if (!stockByForm[form]) stockByForm[form] = { form: form, khaDung: 0, tonThucTe: 0, hangLoi: 0, choKiem: 0 };
    stockByForm[form].khaDung += kd; stockByForm[form].tonThucTe += tt; stockByForm[form].hangLoi += loi; stockByForm[form].choKiem += cho;
    if (!issueByItem[keyRaw]) issueByItem[keyRaw] = { name: keyRaw, maHangNoiBo: maNB, maBanHang: maBH, mau: mau, size: size, khaDung: 0, hangLoi: 0, choKiem: 0, capNhatCuoi: r[14] };
    issueByItem[keyRaw].khaDung += kd;
    issueByItem[keyRaw].hangLoi += loi;
    issueByItem[keyRaw].choKiem += cho;
    if (r[14]) issueByItem[keyRaw].capNhatCuoi = r[14];
  });

  var lowStockRows = pRows.filter(function(x) {
    var sold = azMngAlert05DNum_(x.soLuong);
    var formKey = x.maForm || "";
    var st = stockByForm[formKey] || { khaDung: 0 };
    var minNeed = Math.max(3, Math.ceil(sold * 0.15));
    return sold >= 3 && azMngAlert05DNum_(st.khaDung) <= minNeed;
  }).slice(0, 10).map(function(x) {
    var st = stockByForm[x.maForm] || { khaDung: 0 };
    return { name: x.maForm || x.maHangNoiBo || x.maBanHang || "Không mã", value: "Còn " + azMngAlert05DCompact_(st.khaDung), note: "Đã bán " + azMngAlert05DCompact_(x.soLuong) + " cái" };
  });
  if (lowStockRows.length) {
    azMngAlert05DPush_(groups, "kho", "danger", "Mã bán chạy nhưng tồn thấp", "Các mã đang bán được nhưng tồn khả dụng thấp, cần xem gợi ý sản xuất hoặc nhập thêm.", lowStockRows, "ops");
  }

  var errorRows = Object.keys(issueByItem).map(function(k){ return issueByItem[k]; }).filter(function(x){ return x.hangLoi > 0; }).sort(function(a,b){ return b.hangLoi - a.hangLoi; }).slice(0, 10).map(function(x){ return { name: x.name, value: azMngAlert05DCompact_(x.hangLoi) + " lỗi", note: [x.mau, x.size].filter(String).join(" / ") }; });
  if (inv.hangLoi > 0) {
    azMngAlert05DPush_(groups, "kho", inv.hangLoi >= 30 ? "danger" : "warning", "Hàng lỗi cần xử lý", "Tổng hàng lỗi trong kho: " + azMngAlert05DCompact_(inv.hangLoi) + " cái.", errorRows, "ops");
  }

  var waitingRows = Object.keys(issueByItem).map(function(k){ return issueByItem[k]; }).filter(function(x){ return x.choKiem > 0; }).sort(function(a,b){ return b.choKiem - a.choKiem; }).slice(0, 10).map(function(x){ return { name: x.name, value: azMngAlert05DCompact_(x.choKiem) + " chờ", note: [x.mau, x.size].filter(String).join(" / ") }; });
  if (inv.choKiem > 0) {
    azMngAlert05DPush_(groups, "kho", inv.choKiem >= 50 ? "danger" : "warning", "Hàng chờ hoàn thiện / chờ kiểm", "Có " + azMngAlert05DCompact_(inv.choKiem) + " sản phẩm chưa sẵn sàng bán.", waitingRows, "ops");
  }

  var lastMoveMap = {};
  try {
    var tk = azMngRows_("KHO", "tbl_Kho_TheKho", 50000).rows;
    tk.forEach(function(r){
      var ma = azMngAlert05DText_(r[4]);
      var d = azMngAlert05DDate_(r[1]);
      if (!ma || !d) return;
      if (!lastMoveMap[ma] || d.getTime() > lastMoveMap[ma].getTime()) lastMoveMap[ma] = d;
    });
  } catch(eTK) {}
  var oldRows = Object.keys(issueByItem).map(function(k){
    var x = issueByItem[k];
    var d = lastMoveMap[x.maHangNoiBo] || azMngAlert05DDate_(x.capNhatCuoi);
    var days = d ? Math.floor((now.getTime() - d.getTime()) / 86400000) : -1;
    x.daysOld = days;
    return x;
  }).filter(function(x){ return x.khaDung > 0 && x.daysOld >= 60; }).sort(function(a,b){ return b.daysOld - a.daysOld; }).slice(0, 10).map(function(x){ return { name: x.name, value: x.daysOld + " ngày", note: "Khả dụng " + azMngAlert05DCompact_(x.khaDung) }; });
  if (oldRows.length) {
    azMngAlert05DPush_(groups, "kho", "warning", "Mã tồn lâu", "Có mã còn tồn khả dụng nhưng lâu chưa có biến động kho.", oldRows, "ops");
  }
  if (!tonRows.length) {
    azMngAlert05DPush_(groups, "kho", "warning", "Chưa có dữ liệu tồn kho", "Không đọc được dòng tồn kho để tạo cảnh báo kho.", [], "ops");
  }

  // 4. Cảnh báo rập / xưởng.
  var rapRows = [];
  try { rapRows = azMngRows_("RAP", "tbl_Rap_DonHang", 30000).rows; }
  catch(eRap) { errors.push("Rập/Xưởng: " + eRap.message); rapRows = []; }

  var rapOpen = [], rapLate = [], nhaMayMap = {};
  rapRows.forEach(function(r) {
    var maMam = azMngAlert05DText_(r[0]);
    var ngayTao = r[1];
    var nhaMay = azMngAlert05DText_(r[4]) || "Chưa rõ nhà may";
    var maRap = azMngAlert05DText_(r[5]);
    var tenSP = azMngAlert05DText_(r[6]);
    var tong = azMngAlert05DNum_(r[10]);
    var daGiao = azMngAlert05DNum_(r[11]);
    var conThieu = r[12] !== "" && r[12] !== undefined ? azMngAlert05DNum_(r[12]) : Math.max(tong - daGiao, 0);
    var duKien = r[13];
    var st = [r[21], r[22], r[42]].map(azMngAlert05DText_).join(" ");
    var done = azMngAlert05DIsDone_(st) || (tong > 0 && conThieu <= 0);
    if (done) return;
    var days = azMngAlert05DDays_(ngayTao, now);
    var dueDays = azMngAlert05DDays_(duKien, now);
    var item = { name: maMam || maRap || tenSP || "Mâm rập", maMam: maMam, maRap: maRap, nhaMay: nhaMay, days: days, dueDays: dueDays, conThieu: conThieu, tong: tong, status: st, tenSP: tenSP };
    rapOpen.push(item);
    if (dueDays >= 1 || days >= 10) rapLate.push(item);
    if (!nhaMayMap[nhaMay]) nhaMayMap[nhaMay] = { name: nhaMay, soMam: 0, soLuong: 0, maxDays: 0 };
    nhaMayMap[nhaMay].soMam += 1;
    nhaMayMap[nhaMay].soLuong += Math.max(conThieu, tong || 0);
    nhaMayMap[nhaMay].maxDays = Math.max(nhaMayMap[nhaMay].maxDays, days || 0);
  });

  if (rapOpen.length) {
    azMngAlert05DPush_(groups, "rap", rapOpen.length >= 10 ? "danger" : "warning", "Đơn rập chưa hoàn tất", "Còn " + rapOpen.length + " mâm/đơn rập đang mở.", rapOpen.slice(0, 10).map(function(x){ return { name: x.name, value: x.nhaMay, note: x.days >= 0 ? (x.days + " ngày") : x.status }; }), "ops");
  }
  if (rapLate.length) {
    azMngAlert05DPush_(groups, "rap", "danger", "Rập / xưởng trễ tiến độ", "Có mâm rập đã lâu hoặc quá ngày dự kiến nhưng chưa hoàn tất.", rapLate.sort(function(a,b){ return (b.dueDays + b.days) - (a.dueDays + a.days); }).slice(0,10).map(function(x){ return { name: x.name, value: x.dueDays >= 1 ? ("Trễ " + x.dueDays + " ngày") : (x.days + " ngày"), note: x.nhaMay + (x.conThieu ? (" • còn " + azMngAlert05DCompact_(x.conThieu)) : "") }; }), "ops");
  }
  var nhaMayHolding = Object.keys(nhaMayMap).map(function(k){ return nhaMayMap[k]; }).filter(function(x){ return x.soMam > 0; }).sort(function(a,b){ return b.soLuong - a.soLuong; }).slice(0,10);
  if (nhaMayHolding.length) {
    azMngAlert05DPush_(groups, "rap", "warning", "Nhà may đang giữ hàng", "Các nhà may đang có mâm rập chưa hoàn tất.", nhaMayHolding.map(function(x){ return { name: x.name, value: x.soMam + " mâm", note: "SL mở " + azMngAlert05DCompact_(x.soLuong) + (x.maxDays ? " • lâu nhất " + x.maxDays + " ngày" : "") }; }), "ops");
  }

  // 5. Cảnh báo hệ thống.
  var backup = { data: [] };
  try { backup = azMngGetBackupLog_({ limit: 1 }) || backup; }
  catch(eBackup) { backup = { data: [] }; }
  var bk = (backup.data || [])[0];
  var bkDays = bk ? azMngAlert05DDays_(bk.thoiGian, now) : -1;
  if (!bk) {
    azMngAlert05DPush_(groups, "system", "danger", "Chưa có lịch sử sao lưu", "Không tìm thấy bản backup gần nhất trong log hệ thống.", [], "system");
  } else if (bkDays >= 7) {
    azMngAlert05DPush_(groups, "system", "warning", "Đã lâu chưa backup", "Bản backup gần nhất cách đây khoảng " + bkDays + " ngày.", [{ name: bk.folderName || bk.ma || "Backup", value: bk.thoiGian || "", note: bk.nguoiTao || "" }], "system");
  }

  var missingSheets = [];
  [
    { key: "SALES", sheet: "tbl_DonHang", label: "Đơn hàng" },
    { key: "SALES", sheet: "tbl_DonHang_CT_Size", label: "Chi tiết đơn" },
    { key: "KHO", sheet: "tbl_Kho_Ton", label: "Tồn kho" },
    { key: "RAP", sheet: "tbl_Rap_DonHang", label: "Rập/Xưởng" }
  ].forEach(function(s) {
    try {
      var sh = getSheet_(s.key, s.sheet);
      if (!sh || sh.getLastRow() < 2) missingSheets.push({ name: s.label, value: s.sheet, note: "Chưa có dòng dữ liệu" });
    } catch(eSheet) {
      missingSheets.push({ name: s.label, value: s.sheet, note: "Không đọc được sheet" });
    }
  });
  if (missingSheets.length) {
    azMngAlert05DPush_(groups, "system", "danger", "Dữ liệu nền còn thiếu", "Một số bảng quan trọng chưa có dữ liệu hoặc không đọc được.", missingSheets, "system");
  }
  if (errors.length) {
    azMngAlert05DPush_(groups, "system", "warning", "Có lỗi khi đọc dữ liệu báo cáo", "Một số phần cảnh báo không đọc được đầy đủ.", errors.slice(0,6).map(function(x){ return { name: x, value: "", note: "" }; }), "system");
  }

  ["profit", "kho", "rap", "system"].forEach(function(g) {
    groups[g].sort(function(a,b){ return azMngAlert05DLevelRank_(b.level) - azMngAlert05DLevelRank_(a.level); });
  });
  groups.all.sort(function(a,b){ return azMngAlert05DLevelRank_(b.level) - azMngAlert05DLevelRank_(a.level); });

  var summary = { total: groups.all.length, profit: groups.profit.length, kho: groups.kho.length, rap: groups.rap.length, system: groups.system.length, danger: 0, warning: 0, info: 0 };
  groups.all.forEach(function(a){ summary[a.level] = (summary[a.level] || 0) + 1; });

  return {
    ok: true,
    fromDate: from,
    toDate: to,
    updatedAt: azMngNow_ ? azMngNow_() : Utilities.formatDate(now, "GMT+7", "dd/MM/yyyy HH:mm:ss"),
    summary: summary,
    profit: groups.profit,
    kho: groups.kho,
    rap: groups.rap,
    system: groups.system,
    data: groups.all
  };
}

function azMngHandleApi_(data) {
  var type = azMngText_(data && data.type);
  if (type.indexOf("azMng") === 0 && azMngOwnerDenied_(data)) {
    return outJson_({ ok: false, message: "Chỉ OWNER được xem Quản trị tổng" });
  }
  if (type === "azMngGetExecutiveDashboard") return outJson_(azMngGetExecutiveDashboard_(data));
  if (type === "azMngGetExecutiveAlerts") return outJson_(azMngGetExecutiveAlerts_(data));
  if (type === "azMngGetExecutiveDebtCenter") return outJson_(azMngGetExecutiveDebtCenter_(data));
  if (type === "azMngGetOwnerDashboard") return outJson_(azMngGetOwnerDashboard_(data));
  if (type === "azMngGetAppAudit") return outJson_(azMngGetAppAudit_(data));
  if (type === "azMngCreateBackup") return outJson_(azMngCreateBackup_(data));
  if (type === "azMngGetBackupLog") return outJson_(azMngGetBackupLog_(data));
  if (type === "azMngGetCustomerDebt") return outJson_(azMngGetCustomerDebt_(data));
  if (type === "azMngSaveCustomerPayment") return outJson_(azMngSaveCustomerPayment_(data));
  if (type === "azMngGetCustomerPaymentHistory") return outJson_(azMngGetCustomerPaymentHistory_(data));
  if (type === "azMngGetRapDebt") return outJson_(azMngGetRapDebt_(data));
  if (type === "azMngGetCostPriceList") return outJson_(azMngGetCostPriceList_(data));
  if (type === "azMngSaveCostPrice") return outJson_(azMngSaveCostPrice_(data));
  if (type === "azMngGetProfitReport") return outJson_(azMngGetProfitReport_(data));
  if (type === "azMngGetAdminChecklist") return outJson_(azMngGetAdminChecklist_(data));
  if (type === "azMngGetAdminTestPlan") return outJson_(azMngGetAdminTestPlan_(data));
  return null;
}

/****************************************************
 * PATCH QL RẬP - ĐỒNG NHẤT DANH MỤC NHÀ MAY / THỢ CẮT
 * Mục tiêu:
 * - Không ghi thêm vào sheet cũ NhaMay / ThoCat nữa.
 * - Nhà may chuẩn: RAP / tbl_NhaMay
 * - Thợ cắt chuẩn: RAP / tbl_DoiCat
 * - Mã rập vẫn dùng RAP / MaRap để tránh tạo thêm bảng mới.
 * - Tự copy dữ liệu cũ từ NhaMay -> tbl_NhaMay, ThoCat -> tbl_DoiCat nếu có.
 ****************************************************/
function rapDMText_(v) {
  try { return normalizeText_(v); } catch (e) { return String(v === null || v === undefined ? "" : v).trim(); }
}

function rapDMNow_() {
  try { return nowVN_(); } catch (e) { return Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss"); }
}

function rapDMId_(prefix) {
  return prefix + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + "-" + Math.floor(Math.random() * 1000);
}

function rapDMKey_(v) {
  return rapDMText_(v).toLowerCase();
}

function rapDMMoney_(v) {
  var n = Number(String(v || "")
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : n;
}


function rapDMCanonicalName_(sheetName) {
  sheetName = rapDMText_(sheetName);
  if (sheetName === "NhaMay" || sheetName === "tbl_NhaMay") return "tbl_NhaMay";
  if (sheetName === "Tho" || sheetName === "ThoCat" || sheetName === "tbl_DoiCat") return "tbl_DoiCat";
  if (sheetName === "MaRap") return "MaRap";
  return sheetName;
}


function rapDMMigrateOne_(ssRap, oldName, canonicalName) {
  var oldSh = ssRap.getSheetByName(oldName);
  var newSh = rapDMEnsureSheet_(ssRap, canonicalName);
  if (!oldSh || oldSh.getName() === newSh.getName() || oldSh.getLastRow() < 2) return 0;

  var moved = 0;
  var rows = oldSh.getRange(2, 1, oldSh.getLastRow() - 1, Math.max(2, oldSh.getLastColumn())).getDisplayValues();
  for (var i = 0; i < rows.length; i++) {
    var name = rapDMText_(rows[i][0] || rows[i][1]);
    if (!name) continue;
    if (rapDMExists_(newSh, canonicalName, name)) continue;
    var extra = canonicalName === "tbl_DoiCat" ? (rows[i][1] || rows[i][2] || "") : "";
    rapDMAppend_(newSh, canonicalName, name, extra);
    moved++;
  }
  return moved;
}

function rapDMMigrateAll_() {
  var ssRap = getSS_("RAP");
  rapDMEnsureSheet_(ssRap, "tbl_NhaMay");
  rapDMEnsureSheet_(ssRap, "tbl_DoiCat");
  rapDMEnsureSheet_(ssRap, "MaRap");
  rapDMMigrateOne_(ssRap, "NhaMay", "tbl_NhaMay");
  rapDMMigrateOne_(ssRap, "ThoCat", "tbl_DoiCat");
  SpreadsheetApp.flush();
}

// Override: tên cũ NhaMay/ThoCat sẽ được chuyển sang bảng chuẩn.
function rapEnsureDanhMucSheet_(ssRap, sheetName) {
  var canonicalName = rapDMCanonicalName_(sheetName);
  if (canonicalName === "tbl_NhaMay") rapDMMigrateOne_(ssRap, "NhaMay", "tbl_NhaMay");
  if (canonicalName === "tbl_DoiCat") rapDMMigrateOne_(ssRap, "ThoCat", "tbl_DoiCat");
  return rapDMEnsureSheet_(ssRap, canonicalName);
}

// Override: đọc danh mục từ bảng chuẩn, không phải bảng cũ.


// Override: danh mục trả về cho giao diện chỉ lấy từ bảng chuẩn.


// Override: thêm nhanh chỉ ghi vào bảng chuẩn.


// Override: Hàng nhà lấy nhà may/thợ cắt/mã rập từ nguồn chuẩn.


/****************************************************
 * PATCH QL RẬP - MÃ RẬP CÓ TÊN + DANH MỤC CHUẨN
 * - MaRap thêm cột TenMaRap để dễ dò dữ liệu.
 * - Nếu sheet MaRap đang theo mẫu cũ MaRap/TrangThai/CapNhatCuoi
 *   thì tự chèn cột TenMaRap sau MaRap, không mất dữ liệu cũ.
 * - + Mã rập lưu cả mã và tên.
 ****************************************************/
function rapDMHeaders_(canonicalName) {
  canonicalName = rapDMCanonicalName_(canonicalName);
  if (canonicalName === "tbl_NhaMay") {
    return ["MaNhaMay", "TenNhaMay", "TrangThai", "GhiChu", "NoHienTai", "CapNhatCuoi"];
  }
  if (canonicalName === "tbl_DoiCat") {
    return ["MaDoiCat", "TenDoiCat", "DonGia", "TrangThai", "GhiChu", "CapNhatCuoi"];
  }
  if (canonicalName === "MaRap") {
    return ["MaRap", "TenMaRap", "GiaVon", "DonGiaNhaMay", "TrangThai", "CapNhatCuoi"];
  }
  return ["GiaTri", "TrangThai", "CapNhatCuoi"];
}

function rapDMEnsureSheet_(ssRap, sheetName) {
  var canonicalName = rapDMCanonicalName_(sheetName);
  var headers = rapDMHeaders_(canonicalName);
  var sh = ssRap.getSheetByName(canonicalName);
  if (!sh) sh = ssRap.insertSheet(canonicalName);

  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }

  var first = sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn())).getDisplayValues()[0];
  var empty = true;
  for (var i = 0; i < first.length; i++) {
    if (rapDMText_(first[i])) { empty = false; break; }
  }

  if (empty || sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (canonicalName === "MaRap") {
    var hA = rapDMText_(first[0]).toLowerCase();
    var hB = rapDMText_(first[1]).toLowerCase();
    var hC = rapDMText_(first[2]).toLowerCase();

    var isMaRap = (hA === "marap" || hA === "mã rập" || hA === "ma rập");
    var hasTenMaRap = (hB === "tenmarap" || hB === "tên mã rập" || hB === "ten ma rap");
    var hasGiaVon = (hC === "giavon" || hC === "giá vốn" || hC === "gia von" || hC === "von" || hC === "vốn");

    // Mẫu cũ: A=MaRap, B=TrangThai, C=CapNhatCuoi.
    // Chèn B=TenMaRap trước để dữ liệu trạng thái/ngày không bị mất.
    if (isMaRap && !hasTenMaRap) {
      sh.insertColumnAfter(1);
    }

    if (sh.getMaxColumns() < headers.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    }

    first = sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn())).getDisplayValues()[0];
    hC = rapDMText_(first[2]).toLowerCase();
    hasGiaVon = (hC === "giavon" || hC === "giá vốn" || hC === "gia von" || hC === "von" || hC === "vốn");

    // Mẫu hiện tại: A=MaRap, B=TenMaRap, C=TrangThai, D=CapNhatCuoi.
    // Chèn C=GiaVon để TrangThai/CapNhatCuoi tự đẩy sang D/E.
    if (!hasGiaVon) {
      sh.insertColumnAfter(2);
    }

    // TASK 06N: thêm D=DonGiaNhaMay để tính tiền nhà may trên từng sản phẩm nhận được.
    if (sh.getMaxColumns() < headers.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    }
    first = sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn())).getDisplayValues()[0];
    var hD = rapDMText_(first[3]).toLowerCase();
    var hasDonGiaMay = (hD === "dongianhamay" || hD === "đơn giá nhà may" || hD === "don gia nha may" || hD === "dongia" || hD === "đơn giá");
    if (!hasDonGiaMay) {
      sh.insertColumnAfter(3);
    }

    if (sh.getMaxColumns() < headers.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    }
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    // Đảm bảo dòng tiêu đề chuẩn cho 2 bảng danh mục chính, không dịch chuyển dữ liệu.
    var currentA = rapDMText_(first[0]);
    if (!currentA || currentA === "GiaTri") {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }

  try { sh.setFrozenRows(1); } catch (e) {}
  return sh;
}

function rapDMNameFromRow_(canonicalName, row) {
  row = row || [];
  canonicalName = rapDMCanonicalName_(canonicalName);
  if (canonicalName === "tbl_NhaMay") return rapDMText_(row[1] || row[0]);
  if (canonicalName === "tbl_DoiCat") return rapDMText_(row[1] || row[0]);
  if (canonicalName === "MaRap") return rapDMText_(row[0]);
  return rapDMText_(row[0] || row[1]);
}

function rapDMIsStatusText_(v) {
  var s = rapDMText_(v).toLowerCase();
  return s === "đang dùng" || s === "dang dung" || s === "ngừng dùng" || s === "ngung dung" || s === "đang bán" || s === "dang ban" || s === "status" || s === "trangthai" || s === "trạng thái";
}

function rapDMMaRapTitleFromRow_(row) {
  row = row || [];
  var t = rapDMText_(row[1]);
  if (rapDMIsStatusText_(t)) return "";
  return t;
}

function rapDMFindRow_(sh, canonicalName, name) {
  var key = rapDMKey_(name);
  if (!key || !sh || sh.getLastRow() < 2) return -1;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(2, sh.getLastColumn())).getDisplayValues();
  for (var i = 0; i < rows.length; i++) {
    if (rapDMKey_(rapDMNameFromRow_(canonicalName, rows[i])) === key) return i + 2;
  }
  return -1;
}

function rapDMExists_(sh, canonicalName, name) {
  return rapDMFindRow_(sh, canonicalName, name) !== -1;
}

function rapDMAppend_(sh, canonicalName, name, giaTri2, giaTri3, giaTri4) {
  var now = rapDMNow_();
  canonicalName = rapDMCanonicalName_(canonicalName);
  name = rapDMText_(name);
  giaTri2 = rapDMText_(giaTri2);
  var giaVon = rapDMMoney_(giaTri3);
  var donGiaNhaMay = rapDMMoney_(giaTri4);

  if (canonicalName === "tbl_NhaMay") {
    sh.appendRow([rapDMId_("NM-"), name, "Đang dùng", "", 0, now]);
    return;
  }
  if (canonicalName === "tbl_DoiCat") {
    sh.appendRow([rapDMId_("TC-"), name, parseFloat(giaTri2) || 0, "Đang làm", "", now]);
    return;
  }
  if (canonicalName === "MaRap") {
    // TASK 06O: Mã rập chỉ lưu mã, tên mẫu, giá vốn. Đơn giá nhà may nhập ở phiếu hàng nhà và tự nhớ theo Nhà may + Mã rập.
    sh.appendRow([name, giaTri2, giaVon, "", "Đang dùng", now]);
    return;
  }
  sh.appendRow([name, "Đang dùng", now]);
}

function rapDMGetMaRapInfo_(ssRap) {
  var sh = rapDMEnsureSheet_(ssRap, "MaRap");
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(6, sh.getLastColumn())).getDisplayValues();
  var seen = {};
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var ma = rapDMText_(rows[i][0]);
    if (!ma) continue;
    var key = rapDMKey_(ma);
    if (seen[key]) continue;
    seen[key] = true;
    var ten = rapDMMaRapTitleFromRow_(rows[i]);
    var giaVon = rapDMMoney_(rows[i][2]);
    var donGiaNhaMay = rapDMMoney_(rows[i][3]);
    out.push({ maRap: ma, tenMaRap: ten, giaVon: giaVon, donGiaNhaMay: donGiaNhaMay, label: ten ? (ma + " - " + ten) : ma });
  }
  return out;
}

function rapDocCotDanhMuc_(ssRap, sheetName, colIndex) {
  var canonicalName = rapDMCanonicalName_(sheetName);
  if (canonicalName === "MaRap") {
    return rapDMGetMaRapInfo_(ssRap).map(function(x) { return x.maRap; });
  }
  var sheet = rapEnsureDanhMucSheet_(ssRap, canonicalName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(2, sheet.getLastColumn())).getDisplayValues();
  var seen = {};
  var out = [];

  for (var i = 0; i < values.length; i++) {
    var val = rapDMNameFromRow_(canonicalName, values[i]);
    if (!val) continue;
    var key = rapDMKey_(val);
    if (seen[key]) continue;
    seen[key] = true;
    out.push(val);
  }

  return out;
}

function layDuLieuDanhMuc() {
  try {
    rapDMMigrateAll_();
    var ssRap = getSS_("RAP");
    var sheetKH = getSheet_("SALES", "tbl_KhachHang");

    var khachHang = [];
    var dataKH = sheetKH.getDataRange().getValues();
    for (var i = 1; i < dataKH.length; i++) {
      var tenKhach = rapDMText_(dataKH[i][1]);
      var trangThai = rapDMText_(dataKH[i][8]);
      if (!tenKhach) continue;
      if (trangThai === "Đã xóa") continue;
      khachHang.push(tenKhach);
    }

    var maRapInfo = rapDMGetMaRapInfo_(ssRap);
    return {
      nhaMay: rapDocCotDanhMuc_(ssRap, "tbl_NhaMay", 2),
      maRap: maRapInfo.map(function(x) { return x.maRap; }),
      maRapInfo: maRapInfo,
      thoCat: rapDocCotDanhMuc_(ssRap, "tbl_DoiCat", 2),
      khachHang: khachHang
    };
  } catch (err) {
    throw new Error("Lỗi layDuLieuDanhMuc: " + err.message);
  }
}

function themDanhMucMoi(loai, giaTri1, giaTri2, giaTri3, giaTri4) {
  try {
    rapDMMigrateAll_();
    var ssRap = getSS_("RAP");

    loai = rapDMText_(loai);
    giaTri1 = rapDMText_(giaTri1);
    giaTri2 = rapDMText_(giaTri2);
    giaTri3 = rapDMText_(giaTri3);
    giaTri4 = rapDMText_(giaTri4);
    var giaVon = rapDMMoney_(giaTri3);
    var donGiaNhaMay = rapDMMoney_(giaTri4);

    if (!giaTri1) throw new Error("Thiếu thông tin cần thêm");

    var canonicalName = "";
    if (loai === "NhaMay") canonicalName = "tbl_NhaMay";
    else if (loai === "MaRap") canonicalName = "MaRap";
    else if (loai === "Tho") canonicalName = "tbl_DoiCat";
    else throw new Error("Loại danh mục không hợp lệ: " + loai);

    var sheet = rapDMEnsureSheet_(ssRap, canonicalName);
    var row = rapDMFindRow_(sheet, canonicalName, giaTri1);
    if (row !== -1) {
      if (canonicalName === "MaRap") {
        if (giaTri2) sheet.getRange(row, 2).setValue(giaTri2);
        if (giaTri3) sheet.getRange(row, 3).setValue(giaVon);
        // TASK 06O: không cập nhật đơn giá nhà may trong MaRap nữa.
        sheet.getRange(row, 6).setValue(rapDMNow_());
        SpreadsheetApp.flush();
        return "Đã cập nhật";
      }
      return "Đã tồn tại";
    }

    rapDMAppend_(sheet, canonicalName, giaTri1, giaTri2, giaTri3, giaTri4);
    SpreadsheetApp.flush();
    return "Thành công";
  } catch (err) {
    throw new Error("Lỗi themDanhMucMoi: " + err.message);
  }
}

function rapHNGetMasterData() {
  try {
    rapDMMigrateAll_();

    var products = [];
    try {
      var shHH = getSheet_("KHO", "tbl_Kho_HangHoa");
      var hh = shHH.getDataRange().getValues();
      for (var i = 1; i < hh.length; i++) {
        if (!rapDMText_(hh[i][0]) || !rapDMText_(hh[i][1])) continue;
        products.push({
          maSP: rapDMText_(hh[i][0]),
          maRap: rapDMText_(hh[i][1]),
          mauSanPham: rapDMText_(hh[i][2]),
          hieu: rapDMText_(hh[i][3]),
          tenSanPham: rapDMText_(hh[i][4]),
          nhomHang: rapDMText_(hh[i][5]),
          gioiTinh: rapDMText_(hh[i][6]),
          chatLieu: rapDMText_(hh[i][7]),
          trangThai: rapDMText_(hh[i][8])
        });
      }
    } catch (eHH) {}

    function addUnique_(arr, v) {
      v = rapDMText_(v);
      if (!v) return;
      var key = rapDMKey_(v);
      for (var a = 0; a < arr.length; a++) {
        if (rapDMKey_(arr[a]) === key) return;
      }
      arr.push(v);
    }

    function getRows_(fileKey, sheetName) {
      try { return getSheet_(fileKey, sheetName).getDataRange().getValues(); }
      catch (e) { return []; }
    }

    var ssRap = getSS_("RAP");
    var maRaps = [];
    for (var p = 0; p < products.length; p++) addUnique_(maRaps, products[p].maRap);
    var maRapInfo = rapDMGetMaRapInfo_(ssRap);
    for (var r = 0; r < maRapInfo.length; r++) addUnique_(maRaps, maRapInfo[r].maRap);

    var mauSac = [];
    var msData = getRows_("KHO", "tbl_MauSac");
    for (var m = 1; m < msData.length; m++) addUnique_(mauSac, msData[m][1] || msData[m][0]);

    var khoList = [];
    var vtData = getRows_("KHO", "tbl_Kho_ViTri");
    for (var k = 1; k < vtData.length; k++) addUnique_(khoList, vtData[k][1] || vtData[k][0]);
    if (!khoList.length) khoList.push("KHO CHÍNH");

    // TASK 06AF: Hàng khách đặt dùng chung master data với Hàng nhà.
    // Vì vậy master data phải trả luôn Tên khách + alias cũ để Index không phải gọi layDuLieuDanhMuc() riêng.
    var nhaMayList = rapDocCotDanhMuc_(ssRap, "tbl_NhaMay", 2).sort();
    var doiCatList = rapDocCotDanhMuc_(ssRap, "tbl_DoiCat", 2).sort();
    var khachHang = [];
    try {
      var shKH = getSheet_("SALES", "tbl_KhachHang");
      var dataKH = shKH.getDataRange().getValues();
      for (var kh = 1; kh < dataKH.length; kh++) {
        var tenKhach = rapDMText_(dataKH[kh][1]);
        var trangThaiKH = rapDMText_(dataKH[kh][8]);
        if (!tenKhach) continue;
        if (trangThaiKH === "Đã xóa" || trangThaiKH === "Da xoa") continue;
        addUnique_(khachHang, tenKhach);
      }
    } catch (eKH) {}

    maRaps = maRaps.sort();
    khachHang = khachHang.sort();

    return {
      ok: true,
      products: products,
      maRaps: maRaps,
      maRap: maRaps,             // alias cho form Hàng khách đặt cũ
      maRapInfo: maRapInfo,
      mauSac: mauSac.sort(),
      nhaMay: nhaMayList,
      doiCat: doiCatList,
      thoCat: doiCatList,        // alias cho form Hàng khách đặt cũ
      khachHang: khachHang,
      khoList: khoList.sort()
    };
  } catch (err) {
    return { ok: false, message: "Lỗi lấy danh mục phiếu nhập rập: " + err.message };
  }
}


/****************************************************
 * FIX CHỐT HÓA ĐƠN - ƯU TIÊN HÀNG ĐÃ GIỮ
 * Ngày sửa: 2026-06-23
 *
 * Lý do sửa:
 * - Hàng đã vào hóa đơn sau khi soạn là hàng tạm giữ trong tbl_Kho_Ton.TonGiu.
 * - Không đủ tồn phải chặn ở bước SOẠN HÀNG / GIỮ HÀNG.
 * - Khi CHỐT HÓA ĐƠN, hệ thống không được chặn lại chỉ vì TonThucTe đang 0
 *   trong khi dòng đơn đã có MaGiuHang / trạng thái Đã giữ.
 *
 * Cách xử lý mới:
 * - Dòng đã giữ: kiểm TonGiu trước, không bắt buộc TonThucTe phải còn đủ.
 * - Khi chốt: giảm TonGiu; đồng thời giảm TonThucTe nếu TonThucTe còn dương.
 * - Tránh trừ âm / tránh xuất kho lặp.
 * - Dòng cũ chưa có MaGiuHang vẫn kiểm theo tồn khả dụng để an toàn.
 ****************************************************/
function soanIsHeldLineForFinalize_(item) {
  if (!item) return false;
  var maGiu = normalizeText_(item.maGiuHang);
  var tt = normalizeText_(item.trangThaiXuat).toLowerCase();
  return !!maGiu || tt.indexOf("giữ") !== -1 || tt.indexOf("giu") !== -1;
}

function soanBuildFinalizeNeedMap_(sizeRows) {
  var map = {};
  sizeRows = Array.isArray(sizeRows) ? sizeRows : [];
  sizeRows.forEach(function(r) {
    var maNB = normalizeText_(r && r.maHangNoiBo);
    var qty = khoNum_(r && r.soLuong);
    if (!maNB || qty <= 0) return;
    var key = soanHoldKey_(maNB, r.khoXuat || "", "");
    if (!map[key]) {
      map[key] = {
        maHangNoiBo: maNB,
        khoXuat: normalizeText_(r.khoXuat || ""),
        heldNeed: 0,
        freeNeed: 0,
        totalNeed: 0
      };
    }
    if (soanIsHeldLineForFinalize_(r)) map[key].heldNeed += qty;
    else map[key].freeNeed += qty;
    map[key].totalNeed += qty;
  });
  return map;
}

function soanGetTonSummaryForFinalize_(maHangNoiBo, khoXuat) {
  var shTon = getSheet_("KHO", "tbl_Kho_Ton");
  var values = shTon.getDataRange().getValues();
  var khoFilter = normalizeText_(khoXuat).toUpperCase();
  var out = { tonThucTe: 0, tonGiu: 0, khaDung: 0, rows: 0 };

  for (var i = 1; i < values.length; i++) {
    if (normalizeText_(values[i][0]) !== maHangNoiBo) continue;
    var rowKho = normalizeText_(values[i][2]).toUpperCase();
    if (khoFilter && rowKho !== khoFilter) continue;
    var tonThucTe = khoNum_(values[i][8]);
    var tonGiu = khoNum_(values[i][9]);
    out.tonThucTe += tonThucTe;
    out.tonGiu += tonGiu;
    out.khaDung += Math.max(tonThucTe - tonGiu, 0);
    out.rows++;
  }

  return out;
}

function soanPrecheckCanExportStock_(sizeRows) {
  sizeRows = Array.isArray(sizeRows) ? sizeRows : [];
  if (!sizeRows.length) return true;

  var needMap = soanBuildFinalizeNeedMap_(sizeRows);
  var keys = Object.keys(needMap);

  keys.forEach(function(key) {
    var need = needMap[key];
    var ton = soanGetTonSummaryForFinalize_(need.maHangNoiBo, need.khoXuat);

    if (!ton.rows) {
      throw new Error("Không tìm thấy dòng tồn để chốt hóa đơn. Mã " + need.maHangNoiBo + (need.khoXuat ? (" tại kho " + need.khoXuat) : ""));
    }

    // Dòng đã giữ: chỉ cần TonGiu còn đủ. Nếu dữ liệu cũ bị lệch TonGiu thiếu nhưng TonThucTe còn đủ,
    // vẫn cho chốt để không kẹt đơn cũ.
    if (need.heldNeed > 0) {
      var protectedQty = Math.max(ton.tonGiu, 0) + Math.max(ton.tonThucTe, 0);
      if (protectedQty < need.heldNeed) {
        throw new Error(
          "Không đủ hàng đã giữ để chốt hóa đơn. Mã " + need.maHangNoiBo +
          (need.khoXuat ? (" tại kho " + need.khoXuat) : "") +
          " cần chốt " + need.heldNeed +
          " nhưng hàng giữ/tồn còn " + protectedQty +
          ". Hãy quay lại bước Soạn hàng để giữ lại hàng."
        );
      }
    }

    // Dòng chưa giữ: đây thường là dữ liệu cũ hoặc dòng chưa soạn đúng. Vẫn kiểm tồn khả dụng.
    if (need.freeNeed > 0 && ton.khaDung < need.freeNeed) {
      throw new Error(
        "Hóa đơn có dòng chưa giữ hàng. Mã " + need.maHangNoiBo +
        (need.khoXuat ? (" tại kho " + need.khoXuat) : "") +
        " cần xuất " + need.freeNeed +
        " nhưng khả dụng chỉ còn " + ton.khaDung +
        ". Hãy vào Soạn hàng lưu lại trước khi chốt hóa đơn."
      );
    }
  });

  return true;
}

function soanExportOneStockRow_(item, nowText, nguoiThaoTac) {
  var maNB = normalizeText_(item && item.maHangNoiBo);
  var qty = khoNum_(item && item.soLuong);
  if (!maNB || qty <= 0) return 0;

  var preferredKho = normalizeText_(item.khoXuat).toUpperCase();
  var isHeldLine = soanIsHeldLineForFinalize_(item);
  var shTon = getSheet_("KHO", "tbl_Kho_Ton");
  var shTheKho = getSheet_("KHO", "tbl_Kho_TheKho");
  var values = shTon.getDataRange().getValues();
  var remaining = qty;
  var exported = 0;
  nowText = nowText || nowVN_();

  function isMatchRow_(i) {
    if (normalizeText_(values[i][0]) !== maNB) return false;
    var rowKho = normalizeText_(values[i][2]).toUpperCase();
    if (preferredKho && rowKho !== preferredKho) return false;
    return true;
  }

  function writeExportRow_(i, move, mode) {
    var tonThucTe = khoNum_(values[i][8]);
    var tonGiu = khoNum_(values[i][9]);
    var truTonThucTe = 0;
    var truTonGiu = 0;

    if (mode === "HELD") {
      truTonGiu = Math.min(move, tonGiu);
      // Chỉ trừ TonThucTe nếu còn dương. Không để âm và không chặn hóa đơn đã giữ.
      truTonThucTe = Math.min(move, Math.max(tonThucTe, 0));
    } else {
      truTonThucTe = Math.min(move, Math.max(tonThucTe, 0));
      truTonGiu = 0;
    }

    var newTonThucTe = Math.max(tonThucTe - truTonThucTe, 0);
    var newTonGiu = Math.max(tonGiu - truTonGiu, 0);
    var newKhaDung = Math.max(newTonThucTe - newTonGiu, 0);

    shTon.getRange(i + 1, 9).setValue(newTonThucTe);  // I TonThucTe
    shTon.getRange(i + 1, 10).setValue(newTonGiu);    // J TonGiu
    shTon.getRange(i + 1, 11).setValue(newKhaDung);   // K KhaDung
    shTon.getRange(i + 1, 15).setValue(nowText);      // O CapNhatCuoi

    shTheKho.appendRow([
      khoMakeId_("TK-"),
      nowText,
      mode === "HELD" ? "XUAT_KHO_TU_HANG_GIU" : "XUAT_KHO",
      item.maHoaDon,
      maNB,
      normalizeText_(item.maBanHang),
      normalizeText_(values[i][2] || item.khoXuat || "KHO"),
      -move,
      newTonThucTe,
      nguoiThaoTac || "app",
      "Chốt hóa đơn " + item.maHoaDon +
        (mode === "HELD" ? " - xuất từ hàng đã giữ" : " - xuất kho thật") +
        (preferredKho ? (" tại kho " + preferredKho) : "") +
        " | Trừ giữ: " + truTonGiu +
        " | Trừ tồn thật: " + truTonThucTe
    ]);

    values[i][8] = newTonThucTe;
    values[i][9] = newTonGiu;
    values[i][10] = newKhaDung;
  }

  // 1) Dòng đã giữ: ưu tiên xả TonGiu. Đây là luồng chuẩn sau khi soạn hàng.
  if (isHeldLine) {
    for (var i = 1; i < values.length && remaining > 0; i++) {
      if (!isMatchRow_(i)) continue;
      var tonGiu = khoNum_(values[i][9]);
      if (tonGiu <= 0) continue;
      var moveHeld = Math.min(remaining, tonGiu);
      writeExportRow_(i, moveHeld, "HELD");
      remaining -= moveHeld;
      exported += moveHeld;
    }
  }

  // 2) Nếu còn thiếu, xử lý theo TonThucTe để hỗ trợ đơn cũ / dữ liệu cũ thiếu MaGiuHang.
  for (var j = 1; j < values.length && remaining > 0; j++) {
    if (!isMatchRow_(j)) continue;
    var tonThucTe2 = khoNum_(values[j][8]);
    if (tonThucTe2 <= 0) continue;
    var moveFree = Math.min(remaining, tonThucTe2);
    writeExportRow_(j, moveFree, isHeldLine ? "HELD" : "FREE");
    remaining -= moveFree;
    exported += moveFree;
  }

  if (remaining > 0) {
    throw new Error(
      "Không đủ hàng để chốt hóa đơn. Mã " + maNB +
      (preferredKho ? (" tại kho " + preferredKho) : "") +
      " còn thiếu " + remaining +
      ". Nếu đây là đơn mới, hãy quay lại Soạn hàng để giữ hàng trước."
    );
  }

  return exported;
}

function soanFinalizeStockForOrders_(selectedIds, nguoiThaoTac) {
  var rows = soanCollectSizeRowsForOrders_(selectedIds);
  if (!rows.length) {
    return { exported: 0, rows: 0, message: "Không có dòng size cần xuất kho" };
  }

  soanPrecheckCanExportStock_(rows);

  var shSize = getSheet_("SALES", "tbl_DonHang_CT_Size");
  var nowText = nowVN_();
  var exported = 0;

  rows.forEach(function(item) {
    exported += soanExportOneStockRow_(item, nowText, nguoiThaoTac);
    shSize.getRange(item.rowIndex, 13).setValue("Đã xuất"); // M TrangThaiXuat
    // Giữ lại MaGiuHang ở cột N để dò được hóa đơn đã từng giữ hàng.
  });

  SpreadsheetApp.flush();
  return { exported: exported, rows: rows.length, message: "Đã chốt xuất kho " + exported + " sản phẩm từ hàng đã soạn/giữ" };
}


/****************************************************
 * FIX HÀNG TRẢ - đảm bảo sheet sửa phiếu luôn tồn tại
 * Dùng cho getHangTraDetails / updateEditedHangTra / resetHangTra
 ****************************************************/
function htEnsureChiTietHangTraSuaSheet_() {
  var ss = getSS_("SALES");
  var sh = ss.getSheetByName("tbl_ChiTietHangTraSua");
  var headers = [
    "MaPhieuTra", "TenSP", "SoLuong", "DonGia", "ThanhTien", "GhiChu", "ThoiGian",
    "TinhTrangHang", "MaBanHang", "MaHangNoiBo", "MaSP", "MaRap", "Mau", "Size"
  ];

  if (!sh) {
    sh = ss.insertSheet("tbl_ChiTietHangTraSua");
  }

  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }

  var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var empty = first.every(function(v) { return !htText_(v); });
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }

  return sh;
}


/****************************************************
 * AZALAS FIX 2026-06-24 - NHẬP KHO BATCH
 * Mục tiêu:
 * - Dùng lại nhập kho thủ công từ tab Kho → Nhập kho.
 * - Không đọc tbl_Kho_Ton trong từng item.
 * - Đọc HangHoa / BienThe / Ton / TheKho 1 lần, xử lý trong RAM, ghi batch.
 ****************************************************/
function khoNormalizeTrangThaiKey_(v) {
  return khoText_(v)
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D");
}

function khoBatchNhapKhoItems_(items, options) {
  options = options || {};
  items = items || [];

  var now = options.now || nowVN_();
  var maChungTu = khoText_(options.maChungTu || khoMakeId_("PNK-"));
  var nguoi = khoText_(options.nguoi || options.nguoiNhap || "app");
  var defaultKho = khoText_(options.defaultKho || options.khoNhap || "KHO CHÍNH");
  var ghiChuPrefix = khoText_(options.ghiChuPrefix);

  var shHH = getSheet_("KHO", "tbl_Kho_HangHoa");
  var shBT = getSheet_("KHO", "tbl_Kho_BienThe");
  var shTon = getSheet_("KHO", "tbl_Kho_Ton");
  var shTheKho = getSheet_("KHO", "tbl_Kho_TheKho");

  var hhRows = shHH.getDataRange().getValues();
  var btRows = shBT.getDataRange().getValues();
  var tonRows = shTon.getDataRange().getValues();

  var hhMap = {};
  var btMap = {};
  var tonMap = {};

  for (var ih = 1; ih < hhRows.length; ih++) {
    var maSP0 = khoText_(hhRows[ih][0]);
    if (maSP0) hhMap[maSP0] = { rowIndex: ih + 1, row: hhRows[ih] };
  }

  for (var ib = 1; ib < btRows.length; ib++) {
    var maNB0 = khoText_(btRows[ib][0]);
    if (maNB0) {
      btMap[maNB0] = {
        rowIndex: ib + 1,
        row: btRows[ib],
        maHangNoiBo: maNB0,
        maBanHang: khoText_(btRows[ib][1]) || maNB0
      };
    }
  }

  function tonKey_(maHangNoiBo, kho, viTri) {
    return khoText_(maHangNoiBo) + "|" + khoText_(kho) + "|" + khoText_(viTri);
  }

  for (var it = 1; it < tonRows.length; it++) {
    var keyTon0 = tonKey_(tonRows[it][0], tonRows[it][2], tonRows[it][3]);
    if (khoText_(tonRows[it][0])) {
      tonMap[keyTon0] = {
        rowIndex: it + 1,
        row: tonRows[it].slice(),
        isNew: false
      };
    }
  }

  var hhAppendRows = [];
  var btAppendRows = [];
  var tonAppendRows = [];
  var tonUpdateMap = {};
  var theKhoRows = [];
  var details = [];
  var tongSoLuong = 0;

  for (var i = 0; i < items.length; i++) {
    var src = items[i] || {};
    var qty = khoNum_(src.soLuong || src.qty || src.sl || src.soLuongNhap);
    if (qty <= 0) continue;

    var info = {};
    for (var k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k)) info[k] = src[k];
    }

    info.kho = khoText_(info.kho || info.khoNhap || defaultKho);
    info.khoNhap = info.kho;
    info.viTri = khoText_(info.viTri);
    info.hieu = khoText_(info.hieu || "AZALAS");
    info.maRap = khoText_(info.maRap);
    info.mau = khoText_(info.mau);
    info.size = khoText_(info.size);
    info.tenSP = khoText_(info.tenSP || info.mauSanPham || info.maRap);
    info.mauSanPham = khoText_(info.mauSanPham || info.tenSP || info.maRap);

    if (!info.maRap || !info.mau || !info.size) {
      continue;
    }

    var maSP = khoText_(info.maSP) || khoBuildMaSP_(info.maRap, info.hieu, info.tenSP || info.mauSanPham);
    if (!hhMap[maSP]) {
      var hhRow = [
        maSP,
        info.maRap,
        info.mauSanPham || info.tenSP,
        info.hieu || "AZALAS",
        info.tenSP || info.mauSanPham,
        khoText_(info.nhomHang || "Thành phẩm"),
        khoText_(info.gioiTinh || "Nam/Nữ"),
        khoText_(info.chatLieu),
        "Đang bán",
        khoText_(info.ghiChu),
        now,
        now
      ];
      hhAppendRows.push(hhRow);
      hhMap[maSP] = { rowIndex: 0, row: hhRow };
    }

    var maHangNoiBo = khoText_(info.maHangNoiBo) || khoBuildMaHangNoiBo_(info.maRap, info.hieu, info.mau, info.size);
    var maBanHang = khoText_(info.maBanHang) || maHangNoiBo;

    if (!btMap[maHangNoiBo]) {
      var btRow = [
        maHangNoiBo,
        maBanHang,
        maSP,
        info.maRap,
        info.mauSanPham || info.tenSP,
        info.hieu || "AZALAS",
        info.mau,
        info.size,
        khoText_(info.tenHienThi || ((info.tenSP || info.mauSanPham || info.maRap) + " " + info.mau + " " + info.size)),
        "Có",
        khoText_(info.ghiChu)
      ];
      btAppendRows.push(btRow);
      btMap[maHangNoiBo] = {
        rowIndex: 0,
        row: btRow,
        maHangNoiBo: maHangNoiBo,
        maBanHang: maBanHang
      };
    } else {
      maBanHang = khoText_(btMap[maHangNoiBo].maBanHang || maBanHang);
    }

    var kho = khoText_(info.kho || defaultKho);
    var viTri = khoText_(info.viTri);
    var tonKey = tonKey_(maHangNoiBo, kho, viTri);
    var tonObj = tonMap[tonKey];

    if (!tonObj) {
      var newTonRow = [
        maHangNoiBo,
        maBanHang,
        kho,
        viTri,
        info.maRap,
        info.hieu || "AZALAS",
        info.mau,
        info.size,
        0, // I TonThucTe
        0, // J TonGiu
        0, // K KhaDung
        0, // L ChoHoanThien
        0, // M DaCotRi
        0, // N HangLoi
        now
      ];
      tonObj = { rowIndex: 0, row: newTonRow, isNew: true };
      tonMap[tonKey] = tonObj;
      tonAppendRows.push(newTonRow);
    }

    var rowTon = tonObj.row;
    var trangThaiRaw = khoText_(info.trangThaiHang || info.trangThai || "Hàng tốt");
    var trangThaiKey = khoNormalizeTrangThaiKey_(trangThaiRaw);

    var isCho = trangThaiKey.indexOf("CHO") !== -1 || trangThaiKey.indexOf("HOAN THIEN") !== -1 || trangThaiKey.indexOf("KIEM") !== -1;
    var isLoi = trangThaiKey.indexOf("LOI") !== -1 || trangThaiKey.indexOf("HONG") !== -1;
    var loaiNhap = isLoi ? "NHAP_HANG_LOI" : (isCho ? "NHAP_CHO_KIEM" : "NHAP_KHO");

    var tonThucTe = khoNum_(rowTon[8]);
    var tonGiu = khoNum_(rowTon[9]);
    var choHoanThien = khoNum_(rowTon[11]);
    var daCotRi = khoNum_(rowTon[12]);
    var hangLoi = khoNum_(rowTon[13]);

    if (isLoi) {
      hangLoi += qty;
    } else if (isCho) {
      choHoanThien += qty;
    } else {
      tonThucTe += qty;
    }

    var khaDung = Math.max(tonThucTe - tonGiu, 0);

    rowTon[1] = maBanHang;
    rowTon[4] = info.maRap;
    rowTon[5] = info.hieu || "AZALAS";
    rowTon[6] = info.mau;
    rowTon[7] = info.size;
    rowTon[8] = tonThucTe;
    rowTon[9] = tonGiu;
    rowTon[10] = khaDung;
    rowTon[11] = choHoanThien;
    rowTon[12] = daCotRi;
    rowTon[13] = hangLoi;
    rowTon[14] = now;

    if (!tonObj.isNew && tonObj.rowIndex > 0) {
      tonUpdateMap[tonObj.rowIndex] = rowTon;
    }

    var tonSau = isLoi ? hangLoi : (isCho ? choHoanThien : tonThucTe);
    theKhoRows.push([
      khoMakeId_("TK-"),
      now,
      loaiNhap,
      maChungTu,
      maHangNoiBo,
      maBanHang,
      kho,
      qty,
      tonSau,
      nguoi || "app",
      (ghiChuPrefix ? (ghiChuPrefix + " | ") : "") + (khoText_(info.ghiChu) || "") + (trangThaiRaw ? (" | Trạng thái nhập: " + trangThaiRaw) : "")
    ]);

    tongSoLuong += qty;
    details.push({
      item: info,
      maSP: maSP,
      maHangNoiBo: maHangNoiBo,
      maBanHang: maBanHang,
      kho: kho,
      viTri: viTri,
      soLuong: qty,
      trangThaiHang: trangThaiRaw
    });
  }

  if (!details.length) {
    throw new Error("Không có dòng nhập kho hợp lệ.");
  }

  if (hhAppendRows.length) {
    shHH.getRange(shHH.getLastRow() + 1, 1, hhAppendRows.length, 12).setValues(hhAppendRows);
  }

  if (btAppendRows.length) {
    shBT.getRange(shBT.getLastRow() + 1, 1, btAppendRows.length, 11).setValues(btAppendRows);
  }

  var updateRows = Object.keys(tonUpdateMap);
  for (var u = 0; u < updateRows.length; u++) {
    var rowIndex = Number(updateRows[u]);
    var r = tonUpdateMap[rowIndex];
    shTon.getRange(rowIndex, 9, 1, 7).setValues([r.slice(8, 15)]);
  }

  if (tonAppendRows.length) {
    shTon.getRange(shTon.getLastRow() + 1, 1, tonAppendRows.length, 15).setValues(tonAppendRows);
  }

  if (theKhoRows.length) {
    shTheKho.getRange(shTheKho.getLastRow() + 1, 1, theKhoRows.length, 11).setValues(theKhoRows);
  }

  return {
    ok: true,
    maChungTu: maChungTu,
    tongSoLuong: tongSoLuong,
    soDong: details.length,
    details: details,
    hhMoi: hhAppendRows.length,
    bienTheMoi: btAppendRows.length,
    tonMoi: tonAppendRows.length
  };
}

function khoSaveNhapKho_(data) {
  var lock = LockService.getScriptLock();
  var hasLock = false;

  try {
    hasLock = lock.tryLock(30000);
    if (!hasLock) {
      return outText_("Lỗi nhập kho: Hệ thống đang xử lý phiếu khác, vui lòng thử lại sau.");
    }

    data = data || {};
    var items = data.items || [];
    var now = nowVN_();
    var maPhieu = khoMakeId_("PNK-");
    var khoNhap = khoText_(data.khoNhap || data.kho || "KHO CHÍNH");
    var nguoiNhap = khoText_(data.nguoiNhap || data.nguoi || data.user || "app");
    var ghiChu = khoText_(data.ghiChu);

    if (!items.length) {
      return outText_("Lỗi nhập kho: Chưa có dòng hàng hợp lệ.");
    }

    var batch = khoBatchNhapKhoItems_(items, {
      now: now,
      maChungTu: maPhieu,
      nguoi: nguoiNhap,
      defaultKho: khoNhap,
      ghiChuPrefix: "Nhập kho thủ công"
    });

    var shPN = getSheet_("KHO", "tbl_Kho_PhieuNhap");
    var shPNCT = getSheet_("KHO", "tbl_Kho_PhieuNhap_CT");

    shPN.getRange(shPN.getLastRow() + 1, 1, 1, 10).setValues([[
      maPhieu,
      now,
      "Nhập kho thủ công",
      "THU_CONG",
      "",
      khoNhap,
      batch.tongSoLuong,
      "Đã nhập",
      nguoiNhap,
      ghiChu
    ]]);

    var ctRows = batch.details.map(function(d) {
      var item = d.item || {};
      return [
        maPhieu,
        d.maHangNoiBo,
        d.maBanHang,
        item.maRap,
        item.mau,
        item.size,
        d.kho || khoNhap,
        d.soLuong,
        d.trangThaiHang || "Hàng tốt",
        ghiChu || khoText_(item.ghiChu)
      ];
    });

    if (ctRows.length) {
      shPNCT.getRange(shPNCT.getLastRow() + 1, 1, ctRows.length, 10).setValues(ctRows);
    }

    SpreadsheetApp.flush();

    // Giữ dạng text OK|... để tương thích frontend cũ.
    return outText_("OK|" + maPhieu + "|" + batch.tongSoLuong + "|" + batch.soDong);
  } catch (err) {
    return outText_("Lỗi nhập kho: " + err.message);
  } finally {
    try {
      if (hasLock) lock.releaseLock();
    } catch (e) {}
  }
}


/****************************************************
 * TASK 06K - ẢNH THIẾU THEO MÃ RẬP / MÂM HÀNG
 * - Không bắt nhập tay mã bán hàng + màu.
 * - Lấy kế hoạch màu từ RAP/tbl_Rap_SizeKeHoach trước.
 * - Gom theo: Mã rập -> mẫu hàng -> màu kế hoạch.
 * - Màu đã có ảnh thì đánh dấu, màu thiếu ảnh thì đưa lên trước.
 * - Chỉ đọc dữ liệu và dùng lại khoSaveAnhMaBanHang để lưu ảnh.
 ****************************************************/
function khoGetAnhThieuTheoRap_(data) {
  data = data || {};
  var q = khoText_(data.q).toLowerCase();
  var onlyMissingRaw = khoText_(data.onlyMissing || data.missingOnly || "true").toLowerCase();
  var onlyMissing = !(onlyMissingRaw === "false" || onlyMissingRaw === "0" || onlyMissingRaw === "no");
  var limitGroup = khoNum_(data.limit || 80);
  if (limitGroup <= 0) limitGroup = 80;
  if (limitGroup > 200) limitGroup = 200;

  function normKey_(v) {
    return khoText_(v).toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/Đ/g, "D")
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function addUnique_(arr, v) {
    v = khoText_(v);
    if (v && arr.indexOf(v) === -1) arr.push(v);
  }

  function sizeSort_(a, b) {
    var order = ["XS", "S", "M", "L", "XL", "2X", "2XL", "3X", "3XL", "4X", "4XL", "5X", "5XL", "6X", "6XL"];
    var aa = order.indexOf(khoText_(a).toUpperCase());
    var bb = order.indexOf(khoText_(b).toUpperCase());
    if (aa !== -1 || bb !== -1) return (aa === -1 ? 999 : aa) - (bb === -1 ? 999 : bb);
    return khoText_(a).localeCompare(khoText_(b), "vi", { numeric: true });
  }

  var imgByMaBH = {};
  var imgBySpMau = {};
  try {
    var shAnh = khoEnsureAnhSanPhamSheet_();
    var anhRows = shAnh.getDataRange().getValues();
    for (var a = 1; a < anhRows.length; a++) {
      var maBHImg = khoText_(anhRows[a][1]);
      var maSPImg = khoText_(anhRows[a][2]);
      var mauImg = khoText_(anhRows[a][5]);
      var linkChinh = khoText_(anhRows[a][6]);
      var linkPhu = khoText_(anhRows[a][7]);
      if (!linkChinh && !linkPhu) continue;
      var infoImg = {
        maAnhSP: khoText_(anhRows[a][0]),
        maBanHang: maBHImg,
        maSP: maSPImg,
        maRap: khoText_(anhRows[a][3]),
        hieu: khoText_(anhRows[a][4]),
        mau: mauImg,
        linkAnhChinh: linkChinh,
        linkAnhPhu: linkPhu,
        trangThai: khoText_(anhRows[a][9]) || "Đã có ảnh",
        ghiChu: khoText_(anhRows[a][10])
      };
      if (maBHImg) imgByMaBH[maBHImg] = infoImg;
      if (maSPImg && mauImg) imgBySpMau[normKey_(maSPImg) + "__" + normKey_(mauImg)] = infoImg;
    }
  } catch (eAnh) {}

  var groupMap = {};
  var groupOrder = [];
  var rawPlanRows = 0;

  function ensureGroup_(info) {
    var maRap = khoText_(info.maRap) || "CHUA_CO_RAP";
    var maSP = khoText_(info.maSP) || normKey_((info.maRap || "") + " " + (info.tenSP || ""));
    var tenSP = khoText_(info.tenSP || info.mauSanPham || maSP || maRap);
    var hieu = khoText_(info.hieu);
    var key = normKey_(maRap) + "__" + normKey_(maSP) + "__" + normKey_(tenSP) + "__" + normKey_(hieu);
    if (!groupMap[key]) {
      groupMap[key] = {
        key: key,
        maRap: maRap,
        maSP: maSP,
        tenSP: tenSP,
        hieu: hieu,
        mamHang: [],
        phieuNhapRap: [],
        colors: [],
        colorMap: {},
        tongMauKeHoach: 0,
        daCoAnh: 0,
        chuaCoAnh: 0,
        searchText: ""
      };
      groupOrder.push(key);
    }
    return groupMap[key];
  }

  function addPlan_(info) {
    var maRap = khoText_(info.maRap);
    var mau = khoText_(info.mau).toUpperCase();
    var size = khoText_(info.size).toUpperCase();
    var tenSP = khoText_(info.tenSP || info.mauSanPham || info.maSP || maRap);
    if (!maRap && !tenSP) return;
    if (!mau) return;

    var maSP = khoText_(info.maSP) || normKey_([maRap, info.hieu, tenSP].join("-"));
    var maBanHang = khoText_(info.maBanHang) || (typeof rapHNBuildMaBanHang_ === "function" ? rapHNBuildMaBanHang_(maSP || maRap, mau) : normKey_((maSP || maRap) + "-" + mau));
    var maMam = khoText_(info.maMam);
    var maPhieu = khoText_(info.maPhieuNhapRap);
    var hieu = khoText_(info.hieu);

    var haystack = [maRap, maSP, maBanHang, tenSP, hieu, mau, size, maMam, maPhieu].join(" ").toLowerCase();
    if (q && haystack.indexOf(q) === -1) return;

    rawPlanRows++;
    var g = ensureGroup_({ maRap: maRap, maSP: maSP, tenSP: tenSP, hieu: hieu });
    addUnique_(g.mamHang, maMam);
    addUnique_(g.phieuNhapRap, maPhieu);

    var colorKey = maBanHang || (normKey_(maSP) + "__" + normKey_(mau));
    if (!g.colorMap[colorKey]) {
      var img = imgByMaBH[maBanHang] || imgBySpMau[normKey_(maSP) + "__" + normKey_(mau)] || {};
      g.colorMap[colorKey] = {
        key: colorKey,
        maBanHang: maBanHang,
        maSP: maSP,
        maRap: maRap,
        hieu: hieu,
        tenSP: tenSP,
        mau: mau,
        sizes: [],
        mamHang: [],
        phieuNhapRap: [],
        linkAnhChinh: khoText_(img.linkAnhChinh),
        linkAnhPhu: khoText_(img.linkAnhPhu),
        trangThaiAnh: (img.linkAnhChinh || img.linkAnhPhu) ? "Đã có ảnh" : "Chưa có ảnh",
        ghiChuAnh: khoText_(img.ghiChu),
        soDongKeHoach: 0
      };
      g.colors.push(g.colorMap[colorKey]);
    }
    var c = g.colorMap[colorKey];
    addUnique_(c.sizes, size);
    addUnique_(c.mamHang, maMam);
    addUnique_(c.phieuNhapRap, maPhieu);
    c.soDongKeHoach += 1;
  }

  // Ưu tiên bảng chi tiết kế hoạch size vì bảng này thể hiện đầy đủ màu cần làm theo mã rập.
  try {
    var shSize = getSheet_("RAP", "tbl_Rap_SizeKeHoach");
    var sr = shSize.getDataRange().getValues();
    for (var i = 1; i < sr.length; i++) {
      addPlan_({
        maMam: sr[i][0],
        maRap: sr[i][1],
        mau: sr[i][2],
        size: sr[i][3],
        maPhieuNhapRap: sr[i][8],
        maSP: sr[i][9],
        maBanHang: sr[i][10],
        hieu: sr[i][12],
        tenSP: sr[i][13],
        khoNhapDuKien: sr[i][14]
      });
    }
  } catch (eSize) {}

  // Fallback: nếu bảng size chưa có dữ liệu thì lấy từ tbl_Rap_DonHang schema mới.
  if (rawPlanRows === 0) {
    try {
      var shDH = getSheet_("RAP", "tbl_Rap_DonHang");
      var dh = shDH.getDataRange().getValues();
      for (var d = 1; d < dh.length; d++) {
        addPlan_({
          maMam: dh[d][0],
          maRap: dh[d][5],
          tenSP: dh[d][6],
          mau: dh[d][36] || dh[d][7],
          size: dh[d][37] || dh[d][7],
          maPhieuNhapRap: dh[d][32],
          maSP: dh[d][33],
          maBanHang: dh[d][34],
          hieu: dh[d][35]
        });
      }
    } catch (eDH) {}
  }

  var totalGroupsAll = groupOrder.length;
  var totalColorsAll = 0;
  var totalHasImgAll = 0;
  var totalMissingAll = 0;

  var groups = groupOrder.map(function(key) {
    var g = groupMap[key];
    g.colors.forEach(function(c) {
      c.sizes.sort(sizeSort_);
      c.hasImage = !!(c.linkAnhChinh || c.linkAnhPhu);
    });
    g.colors.sort(function(a, b) {
      if ((a.hasImage ? 1 : 0) !== (b.hasImage ? 1 : 0)) return (a.hasImage ? 1 : 0) - (b.hasImage ? 1 : 0);
      return khoText_(a.mau).localeCompare(khoText_(b.mau), "vi");
    });
    g.tongMauKeHoach = g.colors.length;
    g.daCoAnh = g.colors.filter(function(c) { return c.hasImage; }).length;
    g.chuaCoAnh = g.tongMauKeHoach - g.daCoAnh;
    totalColorsAll += g.tongMauKeHoach;
    totalHasImgAll += g.daCoAnh;
    totalMissingAll += g.chuaCoAnh;
    if (onlyMissing) {
      g.colors = g.colors.filter(function(c) { return !c.hasImage; });
    }
    g.searchText = [g.maRap, g.maSP, g.tenSP, g.hieu, g.colors.map(function(c){ return c.mau; }).join(" ")].join(" ").toLowerCase();
    return g;
  }).filter(function(g) {
    if (!g.colors.length) return false;
    return true;
  });

  groups.sort(function(a, b) {
    if (b.chuaCoAnh !== a.chuaCoAnh) return b.chuaCoAnh - a.chuaCoAnh;
    return (a.maRap + a.tenSP).localeCompare(b.maRap + b.tenSP, "vi", { numeric: true });
  });

  if (groups.length > limitGroup) groups = groups.slice(0, limitGroup);

  return outJson_({
    ok: true,
    data: groups,
    summary: {
      q: q,
      onlyMissing: onlyMissing,
      soNhomHienThi: groups.length,
      soNhomKeHoach: totalGroupsAll,
      tongMauKeHoach: totalColorsAll,
      daCoAnh: totalHasImgAll,
      chuaCoAnh: totalMissingAll,
      source: rawPlanRows > 0 ? "tbl_Rap_SizeKeHoach" : "tbl_Rap_DonHang",
      note: onlyMissing ? "Đang chỉ hiện các màu còn thiếu ảnh." : "Đang hiện cả màu đã có ảnh và màu thiếu ảnh."
    }
  });
}

/****************************************************
 * TASK 06N - ĐƠN GIÁ MÂM HÀNG / NHÀ MAY CHO MÃ RẬP
 * - MaRap có thêm cột DonGiaNhaMay
 * - Hàng nhà tự ghi DonGiaNhaMay + ThanhTienNhaMay vào tbl_Rap_DonHang
 ****************************************************/
function azTask06NDonGiaMamHangCheck() {
  var out = { installed: true };
  try {
    var sh = rapDMEnsureSheet_(getSS_("RAP"), "MaRap");
    var headers = sh.getRange(1, 1, 1, Math.max(6, sh.getLastColumn())).getDisplayValues()[0];
    out.headers = headers.slice(0, 6);
    out.hasDonGiaNhaMay = headers.indexOf("DonGiaNhaMay") !== -1;
    var info = rapDMGetMaRapInfo_(getSS_("RAP"));
    out.maRapInfoHasDonGia = !info.length || Object.prototype.hasOwnProperty.call(info[0], "donGiaNhaMay");
  } catch (err) {
    out.error = err.message || String(err);
  }
  return out;
}


/****************************************************
 * TASK 06O CHECK - Đơn giá nhà may theo lịch sử Nhà may + Mã rập
 ****************************************************/
function azTask06ODonGiaTheoLichSuCheck() {
  var out = { installed: true };
  try {
    out.hasHistoryFn = typeof rapHNGetLastDonGiaNhaMay_ === "function";
    out.hasApi = typeof rapHNGetDonGiaNhaMayTheoRapNhaMay === "function";
    out.note = "Mã rập không cần nhập đơn giá nhà may; phiếu hàng nhà tự lấy giá cũ theo Nhà may + Mã rập nếu có.";
  } catch (err) {
    out.error = err.message || String(err);
  }
  return out;
}


/****************************************************
 * TASK 06V - QL RẬP: LOẠI VẢI CHO HÀNG NHÀ
 * - Tạo sheet RAP / tbl_LoaiVai để lưu danh mục loại vải.
 * - rapHNGetMasterData trả thêm loaiVai.
 * - themDanhMucMoi('LoaiVai', tenLoaiVai) dùng cho nút + sau ô Loại vải.
 * - Khi lưu phiếu hàng nhà, ghi LoaiVai vào tbl_Rap_PhieuNhap và tbl_Rap_DonHang nếu có cột.
 ****************************************************/
function az06VText_(v) {
  return String(v === null || v === undefined ? "" : v).trim();
}

function az06VNow_() {
  try { return nowVN_(); } catch (e) { return Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss"); }
}

function az06VKey_(v) {
  return az06VText_(v).toLowerCase();
}

function az06VId_(prefix) {
  return prefix + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + "-" + Math.floor(Math.random() * 1000);
}

function az06VEnsureLoaiVaiSheet_() {
  var ss = getSS_("RAP");
  var sh = ss.getSheetByName("tbl_LoaiVai");
  var headers = ["MaLoaiVai", "TenLoaiVai", "TrangThai", "GhiChu", "CapNhatCuoi"];
  if (!sh) sh = ss.insertSheet("tbl_LoaiVai");
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  var first = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  var empty = first.every(function(x) { return !az06VText_(x); });
  if (empty || az06VText_(first[0]).toLowerCase() === "giatri") {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  try { sh.setFrozenRows(1); } catch (e) {}
  return sh;
}

function az06VGetLoaiVaiList_() {
  var sh = az06VEnsureLoaiVaiSheet_();
  if (sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(2, sh.getLastColumn())).getDisplayValues();
  var seen = {}, out = [];
  rows.forEach(function(r) {
    var ten = az06VText_(r[1] || r[0]);
    if (!ten) return;
    var k = az06VKey_(ten);
    if (seen[k]) return;
    seen[k] = true;
    out.push(ten);
  });
  out.sort();
  return out;
}

function az06VSaveLoaiVai_(tenLoaiVai) {
  tenLoaiVai = az06VText_(tenLoaiVai);
  if (!tenLoaiVai) throw new Error("Thiếu loại vải");
  var sh = az06VEnsureLoaiVaiSheet_();
  var rows = sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(2, sh.getLastColumn())).getDisplayValues() : [];
  var key = az06VKey_(tenLoaiVai);
  for (var i = 0; i < rows.length; i++) {
    var old = az06VText_(rows[i][1] || rows[i][0]);
    if (az06VKey_(old) === key) return "Đã tồn tại";
  }
  sh.appendRow([az06VId_("LV-"), tenLoaiVai, "Đang dùng", "", az06VNow_()]);
  SpreadsheetApp.flush();
  return "Thành công";
}

function az06VEnsureHeaderCol_(sh, headerName) {
  headerName = az06VText_(headerName);
  if (!sh || !headerName) return -1;
  var lastCol = Math.max(1, sh.getLastColumn());
  var headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var target = headerName.toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (az06VText_(headers[i]).toLowerCase() === target) return i + 1;
  }
  sh.getRange(1, lastCol + 1).setValue(headerName);
  return lastCol + 1;
}

function az06VFindHeaderCol_(sh, headerName) {
  if (!sh) return -1;
  var headers = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0];
  var target = az06VText_(headerName).toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (az06VText_(headers[i]).toLowerCase() === target) return i + 1;
  }
  return -1;
}

function az06VPostSaveLoaiVaiToPhieu_(maPhieuNhapRap, loaiVai) {
  maPhieuNhapRap = az06VText_(maPhieuNhapRap);
  loaiVai = az06VText_(loaiVai);
  if (!maPhieuNhapRap || !loaiVai) return;

  try { az06VSaveLoaiVai_(loaiVai); } catch (e0) {}

  ["tbl_Rap_PhieuNhap", "tbl_Rap_DonHang"].forEach(function(sheetName) {
    try {
      var sh = getSheet_("RAP", sheetName);
      var colMaPhieu = az06VFindHeaderCol_(sh, "MaPhieuNhapRap");
      if (colMaPhieu < 1) return;
      var colLoaiVai = az06VEnsureHeaderCol_(sh, "LoaiVai");
      if (sh.getLastRow() < 2) return;
      var ids = sh.getRange(2, colMaPhieu, sh.getLastRow() - 1, 1).getDisplayValues();
      for (var i = 0; i < ids.length; i++) {
        if (az06VText_(ids[i][0]) === maPhieuNhapRap) {
          sh.getRange(i + 2, colLoaiVai).setValue(loaiVai);
        }
      }
    } catch (e) {}
  });
}

var az06V_OldThemDanhMucMoi = themDanhMucMoi;
themDanhMucMoi = function(loai, giaTri1, giaTri2, giaTri3, giaTri4) {
  if (az06VText_(loai) === "LoaiVai") {
    return az06VSaveLoaiVai_(giaTri1);
  }
  return az06V_OldThemDanhMucMoi.apply(this, arguments);
};

var az06V_OldRapHNGetMasterData = rapHNGetMasterData;
rapHNGetMasterData = function() {
  var res = az06V_OldRapHNGetMasterData.apply(this, arguments);
  try {
    if (res && res.ok !== false) res.loaiVai = az06VGetLoaiVaiList_();
  } catch (e) {
    if (res && res.ok !== false) res.loaiVai = [];
  }
  return res;
};

var az06V_OldRapHNSavePhieuNhap = rapHNSavePhieuNhap;
rapHNSavePhieuNhap = function(payload) {
  payload = payload || {};
  var loaiVai = az06VText_(payload.loaiVai || payload.loaiVaiHang || payload.chatLieu || "");
  var res = az06V_OldRapHNSavePhieuNhap.apply(this, arguments);
  try {
    if (res && res.ok && res.maPhieuNhapRap && loaiVai) {
      az06VPostSaveLoaiVaiToPhieu_(res.maPhieuNhapRap, loaiVai);
    }
  } catch (e) {}
  return res;
};

function AZALAS_TASK06V_RAP_LOAI_VAI_CHECK() {
  var sh = az06VEnsureLoaiVaiSheet_();
  var master = rapHNGetMasterData();
  return {
    ok: true,
    sheetLoaiVai: sh.getName(),
    headers: sh.getRange(1,1,1,5).getDisplayValues()[0],
    masterHasLoaiVai: !!(master && master.loaiVai),
    loaiVaiCount: master && master.loaiVai ? master.loaiVai.length : 0,
    saveCategory: typeof themDanhMucMoi === "function",
    saveRapHN: typeof rapHNSavePhieuNhap === "function"
  };
}


/****************************************************
 * TASK 06W - QL RẬP: TRẢ LOẠI VẢI RA DANH SÁCH MÂM HÀNG
 * - Danh mục loại vải lưu ở RAP / tbl_LoaiVai
 * - Loại vải của từng mâm lưu ở cột LoaiVai của tbl_Rap_DonHang
 * - layDanhSachDonHang trả thêm don.loaiVai để Index hiển thị trên card
 ****************************************************/
function az06WText_(v) {
  return String(v === null || v === undefined ? "" : v).trim();
}

function az06WFindHeaderIndex_(headers, headerName) {
  var target = az06WText_(headerName).toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (az06WText_(headers[i]).toLowerCase() === target) return i;
  }
  return -1;
}

function az06WBuildLoaiVaiMap_() {
  var map = {};
  try {
    var sh = getSheet_("RAP", "tbl_Rap_DonHang");
    if (!sh || sh.getLastRow() < 2) return map;

    var lastCol = Math.max(1, sh.getLastColumn());
    var headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    var colLoaiVai = az06WFindHeaderIndex_(headers, "LoaiVai");
    if (colLoaiVai < 0) return map;

    var colMaMam = az06WFindHeaderIndex_(headers, "MaMam");
    var colMaPhieu = az06WFindHeaderIndex_(headers, "MaPhieuNhapRap");
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getDisplayValues();

    rows.forEach(function(r) {
      var loaiVai = az06WText_(r[colLoaiVai]);
      if (!loaiVai) return;

      if (colMaMam >= 0) {
        var maMam = az06WText_(r[colMaMam]);
        if (maMam) map[maMam] = loaiVai;
      }
      if (colMaPhieu >= 0) {
        var maPhieu = az06WText_(r[colMaPhieu]);
        if (maPhieu) map[maPhieu] = loaiVai;
      }
    });
  } catch (err) {}
  return map;
}

var az06W_OldLayDanhSachDonHang = layDanhSachDonHang;
layDanhSachDonHang = function() {
  var data = az06W_OldLayDanhSachDonHang.apply(this, arguments);
  try {
    if (!Array.isArray(data)) return data;
    var map = az06WBuildLoaiVaiMap_();
    data.forEach(function(don) {
      if (!don) return;
      var key1 = az06WText_(don.maMam || don.thoiGianTao || don.idMam || don.idDonHang);
      var key2 = az06WText_(don.maPhieuNhapRap);
      var loaiVai = map[key1] || map[key2] || az06WText_(don.loaiVai || don.loaiVaiHang);
      if (loaiVai) {
        don.loaiVai = loaiVai;
        don.loaiVaiHang = loaiVai;
      }
    });
  } catch (err) {}
  return data;
};

function AZALAS_TASK06W_RAP_LOAI_VAI_DISPLAY_CHECK() {
  var shDM = az06VEnsureLoaiVaiSheet_();
  var map = az06WBuildLoaiVaiMap_();
  var keys = Object.keys(map);
  return {
    ok: true,
    danhMucLoaiVaiSheet: shDM.getName(),
    danhMucHeaders: shDM.getRange(1, 1, 1, 5).getDisplayValues()[0],
    donHangSheet: "tbl_Rap_DonHang",
    donHangLoaiVaiCol: "LoaiVai",
    mappedCount: keys.length,
    sample: keys.length ? { id: keys[0], loaiVai: map[keys[0]] } : null
  };
}


/****************************************************
 * TASK 06AA - FIX CHỐT TT MÂM RẬP AN TOÀN
 * - Tự tạo tbl_NhaMay_ChotDon / tbl_NhaMay_ThanhToan nếu thiếu
 * - Nút CHỐT TT đơn lẻ không còn im lặng khi lỗi
 * - Không đụng tồn kho / nhập kho
 ****************************************************/
function az06AAEnsureSheet_(fileKey, sheetName, headers) {
  var ss = getSS_(fileKey);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
  }

  headers = headers || [];
  if (headers.length) {
    if (sh.getMaxColumns() < headers.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    }

    var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    var empty = true;
    for (var i = 0; i < first.length; i++) {
      if (normalizeText_(first[i])) {
        empty = false;
        break;
      }
    }

    if (empty) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      try { sh.setFrozenRows(1); } catch (e) {}
    }
  }

  return sh;
}

function az06AAEnsureNhaMayChotDonSheet_() {
  return az06AAEnsureSheet_("RAP", "tbl_NhaMay_ChotDon", [
    "MaChot",
    "NgayChot",
    "TenNhaMay",
    "TongSoLuong",
    "DonGia",
    "ThanhTien",
    "DaThanhToan",
    "ConNo",
    "TrangThai",
    "GhiChu",
    "NguoiChot"
  ]);
}

function az06AAEnsureNhaMayThanhToanSheet_() {
  return az06AAEnsureSheet_("RAP", "tbl_NhaMay_ThanhToan", [
    "MaThanhToan",
    "NgayThanhToan",
    "TenNhaMay",
    "MaChot",
    "SoTien",
    "HinhThuc",
    "NguoiThanhToan",
    "GhiChu"
  ]);
}

// Ghi đè hàm cũ bằng bản an toàn hơn.
// Hàm cũ dùng getSheet_ trực tiếp nên nếu thiếu sheet chốt/thanh toán sẽ lỗi ngầm trên giao diện.
function xacNhanThanhToanSheet(id, nguoiChot) {
  try {
    var sheetDH = rapEnsureRapDonHangSheet_();
    var sheetChot = az06AAEnsureNhaMayChotDonSheet_();
    var sheetTT = az06AAEnsureNhaMayThanhToanSheet_();

    id = normalizeText_(id);
    nguoiChot = normalizeText_(nguoiChot) || "Không rõ";

    var rowIndex = rapFindRowIndexByMaMam_(sheetDH, id);
    if (rowIndex < 2) {
      throw new Error("Không tìm thấy mâm cần thanh toán: " + id);
    }

    var lastCol = Math.max(sheetDH.getLastColumn(), RAP_DON_HEADERS.length);
    var row = sheetDH.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
    var don = rapMapDonHangRow_(row);

    var slGiao = rapGetNum_(don.soLuongGiao || don.tongDaGiao);
    var donGia = rapGetNum_(don.donGiaNhaMay || don.donGia);
    var soTien = slGiao * donGia;

    // Nếu mâm cũ đã có thành tiền nhưng thiếu đơn giá thì vẫn cho chốt theo thành tiền đang lưu.
    if (soTien <= 0) {
      soTien = rapGetNum_(don.thanhTienNhaMay || don.thanhTien);
    }

    if (slGiao <= 0) {
      throw new Error("Mâm này chưa có số lượng đã giao nên chưa chốt TT được");
    }

    if (soTien <= 0) {
      throw new Error("Mâm này chưa có đơn giá / thành tiền nhà may");
    }

    var nowText = nowVN_();
    var today = dateVN_();
    var maChot = normalizeText_(don.maChotNhaMay) || ("CNM-DONLE-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss"));
    var maTT = "TTNM-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmmss") + "-" + Math.floor(Math.random() * 1000);

    sheetDH.getRange(rowIndex, RAP_DON_COL.MA_CHOT_NHA_MAY + 1).setValue(maChot);
    sheetDH.getRange(rowIndex, RAP_DON_COL.THANH_TIEN_NHA_MAY + 1).setValue(soTien);
    sheetDH.getRange(rowIndex, RAP_DON_COL.TRANG_THAI_THANH_TOAN + 1).setValue("Đã thanh toán");
    sheetDH.getRange(rowIndex, RAP_DON_COL.CAP_NHAT_CUOI + 1).setValue(nowText);

    var daCoChot = false;
    var valuesChot = sheetChot.getDataRange().getValues();
    for (var c = 1; c < valuesChot.length; c++) {
      if (normalizeText_(valuesChot[c][0]) === maChot) {
        daCoChot = true;
        sheetChot.getRange(c + 1, 2).setValue(today);
        sheetChot.getRange(c + 1, 3).setValue(don.nhaMay);
        sheetChot.getRange(c + 1, 4).setValue(slGiao);
        sheetChot.getRange(c + 1, 5).setValue(donGia);
        sheetChot.getRange(c + 1, 6).setValue(soTien);
        sheetChot.getRange(c + 1, 7).setValue(soTien);
        sheetChot.getRange(c + 1, 8).setValue(0);
        sheetChot.getRange(c + 1, 9).setValue("Đã thanh toán");
        sheetChot.getRange(c + 1, 10).setValue("Chốt thanh toán đơn lẻ mâm " + don.maRap);
        sheetChot.getRange(c + 1, 11).setValue(nguoiChot);
        break;
      }
    }

    if (!daCoChot) {
      sheetChot.appendRow([
        maChot,
        today,
        don.nhaMay,
        slGiao,
        donGia,
        soTien,
        soTien,
        0,
        "Đã thanh toán",
        "Chốt thanh toán đơn lẻ mâm " + don.maRap,
        nguoiChot
      ]);
    }

    sheetTT.appendRow([
      maTT,
      today,
      don.nhaMay,
      maChot,
      soTien,
      "Tiền mặt",
      nguoiChot,
      "Thanh toán trực tiếp mâm " + don.maRap + " / " + id
    ]);

    try { rapCapNhatNoNhaMay_(don.nhaMay); } catch (eNo) {}
    SpreadsheetApp.flush();

    return {
      ok: true,
      message: "Đã chốt thanh toán mâm " + (don.maRap || id),
      maMam: id,
      maChot: maChot,
      soTien: soTien,
      soLuong: slGiao,
      donGia: donGia
    };

  } catch (err) {
    throw new Error("Lỗi xác nhận thanh toán nhà may: " + err.message);
  }
}

function AZALAS_TASK06AA_CHOT_TT_CHECK() {
  return {
    ok: true,
    chotSheet: !!az06AAEnsureNhaMayChotDonSheet_(),
    thanhToanSheet: !!az06AAEnsureNhaMayThanhToanSheet_(),
    xacNhanFn: typeof xacNhanThanhToanSheet === "function"
  };
}

/**
 * AZALAS MOBILE STABILITY V1 - 2026-08-10
 * API đọc NHANH danh sách Nhà May cho màn Công nợ trên mobile.
 * Chỉ đọc dữ liệu, KHÔNG migrate, KHÔNG append, KHÔNG flush, KHÔNG sửa sheet.
 * Mục tiêu: tránh gọi layDuLieuDanhMuc() nặng chỉ để lấy dropdown Nhà May.
 */
function layDanhSachNhaMayMobile() {
  var ssRap = getSS_("RAP");
  if (!ssRap) return [];

  var out = [];
  var seen = {};
  var sheets = [
    ssRap.getSheetByName("tbl_NhaMay"),
    ssRap.getSheetByName("NhaMay")
  ];

  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s];
    if (!sh || sh.getLastRow() < 2) continue;

    var lastRow = sh.getLastRow();
    var lastCol = Math.max(2, sh.getLastColumn());
    var rows = sh.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
    var canonical = sh.getName() === "tbl_NhaMay";

    for (var i = 0; i < rows.length; i++) {
      var raw = canonical ? (rows[i][1] || rows[i][0]) : (rows[i][0] || rows[i][1]);
      var name = String(raw == null ? "" : raw).trim();
      if (!name) continue;

      var key = name.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push(name);
    }
  }

  return out;
}

function AZALAS_MOBILE_STABILITY_V1_CHECK() {
  var list = layDanhSachNhaMayMobile();
  return {
    ok: true,
    version: "AZ_MOBILE_STABILITY_V1_20260810",
    nhaMayCount: list.length
  };
}

/**
 * AZALAS - SỬA NHANH ĐƠN GIÁ NHÀ MAY TRƯỚC KHI CHỐT TT
 *
 * Chỉ cập nhật đúng mâm trong tbl_Rap_DonHang:
 * - T: DonGiaNhaMay
 * - U: ThanhTienNhaMay = TongDaGiao * DonGiaNhaMay
 * - AF: CapNhatCuoi
 *
 * Không sửa bảng kê đã chốt, không sửa lịch sử thanh toán/công nợ.
 */
function capNhatGiaMamNhaMayChuaChot(maMam, donGiaMoi, nguoiSua) {
  try {
    maMam = normalizeText_(maMam);
    nguoiSua = normalizeText_(nguoiSua) || "Không rõ";
    donGiaMoi = rapGetNum_(donGiaMoi);

    if (!maMam) {
      throw new Error("Thiếu mã mâm.");
    }

    if (!isFinite(donGiaMoi) || donGiaMoi < 0) {
      throw new Error("Đơn giá mới không hợp lệ.");
    }

    var sheet = rapEnsureRapDonHangSheet_();
    var rowIndex = rapFindRowIndexByMaMam_(sheet, maMam);

    if (rowIndex < 2) {
      throw new Error("Không tìm thấy mâm " + maMam + ".");
    }

    var lastCol = Math.max(sheet.getLastColumn(), RAP_DON_HEADERS.length);
    var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
    var don = rapMapDonHangRow_(row);

    // Chỉ cho sửa tại màn CHỐT TT trước khi mâm được đưa vào bảng kê.
    if (normalizeText_(don.maChotNhaMay)) {
      throw new Error(
        "Mâm " + (don.maRap || maMam) +
        " đã được chốt Nhà May. Không sửa giá tại màn Chốt TT để tránh lệch công nợ."
      );
    }

    // API này chỉ ghi schema chuẩn mới A:AQ.
    // Không đoán vị trí cột đối với dữ liệu layout cũ để tránh ghi nhầm.
    if (String(don.layoutRap || "") !== "MOI_AF") {
      throw new Error(
        "Mâm này đang dùng cấu trúc dữ liệu cũ. Vui lòng chuyển sang schema Rập mới trước khi sửa giá nhanh."
      );
    }

    var soLuongNhan = rapGetNum_(don.soLuongGiao || don.tongDaGiao);
    var thanhTienMoi = soLuongNhan * donGiaMoi;
    var nowText = nowVN_();

    // T = DonGiaNhaMay
    sheet.getRange(rowIndex, RAP_DON_COL.DON_GIA_NHA_MAY + 1).setValue(donGiaMoi);

    // U = ThanhTienNhaMay
    sheet.getRange(rowIndex, RAP_DON_COL.THANH_TIEN_NHA_MAY + 1).setValue(thanhTienMoi);

    // AF = CapNhatCuoi
    sheet.getRange(rowIndex, RAP_DON_COL.CAP_NHAT_CUOI + 1).setValue(nowText);

    SpreadsheetApp.flush();

    return {
      ok: true,
      maMam: maMam,
      maRap: normalizeText_(don.maRap),
      nhaMay: normalizeText_(don.nhaMay),
      soLuongNhan: soLuongNhan,
      donGiaCu: rapGetNum_(don.donGiaNhaMay || don.donGia),
      donGia: donGiaMoi,
      thanhTien: thanhTienMoi,
      nguoiSua: nguoiSua,
      capNhatCuoi: nowText
    };

  } catch (err) {
    throw new Error("Lỗi sửa đơn giá Nhà May: " + (err.message || String(err)));
  }
}



/* =====================================================================
 * AZALAS V72 - MÃ RẬP / ẢNH - ONLY OWNER
 * Sheet: 04_DATA_SAN_XUAT_RAP / tbl_RapAnh
 * Folder Drive: 05_MA_RAP_ANH (tạo cạnh file dữ liệu RAP nếu có parent)
 *
 * LỆNH CHẠY 1 LẦN:
 *   AZALAS_SETUP_RAP_ANH()
 * ===================================================================== */

function rapAnhTextV72_(v) {
  return String(v === null || v === undefined ? "" : v).trim();
}

function rapAnhSafeNameV72_(v, fallback) {
  var s = rapAnhTextV72_(v) || fallback || "RAP_ANH";
  s = s
    .replace(/[\\\/:*?"<>|#%\{\}\[\]\^~`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s || fallback || "RAP_ANH";
}

function rapAnhNormalizeV72_(v) {
  return rapAnhTextV72_(v)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function rapAnhHeadersV72_() {
  return [
    "MaRapAnh",      // A
    "NgayTao",       // B
    "TenGoc",        // C
    "NoiDung",       // D
    "AnhJson",       // E
    "NguoiTao",      // F
    "UserTao",       // G
    "CapNhatCuoi",   // H
    "ClientToken",   // I
    "FolderId"       // J
  ];
}

function rapAnhGetSheetV72_() {
  var ss = getSS_("RAP");
  var sh = ss.getSheetByName("tbl_RapAnh");
  if (!sh) {
    throw new Error("Chưa có sheet tbl_RapAnh. Hãy chạy AZALAS_SETUP_RAP_ANH() một lần.");
  }
  return sh;
}

function rapAnhFindRootFolderV72_() {
  var props = PropertiesService.getScriptProperties();
  var savedId = rapAnhTextV72_(props.getProperty("AZALAS_RAP_ANH_FOLDER_ID"));

  if (savedId) {
    try {
      return DriveApp.getFolderById(savedId);
    } catch (eSaved) {}
  }

  var folderName = "05_MA_RAP_ANH";
  var parent = null;

  try {
    var rapFile = DriveApp.getFileById(AZALAS_DATA_FILES.RAP);
    var parents = rapFile.getParents();
    if (parents.hasNext()) parent = parents.next();
  } catch (eParent) {}

  var folder = null;
  if (parent) {
    var same = parent.getFoldersByName(folderName);
    folder = same.hasNext() ? same.next() : parent.createFolder(folderName);
  } else {
    var rootSame = DriveApp.getFoldersByName(folderName);
    folder = rootSame.hasNext() ? rootSame.next() : DriveApp.createFolder(folderName);
  }

  props.setProperty("AZALAS_RAP_ANH_FOLDER_ID", folder.getId());
  return folder;
}

/**
 * CHẠY HÀM NÀY 1 LẦN TRONG APPS SCRIPT.
 * - Tạo sheet tbl_RapAnh trong file RAP = 04_DATA_SAN_XUAT_RAP
 * - Tạo folder 05_MA_RAP_ANH
 * - Lưu Folder ID vào Script Properties
 */
function AZALAS_SETUP_RAP_ANH() {
  var ss = getSS_("RAP");
  var sheetName = "tbl_RapAnh";
  var sh = ss.getSheetByName(sheetName);
  var headers = rapAnhHeadersV72_();

  if (!sh) sh = ss.insertSheet(sheetName);

  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }

  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground("#FFF2BD")
    .setFontColor("#7C4A00");

  try {
    sh.setColumnWidth(1, 180);
    sh.setColumnWidth(2, 150);
    sh.setColumnWidth(3, 260);
    sh.setColumnWidth(4, 420);
    sh.setColumnWidth(5, 300);
    sh.setColumnWidth(6, 150);
    sh.setColumnWidth(7, 150);
    sh.setColumnWidth(8, 150);
    sh.setColumnWidth(9, 220);
    sh.setColumnWidth(10, 220);
  } catch (eWidth) {}

  var folder = rapAnhFindRootFolderV72_();
  var result = {
    ok: true,
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    sheetName: sheetName,
    sheetUrl: ss.getUrl() + "#gid=" + sh.getSheetId(),
    folderName: folder.getName(),
    folderId: folder.getId(),
    folderUrl: folder.getUrl(),
    message: "Đã sẵn sàng tbl_RapAnh + folder lưu ảnh."
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function rapAnhOwnerAccountV72_(data) {
  data = data || {};
  var userKey = rapAnhTextV72_(data.user);
  var userName = rapAnhTextV72_(data.userName || data.name);

  if (!userKey && !userName) {
    return { ok: false, owner: false, message: "Thiếu tài khoản người dùng." };
  }

  try {
    var sh = getSheet_("SYSTEM", "tbl_TaiKhoan");
    var rows = sh.getDataRange().getValues();

    for (var i = 1; i < rows.length; i++) {
      var rowUser = rapAnhTextV72_(rows[i][0]); // A User
      var rowName = rapAnhTextV72_(rows[i][2]); // C TenNhanVien
      var rowRole = rapAnhTextV72_(rows[i][3]); // D Role

      var match =
        (userKey && rowUser && rowUser === userKey) ||
        (!userKey && userName && rowName && rowName === userName);

      if (!match) continue;

      var ownerFlag = false;
      try {
        ownerFlag = hasAppRole_(rowRole, "OWNER");
      } catch (eRole) {
        var roles = rowRole.toUpperCase()
          .replace(/[;|\/\\]+/g, ",")
          .replace(/\s+/g, ",")
          .split(",")
          .map(function(x) { return rapAnhTextV72_(x); });
        ownerFlag = roles.indexOf("OWNER") !== -1;
      }

      return {
        ok: true,
        owner: ownerFlag,
        user: rowUser,
        name: rowName,
        role: rowRole
      };
    }

    return { ok: false, owner: false, message: "Không tìm thấy tài khoản trong tbl_TaiKhoan." };
  } catch (err) {
    return { ok: false, owner: false, message: "Không kiểm tra được quyền OWNER: " + err.message };
  }
}

function rapAnhRequireOwnerV72_(data) {
  var auth = rapAnhOwnerAccountV72_(data);
  if (!auth.ok || !auth.owner) {
    throw new Error(auth.message || "Chỉ OWNER được sử dụng Mã Rập / Ảnh.");
  }
  return auth;
}

function rapAnhParseJsonV72_(v, fallback) {
  try {
    if (!v) return fallback;
    var x = typeof v === "string" ? JSON.parse(v) : v;
    return x === null || x === undefined ? fallback : x;
  } catch (e) {
    return fallback;
  }
}

function rapAnhMakeIdV72_() {
  return "RANH-" +
    Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss") +
    "-" + Math.floor(Math.random() * 9000 + 1000);
}

function rapAnhThumbUrlV72_(fileId) {
  fileId = rapAnhTextV72_(fileId);
  return fileId ? "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w1000" : "";
}

function rapAnhFindByTokenV72_(sh, token) {
  token = rapAnhTextV72_(token);
  if (!token || sh.getLastRow() < 2) return null;

  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (rapAnhTextV72_(vals[i][8]) === token) {
      return { rowIndex: i + 2, row: vals[i] };
    }
  }
  return null;
}

function rapAnhSaveImagesV72_(images, maRapAnh, tenGoc) {
  images = Array.isArray(images) ? images : [];
  if (!images.length) throw new Error("Phải có ít nhất 1 ảnh.");
  if (images.length > 12) throw new Error("Tối đa 12 ảnh cho một nội dung.");

  var root = rapAnhFindRootFolderV72_();
  var subName = rapAnhSafeNameV72_(tenGoc, "RAP") + " - " + maRapAnh;
  if (subName.length > 120) subName = subName.substring(0, 120);

  var folder = root.createFolder(subName);
  var saved = [];

  try {
    for (var i = 0; i < images.length; i++) {
      var dataUrl = rapAnhTextV72_(images[i]);
      if (!dataUrl || dataUrl.indexOf(",") === -1 || dataUrl.indexOf("data:image/") !== 0) {
        throw new Error("Ảnh số " + (i + 1) + " không hợp lệ.");
      }

      var meta = dataUrl.substring(5, dataUrl.indexOf(";"));
      var mime = meta || "image/jpeg";
      var base64 = dataUrl.split(",")[1];
      var bytes = Utilities.base64Decode(base64);
      var ext = mime.indexOf("png") !== -1 ? ".png" :
                (mime.indexOf("webp") !== -1 ? ".webp" : ".jpg");

      var filename = maRapAnh + "_" + String(i + 1).padStart(2, "0") + ext;
      var blob = Utilities.newBlob(bytes, mime, filename);
      var file = folder.createFile(blob);

      saved.push({
        id: file.getId(),
        name: file.getName(),
        url: file.getUrl(),
        viewUrl: "https://drive.google.com/uc?export=view&id=" + file.getId(),
        thumbUrl: rapAnhThumbUrlV72_(file.getId())
      });
    }

    return {
      folderId: folder.getId(),
      folderUrl: folder.getUrl(),
      images: saved
    };
  } catch (err) {
    // Nếu lỗi giữa chừng, cố gắng đưa folder vừa tạo vào thùng rác để tránh rác Drive.
    try { folder.setTrashed(true); } catch (eTrash) {}
    throw err;
  }
}

function rapAnhRowToObjV72_(row) {
  row = row || [];
  var images = rapAnhParseJsonV72_(row[4], []);
  if (!Array.isArray(images)) images = [];

  return {
    id: rapAnhTextV72_(row[0]),
    ngayTao: rapAnhTextV72_(row[1]),
    tenGoc: rapAnhTextV72_(row[2]),
    noiDung: rapAnhTextV72_(row[3]),
    anh: images,
    firstImage: images.length ? images[0] : null,
    imageCount: images.length,
    nguoiTao: rapAnhTextV72_(row[5]),
    userTao: rapAnhTextV72_(row[6]),
    capNhatCuoi: rapAnhTextV72_(row[7]),
    folderId: rapAnhTextV72_(row[9])
  };
}

function rapAnhListV72_(data, auth) {
  var sh = rapAnhGetSheetV72_();
  var last = sh.getLastRow();
  if (last < 2) {
    return { ok: true, items: [], total: 0 };
  }

  var q = rapAnhNormalizeV72_(data && data.q);
  var limit = Math.min(Math.max(Number(data && data.limit) || 600, 20), 1200);
  var rows = sh.getRange(2, 1, last - 1, 10).getValues();
  var items = [];

  // Mới nhất lên trước
  for (var i = rows.length - 1; i >= 0 && items.length < limit; i--) {
    var obj = rapAnhRowToObjV72_(rows[i]);
    if (!obj.id || !obj.tenGoc) continue;

    if (q) {
      var hay = rapAnhNormalizeV72_(obj.tenGoc + " " + obj.noiDung);
      if (hay.indexOf(q) === -1) continue;
    }

    items.push(obj);
  }

  return {
    ok: true,
    items: items,
    total: items.length,
    owner: auth && auth.name ? auth.name : ""
  };
}

function rapAnhCreateV72_(data, auth) {
  data = data || {};

  var tenGoc = rapAnhTextV72_(data.tenGoc);
  var noiDung = rapAnhTextV72_(data.noiDung);
  var images = Array.isArray(data.images) ? data.images : [];
  var clientToken = rapAnhTextV72_(data.clientToken);

  if (!tenGoc) throw new Error("Tên gốc là bắt buộc.");
  if (tenGoc.length > 180) throw new Error("Tên gốc tối đa 180 ký tự.");
  if (noiDung.length > 10000) throw new Error("Nội dung tối đa 10.000 ký tự.");
  if (!images.length) throw new Error("Ảnh là bắt buộc.");

  var sh = rapAnhGetSheetV72_();

  // Chống lưu trùng nếu người dùng bấm lại do mạng.
  var existed = rapAnhFindByTokenV72_(sh, clientToken);
  if (existed) {
    var oldObj = rapAnhRowToObjV72_(existed.row);
    return {
      ok: true,
      duplicate: true,
      item: oldObj,
      message: "Nội dung này đã được lưu trước đó."
    };
  }

  var now = nowVN_(); // Server GMT+7, client không được quyền chỉnh Ngày tạo.
  var maRapAnh = rapAnhMakeIdV72_();
  var saved = rapAnhSaveImagesV72_(images, maRapAnh, tenGoc);

  try {
    sh.appendRow([
      maRapAnh,                         // A MaRapAnh
      now,                              // B NgayTao
      tenGoc,                           // C TenGoc
      noiDung,                          // D NoiDung
      JSON.stringify(saved.images),     // E AnhJson
      rapAnhTextV72_(auth.name),        // F NguoiTao
      rapAnhTextV72_(auth.user),        // G UserTao
      now,                              // H CapNhatCuoi
      clientToken,                      // I ClientToken
      saved.folderId                    // J FolderId
    ]);

    SpreadsheetApp.flush();

    return {
      ok: true,
      item: {
        id: maRapAnh,
        ngayTao: now,
        tenGoc: tenGoc,
        noiDung: noiDung,
        anh: saved.images,
        firstImage: saved.images.length ? saved.images[0] : null,
        imageCount: saved.images.length,
        nguoiTao: auth.name,
        userTao: auth.user,
        capNhatCuoi: now,
        folderId: saved.folderId
      },
      folderUrl: saved.folderUrl,
      message: "Đã lưu Mã Rập / Ảnh."
    };
  } catch (errSheet) {
    try { DriveApp.getFolderById(saved.folderId).setTrashed(true); } catch (eTrash2) {}
    throw errSheet;
  }
}

function rapAnhHandleApiV72_(data) {
  var type = rapAnhTextV72_(data && data.type);
  if (type !== "rapAnhList" && type !== "rapAnhCreate") return null;

  try {
    var auth = rapAnhRequireOwnerV72_(data);

    if (type === "rapAnhList") {
      return outJson_(rapAnhListV72_(data, auth));
    }

    if (type === "rapAnhCreate") {
      return outJson_(rapAnhCreateV72_(data, auth));
    }

    return outJson_({ ok: false, message: "API Mã Rập / Ảnh không hợp lệ." });
  } catch (err) {
    return outJson_({
      ok: false,
      message: err && err.message ? err.message : String(err)
    });
  }
}
