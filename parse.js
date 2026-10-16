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
    ['ขาย', 'sale'], ['ราคา', 'sale'], ['แอด', 'ads']
  ];
  var FIELD_OF = {};
  KEYWORDS.forEach(function (k) { FIELD_OF[k[0]] = k[1]; });

  // คำสำคัญต้องตามด้วยตัวเลข (อาจมี : หรือ = คั่น, ติดลบได้เพื่อจับว่าผิด) ถ้าไม่มีตัวเลขถือว่าเป็นส่วนของชื่อ เช่น "เสื้อส่งฟรี"
  // ตัวเลขรับ 1200 | 1,200 | 1,200.50 | 120.5 แต่ไม่รับ 1,2000 (กำกวม)
  var RE = new RegExp(
    '(?:ค่า)?(' + KEYWORDS.map(function (k) { return k[0]; }).join('|') + ')\\s*[:=]?\\s*' +
    '(-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)(?!\\d)(?!,\\d)', 'g');

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
   * conflicts = ฟิลด์ที่ข้อความให้ค่าไม่ตรงกัน (เช่น ซื้อ 100 ... ซื้อ 120) ไม่เลือกให้ ปล่อยว่าง */
  function parseLine(text) {
    var src = toAsciiDigits(String(text === undefined || text === null ? '' : text));
    var values = {}, seen = {}, conflicts = [], spans = [], firstIdx = -1, m;
    RE.lastIndex = 0;
    while ((m = RE.exec(src))) {
      if (firstIdx < 0) firstIdx = m.index;
      spans.push([m.index, m.index + m[0].length]);
      var field = FIELD_OF[m[1]];
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

    var name;
    if (firstIdx < 0) name = cleanName(src);
    else {
      name = cleanName(src.slice(0, firstIdx));
      if (!name) { // ชื่ออยู่ท้ายข้อความ เช่น "ซื้อ 120 ขาย 299 เสื้อ A" -> เอาส่วนที่เหลือนอกคู่คำสำคัญ-ตัวเลข
        var rest = '', pos = 0;
        spans.forEach(function (s) { rest += src.slice(pos, s[0]) + ' '; pos = s[1]; });
        name = cleanName(rest + src.slice(pos));
      }
    }

    var missing = [];
    if (!name) missing.push('name');
    ['cost', 'shipping', 'box'].forEach(function (f) { if (values[f] === undefined) missing.push(f); });
    if (values.sale === undefined && values.actual === undefined) missing.push('sale');
    return { name: name, values: values, missing: missing, conflicts: conflicts };
  }

  return { parseLine: parseLine, KEYWORDS: KEYWORDS };
});
