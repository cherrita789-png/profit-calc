/* calc.js - ตรรกะคำนวณต้นทุนและกำไรต่อชิ้น ตามสูตรใน SPEC.md
 * ใช้ได้ทั้งในเบราว์เซอร์ (<script src="calc.js">  -> window.Calc) และ node (require)
 * ไม่มีผลข้างเคียง ไม่แตะ DOM ไม่อ่าน/เขียนข้อมูลเอง */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VAT_RATE = 7 / 107; // ราคาขายรวม VAT 7% แล้ว: VAT = ราคา x 7/107

  /* ปัดเศษ 2 ตำแหน่ง (ครึ่งปัดออกจากศูนย์) ใช้ตอนแสดงผลเท่านั้น ห้ามใช้ระหว่างคำนวณ */
  function round2(n) {
    var sign = n < 0 ? -1 : 1;
    return sign * Math.round((Math.abs(n) + 1e-9) * 100) / 100;
  }

  /* อ่านตัวเลขเงินจากช่องกรอก: '' -> null (ว่าง) | '1,200.50' -> 1200.5 | ติดลบ/ตัวอักษร -> NaN (ผิด) */
  function parseMoney(s) {
    s = String(s === undefined || s === null ? '' : s).trim().replace(/,/g, '');
    if (s === '') return null;
    return /^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
  }

  /* ค่าดำเนินการต่อชิ้นจากตั้งค่ากลาง x = { amount, mode: 'perUnit' | 'perMonth' } */
  function overheadPerUnit(x, monthlyUnits) {
    if (!x || !x.amount) return 0;
    if (x.mode === 'perMonth') {
      if (!(monthlyUnits > 0)) throw new RangeError('monthlyUnits ต้องมากกว่า 0 เมื่อใช้ยอดต่อเดือน');
      return x.amount / monthlyUnits;
    }
    return x.amount;
  }

  /* จำนวนที่ขายได้ของช่องทางหนึ่งในเดือนที่เลือก ('YYYY-MM') หรือรวมทุกเดือน ('all'/ไม่ใส่)
   * คืน null ถ้าไม่ได้ใส่จำนวนเลย (ไม่เดาเป็น 0) */
  function soldQty(product, chId, period) {
    var sold = product.sold;
    if (!sold) return null;
    if (period && period !== 'all') {
      var m = sold[period];
      return m && m[chId] !== undefined && m[chId] !== null ? m[chId] : null;
    }
    var total = null;
    Object.keys(sold).forEach(function (k) {
      var v = sold[k] && sold[k][chId];
      if (v !== undefined && v !== null) total = (total || 0) + v;
    });
    return total;
  }

  /* คำนวณ 1 สินค้า x 1 ช่องทาง (ต่อชิ้น)
   * product  = { cost, shipping, box, staff?, ads?, other?, extras?: [{name, amt}], prices: {ch: n}, actual?: {ch: n}, sold?: {'YYYY-MM': {ch: จำนวนชิ้น}} }
   * channel  = { id, gp }   (gp เป็น % ของราคาขาย)
   * settings = { vatOn, monthlyUnits, monthlyAsLump?, staff, ads, other }
   * period   = 'YYYY-MM' (เดือนที่ดูยอดขาย) หรือ 'all'/ไม่ใส่ = รวมทุกเดือน (ใช้เลือกจำนวนที่ขายได้ qty)
   * monthlyAsLump = true: ค่าพนักงาน/แอด/อื่น ๆ ที่ตั้งเป็น perMonth คือ "ก้อนรายเดือน" ไม่ถูกเฉลี่ยลงต่อชิ้น (หักทีเดียวต่อเดือนใน monthlyPL)
   *                 ส่วนค่าที่กรอกเองรายสินค้ากับค่าแบบ perUnit ยังรวมในต้นทุนต่อชิ้นตามเดิม lumpExcluded บอกว่าค่าไหนยังไม่ถูกหัก
   * monthlyAsLump ไม่เปิด (undefined/false) = เฉลี่ยค่า perMonth ลงต่อชิ้นด้วย monthlyUnits (จำนวนที่คาดไว้) แบบเดิม
   * คืน null ถ้าสินค้านี้ไม่ได้ขายช่องทางนั้น (ไม่มีทั้งราคาตั้งและราคาขายจริง) */
  function calcProduct(product, channel, settings, period) {
    var listP = product.prices ? product.prices[channel.id] : undefined;
    var act = product.actual ? product.actual[channel.id] : undefined;
    var price = act !== undefined && act !== null ? act : listP;
    if (price === undefined || price === null) return null;

    var vatRate = settings.vatOn ? VAT_RATE : 0;
    var gpRate = channel.gp / 100;
    var lump = settings.monthlyAsLump === true, excluded = [];

    function over(k) {
      if (product[k] !== undefined && product[k] !== null) return product[k];
      var x = settings[k];
      if (lump && x && x.mode === 'perMonth') { if (x.amount) excluded.push(k); return 0; }
      return overheadPerUnit(x, settings.monthlyUnits);
    }
    var staff = over('staff'), ads = over('ads'), other = over('other');
    var shipping = product.shipping || 0, box = product.box || 0;
    var extras = product.extras || [];
    var extraSum = extras.reduce(function (t, e) { return t + e.amt; }, 0);

    var costs = product.cost + shipping + box + staff + ads + other + extraSum;
    var vat = price * vatRate;
    var gpFee = price * gpRate;
    var profit = price - vat - gpFee - costs;
    var denom = 1 - vatRate - gpRate;

    // ขายได้กี่ชิ้น (ไม่บังคับ): ถ้ามี คำนวณยอดขายรวมและกำไรรวม (กำไรต่อชิ้น x จำนวน) ถ้าไม่มี = null ไม่เดาจำนวน
    var qty = soldQty(product, channel.id, period);

    return {
      channelId: channel.id,
      gp: channel.gp, vatOn: !!settings.vatOn,
      price: price,
      list: listP !== undefined && listP !== null && act !== undefined && act !== null ? listP : null,
      cost: product.cost, shipping: shipping, box: box, staff: staff, ads: ads, other: other, extras: extras,
      lumpExcluded: excluded, // ค่าก้อนรายเดือนที่ยังไม่ได้หักในตัวเลขต่อชิ้นนี้ (ไปหักในงบรายเดือน)
      costs: costs, vat: vat, gpFee: gpFee, profit: profit,
      margin: price > 0 ? profit / price * 100 : 0,
      breakEven: denom > 0 ? costs / denom : null, // null = คำนวณไม่ได้ ตรวจค่า GP
      qty: qty,
      revenue: qty === null ? null : price * qty,
      totalProfit: qty === null ? null : profit * qty
    };
  }

  /* คำนวณสินค้า 1 ตัวทุกช่องทางที่ขาย คืน [{ channel, result }] */
  function calcAll(product, channels, settings) {
    var out = [];
    channels.forEach(function (ch) {
      var r = calcProduct(product, ch, settings);
      if (r) out.push({ channel: ch, result: r });
    });
    return out;
  }

  var OVERHEAD_LABELS = { staff: 'ค่าพนักงาน', ads: 'ค่าแอด', other: 'ค่าดำเนินการอื่น ๆ' };

  /* งบกำไร-ขาดทุนของเดือนเดียว: ยอดขาย - VAT - GP - ต้นทุน/ขนส่ง/กล่อง/ค่ารายชิ้น = กำไรขั้นต้น แล้วหักค่าใช้จ่ายก้อนรายเดือนทีเดียว = กำไรสุทธิ
   * นับเฉพาะสินค้า x ช่องทางที่ใส่จำนวนในเดือนนั้น (และมีราคา)
   * expenses = { 'YYYY-MM': { staff?, ads?, other?, extras?: [{name, amt}] } } ค่าใช้จ่ายจริงที่กรอกของแต่ละเดือน
   * ค่าก้อนรายเดือน (เมื่อ settings.monthlyAsLump เปิด): ค่า staff/ads/other ที่ตั้งเป็น perMonth ใช้ค่าที่กรอกของเดือนนั้น ถ้าไม่ได้กรอกใช้ค่าที่ตั้งไว้เป็นค่าเริ่มต้น
   * extras ของเดือน (ค่าเช่า ฯลฯ) หักเสมอ ไม่ว่าโหมดไหน; ค่า staff/ads/other ที่กรอกจะถูกเมินถ้าไม่ได้เปิดโหมดก้อนรายเดือน (กันหักซ้ำกับที่เฉลี่ยต่อชิ้น) */
  function monthlyPL(products, channels, settings, expenses, month) {
    var t = { month: month, rows: 0, qty: 0, revenue: 0, vat: 0, gpFee: 0, cost: 0, shipping: 0, box: 0, perUnitOther: 0,
              gross: 0, overheads: [], overheadTotal: 0, net: 0, margin: 0 };
    products.forEach(function (p) {
      channels.forEach(function (c) {
        var r = calcProduct(p, c, settings, month);
        if (!r || r.qty === null) return;
        var q = r.qty, extra = r.extras.reduce(function (a, e) { return a + e.amt; }, 0);
        t.rows++; t.qty += q; t.revenue += r.price * q; t.vat += r.vat * q; t.gpFee += r.gpFee * q;
        t.cost += r.cost * q; t.shipping += r.shipping * q; t.box += r.box * q; t.perUnitOther += (r.staff + r.ads + r.other + extra) * q;
      });
    });
    t.gross = t.revenue - t.vat - t.gpFee - t.cost - t.shipping - t.box - t.perUnitOther;
    var e = (expenses && expenses[month]) || {};
    // เดือนที่ไม่มีทั้งยอดขายและค่าใช้จ่ายที่กรอก = เดือนว่าง ไม่หักค่าเริ่มต้น (ไม่ให้เดือนที่ยังไม่มีข้อมูลดูขาดทุน)
    var active = t.rows > 0 || Object.keys(e).length > 0;
    if (active && settings.monthlyAsLump === true) {
      ['staff', 'ads', 'other'].forEach(function (k) {
        var x = settings[k];
        if (!x || x.mode !== 'perMonth') return;
        var entered = e[k] !== undefined && e[k] !== null, amount = entered ? e[k] : x.amount;
        if (amount || entered) t.overheads.push({ key: k, label: OVERHEAD_LABELS[k], amount: amount, source: entered ? 'entered' : 'default' });
      });
    }
    (e.extras || []).forEach(function (x, i) { t.overheads.push({ key: 'x' + i, label: x.name || 'ค่าใช้จ่ายอื่นของเดือน', amount: x.amt, source: 'entered' }); });
    t.overheadTotal = t.overheads.reduce(function (a, o) { return a + o.amount; }, 0);
    t.net = t.gross - t.overheadTotal;
    t.profit = t.net; // ชื่อเดิม ใช้ในตารางสรุป
    t.margin = t.revenue > 0 ? t.net / t.revenue * 100 : 0;
    return t;
  }

  /* สรุปรายเดือน: คืนงบของทุกเดือนที่มีจำนวนที่ขายได้หรือมีค่าใช้จ่ายที่กรอก เดือนล่าสุดก่อน */
  function monthlyTotals(products, channels, settings, expenses) {
    var months = {};
    products.forEach(function (p) { Object.keys(p.sold || {}).forEach(function (m) { months[m] = 1; }); });
    Object.keys(expenses || {}).forEach(function (m) { months[m] = 1; });
    return Object.keys(months).sort().reverse().map(function (m) { return monthlyPL(products, channels, settings, expenses, m); });
  }

  /* รวมงบหลายเดือนเป็นงบเดียว (สำหรับมุมมอง "ทุกเดือนรวมกัน") ค่าใช้จ่ายก้อนรวมตามชื่อรายการ */
  function sumPL(list) {
    var t = { month: 'all', rows: 0, qty: 0, revenue: 0, vat: 0, gpFee: 0, cost: 0, shipping: 0, box: 0, perUnitOther: 0, gross: 0, overheads: [], overheadTotal: 0, net: 0, margin: 0 };
    var byKey = {}, order = [];
    list.forEach(function (m) {
      ['rows', 'qty', 'revenue', 'vat', 'gpFee', 'cost', 'shipping', 'box', 'perUnitOther', 'gross'].forEach(function (k) { t[k] += m[k]; });
      m.overheads.forEach(function (o) {
        var key = o.key.charAt(0) === 'x' ? 'x:' + o.label : o.key;
        if (!byKey[key]) { byKey[key] = { key: key, label: o.label, amount: 0, source: 'sum' }; order.push(key); }
        byKey[key].amount += o.amount;
      });
    });
    t.overheads = order.map(function (k) { return byKey[k]; });
    t.overheadTotal = t.overheads.reduce(function (a, o) { return a + o.amount; }, 0);
    t.net = t.gross - t.overheadTotal; t.profit = t.net;
    t.margin = t.revenue > 0 ? t.net / t.revenue * 100 : 0;
    return t;
  }

  /* งบของช่วงที่เลือก: 'YYYY-MM' = เดือนนั้น, 'all' = รวมทุกเดือนที่มีข้อมูล */
  function periodPL(products, channels, settings, expenses, period) {
    if (period && period !== 'all') return monthlyPL(products, channels, settings, expenses, period);
    return sumPL(monthlyTotals(products, channels, settings, expenses));
  }

  /* สถานะกำไร: 'loss' (ขาดทุน) | 'thin' (% กำไรต่ำกว่า thin) | 'ok' */
  function status(result, thin) {
    if (result.profit < 0) return 'loss';
    if (result.margin < thin) return 'thin';
    return 'ok';
  }

  /* สรุปสำหรับแดชบอร์ด จากรายการผลลัพธ์ (1 รายการ = สินค้า 1 ตัว x ช่องทาง 1 ช่อง) */
  function summarize(results, thin) {
    var n = results.length, sumP = 0, sumM = 0, loss = 0, thinCount = 0;
    var sales = { rows: 0, qty: 0, revenue: 0, profit: 0, margin: 0 }; // รวมเฉพาะรายการที่ใส่จำนวนที่ขายได้
    results.forEach(function (r) {
      sumP += r.profit; sumM += r.margin;
      var s = status(r, thin);
      if (s === 'loss') loss++; else if (s === 'thin') thinCount++;
      if (r.qty !== null && r.qty !== undefined) { sales.rows++; sales.qty += r.qty; sales.revenue += r.revenue; sales.profit += r.totalProfit; }
    });
    sales.margin = sales.revenue > 0 ? sales.profit / sales.revenue * 100 : 0; // ถ่วงน้ำหนักตามยอดขาย ไม่ใช่เฉลี่ยตรง ๆ
    return { count: n, avgProfit: n ? sumP / n : 0, avgMargin: n ? sumM / n : 0, lossCount: loss, thinCount: thinCount, sales: sales };
  }

  /* แจกแจงว่าราคาขาย 1 ชิ้นไปอยู่ที่ไหน: คืนรายการ { key, label, amount } เรียงต้นทุน -> ค่าธรรมเนียม -> VAT
   * ผลรวมทุกแถว + กำไร = ราคาขาย (ตรวจในเทส) */
  function breakdown(r) {
    var rows = [
      { key: 'cost', label: 'ต้นทุนสินค้า', amount: r.cost },
      { key: 'shipping', label: 'ค่าขนส่ง', amount: r.shipping },
      { key: 'box', label: 'ค่ากล่อง/พัสดุ', amount: r.box },
      { key: 'staff', label: 'ค่าพนักงาน', amount: r.staff },
      { key: 'ads', label: 'ค่าแอด', amount: r.ads },
      { key: 'other', label: 'ค่าดำเนินการอื่น ๆ', amount: r.other }
    ];
    r.extras.forEach(function (e, i) { rows.push({ key: 'extra' + i, label: e.name || 'ค่าใช้จ่ายเพิ่มเติม', amount: e.amt }); });
    rows.push({ key: 'gp', label: 'ค่า GP ' + r.gp + '%', amount: r.gpFee });
    rows.push({ key: 'vat', label: r.vatOn ? 'VAT 7% (รวมในราคา)' : 'VAT (ปิด)', amount: r.vat });
    return rows;
  }

  /* คำเตือนตัวเลขที่น่าจะพิมพ์ผิด คืนรหัสคำเตือน (ข้อความภาษาไทยอยู่ที่หน้าจอ)
   * 'costs-far-above-price': ต้นทุนรวมสูงกว่าราคาขายตั้งแต่ 3 เท่าขึ้นไป (เช่น ต้นทุน 120 แต่พิมพ์ 120000) */
  function warnings(r) {
    var w = [];
    if (r.price > 0 && r.costs >= 3 * r.price) w.push('costs-far-above-price');
    return w;
  }

  return { VAT_RATE: VAT_RATE, warnings: warnings, round2: round2, parseMoney: parseMoney, overheadPerUnit: overheadPerUnit, calcProduct: calcProduct, calcAll: calcAll, soldQty: soldQty, monthlyPL: monthlyPL, monthlyTotals: monthlyTotals, sumPL: sumPL, periodPL: periodPL, status: status, summarize: summarize, breakdown: breakdown };
});
