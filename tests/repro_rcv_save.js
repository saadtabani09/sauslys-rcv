// Runtime regression test for RCV receiving integrity, using the app's own saveSess().
// Runs offline: third-party OCR/CDN requests are blocked and the ops server is intercepted.
// Exit 1 while any finding still reproduces, 0 when all are fixed. IDs match reports/rcv/*.md.
//
// Usage: npm install --no-save playwright && node tests/repro_rcv_save.js "$PWD/index.html"
// Source of truth: Sauslys-AGENT-SKILLS skills/sauslys-rcv-red-team/scripts/repro_rcv_save.js
const { chromium } = require('playwright');

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('usage: node repro_rcv_save.js /path/to/index.html'); process.exit(2); }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [], dialogs = [], posted = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });   // alerts closed, confirms answered "Cancel"
  await page.route(/tessdata|jsdelivr/, r => r.abort());
  await page.route('https://ops.test/**', r => {
    posted.push({ headers: r.request().headers(), body: r.request().postData() });
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.goto('file://' + file);
  await page.waitForTimeout(800);

  const run = expr => page.evaluate(expr);
  const stock = () => run(`inv['Beef Patties'] ? {...inv['Beef Patties']} : null`);
  const save = async (qty, unit, invoice, price) => {
    const before = dialogs.length;
    await run(`(() => {
      const s = document.getElementById('supsel'); s.value = s.options[1].value;
      document.getElementById('invnum').value = '${invoice}';
      sess = [{uid: ++uidSeq, raw: 'beef patty', matched: 'Beef Patties', score: 0, qty: ${qty}, unit: '${unit}', price: ${price}}];
      saveSess();
    })()`);
    return { stock: await stock(), dialog: dialogs.slice(before).join(' | '), sessLeft: await run('sess.length') };
  };

  await run(`localStorage.clear(); lg = []; inv = {}; if (typeof outbox !== 'undefined') outbox = [];`);
  const r = {};
  r.first = await save(5, 'KG', 'INV-100', 3900);
  r.duplicate = await save(5, 'KG', 'INV-100', 3900);
  r.dupEntries = await run(`lg.filter(e => e.invoiceNum === 'INV-100').length`);
  r.mixedUnit = await save(3, 'PCS', 'INV-101', 1200);
  r.negative = await save(-20, 'KG', 'INV-102', 100);
  r.grams = await save(500, 'G', 'INV-103', 400);
  r.csvBom = await run(`/\\\\uFEFF|\\uFEFF/.test(expCSV.toString())`);
  r.queued = await run(`(() => { try { return JSON.parse(localStorage.getItem('sl_outbox') || '[]').length; } catch (e) { return 0; } })()`);
  r.hasBackup = await run(`typeof bkup === 'function' && typeof rstr === 'function'`);
  if (await run(`typeof flushSync === 'function'`)) {
    await run(`localStorage.setItem('sl_sync', JSON.stringify({url: 'https://ops.test', key: 'test-key'}))`);
    await run(`flushSync()`);
    await page.waitForTimeout(500);
    r.outboxAfterSync = await run(`outbox.length`);
  }
  await browser.close();

  const base = r.first.stock ? r.first.stock.qty : 0;
  const first = posted[0] || { headers: {}, body: '{}' };
  const checks = [
    ['RCV-01 duplicate invoice accepted (stock double-counted)', r.dupEntries > 1],
    ['RCV-01 saved items stay on screen after save (easy re-save)', r.first.sessLeft > 0],
    ['RCV-02 PCS added into a KG balance', !r.mixedUnit.stock || r.mixedUnit.stock.unit !== 'KG' || r.mixedUnit.stock.qty !== r.duplicate.stock.qty],
    ['RCV-02 grams not converted into the KG balance', !r.grams.stock || Math.abs(r.grams.stock.qty - (r.negative.stock.qty + 0.5)) > 1e-9],
    ['RCV-03 negative quantity accepted, stock reduced', !r.negative.stock || r.negative.stock.qty < r.mixedUnit.stock.qty || r.negative.stock.qty < 0],
    ['RCV-04 saved delivery not queued for server sync', !(r.queued > 0)],
    ['RCV-04 queued delivery not sent to the ops server', !(posted.length > 0 && r.outboxAfterSync === 0)],
    ['RCV-04 sync does not authenticate / tag as receiving', !(first.headers['x-sauslys-access'] === 'test-key' && JSON.parse(first.body || '{}').entry_type === 'receiving')],
    ['RCV-04 no backup / restore', !r.hasBackup],
    ['RCV-07 CSV export has no UTF-8 BOM (Bengali garbles in Excel)', !r.csvBom],
  ];
  console.log('observed:', JSON.stringify({ ...r, posted: posted.length, baseKg: base }));
  console.log('app messages:', dialogs.length ? dialogs.map(d => d.replace(/\s+/g, ' ').slice(0, 110)) : 'none');
  let open = 0;
  for (const [name, reproduced] of checks) {
    console.log(`${reproduced ? 'REPRODUCED' : 'fixed     '}  ${name}`);
    if (reproduced) open++;
  }
  if (errors.length) { console.log('page errors:', errors); open++; }
  console.log(`${open} of ${checks.length} checks still failing`);
  process.exit(open ? 1 : 0);
})();
