/* app.js - หน้าจอของเครื่องมือคำนวณกำไร: แดชบอร์ด, รายละเอียดสินค้า, ฟอร์มสินค้า, ตั้งค่า, สำรอง/นำเข้า
 * ตรรกะอยู่ใน calc.js / parse.js / store.js (มีเทสแยก) ไฟล์นี้ทำหน้าที่ต่อสายหน้าจอเท่านั้น */
(function () {
  'use strict';

  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); };
  var money = function (n) { return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var pct = function (n) { return (n < 0 ? '-' : '') + Math.abs(n).toFixed(2) + '%'; };
  var cls = function (n) { return n < 0 ? 'neg' : ''; };
  var $ = function (id) { return document.getElementById(id); };
  var disc = function (r) { return r.list ? (r.price < r.list ? 'ลด ' : 'สูงกว่า ') + Math.abs((r.list - r.price) / r.list * 100).toFixed(0) + '%' : ''; };

  var ICON = {
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="5" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="11" width="7" height="9" rx="1.5"/></svg>',
    add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/></svg>',
    set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h9M18 7h1M5 17h1M10 17h9"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
    back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>'
  };
  var NAV = [['dash', 'แดชบอร์ด', 'ภาพรวมกำไรทุกสินค้า'], ['add', 'เพิ่มสินค้า', 'กรอก หรือวางข้อความจาก Line'], ['set', 'ตั้งค่า', 'GP, VAT, พนักงาน, แอด, สำรองข้อมูล']];
  var FIELD_LABEL = { name: 'ชื่อสินค้า', cost: 'ต้นทุน', shipping: 'ค่าขนส่ง', box: 'ค่ากล่อง', sale: 'ราคาตั้ง', actual: 'ราคาขายจริง', ads: 'ค่าแอด', staff: 'ค่าพนักงาน' };

  /* โหมดทดลอง (showcase.html): ใช้ข้อมูลสมมติที่หน้าเว็บส่งมาใน window.COSTCALC_DEMO เก็บในหน่วยความจำ ไม่แตะ localStorage จริง */
  var demo = window.COSTCALC_DEMO || null;
  function memoryStorage(seed) {
    var m = {}; m[Store.KEY] = JSON.stringify(seed);
    return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); } };
  }
  var store = Store.createStore(demo ? memoryStorage(demo) : (function () { try { return window.localStorage; } catch (e) { return null; } })());
  var loaded = store.load();
  var state = {
    data: loaded.data, status: loaded.status,
    sForm: null, sDirty: false, sShowErr: false, sSaved: false,
    pForm: null, pDirty: false, pShowErr: false, pText: '', pCh: null, miss: {}, pMsg: '', img: null,
    fil: { ch: 'all', loss: false, sort: 'desc' },
    cur: ''
  };

  function toast(t) {
    var e = $('toast'); e.textContent = t; e.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove('show'); }, 3000);
  }

  /* ---------- เส้นทาง: #dash #add #edit/<id> #p/<id>/<ช่องทาง> #set (รีเฟรชแล้วอยู่หน้าเดิม) ---------- */
  function route() {
    var p = location.hash.replace(/^#\/?/, '').split('/');
    var n = p[0] || 'dash';
    if (['dash', 'add', 'edit', 'p', 'set'].indexOf(n) < 0) n = 'dash';
    return { name: n, id: p[1], ch: p[2] };
  }
  function isDirty() { var n = route().name; return ((n === 'add' || n === 'edit') && state.pDirty) || (n === 'set' && state.sDirty); }
  function ch(id) { return state.data.channels.find(function (c) { return c.id === id; }); }
  function product(id) { return state.data.products.find(function (p) { return p.id === id; }); }
  function calcFor(p, c) { return Calc.calcProduct(p, c, state.data.settings); }
  function results(p) {
    var out = [];
    state.data.channels.forEach(function (c) { var r = calcFor(p, c); if (r) out.push({ ch: c, r: r }); });
    return out;
  }

  /* เข้าหน้าใหม่: เตรียมฟอร์มตามหน้า */
  function enter() {
    var r = route();
    if (r.name === 'set') { state.sForm = Store.toForm(state.data); state.sDirty = false; state.sShowErr = false; state.sSaved = false; }
    if (r.name === 'add' || (r.name === 'edit' && product(r.id))) {
      state.pForm = r.name === 'add' ? Store.blankProductForm(state.data.channels) : Store.productToForm(product(r.id), state.data.channels);
      state.pDirty = false; state.pShowErr = false; state.pText = ''; state.miss = {}; state.pMsg = '';
      state.pCh = state.data.channels[0].id;
      if (state.img) { URL.revokeObjectURL(state.img); state.img = null; }
    }
  }

  function renderNav() {
    var n = route().name, on = n === 'p' || n === 'edit' ? 'dash' : n;
    $('nav').innerHTML = NAV.map(function (x) {
      return '<a class="opnav-item ' + (on === x[0] ? 'on' : '') + '" href="#' + x[0] + '"><i>' + ICON[x[0]] + '</i><span><b>' + x[1] + '</b><small>' + x[2] + '</small></span></a>';
    }).join('');
  }

  function statusNote() {
    if (state.status === 'unavailable') return '<div class="hint bad-box">เบราว์เซอร์นี้ไม่ให้เก็บข้อมูล (อาจเปิดโหมดส่วนตัวอยู่) ข้อมูลจะหายเมื่อปิดหน้านี้ ใช้ปุ่มดาวน์โหลดไฟล์สำรองในหน้าตั้งค่าเก็บไว้</div>';
    if (state.status === 'recovered') return '<div class="hint bad-box">อ่านข้อมูลเดิมในเครื่องไม่ได้ จึงเริ่มใหม่ด้วยค่าเริ่มต้น (ข้อมูลเดิมถูกสำรองไว้ในเบราว์เซอร์ ไม่ได้ถูกลบ) ถ้ามีไฟล์สำรอง นำเข้าได้ในหน้าตั้งค่า</div>';
    return '';
  }
  function gpWarn() {
    var allZero = state.data.channels.every(function (c) { return c.gp === 0; });
    return allZero ? '<div class="hint warn">ค่า GP ทุกช่องทางยังเป็น 0 กำไรที่เห็นยังไม่หักค่าธรรมเนียมแพลตฟอร์ม <a href="#set">ไปใส่ค่า GP ในหน้าตั้งค่า</a></div>' : '';
  }
  function zone(r) {
    var s = Calc.status(r, state.data.settings.thinMargin);
    return s === 'loss' ? '<span class="zone danger">ขาดทุน</span>' : s === 'thin' ? '<span class="zone warn">กำไรบาง</span>' : '<span class="zone safe">ปกติ</span>';
  }

  /* ---------- แดชบอร์ด ---------- */
  function viewDash() {
    var d = state.data, f = state.fil;
    var head = statusNote() + gpWarn();
    if (!d.products.length) {
      return head + '<div class="pagehead"><h1>แดชบอร์ด</h1></div><div class="card empty-big"><h3 style="justify-content:center">ยังไม่มีสินค้า</h3>' +
        '<ol class="steps" style="text-align:left;display:inline-block"><li>ตั้งค่า GP ของแต่ละช่องทาง (Facebook, Shopee, Line) และค่าพนักงาน/แอด</li><li>เพิ่มสินค้า กรอกเอง หรือวางข้อความที่จดไว้ใน Line</li><li>กลับมาดูกำไรต่อชิ้นของทุกสินค้าที่หน้านี้</li></ol>' +
        '<p></p><a class="btn" href="#set">ตั้งค่า</a> <a class="btn-primary" href="#add" style="text-decoration:none;display:inline-flex">เพิ่มสินค้าแรก</a></div>';
    }
    var all = [];
    d.products.forEach(function (p) { d.channels.forEach(function (c) { var r = calcFor(p, c); if (r) all.push({ p: p, ch: c, r: r }); }); });
    var sum = Calc.summarize(all.map(function (x) { return x.r; }), d.settings.thinMargin);
    var list = all.filter(function (x) { return (f.ch === 'all' || x.ch.id === f.ch) && (!f.loss || x.r.profit < 0); });
    list.sort(function (a, b) { return (f.sort === 'desc' ? b.r.profit - a.r.profit : a.r.profit - b.r.profit) || a.p.name.localeCompare(b.p.name); });
    var noPrice = d.products.filter(function (p) { return !results(p).length; });
    return head + '<div class="pagehead"><h1>แดชบอร์ด</h1><div class="sp"><a class="btn btn-sm" href="#add">เพิ่มสินค้า</a></div></div>' +
      '<div class="cards">' +
      '<div class="stat"><div class="t">สินค้าทั้งหมด</div><div class="v num">' + d.products.length + '</div></div>' +
      '<div class="stat"><div class="t">กำไรเฉลี่ยต่อชิ้น</div><div class="v num ' + cls(sum.avgProfit) + '">' + money(sum.avgProfit) + '</div></div>' +
      '<div class="stat"><div class="t">% กำไรเฉลี่ย</div><div class="v num ' + cls(sum.avgMargin) + '">' + pct(sum.avgMargin) + '</div></div>' +
      '<div class="stat"><div class="t">รายการที่ขาดทุน</div><div class="v num ' + (sum.lossCount ? 'neg' : '') + '">' + sum.lossCount + ' <span class="small muted" style="font-weight:400">จาก ' + sum.count + '</span></div></div></div>' +
      '<div class="filters"><select data-fil="ch" aria-label="กรองช่องทาง"><option value="all">ทุกช่องทาง</option>' +
      d.channels.map(function (c) { return '<option value="' + esc(c.id) + '"' + (f.ch === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>' +
      '<select data-fil="sort" aria-label="เรียงลำดับ"><option value="desc"' + (f.sort === 'desc' ? ' selected' : '') + '>กำไรมาก ไป น้อย</option><option value="asc"' + (f.sort === 'asc' ? ' selected' : '') + '>กำไรน้อย ไป มาก</option></select>' +
      '<label class="ck"><input type="checkbox" data-fil="loss"' + (f.loss ? ' checked' : '') + '> เฉพาะที่ขาดทุน</label></div>' +
      '<table class="tbl"><thead><tr><th>สินค้า</th><th>ช่องทาง</th><th class="r hm">ราคาขายจริง</th><th class="r hm">ต้นทุนรวม</th><th class="r">กำไร/ชิ้น</th><th class="r">% กำไร</th><th>สถานะ</th></tr></thead><tbody>' +
      (list.length ? list.map(function (x) {
        return '<tr data-go="#p/' + esc(x.p.id) + '/' + esc(x.ch.id) + '"><td><a class="plink" href="#p/' + esc(x.p.id) + '/' + esc(x.ch.id) + '">' + esc(x.p.name) + '</a></td><td>' + esc(x.ch.name) + '</td>' +
          '<td class="r num hm">' + money(x.r.price) + (x.r.list ? '<div class="small muted">ตั้ง ' + money(x.r.list) + ' (' + disc(x.r) + ')</div>' : '') + '</td><td class="r num hm">' + money(x.r.costs) + '</td>' +
          '<td class="r num ' + cls(x.r.profit) + '"><b>' + money(x.r.profit) + '</b></td><td class="r num ' + cls(x.r.margin) + '">' + pct(x.r.margin) + '</td><td>' + zone(x.r) + '</td></tr>';
      }).join('') : '<tr><td colspan="7" class="empty">ไม่มีรายการตามตัวกรอง</td></tr>') + '</tbody></table>' +
      '<p class="small muted" style="margin-top:10px">ต้นทุนรวม = ต้นทุนสินค้า + ขนส่ง + กล่อง + พนักงาน + แอด + อื่น ๆ (ยังไม่รวม GP และ VAT) · กดแถวเพื่อดูรายละเอียด · "กำไรบาง" = % กำไรต่ำกว่า ' + d.settings.thinMargin + '% (ปรับได้ในตั้งค่า)</p>' +
      (noPrice.length ? '<div class="hint warn" style="margin-top:12px">สินค้าที่ยังไม่มีราคาขายช่องทางไหนเลย (ไม่แสดงในตาราง): ' + noPrice.map(function (p) { return '<a href="#edit/' + esc(p.id) + '">' + esc(p.name) + '</a>'; }).join(', ') + '</div>' : '');
  }

  /* ---------- รายละเอียดสินค้า ---------- */
  function viewDetail() {
    var r0 = route(), p = product(r0.id);
    if (!p) return '<div class="pagehead"><h1>ไม่พบสินค้านี้</h1></div><div class="card"><p class="muted">สินค้านี้อาจถูกลบไปแล้ว</p><p style="margin-top:10px"><a class="btn" href="#dash">กลับแดชบอร์ด</a></p></div>';
    var rs = results(p);
    var cur = rs.find(function (x) { return x.ch.id === r0.ch; }) || rs[0];
    var eff = function (k, v) { return p[k] !== undefined ? money(v) : money(v) + ' <span class="small muted" style="font-weight:400">ค่ากลาง</span>'; };
    var head = '<a class="back" href="#dash">' + ICON.back + ' กลับแดชบอร์ด</a>' +
      '<div class="pagehead"><h1>' + esc(p.name) + '</h1><div class="sp"><a class="btn btn-sm" href="#edit/' + esc(p.id) + '">แก้ไข</a><button class="btn btn-sm btn-danger" data-act="delprod">ลบ</button></div></div>' +
      (p.note ? '<p class="muted" style="margin:-6px 0 12px;font-size:13.5px">' + esc(p.note) + '</p>' : '');
    if (!cur) return head + gpWarn() + '<div class="card"><p class="muted">สินค้านี้ยังไม่มีราคาขายช่องทางไหนเลย</p><p style="margin-top:10px"><a class="btn-primary" style="text-decoration:none;display:inline-flex;width:auto" href="#edit/' + esc(p.id) + '">ใส่ราคาขาย</a></p></div>';
    var r = cur.r;
    var bk = Calc.breakdown(r).map(function (x) {
      return '<div class="bk"><span>' + esc(x.label) + '</span><div class="bar"><span style="width:' + Math.min(100, r.price ? x.amount / r.price * 100 : 0) + '%"></span></div><span class="r num">' + money(x.amount) + '</span><span class="pct r num">' + (r.price ? (x.amount / r.price * 100).toFixed(1) : '0.0') + '%</span></div>';
    }).join('') +
      '<div class="bk ' + (r.profit < 0 ? 'loss' : 'profit') + '"><b>' + (r.profit < 0 ? 'ขาดทุน' : 'กำไร') + '</b><div class="bar"><span style="width:' + Math.min(100, r.price ? Math.abs(r.profit) / r.price * 100 : 0) + '%"></span></div><b class="r num ' + cls(r.profit) + '">' + money(r.profit) + '</b><span class="pct r num">' + (r.price ? (r.profit / r.price * 100).toFixed(1) : '0.0') + '%</span></div>' +
      '<div class="bk total"><span>ราคาขายจริง</span><span></span><span class="r num">' + money(r.price) + '</span><span class="pct r num">100%</span></div>';
    return head + gpWarn() +
      '<div class="card" style="margin-bottom:16px"><h3>ข้อมูลที่กรอก</h3><div class="kv"><div>ต้นทุนสินค้า<b class="num">' + money(p.cost) + '</b></div><div>ค่าขนส่ง<b class="num">' + money(p.shipping) + '</b></div><div>ค่ากล่อง<b class="num">' + money(p.box) + '</b></div>' +
      '<div>ค่าพนักงาน<b class="num">' + eff('staff', r.staff) + '</b></div><div>ค่าแอด<b class="num">' + eff('ads', r.ads) + '</b></div><div>ค่าอื่น ๆ<b class="num">' + eff('other', r.other) + '</b></div>' +
      (p.extras || []).map(function (e) { return '<div>' + esc(e.name || 'ค่าใช้จ่ายเพิ่มเติม') + '<b class="num">' + money(e.amt) + '</b></div>'; }).join('') + '</div></div>' +
      '<div class="card" style="margin-bottom:16px"><h3>เทียบทุกช่องทาง</h3><table class="tbl"><thead><tr><th>ช่องทาง</th><th class="r hm">ราคาตั้ง</th><th class="r">ราคาขายจริง</th><th class="r">กำไร/ชิ้น</th><th class="r">% กำไร</th><th class="r hm">ราคาขั้นต่ำที่ไม่ขาดทุน</th><th>สถานะ</th></tr></thead><tbody>' +
      rs.map(function (x) {
        return '<tr><td><b>' + esc(x.ch.name) + '</b></td><td class="r num hm">' + (x.r.list ? money(x.r.list) + ' <span class="small muted">(' + disc(x.r) + ')</span>' : '-') + '</td><td class="r num">' + money(x.r.price) + '</td>' +
          '<td class="r num ' + cls(x.r.profit) + '"><b>' + money(x.r.profit) + '</b></td><td class="r num ' + cls(x.r.margin) + '">' + pct(x.r.margin) + '</td>' +
          '<td class="r num hm">' + (x.r.breakEven === null ? 'คำนวณไม่ได้ ตรวจค่า GP' : money(x.r.breakEven)) + '</td><td>' + zone(x.r) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="card"><h3>ราคาขาย 1 ชิ้นไปอยู่ที่ไหนบ้าง</h3><div class="tabs2">' +
      rs.map(function (x) { return '<a class="' + (x.ch.id === cur.ch.id ? 'on' : '') + '" href="#p/' + esc(p.id) + '/' + esc(x.ch.id) + '">' + esc(x.ch.name) + '</a>'; }).join('') + '</div>' + bk +
      (r.breakEven === null ? '<p class="small neg" style="margin-top:8px">GP + VAT รวมแล้วเกินราคาขาย คำนวณราคาขั้นต่ำไม่ได้ ตรวจค่า GP</p>' : '<p class="small muted" style="margin-top:8px">ราคาขั้นต่ำที่ไม่ขาดทุนของช่องทางนี้: <b class="num">' + money(r.breakEven) + '</b> บาท</p>') + '</div>';
  }

  /* ---------- ฟอร์มสินค้า ---------- */
  function pfld(key, id, label, val, ph) {
    return '<div><label for="' + id + '">' + label + '</label><input id="' + id + '" inputmode="decimal" autocomplete="off" data-pf="' + key + '" placeholder="' + esc(ph || '') + '" value="' + esc(val) + '" class="' + (state.miss[key] ? 'miss' : '') + '">' +
      '<div class="fe" data-perr="' + key + '"></div>' + (state.miss[key] ? '<div class="fn">' + esc(state.miss[key]) + '</div>' : '') + '</div>';
  }
  function extrasHtml() {
    return state.pForm.extras.map(function (e, i) {
      return '<div class="exrow"><input data-pf="x.' + i + '.name" placeholder="ชื่อรายการ เช่น ค่าถุงซิป" value="' + esc(e.name) + '" autocomplete="off" aria-label="ชื่อรายการค่าใช้จ่าย"><div><input inputmode="decimal" data-pf="x.' + i + '.amt" placeholder="บาทต่อชิ้น" value="' + esc(e.amt) + '" autocomplete="off" aria-label="ราคารายการค่าใช้จ่าย"><div class="fe" data-perr="x.' + i + '.amt"></div></div><button class="mini" data-act="delex:' + i + '">ลบ</button></div>';
    }).join('');
  }
  function viewForm() {
    var d = state.data, f = state.pForm, S = d.settings;
    if (!f || (route().name === 'edit' && !product(route().id))) return '<div class="pagehead"><h1>ไม่พบสินค้านี้</h1></div><div class="card"><p class="muted">สินค้านี้อาจถูกลบไปแล้ว</p><p style="margin-top:10px"><a class="btn" href="#dash">กลับแดชบอร์ด</a></p></div>';
    var editing = !!f.id;
    var def = function (k) { return money(Calc.overheadPerUnit(S[k], S.monthlyUnits)); };
    return statusNote() + gpWarn() + (editing ? '<a class="back" href="#p/' + esc(f.id) + '">' + ICON.back + ' กลับหน้าสินค้า</a>' : '') +
      '<div class="pagehead"><h1>' + (editing ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า') + '</h1></div><div class="grid2"><div>' +
      '<div class="card" style="margin-bottom:16px"><h3>วางข้อความที่จดไว้ใน Line</h3>' +
      '<textarea id="paste" rows="3" data-pt placeholder="เช่น เสื้อ A ซื้อ 120 ส่ง 35 กล่อง 8 ขาย 299">' + esc(state.pText) + '</textarea>' +
      '<div class="btn-row" style="margin-top:10px;align-items:center"><button class="btn btn-sm" data-act="parse">แยกตัวเลข</button><span class="small muted">ราคาขายใส่ที่</span>' +
      '<select id="pasteCh" data-pch style="border:1px solid rgb(var(--line)/.16);border-radius:10px;padding:7px;font-size:13px;background:#fff">' + d.channels.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === state.pCh ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="pastemsg" id="pmsg">' + state.pMsg + '</div><div class="small muted" style="margin-top:6px">คำที่เข้าใจ: ซื้อ/ทุน, ส่ง/ขนส่ง, กล่อง/พัสดุ, ขาย/ราคา, ขายจริง, แอด, พนักงาน แยกแล้วเติมลงฟอร์มด้านล่าง ตรวจและแก้ก่อนบันทึกเสมอ</div></div>' +
      '<div class="card"><h3>ข้อมูลสินค้า</h3><label for="f-name">ชื่อสินค้า</label><input id="f-name" data-pf="name" autocomplete="off" value="' + esc(f.name) + '" class="' + (state.miss.name ? 'miss' : '') + '"><div class="fe" data-perr="name"></div>' + (state.miss.name ? '<div class="fn">' + esc(state.miss.name) + '</div>' : '') +
      '<div class="field-row three">' + pfld('cost', 'f-cost', 'ต้นทุนสินค้า (บาท)', f.cost) + pfld('shipping', 'f-ship', 'ค่าขนส่ง (บาท)', f.shipping, '0') + pfld('box', 'f-box', 'ค่ากล่อง (บาท)', f.box, '0') + '</div>' +
      '<label style="margin-top:14px;color:rgb(var(--ink));font-weight:600">ค่าใช้จ่ายอื่นต่อชิ้น <span class="muted" style="font-weight:400">(เว้นว่าง = ใช้ค่ากลางจากตั้งค่า ตัวเลขจางคือค่ากลาง)</span></label>' +
      '<div class="field-row three" style="margin-top:0">' + pfld('staff', 'f-staff', 'ค่าพนักงาน (บาท)', f.staff, def('staff')) + pfld('ads', 'f-ads', 'ค่าแอด (บาท)', f.ads, def('ads')) + pfld('other', 'f-other', 'ค่าอื่น ๆ (บาท)', f.other, def('other')) + '</div>' +
      '<div id="extras">' + extrasHtml() + '</div><button class="btn btn-sm" data-act="addex" style="margin-top:10px">+ เพิ่มรายการค่าใช้จ่ายเอง</button>' +
      '<label style="margin-top:14px;color:rgb(var(--ink));font-weight:600">ราคาตั้งรวม VAT แต่ละช่องทาง <span class="muted" style="font-weight:400">(เว้นว่าง = ไม่ขายช่องนี้)</span></label>' +
      '<div class="field-row three" style="margin-top:0">' + d.channels.map(function (c) { return pfld('p.' + c.id, 'f-p-' + c.id, esc(c.name), f.prices[c.id]); }).join('') + '</div>' +
      '<label style="margin-top:14px;color:rgb(var(--ink));font-weight:600">ราคาขายจริงแต่ละช่องทาง <span class="muted" style="font-weight:400">(หลังส่วนลด/โปรโมชัน เว้นว่าง = ใช้ราคาตั้ง)</span></label>' +
      '<div class="field-row three" style="margin-top:0">' + d.channels.map(function (c) { return pfld('a.' + c.id, 'f-a-' + c.id, esc(c.name), f.actual[c.id], 'เท่าราคาตั้ง'); }).join('') + '</div><div class="fe" data-perr="prices"></div>' +
      '<label for="f-note" style="margin-top:14px">โน้ต (ไม่บังคับ)</label><input id="f-note" data-pf="note" autocomplete="off" value="' + esc(f.note) + '" placeholder="เช่น ซัพพลายเออร์ สีที่ขาย">' +
      '<label style="margin-top:14px">รูปกระดาษที่จดไว้ (ไว้ดูประกอบตอนกรอก ไม่ถูกบันทึก)</label><div class="imgbox"><input type="file" id="img" accept="image/*"><div id="imgprev">' + (state.img ? '<img src="' + state.img + '" alt="รูปกระดาษที่แนบ">' : '<div style="margin-top:6px">ยังไม่ได้แนบรูป</div>') + '</div><div class="small" style="margin-top:8px">ยังไม่อ่านรูปให้อัตโนมัติ ดูรูปแล้วกรอกเองหรือพิมพ์ข้อความด้านบน</div></div>' +
      '<div class="btn-row"><button class="btn-primary" data-act="saveprod">บันทึกสินค้า</button><a class="btn" href="' + (editing ? '#p/' + esc(f.id) : '#dash') + '">ยกเลิก</a><span id="pflag" style="align-self:center"></span></div></div></div>' +
      '<div class="card sticky"><h3>ผลลัพธ์สด</h3><div id="live"></div></div></div>';
  }
  function fieldFilled(key) {
    var f = state.pForm, p = key.split('.');
    var v = p[0] === 'x' ? f.extras[+p[1]] && f.extras[+p[1]][p[2]] : p[0] === 'p' ? f.prices[p[1]] : p[0] === 'a' ? f.actual[p[1]] : f[key];
    return String(v === undefined ? '' : v).trim() !== '';
  }
  function paintForm() {
    if (!state.pForm || ['add', 'edit'].indexOf(route().name) < 0 || !$('live')) return;
    var f = state.pForm, v = Store.validateProductForm(f, state.data.channels);
    document.querySelectorAll('[data-perr]').forEach(function (e) {
      var key = e.dataset.perr, msg = v.errors[key] || '', show = msg && (state.pShowErr || (key !== 'prices' && fieldFilled(key)));
      e.textContent = show ? msg : '';
      var inp = e.previousElementSibling && e.previousElementSibling.tagName === 'INPUT' ? e.previousElementSibling : null;
      if (inp) inp.classList.toggle('bad', !!show);
    });
    var flag = $('pflag'); if (flag) flag.innerHTML = state.pDirty ? '<span class="dirty">มีการแก้ไขที่ยังไม่ได้บันทึก</span>' : '';
    var live = $('live');
    var hard = Object.keys(v.errors).filter(function (k) { return k !== 'name' && k !== 'prices'; });
    if (v.errors.cost && !fieldFilled('cost') && hard.length === 1) { live.innerHTML = '<div class="empty">กรอกต้นทุนสินค้าเพื่อดูผลลัพธ์</div>'; return; }
    if (hard.length) { live.innerHTML = '<div class="empty">แก้ช่องที่ผิดก่อน จึงจะคำนวณได้</div>'; return; }
    if (v.errors.prices) { live.innerHTML = '<div class="empty">ใส่ราคาขายอย่างน้อย 1 ช่องทางเพื่อดูผลลัพธ์</div>'; return; }
    var v2 = Store.validateProductForm(Object.assign({}, f, { name: f.name.trim() ? f.name : '-' }), state.data.channels);
    live.innerHTML = state.data.channels.map(function (c) {
      var r = calcFor(v2.clean, c);
      if (!r) return '<div class="res"><div class="h"><span>' + esc(c.name) + '</span><span class="zone gray">ไม่ได้ขาย</span></div></div>';
      return '<div class="res"><div class="h"><span>' + esc(c.name) + ' · GP ' + c.gp + '%</span>' + zone(r) + '</div>' +
        '<div class="big num ' + cls(r.profit) + '">' + money(r.profit) + ' <span class="small muted" style="font-weight:400;font-family:Anuphan">บาท/ชิ้น</span></div>' +
        (r.list ? '<div class="sub num">ราคาตั้ง ' + money(r.list) + ' · ขายจริง ' + money(r.price) + ' (' + disc(r) + ')</div>' : '') +
        '<div class="sub num">กำไร ' + pct(r.margin) + ' · ต้นทุนรวม ' + money(r.costs) + ' · VAT ' + money(r.vat) + ' · GP ' + money(r.gpFee) + '</div>' +
        '<div class="sub num">ราคาขั้นต่ำที่ไม่ขาดทุน ' + (r.breakEven === null ? 'คำนวณไม่ได้ ตรวจค่า GP' : money(r.breakEven)) + '</div></div>';
    }).join('');
  }

  function setPField(key, val) {
    var f = state.pForm, p = key.split('.');
    if (p[0] === 'x') f.extras[+p[1]][p[2]] = val;
    else if (p[0] === 'p') f.prices[p[1]] = val;
    else if (p[0] === 'a') f.actual[p[1]] = val;
    else f[key] = val;
    if (state.miss[key]) delete state.miss[key];
    state.pDirty = true;
  }

  function doParse() {
    var f = state.pForm, r = ParseLine.parseLine(state.pText), c = state.pCh, v = r.values;
    var read = [];
    if (r.name) { f.name = r.name; read.push(FIELD_LABEL.name + ' ' + r.name); }
    ['cost', 'shipping', 'box', 'staff', 'ads'].forEach(function (k) { if (v[k] !== undefined) { f[k] = String(v[k]); read.push(FIELD_LABEL[k] + ' ' + v[k]); } });
    if (v.sale !== undefined) { f.prices[c] = String(v.sale); read.push(FIELD_LABEL.sale + ' ' + v.sale); }
    if (v.actual !== undefined) { f.actual[c] = String(v.actual); read.push(FIELD_LABEL.actual + ' ' + v.actual); }
    var keyOf = { name: 'name', cost: 'cost', shipping: 'shipping', box: 'box', staff: 'staff', ads: 'ads', sale: 'p.' + c, actual: 'a.' + c };
    state.miss = {};
    var need = [], clash = [];
    r.missing.forEach(function (m) {
      var empty = m === 'sale' ? !String(f.prices[c]).trim() && !String(f.actual[c]).trim() : !fieldFilled(keyOf[m]);
      if (empty) { state.miss[keyOf[m]] = 'ไม่พบในข้อความ กรอกเอง'; need.push(FIELD_LABEL[m]); }
    });
    r.conflicts.forEach(function (k) {
      // ข้อความให้ค่าไม่ตรงกัน: ไม่เดา เคลียร์ช่องนั้นทิ้ง ไม่ปล่อยค่าเก่าค้างให้เข้าใจผิดว่าอ่านมาจากข้อความ
      if (k === 'sale') f.prices[c] = ''; else if (k === 'actual') f.actual[c] = ''; else f[k] = '';
      state.miss[keyOf[k]] = 'ข้อความให้ค่าไม่ตรงกัน ตรวจและกรอกเอง'; clash.push(FIELD_LABEL[k]);
    });
    state.pDirty = true;
    state.pMsg = (read.length ? '<span class="pos">อ่านได้:</span> ' + esc(read.join(', ')) : '<span class="neg">ไม่พบคำสำคัญที่มีตัวเลขตามหลัง</span>') +
      (need.length ? '<br><span style="color:#92660b">ต้องกรอกเอง:</span> ' + esc(need.join(', ')) : '') + (clash.length ? '<br><span class="neg">ข้อความขัดกัน (ไม่เดา):</span> ' + esc(clash.join(', ')) : '');
    var keep = state.pText;
    $('main').innerHTML = viewForm(); $('paste').value = keep; paintForm();
  }

  function saveProduct() {
    var v = Store.validateProductForm(state.pForm, state.data.channels);
    if (!v.ok) {
      state.pShowErr = true; paintForm(); toast('แก้ช่องสีแดงก่อนบันทึก');
      var first = document.querySelector('input.bad'); if (first) { first.scrollIntoView({ block: 'center' }); first.focus(); }
      return;
    }
    var isNew = !v.clean.id, data2 = Store.upsertProduct(state.data, v.clean);
    var id = isNew ? data2.products[data2.products.length - 1].id : v.clean.id;
    var res = store.save(data2);
    if (!res.ok && res.error !== 'unavailable') { toast('บันทึกไม่สำเร็จ (พื้นที่เก็บข้อมูลเต็มหรือถูกบล็อก) ข้อมูลที่กรอกยังอยู่ในหน้านี้'); return; }
    state.data = data2; state.pDirty = false;
    if (res.error === 'unavailable') toast('เก็บถาวรไม่ได้ในเบราว์เซอร์นี้ ใช้ได้เฉพาะตอนเปิดหน้านี้'); else toast('บันทึกสินค้าแล้ว');
    var first = results(v.clean)[0];
    location.hash = '#p/' + id + (first ? '/' + first.ch.id : '');
  }
  function deleteProd() {
    var p = product(route().id); if (!p) return;
    if (!confirm('ลบสินค้า "' + p.name + '" ใช่ไหม? ลบแล้วกู้คืนไม่ได้ (ถ้าไม่แน่ใจ ดาวน์โหลดไฟล์สำรองก่อนในหน้าตั้งค่า)')) return;
    var data2 = Store.deleteProduct(state.data, p.id), res = store.save(data2);
    if (!res.ok && res.error !== 'unavailable') { toast('ลบไม่สำเร็จ ข้อมูลไม่ถูกเปลี่ยน'); return; }
    state.data = data2; toast('ลบสินค้าแล้ว'); location.hash = '#dash';
  }

  /* ---------- ตั้งค่า ---------- */
  function errCell(key) { return '<div class="fe" data-err="' + key + '"></div>'; }
  function viewSet() {
    var f = state.sForm;
    function row(k, label) {
      return '<div class="setrow"><span class="lab">' + label + '</span><div><input inputmode="decimal" autocomplete="off" data-f="' + k + '.amount" value="' + esc(f[k].amount) + '" aria-label="' + label + '">' + errCell(k + '.amount') + '</div>' +
        '<select data-f="' + k + '.mode" aria-label="วิธีคิด' + label + '"><option value="perUnit"' + (f[k].mode === 'perUnit' ? ' selected' : '') + '>บาทต่อชิ้น</option><option value="perMonth"' + (f[k].mode === 'perMonth' ? ' selected' : '') + '>ยอดต่อเดือน</option></select></div>';
    }
    return statusNote() + gpWarn() + '<div class="pagehead"><h1>ตั้งค่า</h1></div>' +
      '<div class="card" style="margin-bottom:16px"><h3>ช่องทางขายและค่า GP</h3><p class="small muted" style="margin-bottom:6px">GP คิดเป็น % ของราคาขาย (ไม่มีค่าธรรมเนียมให้ใส่ 0)</p>' +
      f.channels.map(function (c, i) {
        return '<div class="chrow"><div><input data-f="ch.' + i + '.name" autocomplete="off" value="' + esc(c.name) + '" aria-label="ชื่อช่องทาง">' + errCell('ch.' + i + '.name') + '</div>' +
          '<div><div class="unit"><input inputmode="decimal" autocomplete="off" data-f="ch.' + i + '.gp" value="' + esc(c.gp) + '" aria-label="GP ของ ' + esc(c.name) + '"><span>%</span></div>' + errCell('ch.' + i + '.gp') + '</div>' +
          '<button class="mini" data-act="delch:' + i + '"' + (f.channels.length === 1 ? ' disabled title="ต้องมีอย่างน้อย 1 ช่องทาง"' : '') + '>ลบ</button></div>';
      }).join('') + errCell('channels') + '<button class="btn btn-sm" data-act="addch" style="margin-top:10px">+ เพิ่มช่องทาง</button></div>' +
      '<div class="card" style="margin-bottom:16px"><h3>VAT</h3><label class="ck" style="font-size:14px"><input type="checkbox" data-f="vatOn"' + (f.vatOn ? ' checked' : '') + '> ร้านจดทะเบียน VAT (ราคาขายที่กรอกรวม VAT 7% แล้ว)</label></div>' +
      '<div class="card" style="margin-bottom:16px"><h3>ค่าดำเนินการต่อชิ้น (ค่ากลาง ใช้กับทุกสินค้า)</h3>' + row('staff', 'ค่าพนักงาน') + row('ads', 'ค่าแอด') + row('other', 'ค่าดำเนินการอื่น ๆ') +
      '<div class="setrow"><span class="lab">ชิ้นที่คาดว่าจะขายต่อเดือน<div class="small muted">ใช้หารเมื่อเลือก "ยอดต่อเดือน"</div></span><div><input inputmode="numeric" autocomplete="off" data-f="monthlyUnits" value="' + esc(f.monthlyUnits) + '" aria-label="ชิ้นที่คาดว่าจะขายต่อเดือน">' + errCell('monthlyUnits') + '</div><span></span></div>' +
      '<div class="hint" style="margin:12px 0 0" id="preview"></div></div>' +
      '<div class="card" style="margin-bottom:16px"><h3>สถานะกำไร</h3><div class="setrow"><span class="lab">ถือว่า "กำไรบาง" เมื่อ % กำไรต่ำกว่า<div class="small muted">ใส่ 0 = ไม่เตือนกำไรบาง (ขาดทุนยังเตือนเสมอ)</div></span><div><div class="unit"><input inputmode="decimal" autocomplete="off" data-f="thinMargin" value="' + esc(f.thinMargin) + '" aria-label="เกณฑ์กำไรบาง"><span>%</span></div>' + errCell('thinMargin') + '</div><span></span></div></div>' +
      '<div class="savebar"><button class="btn-primary" data-act="saveset">บันทึกตั้งค่า</button><span id="dirtyflag"></span></div>' +
      '<div class="card" style="margin-top:8px"><h3>สำรองข้อมูล</h3><p class="small muted" style="margin-bottom:10px">ข้อมูลทั้งหมด (ตั้งค่าและสินค้า ' + state.data.products.length + ' รายการ) เก็บอยู่ในเบราว์เซอร์เครื่องนี้เท่านั้น ถ้าล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเครื่องจะหาย แนะนำดาวน์โหลดไฟล์สำรองเป็นระยะ</p>' +
      '<div class="btn-row" style="margin-top:0;align-items:center"><button class="btn btn-sm" data-act="export">ดาวน์โหลดไฟล์สำรอง</button><label class="btn btn-sm" style="margin:0;cursor:pointer">นำเข้าจากไฟล์สำรอง<input type="file" id="imp" accept="application/json,.json" style="display:none"></label></div>' +
      '<p class="small muted" style="margin-top:10px">นำเข้าจะแทนที่ข้อมูลปัจจุบันทั้งหมด (จะถามยืนยันก่อน)</p></div>';
  }
  function paintSet() {
    if (route().name !== 'set' || !state.sForm) return;
    var r = Store.validateForm(state.sForm);
    document.querySelectorAll('[data-err]').forEach(function (e) {
      var msg = state.sShowErr ? (r.errors[e.dataset.err] || '') : '';
      e.textContent = msg;
      if (e.dataset.err === 'channels') return;
      var prev = e.previousElementSibling, inp = prev && prev.tagName === 'DIV' ? prev.querySelector('input') : prev;
      if (inp && inp.tagName === 'INPUT') inp.classList.toggle('bad', !!msg);
    });
    var flag = $('dirtyflag'); if (flag) flag.innerHTML = state.sDirty ? '<span class="dirty">มีการแก้ไขที่ยังไม่ได้บันทึก</span>' : (state.sSaved ? '<span class="saved">บันทึกแล้ว</span>' : '');
    var pv = $('preview');
    if (pv) {
      if (r.ok) { var s = r.clean.settings, u = function (k) { return money(Calc.overheadPerUnit(s[k], s.monthlyUnits)); }; pv.innerHTML = 'ต่อชิ้นตอนนี้: พนักงาน <b class="num">' + u('staff') + '</b> · แอด <b class="num">' + u('ads') + '</b> · อื่น ๆ <b class="num">' + u('other') + '</b> บาท'; }
      else pv.textContent = 'ตัวอย่างต่อชิ้นจะแสดงเมื่อกรอกค่าถูกต้องครบ';
    }
  }
  function setSField(path, value) {
    var f = state.sForm, p = path.split('.');
    if (p[0] === 'ch') f.channels[+p[1]][p[2]] = value; else if (p.length === 2) f[p[0]][p[1]] = value; else f[p[0]] = value;
    state.sDirty = true; state.sSaved = false;
  }
  function saveSet() {
    var r = Store.validateForm(state.sForm);
    if (!r.ok) { state.sShowErr = true; paintSet(); toast('แก้ช่องสีแดงก่อนบันทึก'); var first = document.querySelector('input.bad'); if (first) first.focus(); return; }
    var data = Store.pruneChannels({ version: 1, settings: r.clean.settings, channels: r.clean.channels, products: state.data.products });
    var res = store.save(data);
    if (!res.ok && res.error !== 'unavailable') { toast('บันทึกไม่สำเร็จ (พื้นที่เก็บข้อมูลเต็มหรือถูกบล็อก) ค่าที่แก้ยังอยู่ในหน้านี้'); return; }
    state.data = data; state.sForm = Store.toForm(data); state.sDirty = false; state.sShowErr = false; state.sSaved = res.ok;
    if (res.ok) state.status = 'ok';
    render(); toast(res.ok ? 'บันทึกตั้งค่าแล้ว' : 'เก็บถาวรไม่ได้ในเบราว์เซอร์นี้ ใช้ได้เฉพาะตอนเปิดหน้านี้');
  }
  function doExport() {
    var text = Store.exportJSON(state.data), d = new Date();
    var name = 'costcalc-backup-' + d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + '.json';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('ดาวน์โหลดไฟล์สำรองแล้ว (' + name + ')');
  }
  function applyImport(text) {
    var r = Store.parseImport(text);
    if (!r.ok) { toast(r.error === 'json' ? 'ไฟล์นี้ไม่ใช่ไฟล์สำรองของเครื่องมือนี้ ไม่ได้นำเข้า' : 'ไฟล์สำรองมีข้อมูลผิดรูปแบบ ไม่ได้นำเข้า ข้อมูลเดิมไม่ถูกแตะ'); return false; }
    if (!confirm('นำเข้าจะแทนที่ข้อมูลปัจจุบันทั้งหมดด้วยข้อมูลในไฟล์ (สินค้า ' + r.data.products.length + ' รายการ, ช่องทาง ' + r.data.channels.length + ' ช่อง) ทำต่อไหม?')) return false;
    var res = store.save(r.data);
    if (!res.ok && res.error !== 'unavailable') { toast('นำเข้าไม่สำเร็จ (พื้นที่เก็บข้อมูลเต็มหรือถูกบล็อก) ข้อมูลเดิมไม่ถูกแตะ'); return false; }
    state.data = r.data; state.status = res.ok ? 'ok' : state.status; state.sDirty = false; enter(); render();
    toast('นำเข้าแล้ว สินค้า ' + r.data.products.length + ' รายการ');
    return true;
  }

  /* ---------- วาดหน้า ---------- */
  function render() {
    renderNav();
    var n = route().name;
    var demoBar = demo ? '<div class="hint warn"><b>แบบทดลอง</b> ข้อมูลทั้งหมดเป็นข้อมูลสมมติ (รวมถึงค่า GP 10% ของ Shopee) กรอก/แก้/ลบได้เต็มที่ แต่ไม่ถูกเก็บถาวร รีเฟรชแล้วกลับเป็นเดิม ตัวจริงคือ index.html</div>' : '';
    $('main').innerHTML = demoBar + (n === 'dash' ? viewDash() : n === 'p' ? viewDetail() : n === 'set' ? viewSet() : viewForm());
    paintSet(); paintForm();
    window.scrollTo(0, 0);
  }

  /* ---------- เหตุการณ์ ---------- */
  document.addEventListener('click', function (e) {
    var go = e.target.closest('tr[data-go]');
    if (go && !e.target.closest('a')) { location.hash = go.dataset.go; return; }
    var t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
    var a = t.dataset.act.split(':'), act = a[0];
    if (act === 'saveset') saveSet();
    else if (act === 'saveprod') saveProduct();
    else if (act === 'delprod') deleteProd();
    else if (act === 'export') doExport();
    else if (act === 'parse') doParse();
    else if (act === 'addex') { state.pForm.extras.push({ name: '', amt: '' }); state.pDirty = true; $('extras').innerHTML = extrasHtml(); paintForm(); var xs = document.querySelectorAll('[data-pf$=".name"]'); if (xs.length) xs[xs.length - 1].focus(); }
    else if (act === 'delex') { state.pForm.extras.splice(+a[1], 1); state.pDirty = true; $('extras').innerHTML = extrasHtml(); paintForm(); }
    else if (act === 'addch') {
      state.sForm.channels.push({ id: Store.newChannelId(state.sForm.channels), name: '', gp: '0' }); state.sDirty = true; state.sSaved = false; render();
      var ins = document.querySelectorAll('[data-f$=".name"]'); if (ins.length) ins[ins.length - 1].focus();
    } else if (act === 'delch') {
      var i = +a[1], c = state.sForm.channels[i];
      if (state.sForm.channels.length === 1) return;
      if (Store.channelInUse(state.data, c.id) && !confirm('มีสินค้าที่ใช้ราคาของช่องทาง "' + c.name + '" อยู่ ลบแล้วราคาของช่องทางนี้จะหายไปจากสินค้าเหล่านั้นหลังบันทึก ลบเลยไหม?')) return;
      state.sForm.channels.splice(i, 1); state.sDirty = true; state.sSaved = false; render();
    }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.f !== undefined && t.type !== 'checkbox' && t.tagName !== 'SELECT') { setSField(t.dataset.f, t.value); paintSet(); }
    else if (t.dataset.pf !== undefined) { setPField(t.dataset.pf, t.value); t.classList.remove('miss'); if (t.nextElementSibling && t.nextElementSibling.nextElementSibling && t.nextElementSibling.nextElementSibling.className === 'fn') t.nextElementSibling.nextElementSibling.remove(); paintForm(); }
    else if (t.dataset.pt !== undefined) { state.pText = t.value; }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.f !== undefined) { if (t.type === 'checkbox') setSField(t.dataset.f, t.checked); else if (t.tagName === 'SELECT') setSField(t.dataset.f, t.value); else return; paintSet(); }
    else if (t.dataset.fil) { state.fil[t.dataset.fil] = t.type === 'checkbox' ? t.checked : t.value; render(); }
    else if (t.dataset.pch !== undefined) { state.pCh = t.value; }
    else if (t.id === 'img' && t.files[0]) {
      if (state.img) URL.revokeObjectURL(state.img);
      state.img = URL.createObjectURL(t.files[0]); $('imgprev').innerHTML = '<img src="' + state.img + '" alt="รูปกระดาษที่แนบ">';
    } else if (t.id === 'imp' && t.files[0]) {
      var file = t.files[0];
      if (file.size > 5 * 1024 * 1024) { toast('ไฟล์ใหญ่เกิน 5 MB ไม่ใช่ไฟล์สำรองของเครื่องมือนี้'); t.value = ''; return; }
      var rd = new FileReader(); rd.onload = function () { applyImport(String(rd.result)); }; rd.onerror = function () { toast('อ่านไฟล์ไม่ได้'); }; rd.readAsText(file); t.value = '';
    }
  });
  window.addEventListener('hashchange', function () {
    if (state.ignoreHash) { state.ignoreHash = false; return; }
    if (isDirtyAt(state.cur) && !confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ทิ้งการแก้ไขและออกจากหน้านี้ไหม?')) { state.ignoreHash = true; location.hash = state.cur; return; }
    state.cur = location.hash; enter(); render();
  });
  function isDirtyAt(hash) {
    var n = (hash || '').replace(/^#\/?/, '').split('/')[0];
    return ((n === 'add' || n === 'edit') && state.pDirty) || (n === 'set' && state.sDirty);
  }
  window.addEventListener('beforeunload', function (e) { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  state.cur = location.hash;
  enter(); render();
  window.__app = { state: state, render: render, applyImport: applyImport, doExport: doExport }; // ไว้ให้เทสในเบราว์เซอร์ตรวจ
})();
