/* store.js - เก็บ/โหลดข้อมูลในเบราว์เซอร์ (localStorage), ตรวจฟอร์มตั้งค่า/ฟอร์มสินค้า, สำรอง/นำเข้า
 * ไม่แตะ DOM รับ storage เข้ามาเองเพื่อให้ทดสอบด้วย node ได้
 * ข้อมูลทั้งหมดอยู่ใต้คีย์เดียว: { version, settings, channels, products } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.Store = factory(root.Calc);
})(typeof self !== 'undefined' ? self : this, function (Calc) {
  'use strict';

  var KEY = 'costcalc.v1';
  var BACKUP_KEY = 'costcalc.v1.unreadable'; // ข้อมูลเดิมที่อ่านไม่ได้ เก็บไว้ ไม่ลบทิ้ง
  var MODES = ['perUnit', 'perMonth'];
  var DEFAULT_THIN = 10; // % กำไรที่ถือว่า "บาง" (ค่าเริ่มต้น เจ้าของร้านปรับได้)
  var MONEY_ERR = 'กรอกเป็นตัวเลขตั้งแต่ 0 ขึ้นไป';
  var MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/; // เดือนของจำนวนที่ขายได้ เช่น 2026-10

  function defaults() {
    return {
      version: 1,
      settings: {
        vatOn: true,
        monthlyUnits: 100,
        thinMargin: DEFAULT_THIN,
        monthlyAsLump: true, // ค่าที่ตั้งเป็น "ยอดต่อเดือน" เป็นก้อนรายเดือน หักทีเดียวต่อเดือนในงบกำไร-ขาดทุน ไม่เฉลี่ยลงต่อชิ้น
        staff: { amount: 0, mode: 'perUnit' },
        ads: { amount: 0, mode: 'perUnit' },
        other: { amount: 0, mode: 'perUnit' }
      },
      // GP เริ่มที่ 0 ให้เจ้าของร้านใส่เอง ไม่เดาเรทของแพลตฟอร์ม
      channels: [
        { id: 'fb', name: 'Facebook', gp: 0 },
        { id: 'sp', name: 'Shopee', gp: 0 },
        { id: 'ln', name: 'Line', gp: 0 }
      ],
      products: [],
      expenses: {} // ค่าใช้จ่ายจริงของแต่ละเดือน { 'YYYY-MM': { staff?, ads?, other?, extras?: [{name, amt}] } }
    };
  }

  function isNum(n) { return typeof n === 'number' && isFinite(n) && n >= 0; }
  function isOverhead(x) { return x && isNum(x.amount) && MODES.indexOf(x.mode) >= 0; }
  function isMoneyMap(m, ids) {
    if (m === undefined) return true;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
    return Object.keys(m).every(function (k) { return ids[k] && isNum(m[k]); });
  }

  /* จำนวนที่ขายได้แยกเดือน: { 'YYYY-MM': { ช่องทาง: จำนวน } } ช่องทางต้องมีอยู่ จำนวน >= 0 */
  function isSoldMap(sold, ids) {
    if (sold === undefined) return true;
    if (!sold || typeof sold !== 'object' || Array.isArray(sold)) return false;
    return Object.keys(sold).every(function (m) { return MONTH_RE.test(m) && sold[m] && typeof sold[m] === 'object' && !Array.isArray(sold[m]) && isMoneyMap(sold[m], ids); });
  }

  /* ค่าใช้จ่ายจริงรายเดือน: { 'YYYY-MM': { staff?, ads?, other?, extras?: [{ name, amt }] } } จำนวนเงิน >= 0 */
  function isExpensesMap(ex) {
    if (ex === undefined) return true;
    if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return false;
    return Object.keys(ex).every(function (m) {
      var e = ex[m];
      if (!MONTH_RE.test(m) || !e || typeof e !== 'object' || Array.isArray(e)) return false;
      if (['staff', 'ads', 'other'].some(function (k) { return e[k] !== undefined && !isNum(e[k]); })) return false;
      if (e.extras !== undefined && (!Array.isArray(e.extras) || !e.extras.every(function (x) { return x && typeof x.name === 'string' && isNum(x.amt); }))) return false;
      return true;
    });
  }

  function currentMonth() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }

  /* ข้อมูลรุ่นก่อนเก็บจำนวนที่ขายได้แบบไม่มีเดือน { ช่องทาง: จำนวน } ย้ายเข้าเดือนที่ระบุ (ค่าเริ่มต้นเดือนปัจจุบัน) ไม่ให้ข้อมูลหาย */
  function migrate(d, month) {
    if (!d || !Array.isArray(d.products)) return d;
    d.products.forEach(function (p) {
      if (!p || !p.sold || typeof p.sold !== 'object' || Array.isArray(p.sold)) return;
      var keys = Object.keys(p.sold);
      if (keys.length && keys.every(function (k) { return typeof p.sold[k] === 'number'; })) {
        var m = {}; m[month || currentMonth()] = p.sold; p.sold = m;
      }
    });
    return d;
  }

  /* สินค้า 1 ตัวใช้ได้ไหม (ราคาอ้างได้เฉพาะช่องทางที่มีอยู่) ไม่บังคับต้องมีราคา เพราะลบช่องทางแล้วสินค้าอาจไม่เหลือราคา */
  function isValidProduct(p, ids) {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name.trim()) return false;
    if (!isNum(p.cost) || !isNum(p.shipping) || !isNum(p.box)) return false;
    if (['staff', 'ads', 'other'].some(function (k) { return p[k] !== undefined && !isNum(p[k]); })) return false;
    if (p.extras !== undefined) {
      if (!Array.isArray(p.extras)) return false;
      if (!p.extras.every(function (e) { return e && typeof e.name === 'string' && isNum(e.amt); })) return false;
    }
    if (p.note !== undefined && typeof p.note !== 'string') return false;
    return isMoneyMap(p.prices, ids) && isMoneyMap(p.actual, ids) && isSoldMap(p.sold, ids);
  }

  /* โครงข้อมูลที่อ่านมาใช้ได้ไหม (กันไฟล์เสีย/ถูกแก้มือ/เวอร์ชันอื่น) */
  function isValidData(d) {
    if (!d || d.version !== 1 || !d.settings || !Array.isArray(d.channels) || !Array.isArray(d.products)) return false;
    var s = d.settings;
    if (typeof s.vatOn !== 'boolean' || !(s.monthlyUnits > 0) || !isOverhead(s.staff) || !isOverhead(s.ads) || !isOverhead(s.other)) return false;
    if (s.thinMargin !== undefined && (!isNum(s.thinMargin) || s.thinMargin > 100)) return false;
    if (s.monthlyAsLump !== undefined && typeof s.monthlyAsLump !== 'boolean') return false;
    if (!isExpensesMap(d.expenses)) return false;
    if (d.channels.length < 1) return false;
    var ids = {};
    var chOk = d.channels.every(function (c) {
      if (!c || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name.trim() || !isNum(c.gp) || c.gp > 100 || ids[c.id]) return false;
      ids[c.id] = 1; return true;
    });
    if (!chOk) return false;
    var pids = {};
    return d.products.every(function (p) {
      if (!isValidProduct(p, ids) || pids[p.id]) return false;
      pids[p.id] = 1; return true;
    });
  }

  /* ข้อมูลเวอร์ชันแรก ๆ ที่ยังไม่มี thinMargin เติมให้ */
  function normalize(d) {
    if (d.settings.thinMargin === undefined) d.settings.thinMargin = DEFAULT_THIN;
    if (d.settings.monthlyAsLump === undefined) d.settings.monthlyAsLump = true;
    delete d.settings.divideByActual; // ตัวเลือกรุ่นก่อนที่เลิกใช้แล้ว (เคยหารด้วยยอดขายจริง) ไม่ใช้ ทิ้ง
    if (d.expenses === undefined) d.expenses = {};
    return d;
  }

  /* ผูกกับ storage (window.localStorage หรือของปลอมในเทส) ถ้า storage เป็น null/ใช้ไม่ได้ จะทำงานในหน่วยความจำและแจ้งสถานะ */
  function createStore(storage) {
    var memory = null;

    function usable() {
      if (!storage) return false;
      try { storage.getItem(KEY); return true; } catch (e) { return false; }
    }

    /* คืน { data, status } status: 'new' | 'ok' | 'recovered' (อ่านของเดิมไม่ได้ เริ่มใหม่ ของเดิมสำรองไว้) | 'unavailable' (เบราว์เซอร์ไม่ให้เก็บ) */
    function load() {
      if (!usable()) { memory = memory || defaults(); return { data: memory, status: 'unavailable' }; }
      var raw = storage.getItem(KEY);
      if (raw === null || raw === undefined) return { data: defaults(), status: 'new' };
      var parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
      var before = parsed ? JSON.stringify(parsed) : '';
      try { migrate(parsed); } catch (e) { /* โครงพัง ปล่อยให้การตรวจข้อมูลจัดการ */ }
      if (isValidData(parsed)) {
        // ถ้าเพิ่งย้ายข้อมูลรุ่นเก่า เขียนกลับทันที ไม่งั้นเปิดอีกทีเดือนหน้าข้อมูลจะไปตกเดือนใหม่
        if (JSON.stringify(parsed) !== before) { try { storage.setItem(KEY, JSON.stringify(parsed)); } catch (e) { /* เขียนไม่ได้ก็ใช้ในหน่วยความจำต่อ */ } }
        return { data: normalize(parsed), status: 'ok' };
      }
      try { storage.setItem(BACKUP_KEY, raw); } catch (e) { /* เก็บสำรองไม่ได้ก็ไม่เป็นไร */ }
      return { data: defaults(), status: 'recovered' };
    }

    /* คืน { ok:true } หรือ { ok:false, error } ไม่โยน exception ใส่หน้าจอ */
    function save(data) {
      if (!isValidData(data)) return { ok: false, error: 'invalid' };
      if (!usable()) { memory = data; return { ok: false, error: 'unavailable' }; }
      try { storage.setItem(KEY, JSON.stringify(data)); return { ok: true }; }
      catch (e) { return { ok: false, error: 'write-failed' }; }
    }

    return { load: load, save: save };
  }

  /* ช่องทางนี้มีสินค้าใช้ราคาอยู่ไหม (ไว้เตือนก่อนลบ) */
  function channelInUse(data, id) {
    return data.products.some(function (p) {
      return (p.prices && p.prices[id] !== undefined) || (p.actual && p.actual[id] !== undefined) || (p.sold && Object.keys(p.sold).some(function (m) { return p.sold[m] && p.sold[m][id] !== undefined; }));
    });
  }

  function newId(prefix, list) {
    var id;
    do { id = prefix + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
    while (list.some(function (x) { return x.id === id; }));
    return id;
  }
  function newChannelId(channels) { return newId('c', channels); }
  function newProductId(products) { return newId('p', products); }

  /* ตัดราคาของช่องทางที่ไม่มีแล้วออกจากสินค้าทุกตัว (ใช้หลังลบช่องทาง) คืนข้อมูลใหม่ ไม่แก้ของเดิม */
  function pruneChannels(data) {
    var ids = {};
    data.channels.forEach(function (c) { ids[c.id] = 1; });
    function keep(m) {
      if (!m) return m;
      var out = {};
      Object.keys(m).forEach(function (k) { if (ids[k]) out[k] = m[k]; });
      return out;
    }
    return Object.assign({}, data, { products: data.products.map(function (p) {
      var q = Object.assign({}, p); q.prices = keep(p.prices); if (p.actual) q.actual = keep(p.actual); if (p.sold) { var ns = {}; Object.keys(p.sold).forEach(function (m) { var k = keep(p.sold[m]); if (Object.keys(k).length) ns[m] = k; }); q.sold = ns; } return q;
    }) });
  }

  /* เพิ่มหรือแก้สินค้า (ตาม id) คืนข้อมูลใหม่ สินค้าใหม่ (id = null) จะได้ id ให้ */
  function upsertProduct(data, product) {
    var p = Object.assign({}, product);
    var products = data.products.slice();
    if (!p.id) { p.id = newProductId(products); products.push(p); }
    else {
      var i = products.findIndex(function (x) { return x.id === p.id; });
      if (i < 0) products.push(p); else products[i] = p;
    }
    return Object.assign({}, data, { products: products });
  }
  function deleteProduct(data, id) {
    return Object.assign({}, data, { products: data.products.filter(function (p) { return p.id !== id; }) });
  }

  /* ---------- ฟอร์มตั้งค่า ---------- */
  function toForm(data) {
    var s = data.settings;
    function o(x) { return { amount: String(x.amount), mode: x.mode }; }
    return {
      vatOn: s.vatOn, monthlyAsLump: s.monthlyAsLump !== false, monthlyUnits: String(s.monthlyUnits), thinMargin: String(s.thinMargin === undefined ? DEFAULT_THIN : s.thinMargin),
      staff: o(s.staff), ads: o(s.ads), other: o(s.other),
      channels: data.channels.map(function (c) { return { id: c.id, name: c.name, gp: String(c.gp) }; })
    };
  }

  /* คืน { ok, errors, clean } errors เป็นแมปคีย์ -> ข้อความ: 'ch.0.name' 'ch.0.gp' 'staff.amount' 'ads.amount' 'other.amount' 'monthlyUnits' 'thinMargin' 'channels'
   * clean = { settings, channels } เมื่อ ok */
  function validateForm(form) {
    var errors = {}, channels = [], names = {};

    if (!form.channels.length) errors.channels = 'ต้องมีอย่างน้อย 1 ช่องทาง';
    form.channels.forEach(function (c, i) {
      var name = String(c.name).trim(), gp = Calc.parseMoney(c.gp);
      if (!name) errors['ch.' + i + '.name'] = 'ใส่ชื่อช่องทาง';
      else if (name.length > 30) errors['ch.' + i + '.name'] = 'ชื่อยาวเกิน 30 ตัวอักษร';
      else if (names[name.toLowerCase()]) errors['ch.' + i + '.name'] = 'ชื่อซ้ำกับช่องทางอื่น';
      else names[name.toLowerCase()] = 1;
      if (gp === null) errors['ch.' + i + '.gp'] = 'ใส่ค่า GP (ไม่มีให้ใส่ 0)';
      else if (Number.isNaN(gp)) errors['ch.' + i + '.gp'] = MONEY_ERR;
      else if (gp > 100) errors['ch.' + i + '.gp'] = 'GP ต้องไม่เกิน 100%';
      channels.push({ id: c.id, name: name, gp: gp });
    });

    var settings = { vatOn: !!form.vatOn, monthlyAsLump: form.monthlyAsLump !== false };
    ['staff', 'ads', 'other'].forEach(function (k) {
      var amt = Calc.parseMoney(form[k].amount); // ว่าง = 0
      if (Number.isNaN(amt)) errors[k + '.amount'] = MONEY_ERR;
      if (MODES.indexOf(form[k].mode) < 0) errors[k + '.mode'] = 'เลือกวิธีคิด';
      settings[k] = { amount: amt === null ? 0 : amt, mode: form[k].mode };
    });
    var units = Calc.parseMoney(form.monthlyUnits);
    if (units === null || Number.isNaN(units) || !(units > 0) || Math.floor(units) !== units) errors.monthlyUnits = 'กรอกจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
    settings.monthlyUnits = units;
    var thin = Calc.parseMoney(form.thinMargin);
    if (thin === null) errors.thinMargin = 'ใส่ % (ไม่ต้องการเตือนให้ใส่ 0)';
    else if (Number.isNaN(thin)) errors.thinMargin = MONEY_ERR;
    else if (thin > 100) errors.thinMargin = 'ต้องไม่เกิน 100%';
    settings.thinMargin = thin;

    var ok = Object.keys(errors).length === 0;
    return { ok: ok, errors: errors, clean: ok ? { settings: settings, channels: channels } : null };
  }

  /* ---------- ฟอร์มสินค้า ---------- */
  /* f.sold = { 'YYYY-MM': { ช่องทาง: ข้อความ } } ทุกเดือนที่มีข้อมูล, f.soldMonth = เดือนที่กำลังแก้ในฟอร์ม */
  function emptySoldMonth(channels) { var m = {}; channels.forEach(function (c) { m[c.id] = ''; }); return m; }
  function blankProductForm(channels, month) {
    var f = { id: null, name: '', note: '', cost: '', shipping: '', box: '', staff: '', ads: '', other: '', extras: [], prices: {}, actual: {}, sold: {}, soldMonth: month || currentMonth() };
    channels.forEach(function (c) { f.prices[c.id] = ''; f.actual[c.id] = ''; });
    f.sold[f.soldMonth] = emptySoldMonth(channels);
    return f;
  }
  function productToForm(p, channels, month) {
    var f = blankProductForm(channels, month);
    f.id = p.id; f.name = p.name; f.note = p.note || '';
    f.cost = String(p.cost); f.shipping = String(p.shipping); f.box = String(p.box);
    ['staff', 'ads', 'other'].forEach(function (k) { f[k] = p[k] === undefined ? '' : String(p[k]); });
    f.extras = (p.extras || []).map(function (e) { return { name: e.name, amt: String(e.amt) }; });
    channels.forEach(function (c) {
      if (p.prices && p.prices[c.id] !== undefined) f.prices[c.id] = String(p.prices[c.id]);
      if (p.actual && p.actual[c.id] !== undefined) f.actual[c.id] = String(p.actual[c.id]);
    });
    Object.keys(p.sold || {}).forEach(function (m) {
      f.sold[m] = f.sold[m] || emptySoldMonth(channels);
      channels.forEach(function (c) { if (p.sold[m][c.id] !== undefined) f.sold[m][c.id] = String(p.sold[m][c.id]); });
    });
    return f;
  }

  /* คืน { ok, errors, clean } คีย์ errors: name cost shipping box staff ads other  x.<i>.amt  p.<channelId>  a.<channelId>  prices
   * ต้นทุนต้องกรอก, ค่าขนส่ง/กล่องว่าง = 0, ค่าพนักงาน/แอด/อื่น ๆ ว่าง = ใช้ค่ากลาง, ต้องมีราคาอย่างน้อย 1 ช่องทาง
   * clean = สินค้าพร้อมบันทึก (id เป็น null ถ้าเป็นสินค้าใหม่) */
  function validateProductForm(form, channels) {
    var errors = {}, P = Calc.parseMoney;
    var name = String(form.name).trim();
    if (!name) errors.name = 'ใส่ชื่อสินค้า';
    else if (name.length > 60) errors.name = 'ชื่อยาวเกิน 60 ตัวอักษร';

    var cost = P(form.cost);
    if (cost === null) errors.cost = 'กรอกต้นทุนสินค้า';
    else if (Number.isNaN(cost)) errors.cost = MONEY_ERR;
    var shipping = P(form.shipping), box = P(form.box);
    if (Number.isNaN(shipping)) errors.shipping = MONEY_ERR;
    if (Number.isNaN(box)) errors.box = MONEY_ERR;

    var clean = { id: form.id || null, name: name, cost: cost, shipping: shipping || 0, box: box || 0 };
    ['staff', 'ads', 'other'].forEach(function (k) {
      var v = P(form[k]);
      if (Number.isNaN(v)) errors[k] = MONEY_ERR; else if (v !== null) clean[k] = v;
    });

    var extras = [];
    form.extras.forEach(function (e, i) {
      var en = String(e.name).trim(), amt = P(e.amt);
      if (en === '' && amt === null) return; // แถวว่าง ข้าม
      if (amt === null) errors['x.' + i + '.amt'] = 'ใส่ราคา';
      else if (Number.isNaN(amt)) errors['x.' + i + '.amt'] = MONEY_ERR;
      else extras.push({ name: en, amt: amt });
    });
    if (extras.length) clean.extras = extras;

    var prices = {}, actual = {}, sold = {};
    channels.forEach(function (c) {
      var p = P(form.prices[c.id]), a = P(form.actual[c.id]);
      if (Number.isNaN(p)) errors['p.' + c.id] = MONEY_ERR; else if (p !== null) prices[c.id] = p;
      if (Number.isNaN(a)) errors['a.' + c.id] = MONEY_ERR; else if (a !== null) actual[c.id] = a;
    });
    // จำนวนที่ขายได้รายเดือน คีย์ error: s.<YYYY-MM>.<ช่องทาง> ต้องมีราคาของช่องทางนั้นก่อน ไม่งั้นคำนวณยอดขายไม่ได้
    Object.keys(form.sold || {}).forEach(function (m) {
      if (!MONTH_RE.test(m)) return;
      channels.forEach(function (c) {
        var s = P(form.sold[m][c.id]), key = 's.' + m + '.' + c.id;
        if (Number.isNaN(s)) errors[key] = MONEY_ERR;
        else if (s !== null) {
          if (prices[c.id] === undefined && actual[c.id] === undefined && !errors['p.' + c.id] && !errors['a.' + c.id]) errors[key] = 'ใส่ราคาขายของช่องทางนี้ก่อน';
          else { sold[m] = sold[m] || {}; sold[m][c.id] = s; }
        }
      });
    });
    if (!Object.keys(prices).length && !Object.keys(actual).length) errors.prices = 'ใส่ราคาอย่างน้อย 1 ช่องทาง';
    clean.prices = prices;
    if (Object.keys(actual).length) clean.actual = actual;
    if (Object.keys(sold).length) clean.sold = sold;
    var note = String(form.note || '').trim();
    if (note) clean.note = note;

    var ok = Object.keys(errors).length === 0;
    return { ok: ok, errors: errors, clean: ok ? clean : null };
  }

  /* ---------- ค่าใช้จ่ายจริงรายเดือน ---------- */
  function expenseToForm(expenses, month) {
    var e = (expenses && expenses[month]) || {};
    var f = { month: month, staff: '', ads: '', other: '', extras: [] };
    ['staff', 'ads', 'other'].forEach(function (k) { if (e[k] !== undefined) f[k] = String(e[k]); });
    f.extras = (e.extras || []).map(function (x) { return { name: x.name, amt: String(x.amt) }; });
    return f;
  }
  /* คีย์ error: staff ads other x.<i>.amt   ช่องว่าง = ไม่กรอก (ใช้ค่าที่ตั้งไว้) 0 = ตั้งใจว่าไม่มีค่าใช้จ่ายนี้เดือนนี้
   * clean = { staff?, ads?, other?, extras? } (ว่างทั้งหมด = {} แปลว่าลบข้อมูลเดือนนั้น) */
  function validateExpenseForm(form) {
    var errors = {}, clean = {}, P = Calc.parseMoney;
    ['staff', 'ads', 'other'].forEach(function (k) {
      var v = P(form[k]);
      if (Number.isNaN(v)) errors[k] = MONEY_ERR; else if (v !== null) clean[k] = v;
    });
    var extras = [];
    form.extras.forEach(function (x, i) {
      var name = String(x.name).trim(), amt = P(x.amt);
      if (name === '' && amt === null) return;
      if (amt === null) errors['x.' + i + '.amt'] = 'ใส่จำนวนเงิน';
      else if (Number.isNaN(amt)) errors['x.' + i + '.amt'] = MONEY_ERR;
      else extras.push({ name: name, amt: amt });
    });
    if (extras.length) clean.extras = extras;
    var ok = Object.keys(errors).length === 0;
    return { ok: ok, errors: errors, clean: ok ? clean : null };
  }
  /* ตั้งค่าใช้จ่ายของเดือน (clean ว่าง = ลบเดือนนั้น) คืนข้อมูลใหม่ ไม่แก้ของเดิม */
  function setExpenses(data, month, clean) {
    var ex = Object.assign({}, data.expenses || {});
    if (clean && Object.keys(clean).length) ex[month] = clean; else delete ex[month];
    return Object.assign({}, data, { expenses: ex });
  }

  /* ---------- สำรอง/นำเข้า ---------- */
  function exportJSON(data) {
    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings: data.settings, channels: data.channels, products: data.products, expenses: data.expenses || {} }, null, 2);
  }
  /* คืน { ok:true, data } หรือ { ok:false, error:'json'|'shape' } เก็บเฉพาะฟิลด์ที่รู้จัก ไม่เชื่อค่าแปลกปลอมในไฟล์ */
  function parseImport(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return { ok: false, error: 'json' }; }
    if (!o || typeof o !== 'object') return { ok: false, error: 'shape' };
    try { migrate(o); } catch (e) { /* โครงพัง ให้การตรวจข้อมูลปฏิเสธ */ }
    var data = { version: o.version, settings: o.settings, channels: o.channels, products: o.products, expenses: o.expenses };
    if (!isValidData(data)) return { ok: false, error: 'shape' };
    return { ok: true, data: normalize(JSON.parse(JSON.stringify(data))) };
  }

  return {
    KEY: KEY, BACKUP_KEY: BACKUP_KEY, MONTH_RE: MONTH_RE, currentMonth: currentMonth, migrate: migrate, DEFAULT_THIN: DEFAULT_THIN, defaults: defaults, isValidData: isValidData, isValidProduct: isValidProduct, createStore: createStore,
    channelInUse: channelInUse, newChannelId: newChannelId, newProductId: newProductId, pruneChannels: pruneChannels,
    upsertProduct: upsertProduct, deleteProduct: deleteProduct,
    expenseToForm: expenseToForm, validateExpenseForm: validateExpenseForm, setExpenses: setExpenses, isExpensesMap: isExpensesMap,
    toForm: toForm, validateForm: validateForm, blankProductForm: blankProductForm, productToForm: productToForm, validateProductForm: validateProductForm,
    exportJSON: exportJSON, parseImport: parseImport
  };
});
