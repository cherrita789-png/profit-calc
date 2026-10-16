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

  /* คำนวณ 1 สินค้า x 1 ช่องทาง
   * product  = { cost, shipping, box, staff?, ads?, other?, extras?: [{name, amt}], prices: {ch: n}, actual?: {ch: n} }
   * channel  = { id, gp }   (gp เป็น % ของราคาขาย)
   * settings = { vatOn, monthlyUnits, staff, ads, other }
   * คืน null ถ้าสินค้านี้ไม่ได้ขายช่องทางนั้น (ไม่มีทั้งราคาตั้งและราคาขายจริง) */
  function calcProduct(product, channel, settings) {
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

    return {
      channelId: channel.id,
      gp: channel.gp, vatOn: !!settings.vatOn,
      price: price,
      list: listP !== undefined && listP !== null && act !== undefined && act !== null ? listP : null,
      cost: product.cost, shipping: shipping, box: box, staff: staff, ads: ads, other: other, extras: extras,
      costs: costs, vat: vat, gpFee: gpFee, profit: profit,
      margin: price > 0 ? profit / price * 100 : 0,
      breakEven: denom > 0 ? costs / denom : null // null = คำนวณไม่ได้ ตรวจค่า GP
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

  /* สถานะกำไร: 'loss' (ขาดทุน) | 'thin' (% กำไรต่ำกว่า thin) | 'ok' */
  function status(result, thin) {
    if (result.profit < 0) return 'loss';
    if (result.margin < thin) return 'thin';
    return 'ok';
  }

  /* สรุปสำหรับแดชบอร์ด จากรายการผลลัพธ์ (1 รายการ = สินค้า 1 ตัว x ช่องทาง 1 ช่อง) */
  function summarize(results, thin) {
    var n = results.length, sumP = 0, sumM = 0, loss = 0, thinCount = 0;
    results.forEach(function (r) {
      sumP += r.profit; sumM += r.margin;
      var s = status(r, thin);
      if (s === 'loss') loss++; else if (s === 'thin') thinCount++;
    });
    return { count: n, avgProfit: n ? sumP / n : 0, avgMargin: n ? sumM / n : 0, lossCount: loss, thinCount: thinCount };
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

  return { VAT_RATE: VAT_RATE, round2: round2, parseMoney: parseMoney, overheadPerUnit: overheadPerUnit, calcProduct: calcProduct, calcAll: calcAll, status: status, summarize: summarize, breakdown: breakdown };
});
