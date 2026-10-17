/* parse.js - แยกตัวเลขต้นทุนจากข้อความที่จดใน Line ตามกฎใน SPEC.md
 * หลักการ: ไม่เดา อ่านไม่ชัดหรือขัดกันเอง = เว้นว่างและแจ้งใน missing/conflicts ให้ผู้ใช้กรอกเอง
 * ใช้ได้ทั้งเบราว์เซอร์ (window.ParseLine) และ node (require) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ParseLine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // คำสำคัญ -> ฟิลด์ ต้องมีคำเต็มครบ (เช่น ขนส่ง ต้นทุน ขายจริง) ไม่งั้นพยางค์หน้าจะติดไปกับชื่อสินค้า
  // ลำดับในลิสต์ไม่มีผล เพราะ regex ต้องมีตัวเลขตามหลัง ถ้าไม่มีจะถอยไปลองคำอื่นเอง
  var KEYWORDS = [
    ['ราคาขายจริง', 'actual'], ['ราคาขาย', 'sale'], ['ราคาทุน', 'cost'], ['ขายจริง', 'actual'],
    ['ต้นทุน', 'cost'], ['ขนส่ง', 'shipping'], ['พนักงาน', 'staff'], ['โฆษณา', 'ads'],
    ['พัสดุ', 'box'], ['กล่อง', 'box'], ['ซื้อ', 'cost'], ['ทุน', 'cost'], ['ส่ง', 'shipping'],
    ['ขาย', 'sale'], ['ราคา', 'sale'], ['แอด', 'ads'],
    // จำนวนที่ขายได้ (ชิ้น) ไม่ใช่ราคา: ขายได้ 1000, ยอดขาย 1000, ขายออก 50, จำนวนที่ขายได้ 20
    ['จำนวนที่ขายได้', 'sold'], ['จำนวนที่ขาย', 'sold'], ['ขายได้', 'sold'], ['ขายออก', 'sold'], ['ยอดขาย', 'sold']
  ];
  var FIELD_OF = {};
  KEYWORDS.forEach(function (k) { FIELD_OF[k[0]] = k[1]; });

  // คำสำคัญต้องตามด้วยตัวเลข (อาจมี : หรือ = คั่น, ติดลบได้เพื่อจับว่าผิด) ถ้าไม่มีตัวเลขถือว่าเป็นส่วนของชื่อ เช่น "เสื้อส่งฟรี"
  // ตัวเลขรับ 1200 | 1,200 | 1,200.50 | 120.5 แต่ไม่รับ 1,2000 (กำกวม)
  // คำคั่นที่พบบ่อยระหว่างคำสำคัญกับตัวเลข เช่น "ทุนสินค้า 100", "ขายราคา 179", "ซื้อมา 100", "ส่งชิ้นละ 35"
  // ไม่รวม "ได้" (ขายได้ 1000 อาจหมายถึงยอดรวม/จำนวนที่ขายได้ ไม่ใช่ราคา) ไม่เดา
  var FILLER = '(?:สินค้า|ต่อชิ้น|ชิ้นละ|อันละ|ตัวละ|ราคา|เป็น|เท่ากับ|อยู่ที่|ที่|มา)';
  // ตัวเลขที่ตามด้วยหน่วยนับ (5 ชิ้น, 10 ตัว) คือจำนวน ไม่ใช่เงิน: "ขาย 5 ชิ้น" = ขายได้ 5 ชิ้น (sold), คำสำคัญอื่น (ซื้อ 100 ตัว) ไม่รับ
  // ยกเว้น "ชิ้นละ" ที่หมายถึงราคาต่อชิ้น ไม่รวม "กล่อง" เพราะ "ส่ง 35 กล่อง 8" ต้องอ่านได้
  var QTY_UNIT = '(?:ชิ้น|อัน|ตัว|ใบ|คู่|ชุด|แพ็ค|ขวด|ถุง)(?!ละ)';
  // ตัวเลขที่ตามด้วยหน่วยเงิน (บาท) คือเงิน ถ้าไปกับคำว่าขายได้/ยอดขาย ไม่ใช่จำนวนชิ้น ไม่รับ (ไม่เดาว่า 1000 บาท = 1000 ชิ้น)
  var MONEY_UNIT = '(?:บาท|บ\\.|฿)';
  var RE_SRC =
    '(?:ค่า)?(' + KEYWORDS.map(function (k) { return k[0]; }).join('|') + ')\\s*(?:' + FILLER + '\\s*)*[:=]?\\s*' +
    '(-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)(?!\\d)(?!,\\d)(?:\\s*(' + QTY_UNIT + '|' + MONEY_UNIT + '))?';
  var RE = new RegExp(RE_SRC, 'g');
  var MONEY_RE = new RegExp('^' + MONEY_UNIT);

  var THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
  function toAsciiDigits(s) {
    return s.replace(/[๐-๙]/g, function (c) { return String(THAI_DIGITS.indexOf(c)); });
  }
  function cleanName(s) {
    return s.replace(/\s+/g, ' ').replace(/^[\s,:;\-–]+|[\s,:;\-–]+$/g, '');
  }

  /* คืน { name, values, missing, conflicts }
   * values    = { cost, shipping, box, sale, actual, ads, staff } เฉพาะตัวที่อ่านได้ (เป็นตัวเลข)
   * missing   = ฟิลด์ที่ต้องให้ผู้ใช้กรอกเอง จาก ['name','cost','shipping','box','sale']
   *             (sale ไม่ถือว่าขาดถ้ามี actual) แอด/พนักงานเป็นฟิลด์ไม่บังคับ ไม่ถูกนับว่าขาด
   * conflicts = ฟิลด์ที่ข้อความให้ค่าไม่ตรงกัน (เช่น ซื้อ 100 ... ซื้อ 120) ไม่เลือกให้ ปล่อยว่าง
   * unread    = บรรทัดที่อ่านไม่ออก (ไม่มีคำสำคัญตามด้วยตัวเลข) ที่ถูกข้าม เช่น "ขายได้1000 บ้าน" */
  function parseLine(text) {
    var src = toAsciiDigits(String(text === undefined || text === null ? '' : text));
    var values = {}, seen = {}, conflicts = [], spans = [], rejected = [], firstIdx = -1, m;
    RE.lastIndex = 0;
    while ((m = RE.exec(src))) {
      var field = FIELD_OF[m[1]], unit = m[3] || '';
      var isMoney = unit !== '' && MONEY_RE.test(unit), isQty = unit !== '' && !isMoney;
      if (isQty) { if (field === 'sale') field = 'sold'; else if (field !== 'sold') continue; } // ซื้อ 100 ตัว = จำนวน ไม่ใช่ต้นทุน ข้าม
      else if (isMoney && field === 'sold') { rejected.push({ t: m[0].replace(/\s+/g, ' ').trim(), s: m.index, e: m.index + m[0].length }); continue; } // ขายได้ 1000 บาท = เงิน ไม่ใช่จำนวนชิ้น ข้ามและแจ้ง
      if (firstIdx < 0) firstIdx = m.index;
      spans.push([m.index, m.index + m[0].length]);
      var raw = m[2];
      var n = raw.charAt(0) === '-' ? NaN : parseFloat(raw.replace(/,/g, '')); // ติดลบ = ผิด ไม่รับ
      if (!(field in seen)) { seen[field] = [n]; continue; }
      seen[field].push(n);
    }
    Object.keys(seen).forEach(function (f) {
      var list = seen[f];
      var bad = list.some(function (v) { return Number.isNaN(v); });
      var distinct = list.filter(function (v, i) { return list.indexOf(v) === i; });
      if (bad && list.length === 1) return;                // ค่าเดียวและผิด: เว้นว่าง
      if (distinct.length > 1 || bad) { conflicts.push(f); return; } // หลายค่าไม่ตรงกัน: ไม่เดา
      values[f] = distinct[0];
    });

    // แบ่งบรรทัด จำว่าบรรทัดไหนมีคู่คำสำคัญ-ตัวเลข (used) บรรทัดที่ไม่มีจะเป็นชื่อหรืออ่านไม่ได้
    var lineInfo = [], off = 0;
    src.split('\n').forEach(function (t) {
      var start = off, end = off + t.length; off = end + 1;
      if (!t.trim()) return;
      var used = spans.some(function (s) { return s[0] < end && s[1] > start; });
      lineInfo.push({ text: t, used: used });
    });

    // ข้อความสำหรับหาชื่อ: ตัดส่วนที่ถูกปฏิเสธ (เช่น ยอดขาย 1000 บาท) ออก ไม่ให้ปนเข้าชื่อสินค้า
    var nameSrc = src;
    rejected.forEach(function (r) { nameSrc = nameSrc.slice(0, r.s) + new Array(r.e - r.s + 1).join(' ') + nameSrc.slice(r.e); });

    var name, unread = [];
    if (lineInfo.length > 1 && !lineInfo[0].used) {
      // ข้อความหลายบรรทัด บรรทัดแรกไม่มีคำสำคัญตามด้วยตัวเลข = ชื่อสินค้า บรรทัดอื่นที่อ่านไม่ออกแจ้งว่าข้าม ไม่ปนเข้าชื่อ ไม่เดา
      name = cleanName(lineInfo[0].text);
      lineInfo.slice(1).forEach(function (l) { if (!l.used) unread.push(l.text.replace(/\s+/g, ' ').trim()); });
    } else if (firstIdx < 0) name = cleanName(nameSrc);
    else {
      name = cleanName(nameSrc.slice(0, firstIdx));
      if (!name) { // ชื่ออยู่ท้ายข้อความ เช่น "ซื้อ 120 ขาย 299 เสื้อ A" -> เอาส่วนที่เหลือนอกคู่คำสำคัญ-ตัวเลข
        var rest = '', pos = 0;
        spans.forEach(function (s) { rest += nameSrc.slice(pos, s[0]) + ' '; pos = s[1]; });
        name = cleanName(rest + nameSrc.slice(pos));
      }
    }

    // ส่วนที่ถูกปฏิเสธเพราะกำกวม (เช่น ยอดขาย 1000 บาท) ต้องแจ้งเสมอ ไม่ให้หายเงียบ (ถ้าบรรทัดนั้นอยู่ใน unread แล้วไม่ซ้ำ)
    rejected.forEach(function (r) {
      if (!unread.some(function (u) { return u.indexOf(r.t) >= 0; })) unread.push(r.t);
    });

    var missing = [];
    if (!name) missing.push('name');
    ['cost', 'shipping', 'box'].forEach(function (f) { if (values[f] === undefined) missing.push(f); });
    if (values.sale === undefined && values.actual === undefined) missing.push('sale');
    return { name: name, values: values, missing: missing, conflicts: conflicts, unread: unread };
  }

  return { parseLine: parseLine, KEYWORDS: KEYWORDS };
});
