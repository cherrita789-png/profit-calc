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

  /* คำนวณ 1 สินค้า x 1 ช่องทาง
   * product  = { cost, shipping, box, staff?, ads?, other?, extras?: [{name, amt}], prices: {ch: n}, actual?: {ch: n}, sold?: {'YYYY-MM': {ch: จำนวนชิ้น}} }
   * channel  = { id, gp }   (gp เป็น % ของราคาขาย)
   * settings = { vatOn, monthlyUnits, staff, ads, other }
   * period   = 'YYYY-MM' (เดือนที่ดูยอดขาย) หรือ 'all'/ไม่ใส่ = รวมทุกเดือน
   * คืน null ถ้าสินค้านี้ไม่ได้ขายช่องทางนั้น (ไม่มีทั้งราคาตั้งและราคาขายจริง) */
  function calcProduct(product, channel, settings, period) {
    var listP = product.prices ? product.prices[channel.id] : undefined;
    var act = product.actual ? product.actual[channel.id] : undefined;
    var price = act !== undefined && act !== null ? act : listP;
    if (price === undefined || price === null) return null;

    var vatRate = settings.vatOn ? VAT_RATE : 0;
    var gpRate = channel.gp / 100;
    var units = settings.monthlyUnits;

    function over(k) { return product[k] !== undefined && product[k] !== null ? product[k] : overheadPerUnit(settings[k], units); }
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

  /* สรุปรายเดือน: คืน [{ month, rows, qty, revenue, profit, margin }] เดือนล่าสุดก่อน
   * นับเฉพาะสินค้า x ช่องทางที่ใส่จำนวนในเดือนนั้น และมีราคาของช่องทางนั้น */
  function monthlyTotals(products, channels, settings) {
    var months = {};
    products.forEach(function (p) { Object.keys(p.sold || {}).forEach(function (m) { months[m] = 1; }); });
    return Object.keys(months).sort().reverse().map(function (m) {
      var t = { month: m, rows: 0, qty: 0, revenue: 0, profit: 0, margin: 0 };
      products.forEach(function (p) {
        channels.forEach(function (c) {
          var r = calcProduct(p, c, settings, m);
          if (r && r.qty !== null) { t.rows++; t.qty += r.qty; t.revenue += r.revenue; t.profit += r.totalProfit; }
        });
      });
      t.margin = t.revenue > 0 ? t.profit / t.revenue * 100 : 0;
      return t;
    });
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

  return { VAT_RATE: VAT_RATE, warnings: warnings, round2: round2, parseMoney: parseMoney, overheadPerUnit: overheadPerUnit, calcProduct: calcProduct, calcAll: calcAll, soldQty: soldQty, monthlyTotals: monthlyTotals, status: status, summarize: summarize, breakdown: breakdown };
});
