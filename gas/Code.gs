/**
 * ============================================================================
 * REFERENCE COPY — คัดลอกส่วนที่ต้องการไปวางในโปรเจกต์ Apps Script จริงของคุณเอง
 * ไฟล์นี้ไม่ได้ถูกรันจริงจาก repo นี้ (Apps Script ไม่ deploy จาก GitHub โดยตรง)
 *
 * ทุกฟังก์ชันเดิม (business logic) ถูกคัดลอกมาแบบไม่แก้ไข ยกเว้น 4 ฟังก์ชันที่เขียนข้อมูล
 * (registerPatient, updateProfileOnly, saveOPDVisit, addNewDrug) ซึ่งเพิ่ม LockService
 * ครอบไว้เพื่อกันข้อมูลชนกันเวลามีคนเรียกพร้อมกันหลายทาง (หน้า HTML เดิม + API ใหม่)
 *
 * ส่วนที่ "เพิ่มใหม่" ทั้งหมดอยู่ท้ายไฟล์ ในหัวข้อ "==== API LAYER (ใหม่) ====":
 *   - doGet / doPost ถูกปรับให้แยกเส้นทาง: ถ้ามี ?action=... จะตอบเป็น JSON (API)
 *     ถ้าไม่มี action จะ serve หน้า Index.html เหมือนเดิมทุกประการ (ของเดิมไม่กระทบ)
 *   - handleApi / jsonOut คือ router + ตัวช่วยตอบ JSON
 *   - ต้องตั้งค่า Script Properties ชื่อ API_TOKEN ก่อนใช้งาน (Project Settings >
 *     Script Properties > Add script property) เพื่อกันคนนอกยิง API มั่ว
 *
 * ดูขั้นตอน deploy แบบไม่กระทบระบบที่ใช้งานอยู่ได้ใน SETUP.md
 * ============================================================================
 */


// ==== ฟังก์ชันเดิมทั้งหมด (ไม่แก้ logic) ====================================

function getOrCreateOPDSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('OPD_Visits');
  if (!sheet) {
    sheet = ss.insertSheet('OPD_Visits');
    sheet.appendRow([
      "Date", "HN", "Name", "Age", "Gender", "Phone", "Address", "CID",
      "CC", "Allergy", "Underlying", "PE", "BP", "HR", "RR", "Temp",
      "BW", "Height", "BMI", "Lab", "Dx", "Rx", "Doctor", "Status"
    ]);
  }
  return sheet;
}

// เพิ่มใหม่: ทำให้ Sheet เปล่าๆ ใช้งานได้ทันทีโดยไม่ต้องสร้าง Patients/Settings เอง
// (จำเป็นสำหรับใช้เป็น "template" — ก็อปปี้ Sheet+Script ให้ลูกค้าใหม่แล้วรันได้เลย)
function getOrCreatePatientsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Patients');
  if (!sheet) {
    sheet = ss.insertSheet('Patients');
    sheet.appendRow(['HN', 'CID', 'Name', 'DOB', 'Gender', 'Phone', 'Address', 'Allergy', 'Underlying']);
  }
  return sheet;
}

function getOrCreateSettingsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Settings');
  if (!sheet) {
    sheet = ss.insertSheet('Settings');
    sheet.appendRow(['ClinicName', 'Address', 'Phone', 'Hours']);
    sheet.appendRow(['คลินิกของฉัน', 'แก้ไขที่อยู่ได้ที่ Sheet นี้', '0-0000-0000', '08:00 - 20:00']);
  }
  return sheet;
}

function safeDateStr(val) {
  if (!val) return "";
  try {
    if (Object.prototype.toString.call(val) === '[object Date]') {
      if (isNaN(val.getTime())) return "";
      return Utilities.formatDate(val, "GMT+7", "yyyy-MM-dd");
    }
    var str = String(val).replace(/'/g, "").trim();

    // ISO ตรงเป๊ะ หรือมี time component ต่อท้าย (เช่น "1955-05-01T00:00:00.000Z")
    var isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3];

    // รูปแบบ d/m/yyyy หรือ d-m-yyyy หรือ d.m.yyyy (รองรับทั้งปี ค.ศ. และ พ.ศ.)
    var altMatch = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (altMatch) {
      var dd = ('0' + altMatch[1]).slice(-2);
      var mm = ('0' + altMatch[2]).slice(-2);
      var yyyy = parseInt(altMatch[3], 10);
      if (yyyy > 2400) yyyy -= 543;
      return yyyy + "-" + mm + "-" + dd;
    }

    return "";
  } catch (e) { return ""; }
}

function calculateAgeFromStr(dobStr) {
  if (!dobStr) return "-";
  var parts = dobStr.split('-');
  if (parts.length !== 3) return "-";
  var y = parseInt(parts[0]);
  var currentYear = new Date().getFullYear();
  return Math.abs(currentYear - y);
}

function getClinicInfo() {
  var sheet = getOrCreateSettingsSheet();
  var data = sheet.getRange(2, 1, 1, 4).getValues()[0];
  return { name: data[0], address: data[1], phone: data[2], hours: data[3] };
}

function getDrugList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Drugs');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var drugs = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] != "") drugs.push({ name: data[i][0], usage: data[i][1] });
  }
  return drugs;
}

function addNewDrug(name, usage) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Drugs');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == name) return "Exist";
    }
    sheet.appendRow([name, usage]);
    return "Saved";
  } finally {
    lock.releaseLock();
  }
}

function getICD10Data() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('ICD10');
  if (!sheet) {
    sheet = ss.insertSheet('ICD10');
    sheet.appendRow(['Code', 'Description (Thai/Eng)']);
    var commonData = [
      ['Z48.0', 'Z48.0 : ทำแผล (Change dressing)'], ['Z48.02', 'Z48.02 : ตัดไหม (Removal of sutures)'],
      ['T14.0', 'T14.0 : แผลถลอก (Superficial injury)'], ['T14.1', 'T14.1 : แผลเปิด (Open wound)'],
      ['W54', 'W54 : สุนัขกัด (Dog bite)'], ['R50.9', 'R50.9 : ไข้ (Fever)'],
      ['J00', 'J00 : หวัด (Common Cold)'], ['A09', 'A09 : ท้องเสีย (Diarrhea)'],
      ['I10', 'I10 : ความดันสูง (HT)'], ['E11.9', 'E11.9 : เบาหวาน (DM)']
    ];
    sheet.getRange(2, 1, commonData.length, 2).setValues(commonData);
  }
  var data = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) list.push({ code: data[i][0], desc: data[i][1] });
  }
  return list;
}

function getAllPatientsList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreatePatientsSheet();
  var data = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < data.length; i++) {
    list.push({
      hn: String(data[i][0]).replace(/'/g, ""),
      cid: String(data[i][1]).replace(/'/g, ""),
      name: data[i][2],
      phone: String(data[i][5]).replace(/'/g, "")
    });
  }
  return list.reverse();
}

function getPatientFullHistory(hn) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hnClean = String(hn).replace(/'/g, "").trim();

  var pSheet = getOrCreatePatientsSheet();
  var pData = pSheet.getDataRange().getValues();
  var profile = null;
  for (var i = 1; i < pData.length; i++) {
    if (String(pData[i][0]).replace(/'/g, "").trim() == hnClean) {
      profile = {
        hn: pData[i][0], cid: pData[i][1], name: pData[i][2],
        dob: safeDateStr(pData[i][3]), gender: pData[i][4],
        phone: pData[i][5], address: pData[i][6],
        allergy: pData[i][7], underlying: pData[i][8]
      };
      break;
    }
  }

  var vSheet = getOrCreateOPDSheet();
  var vData = vSheet.getDataRange().getValues();
  var visits = [];

  for (var j = 1; j < vData.length; j++) {
    if (String(vData[j][1]).replace(/'/g, "").trim() == hnClean) {
      var d = new Date(vData[j][0]);
      var dateStr = Utilities.formatDate(d, "GMT+7", "dd/MM/yyyy HH:mm");

      visits.push({
        rowIndex: j + 1,
        date: dateStr,
        cc: vData[j][8], allergy: vData[j][9], underlying: vData[j][10], pe: vData[j][11],
        bp: vData[j][12], hr: vData[j][13], rr: vData[j][14], bt: vData[j][15],
        bw: vData[j][16], ht: vData[j][17], bmi: vData[j][18],
        lab: vData[j][19], dx: vData[j][20], rx: vData[j][21],
        doctor: vData[j][22]
      });
    }
  }
  visits.reverse();

  return { profile: profile, visits: visits };
}

function getLastTenPatients() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreatePatientsSheet();
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var rows = data.slice(1);
  var last10 = rows.slice(-10).reverse();
  return last10.map(function (row) { return { hn: row[0], cid: row[1], name: row[2] }; });
}

function registerPatient(form) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreatePatientsSheet();
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) == String(form.hn)) return "Error: HN นี้มีอยู่แล้ว";
    }
    sheet.appendRow(["'" + form.hn, "'" + form.cid, form.name, "", form.gender, "'" + form.phone, "", form.allergy, form.underlying]);
    return "ลงทะเบียนสำเร็จ";
  } finally {
    lock.releaseLock();
  }
}

function updateProfileOnly(form) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var pSheet = getOrCreatePatientsSheet();
    var pData = pSheet.getDataRange().getValues();
    var targetHN = String(form.opd_hn).trim().replace(/'/g, "");

    for (var i = 1; i < pData.length; i++) {
      var rowHN = String(pData[i][0]).trim().replace(/'/g, "");
      if (rowHN == targetHN) {
        var row = i + 1;
        pSheet.getRange(row, 2).setValue("'" + form.opd_cid);
        pSheet.getRange(row, 3).setValue(form.opd_name);
        if (form.opd_dob) pSheet.getRange(row, 4).setValue("'" + form.opd_dob);
        pSheet.getRange(row, 5).setValue(form.opd_gender);
        pSheet.getRange(row, 6).setValue("'" + form.opd_phone);
        if (form.opd_address) pSheet.getRange(row, 7).setValue(form.opd_address);
        pSheet.getRange(row, 8).setValue(form.opd_allergy);
        pSheet.getRange(row, 9).setValue(form.opd_underlying);
        return "แก้ไขข้อมูลส่วนตัวเรียบร้อยแล้ว";
      }
    }
    return "Error: ไม่พบ HN นี้ในฐานข้อมูล";
  } finally {
    lock.releaseLock();
  }
}

function searchPatientData(text) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pSheet = getOrCreatePatientsSheet();
  var vSheet = getOrCreateOPDSheet();
  var pData = pSheet.getDataRange().getValues();
  var vData = vSheet.getDataRange().getValues();

  var textClean = text.toString().replace(/\D/g, '');
  var matches = [];
  var todayStr = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd");

  for (var i = 1; i < pData.length; i++) {
    var r = pData[i];
    var rowHN = String(r[0]).replace(/'/g, "");
    var isMatch = false;
    if (rowHN == text) isMatch = true;
    else if (String(r[2]).includes(text)) isMatch = true;
    else if (textClean.length > 5 && (String(r[1]).includes(textClean) || String(r[5]).includes(textClean))) isMatch = true;

    if (isMatch) {
      var dobStr = safeDateStr(r[3]);
      var age = calculateAgeFromStr(dobStr);
      var todayVisit = null;
      for (var j = 1; j < vData.length; j++) {
        var visitHN = String(vData[j][1]).replace(/'/g, "");
        if (visitHN == rowHN) {
          var visitDate = safeDateStr(vData[j][0]);
          if (visitDate == todayStr) {
            todayVisit = {
              rowIndex: j + 1,
              cc: vData[j][8], allergy: vData[j][9], underlying: vData[j][10], pe: vData[j][11],
              bp: vData[j][12], hr: vData[j][13], rr: vData[j][14], bt: vData[j][15],
              bw: vData[j][16], ht: vData[j][17], bmi: vData[j][18],
              lab: vData[j][19], dx: vData[j][20], rx: vData[j][21],
              doctor: vData[j][22], status: vData[j][23]
            };
          }
        }
      }
      matches.push({
        hn: rowHN, cid: r[1], name: r[2], dob: dobStr, age: age,
        gender: r[4], phone: r[5], address: r[6], allergy: r[7], underlying: r[8],
        today_visit: todayVisit
      });
    }
  }

  var result = { status: 'not_found', candidates: [], info: {}, history: [] };
  if (matches.length === 0) { result.status = 'not_found'; }
  else if (matches.length > 1) { result.status = 'multiple'; result.candidates = matches; }
  else {
    result.status = 'single'; result.info = matches[0];
    for (var j = 1; j < vData.length; j++) {
      if (String(vData[j][1]).replace(/'/g, "") == String(result.info.hn)) {
        var d = new Date(vData[j][0]);
        var dateStr = Utilities.formatDate(d, "GMT+7", "dd/MM/yyyy HH:mm");
        result.history.push({ rowIndex: j + 1, date: dateStr, dx: vData[j][20] });
      }
    }
    result.history.reverse();
  }
  return result;
}

function saveOPDVisit(form) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var vSheet = getOrCreateOPDSheet();
    var pSheet = getOrCreatePatientsSheet();

    var originalHN = String(form.original_hn).trim().replace(/'/g, "");
    var newHN = String(form.opd_hn).trim().replace(/'/g, "");
    var status = form.visit_status;
    var rowIndex = parseInt(form.opd_row_index);

    if (isNaN(rowIndex) || rowIndex == 0) {
      var allData = vSheet.getDataRange().getValues();
      for (var k = 1; k < allData.length; k++) {
        var vHN = String(allData[k][1]).trim().replace(/'/g, "");
        var vStatus = allData[k][23];
        if (vHN == newHN && vStatus == "Waiting") {
          rowIndex = k + 1;
          break;
        }
      }
    }

    var pData = pSheet.getDataRange().getValues();
    for (var i = 1; i < pData.length; i++) {
      var rowHN = String(pData[i][0]).trim().replace(/'/g, "");
      if (rowHN == originalHN) {
        var row = i + 1;
        pSheet.getRange(row, 1).setValue("'" + newHN);
        pSheet.getRange(row, 2).setValue("'" + form.opd_cid);
        pSheet.getRange(row, 3).setValue(form.opd_name);
        if (form.opd_dob) { pSheet.getRange(row, 4).setValue("'" + form.opd_dob); }
        pSheet.getRange(row, 5).setValue(form.opd_gender);
        pSheet.getRange(row, 6).setValue("'" + form.opd_phone);
        if (form.opd_address) pSheet.getRange(row, 7).setValue(form.opd_address);
        pSheet.getRange(row, 8).setValue(form.opd_allergy);
        pSheet.getRange(row, 9).setValue(form.opd_underlying);
        break;
      }
    }

    if (originalHN != newHN) {
      var vData = vSheet.getDataRange().getValues();
      for (var j = 1; j < vData.length; j++) {
        var vHN = String(vData[j][1]).trim().replace(/'/g, "");
        if (vHN == originalHN) {
          vSheet.getRange(j + 1, 2).setValue("'" + newHN);
          vSheet.getRange(j + 1, 3).setValue(form.opd_name);
        }
      }
    }

    var dataRow = [
      "'" + newHN, form.opd_name, form.opd_age, form.opd_gender,
      "'" + form.opd_phone, form.opd_address, "'" + form.opd_cid,
      form.cc, form.opd_allergy, form.opd_underlying, form.pe,
      form.bp, form.hr, form.rr, form.bt,
      form.bw, form.ht, form.bmi,
      form.lab, form.dx, form.rx, form.doctor, status
    ];

    if (!isNaN(rowIndex) && rowIndex > 0) {
      vSheet.getRange(rowIndex, 2, 1, 23).setValues([dataRow]);
      return "บันทึกข้อมูลเรียบร้อย";
    } else {
      vSheet.appendRow([new Date()].concat(dataRow));
      return "บันทึกข้อมูลใหม่เรียบร้อย";
    }
  } finally {
    lock.releaseLock();
  }
}

function getDashboardStats() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateOPDSheet();
  var data = sheet.getDataRange().getValues();

  var stats = {
    todayCount: 0, monthCount: 0, totalCount: 0,
    dailyTrend: {}, dxCounts: {}
  };

  if (data.length <= 1) return stats;

  var today = new Date();
  var todayStr = Utilities.formatDate(today, "GMT+7", "yyyy-MM-dd");
  var currentMonth = today.getMonth();
  var currentYear = today.getFullYear();

  for (var i = 1; i < data.length; i++) {
    stats.totalCount++;
    var rowDateStr = safeDateStr(data[i][0]);
    if (!rowDateStr) continue;
    var rowDate = new Date(rowDateStr);

    if (rowDateStr === todayStr) stats.todayCount++;
    if (rowDate.getMonth() === currentMonth && rowDate.getFullYear() === currentYear) stats.monthCount++;

    if (!stats.dailyTrend[rowDateStr]) stats.dailyTrend[rowDateStr] = 0;
    stats.dailyTrend[rowDateStr]++;

    var dx = String(data[i][20]).trim();
    if (dx) {
      var shortDx = dx.split(':')[0].trim();
      if (!stats.dxCounts[shortDx]) stats.dxCounts[shortDx] = 0;
      stats.dxCounts[shortDx]++;
    }
  }

  var chartData = { dates: [], counts: [] };
  for (var d = 6; d >= 0; d--) {
    var dObj = new Date();
    dObj.setDate(today.getDate() - d);
    var dStr = Utilities.formatDate(dObj, "GMT+7", "yyyy-MM-dd");
    var label = Utilities.formatDate(dObj, "GMT+7", "dd/MM");

    chartData.dates.push(label);
    chartData.counts.push(stats.dailyTrend[dStr] || 0);
  }
  stats.chartDaily = chartData;

  var sortableDx = [];
  for (var key in stats.dxCounts) { sortableDx.push([key, stats.dxCounts[key]]); }
  sortableDx.sort(function (a, b) { return b[1] - a[1]; });
  stats.topDx = sortableDx.slice(0, 5);

  return stats;
}

function getWaitingList() {
  var sheet = getOrCreateOPDSheet();
  var data = sheet.getDataRange().getValues();
  var queue = [];
  var now = new Date();
  for (var i = 1; i < data.length; i++) {
    if (data[i][23] == "Waiting") {
      var d = new Date(data[i][0]);
      var timeStr = Utilities.formatDate(d, "GMT+7", "HH:mm");
      var waitMinutes = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000));
      queue.push({
        rowIndex: i + 1, hn: data[i][1], name: data[i][2], cc: data[i][8], bp: data[i][12],
        wait_time: timeStr, waitMinutes: waitMinutes, _sortTime: d.getTime()
      });
    }
  }
  // เรียงตามเวลาเข้าคิวก่อน-หลัง แล้วให้เลขคิวตามลำดับนั้น (มาก่อนได้คิวน้อยกว่า)
  queue.sort(function (a, b) { return a._sortTime - b._sortTime; });
  queue.forEach(function (q, idx) { q.queueNumber = idx + 1; delete q._sortTime; });
  return queue;
}

function getVisitsByMonth(year, month) {
  var y = parseInt(year, 10);
  var m = parseInt(month, 10); // 1-12
  var sheet = getOrCreateOPDSheet();
  var data = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < data.length; i++) {
    var d = new Date(data[i][0]);
    if (isNaN(d.getTime())) continue;
    if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
      list.push({
        date: Utilities.formatDate(d, "GMT+7", "dd/MM/yyyy HH:mm"),
        hn: String(data[i][1]).replace(/'/g, ""),
        name: data[i][2],
        cid: String(data[i][7]).replace(/'/g, ""),
        phone: String(data[i][5]).replace(/'/g, ""),
        cc: data[i][8],
        dx: data[i][20],
        doctor: data[i][22],
        status: data[i][23]
      });
    }
  }
  return list;
}

function getRecentActivity() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateOPDSheet();
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var limit = 50;
  var startIndex = Math.max(1, data.length - limit);
  var rows = data.slice(startIndex);
  return rows.reverse().map(function (r, i) {
    var actualRowIndex = data.length - i;
    var d = new Date(r[0]);
    var timeStr = Utilities.formatDate(d, "GMT+7", "HH:mm");
    return { rowIndex: actualRowIndex, time: timeStr, hn: r[1], name: r[2], dx: r[20], status: r[23] || 'Completed' };
  });
}

function getVisitByRow(rowIndex) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var vSheet = getOrCreateOPDSheet();
  var pSheet = getOrCreatePatientsSheet();
  var vData = vSheet.getRange(rowIndex, 1, 1, 24).getValues()[0];
  var hn = String(vData[1]).replace(/'/g, "");

  var pData = pSheet.getDataRange().getValues();
  var patientInfo = {};
  for (var i = 1; i < pData.length; i++) {
    if (String(pData[i][0]).replace(/'/g, "") == hn) {
      var r = pData[i];
      var dobStr = safeDateStr(r[3]);
      var age = calculateAgeFromStr(dobStr);
      patientInfo = {
        hn: r[0], cid: r[1], name: r[2],
        dob: dobStr, age: age,
        gender: r[4], phone: r[5],
        address: r[6], allergy: r[7], underlying: r[8]
      };
      break;
    }
  }
  return {
    visit: {
      rowIndex: rowIndex,
      cc: vData[8], allergy: vData[9], underlying: vData[10], pe: vData[11],
      bp: vData[12], hr: vData[13], rr: vData[14], bt: vData[15],
      bw: vData[16], ht: vData[17], bmi: vData[18],
      lab: vData[19], dx: vData[20], rx: vData[21],
      doctor: vData[22], status: vData[23]
    },
    patient: patientInfo
  };
}


// ==== AUTH (ใหม่) — Username/Password login + จัดการผู้ใช้หลายคน ============
// สร้าง 2 sheet ใหม่แบบ additive เท่านั้น (ไม่แตะ sheet เดิม):
//   Users:    Username | PasswordHash | DisplayName | Active | Role (admin/staff)
//   Sessions: Token | Username | ExpiresAt

var SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // อายุ session 12 ชั่วโมง

function getOrCreateUsersSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Users');
  if (!sheet) {
    sheet = ss.insertSheet('Users');
    sheet.appendRow(['Username', 'PasswordHash', 'DisplayName', 'Active', 'Role']);
    return sheet;
  }
  // migrate: เพิ่มคอลัมน์ Role ถ้ายังไม่มี (สำหรับ sheet ที่สร้างไว้ก่อนมีฟีเจอร์นี้)
  var header = sheet.getRange(1, 1, 1, Math.max(5, sheet.getLastColumn())).getValues()[0];
  if (header[4] !== 'Role') {
    sheet.getRange(1, 5).setValue('Role');
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var roleCol = sheet.getRange(2, 5, lastRow - 1, 1).getValues();
      for (var i = 0; i < roleCol.length; i++) {
        // ผู้ใช้ที่มีอยู่ก่อนฟีเจอร์นี้ ให้เป็น admin ไว้ก่อน กันไม่ให้ล็อกตัวเองออกจากหน้าจัดการผู้ใช้
        if (!roleCol[i][0]) roleCol[i][0] = 'admin';
      }
      sheet.getRange(2, 5, roleCol.length, 1).setValues(roleCol);
    }
  }
  return sheet;
}

function getOrCreateSessionsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Sessions');
  if (!sheet) {
    sheet = ss.insertSheet('Sessions');
    sheet.appendRow(['Token', 'Username', 'ExpiresAt']);
  }
  return sheet;
}

function hashPassword(password) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/**
 * รันฟังก์ชันนี้เองจาก Apps Script Editor เท่านั้น (เลือกฟังก์ชันแล้วกด Run)
 * เพื่อสร้าง/รีเซ็ตรหัสผ่านผู้ใช้ — ไม่ได้เปิดให้เรียกผ่าน API เพื่อความปลอดภัย
 */
function createOrUpdateUser(username, plainPassword, displayName, role) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateUsersSheet();
    var data = sheet.getDataRange().getValues();
    var hash = hashPassword(plainPassword);
    var finalRole = (role === 'staff') ? 'staff' : 'admin'; // default admin เพื่อความเข้ากันได้กับการใช้งานเดิม
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === username) {
        sheet.getRange(i + 1, 2).setValue(hash);
        sheet.getRange(i + 1, 3).setValue(displayName || data[i][2]);
        sheet.getRange(i + 1, 4).setValue(true);
        sheet.getRange(i + 1, 5).setValue(role ? finalRole : (data[i][4] || 'admin'));
        return 'Updated: ' + username;
      }
    }
    sheet.appendRow([username, hash, displayName || username, true, finalRole]);
    return 'Created: ' + username;
  } finally {
    lock.releaseLock();
  }
}

/**
 * ตัวอย่าง: แก้ 3 ค่าด้านล่างแล้วเลือกฟังก์ชันนี้ใน Run dropdown กด Run ครั้งเดียว
 * เพื่อสร้างบัญชีแรก จากนั้นจะลบทิ้งหรือปล่อยไว้ก็ได้ (ใช้สร้าง/รีเซ็ตรหัสผ่านภายหลังได้เรื่อยๆ)
 */
function _seedAdminUser() {
  Logger.log(createOrUpdateUser('admin', 'ChangeMe123!', 'ผู้ดูแลระบบ'));
}

function login(username, password) {
  var sheet = getOrCreateUsersSheet();
  var data = sheet.getDataRange().getValues();
  var hash = hashPassword(password);
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === username) {
      if (data[i][3] === false || String(data[i][3]).toUpperCase() === 'FALSE') {
        throw new Error('บัญชีนี้ถูกระงับการใช้งาน');
      }
      if (data[i][1] !== hash) break;
      var token = Utilities.getUuid();
      var sessSheet = getOrCreateSessionsSheet();
      sessSheet.appendRow([token, username, Date.now() + SESSION_DURATION_MS]);
      return { token: token, displayName: data[i][2] || username, role: data[i][4] || 'admin' };
    }
  }
  throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
}

function validateSession(token) {
  if (!token) return null;
  var sheet = getOrCreateSessionsSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      if (Number(data[i][2]) < Date.now()) return null;
      return data[i][1];
    }
  }
  return null;
}

function logout(token) {
  var sheet = getOrCreateSessionsSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return 'ok';
}

// ---- จัดการผู้ใช้หลายคน (เรียกผ่านหน้า "จัดการผู้ใช้" ในเว็บ — ต้องเป็น admin) ----

function getUserRow(username) {
  var sheet = getOrCreateUsersSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === username) {
      return {
        rowIndex: i + 1, username: data[i][0], displayName: data[i][2],
        active: data[i][3] !== false && String(data[i][3]).toUpperCase() !== 'FALSE',
        role: data[i][4] || 'admin'
      };
    }
  }
  return null;
}

function requireAdmin(username) {
  var u = getUserRow(username);
  if (!u || u.role !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบ (admin) เท่านั้นที่ทำรายการนี้ได้');
}

function countActiveAdmins() {
  var sheet = getOrCreateUsersSheet();
  var data = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    var active = data[i][3] !== false && String(data[i][3]).toUpperCase() !== 'FALSE';
    if (active && data[i][4] === 'admin') count++;
  }
  return count;
}

function listUsers() {
  var sheet = getOrCreateUsersSheet();
  var data = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < data.length; i++) {
    list.push({
      username: data[i][0], displayName: data[i][2],
      active: data[i][3] !== false && String(data[i][3]).toUpperCase() !== 'FALSE',
      role: data[i][4] || 'admin'
    });
  }
  return list;
}

function adminCreateUser(actingUsername, username, password, displayName, role) {
  requireAdmin(actingUsername);
  username = String(username || '').trim();
  if (!username || !password) throw new Error('กรุณากรอก Username และ Password');
  if (password.length < 4) throw new Error('รหัสผ่านสั้นเกินไป (อย่างน้อย 4 ตัวอักษร)');
  if (getUserRow(username)) throw new Error('มี Username นี้อยู่แล้ว');
  createOrUpdateUser(username, password, displayName, role === 'admin' ? 'admin' : 'staff');
  return 'สร้างผู้ใช้ ' + username + ' เรียบร้อยแล้ว';
}

function adminUpdateUser(actingUsername, username, displayName, role, active) {
  requireAdmin(actingUsername);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var u = getUserRow(username);
    if (!u) throw new Error('ไม่พบผู้ใช้นี้');
    var newRole = (role === 'admin') ? 'admin' : 'staff';
    var newActive = !!active;
    var losingAdmin = (u.role === 'admin' && u.active) && (newRole !== 'admin' || !newActive);
    if (losingAdmin && countActiveAdmins() <= 1) {
      throw new Error('ไม่สามารถถอดสิทธิ์หรือปิดใช้งาน admin คนสุดท้ายของระบบได้');
    }
    var sheet = getOrCreateUsersSheet();
    sheet.getRange(u.rowIndex, 3).setValue(displayName || u.displayName);
    sheet.getRange(u.rowIndex, 4).setValue(newActive);
    sheet.getRange(u.rowIndex, 5).setValue(newRole);
    return 'บันทึกข้อมูลผู้ใช้ ' + username + ' เรียบร้อยแล้ว';
  } finally {
    lock.releaseLock();
  }
}

function adminResetPassword(actingUsername, username, newPassword) {
  requireAdmin(actingUsername);
  if (!newPassword || newPassword.length < 4) throw new Error('รหัสผ่านใหม่สั้นเกินไป (อย่างน้อย 4 ตัวอักษร)');
  var u = getUserRow(username);
  if (!u) throw new Error('ไม่พบผู้ใช้นี้');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateUsersSheet();
    sheet.getRange(u.rowIndex, 2).setValue(hashPassword(newPassword));
    return 'รีเซ็ตรหัสผ่านของ ' + username + ' เรียบร้อยแล้ว';
  } finally {
    lock.releaseLock();
  }
}


// ==== API LAYER (ใหม่) ======================================================
// ตั้งค่า Script Properties ก่อนใช้งาน:
//   Project Settings > Script Properties > Add script property
//   Property: API_TOKEN   Value: <สุ่มสตริงยาวๆ เก็บเป็นความลับ>

function doGet(e) {
  if (e.parameter && e.parameter.action) {
    return handleApi(e.parameter.action, e.parameter);
  }
  // ไม่มี action -> serve หน้า Index.html เดิม เหมือนของเดิมทุกประการ
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Clinic System V50 Fixed')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { /* ignore, treated as unknown action below */ }
  return handleApi(body.action, body);
}

function handleApi(action, p) {
  p = p || {};
  var API_TOKEN = PropertiesService.getScriptProperties().getProperty('API_TOKEN');

  try {
    if (!API_TOKEN || p.token !== API_TOKEN) {
      return jsonOut({ ok: false, error: 'Unauthorized' });
    }

    if (action === 'login') {
      return jsonOut({ ok: true, data: login(p.username, p.password) });
    }

    var loggedInUser = validateSession(p.sessionToken);
    if (!loggedInUser) {
      return jsonOut({ ok: false, error: 'SESSION_EXPIRED' });
    }

    var data;
    switch (action) {
      case 'logout':                 data = logout(p.sessionToken); break;
      case 'listUsers':              requireAdmin(loggedInUser); data = listUsers(); break;
      case 'createUser':             data = adminCreateUser(loggedInUser, p.username, p.password, p.displayName, p.role); break;
      case 'updateUser':             data = adminUpdateUser(loggedInUser, p.username, p.displayName, p.role, p.active); break;
      case 'resetUserPassword':      data = adminResetPassword(loggedInUser, p.username, p.newPassword); break;
      case 'getClinicInfo':          data = getClinicInfo(); break;
      case 'getDrugList':            data = getDrugList(); break;
      case 'getICD10Data':           data = getICD10Data(); break;
      case 'getAllPatientsList':     data = getAllPatientsList(); break;
      case 'getLastTenPatients':     data = getLastTenPatients(); break;
      case 'getPatientFullHistory':  data = getPatientFullHistory(p.hn); break;
      case 'searchPatientData':      data = searchPatientData(p.text); break;
      case 'getDashboardStats':      data = getDashboardStats(); break;
      case 'getWaitingList':         data = getWaitingList(); break;
      case 'getRecentActivity':      data = getRecentActivity(); break;
      case 'getVisitsByMonth':       data = getVisitsByMonth(p.year, p.month); break;
      case 'getVisitByRow':          data = getVisitByRow(p.rowIndex); break;
      case 'registerPatient':        data = registerPatient(p.form); break;
      case 'updateProfileOnly':      data = updateProfileOnly(p.form); break;
      case 'saveOPDVisit':           data = saveOPDVisit(p.form); break;
      case 'addNewDrug':             data = addNewDrug(p.name, p.usage); break;
      default:
        return jsonOut({ ok: false, error: 'Unknown action: ' + action });
    }
    return jsonOut({ ok: true, data: data });
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
