import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCsv,
  calculateFinance,
  prepareBackup,
  validateRecordData,
  validateRestoreRecords
} from '../shared/data.js';

test('monthly indicators, accumulated balance and trend reconcile with movements', () => {
  const items = [
    { type: 'in', value: 1000, date: '2026-03-02' },
    { type: 'out', value: 250, date: '2026-03-20', cat: 'Insumos' },
    { type: 'in', value: 400, date: '2026-04-01' },
    { type: 'out', value: 50, date: '2026-02-10' },
    { type: 'in', value: 90, date: 'invalid' }
  ];

  const march = calculateFinance(200, items, '2026-03', new Date(2026, 2, 1));
  assert.equal(march.income, 1000);
  assert.equal(march.expenses, 250);
  assert.equal(march.periodBalance, 750);
  assert.equal(march.accumulated, 1390);
  assert.equal(march.categories.Insumos, 250);
  assert.deepEqual(march.trend.map(month => month.key), [
    '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'
  ]);
  assert.equal(march.trend.at(-1).balance, 750);
  assert.equal(march.trend[4].balance, -50);

  const allTime = calculateFinance(200, items, '', new Date(2026, 3, 1));
  assert.equal(allTime.income, 1490);
  assert.equal(allTime.expenses, 300);
  assert.equal(allTime.periodBalance, 1190);
  assert.equal(allTime.accumulated, 1390);
});

test('CSV escaping quotes cells and prevents formula execution in text', () => {
  const csv = buildCsv(['descricao', 'valor'], [
    { descricao: '=HYPERLINK("https://bad")', valor: 12.5 },
    { descricao: 'linha;com "aspas"', valor: -3 }
  ]);
  assert.equal(csv, [
    'descricao;valor',
    '"\'=HYPERLINK(""https://bad"")";"12.5"',
    '"linha;com ""aspas""";"-3"'
  ].join('\r\n'));
});

test('backup preparation rejects invalid values and repeated identifiers', () => {
  const duplicateBackup = {
    version: 1,
    collections: {
      lancamentos: [
        { id: 'same', type: 'in', value: 20, date: '2026-01-01' },
        { id: 'same', type: 'out', value: 10, date: '2026-01-02' }
      ]
    }
  };
  assert.throws(() => prepareBackup(duplicateBackup, new Date(2026, 0, 3)), /identificadores duplicados/);
  assert.throws(() => prepareBackup({
    version: 1,
    collections: { lancamentos: [{ id: 'bad', type: 'out', value: -1, date: '2026-02-30' }] }
  }, new Date(2026, 0, 3)), /registros inválidos/);
  assert.throws(() => prepareBackup({ version: 2, collections: {} }), /Formato de backup/);
});

test('cow records preserve an optional bull name through backups', () => {
  const cow = {
    nome: 'Mimosa',
    touro: 'Touro ABC',
    cio: '2026-01-01',
    parto: '2026-10-01'
  };
  const today = new Date(2026, 9, 28);
  assert.equal(validateRecordData('vacas', 'cow-1', cow, today), null);
  const legacyCow = { ...cow };
  delete legacyCow.touro;
  assert.equal(validateRecordData('vacas', 'cow-2', legacyCow, today), null);
  const [restoredCow] = prepareBackup({
    version: 1,
    collections: { vacas: [{ id: 'cow-1', ...cow }] }
  }, today);
  assert.equal(restoredCow.data.touro, 'Touro ABC');
  assert.equal(validateRecordData('vacas', 'cow-2', {
    ...cow,
    touro: 'T'.repeat(501)
  }, today), 'invalid-cow');
  assert.equal(validateRecordData('vacas', 'cow-2', {
    ...cow,
    touro: 123
  }, today), 'invalid-cow');
  assert.equal(validateRecordData('vacas', 'cow-3', {
    ...cow,
    partoRealizado: '2026-10-28'
  }, today), null);
  assert.equal(validateRecordData('vacas', 'cow-4', {
    ...cow,
    partoRealizado: '2026-10-29'
  }, today), 'invalid-cow');
  assert.equal(validateRecordData('vacas', 'cow-5', {
    ...cow,
    partoRealizado: '2026-02-30'
  }, today), 'invalid-cow');
});

test('valid restore batches retain distinct IDs and reject oversized or malformed batches', () => {
  const records = [
    { collection: 'config', id: 'saldo', data: { value: 100 } },
    { collection: 'contas', id: 'bill-1', data: { desc: 'Ração', value: 25, due: '2026-01-10' } }
  ];
  assert.equal(validateRestoreRecords(records, new Date(2026, 0, 5)), records);
  assert.throws(() => validateRestoreRecords([
    ...records,
    { collection: 'config', id: 'saldo', data: { value: 200 } }
  ], new Date(2026, 0, 5)), /duplicate-id/);
  assert.throws(() => validateRestoreRecords([], new Date(2026, 0, 5)), /invalid-record-count/);
  assert.throws(() => validateRestoreRecords([
    { collection: 'contas', id: '"><img src=x onerror=alert(1)>', data: { desc: 'Conta', value: 25, due: '2026-01-10' } }
  ], new Date(2026, 0, 5)), /invalid-record-data/);
});
