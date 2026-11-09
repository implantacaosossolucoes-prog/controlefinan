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
    parto: '2026-10-01',
    partoRealizado: '2026-10-28',
    observacoesBezerro: 'Fêmea, pelagem marrom'
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
  assert.equal(restoredCow.data.observacoesBezerro, 'Fêmea, pelagem marrom');
  assert.equal(validateRecordData('vacas', 'cow-2', {
    ...cow,
    touro: 'T'.repeat(501)
  }, today), 'invalid-cow');
  assert.equal(validateRecordData('vacas', 'cow-2', {
    ...cow,
    touro: 123
  }, today), 'invalid-cow');
  assert.equal(validateRecordData('vacas', 'cow-3', cow, today), null);
  assert.equal(validateRecordData('vacas', 'cow-4', {
    ...cow,
    partoRealizado: '2026-10-29'
  }, today), 'invalid-cow');
  assert.equal(validateRecordData('vacas', 'cow-5', {
    ...cow,
    partoRealizado: '2026-02-30'
  }, today), 'invalid-cow');
  assert.equal(validateRecordData('vacas', 'cow-6', {
    ...cow,
    observacoesBezerro: 'O'.repeat(2001)
  }, today), 'invalid-cow');
  assert.equal(validateRecordData('vacas', 'cow-7', {
    ...cow,
    observacoesBezerro: 5
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

test('crop records validate plots, seasons, field activities and linked finance expenses', () => {
  const today = new Date(2026, 0, 5);
  const plot = { kind: 'talhao', nome: 'Talhão Norte', areaHa: 12.5 };
  const season = {
    kind: 'safra',
    cultura: 'milho',
    nome: '2025/26',
    talhaoId: 'plot-1',
    plantio: '2025-10-10',
    colheitaPrevista: '2026-03-20',
    status: 'em_andamento'
  };
  assert.equal(validateRecordData('lavouras', 'plot-1', plot, today), null);
  assert.equal(validateRecordData('lavouras', 'plot-located', {
    ...plot, latitude: -29.123456, longitude: -53.987654
  }, today), null);
  const boundary = [
    { latitude: -29.1, longitude: -53.1 },
    { latitude: -29.1, longitude: -53.2 },
    { latitude: -29.2, longitude: -53.2 },
    { latitude: -29.2, longitude: -53.1 }
  ];
  assert.equal(validateRecordData('lavouras', 'plot-demarcated', {
    ...plot, latitude: -29.15, longitude: -53.15, boundary
  }, today), null);
  assert.equal(validateRecordData('lavouras', 'plot-short-boundary', {
    ...plot, boundary: boundary.slice(0, 2)
  }, today), 'invalid-crop-plot');
  assert.equal(validateRecordData('lavouras', 'plot-duplicate-boundary', {
    ...plot, boundary: [boundary[0], boundary[1], boundary[0]]
  }, today), 'invalid-crop-plot');
  assert.equal(validateRecordData('lavouras', 'plot-bad-boundary-point', {
    ...plot, boundary: [...boundary.slice(0, 3), { latitude: 0, longitude: 181 }]
  }, today), 'invalid-crop-plot');
  assert.equal(validateRecordData('lavouras', 'plot-too-large-boundary', {
    ...plot, boundary: Array.from({ length: 501 }, (_, index) => ({
      latitude: index % 90,
      longitude: index % 180
    }))
  }, today), 'invalid-crop-plot');
  assert.equal(validateRecordData('lavouras', 'plot-half-located', {
    ...plot, latitude: -29.123456
  }, today), 'invalid-crop-plot');
  assert.equal(validateRecordData('lavouras', 'plot-bad-latitude', {
    ...plot, latitude: -91, longitude: 0
  }, today), 'invalid-crop-plot');
  assert.equal(validateRecordData('lavouras', 'plot-bad-longitude', {
    ...plot, latitude: 0, longitude: 181
  }, today), 'invalid-crop-plot');
  assert.equal(validateRecordData('lavouras', 'season-1', season, today), null);
  assert.equal(validateRecordData('lavouras', 'input-1', {
    kind: 'insumo', nome: 'Semente', unidade: 'kg', estoqueMinimo: 50
  }, today), null);
  assert.equal(validateRecordData('lavouras', 'rain-1', {
    kind: 'atividade', operacao: 'chuva', safraId: 'season-1', talhaoId: 'plot-1',
    data: '2026-01-03', chuvaMm: 18
  }, today), null);
  assert.equal(validateRecordData('lavouras', 'harvest-1', {
    kind: 'atividade', operacao: 'colheita', safraId: 'season-1', talhaoId: 'plot-1',
    data: '2026-01-03', areaHa: 10, producao: 600, unidadeProducao: 'sc'
  }, today), null);
  assert.equal(validateRecordData('lavouras', 'stock-1', {
    kind: 'atividade', operacao: 'estoque_entrada', data: '2026-01-03',
    inputId: 'input-1', quantidade: 200
  }, today), null);
  assert.equal(validateRecordData('lavouras', 'harvest-2', {
    kind: 'atividade', operacao: 'colheita', safraId: 'season-1', talhaoId: 'plot-1',
    data: '2026-01-03', areaHa: 10, producao: 600
  }, today), 'invalid-crop-activity');
  assert.equal(validateRecordData('lavouras', 'stock-2', {
    kind: 'atividade', operacao: 'estoque_entrada', data: '2026-01-03',
    inputId: 'input-1', quantidade: -2
  }, today), 'invalid-crop-activity');
  assert.equal(validateRecordData('lavouras', 'season-2', {
    ...season, cultura: 'trigo'
  }, today), 'invalid-crop-season');
  assert.equal(validateRecordData('lancamentos', 'expense-1', {
    type: 'out', value: 120, date: '2026-01-03', cropSeasonId: 'season-1', cropPlotId: 'plot-1'
  }, today), null);
  assert.equal(validateRecordData('lancamentos', 'expense-2', {
    type: 'in', value: 120, date: '2026-01-03', cropSeasonId: 'season-1'
  }, today), 'invalid-movement');
});

test('crop records are included in versioned backup preparation', () => {
  const boundary = [
    { latitude: -29.1, longitude: -53.1 },
    { latitude: -29.1, longitude: -53.2 },
    { latitude: -29.2, longitude: -53.2 }
  ];
  const [record] = prepareBackup({
    version: 1,
    collections: {
      lavouras: [{
        id: 'plot-1', kind: 'talhao', nome: 'Talhão Sul', areaHa: 8,
        latitude: -29.133333, longitude: -53.166667, boundary
      }]
    }
  }, new Date(2026, 0, 5));
  assert.equal(record.collection, 'lavouras');
  assert.equal(record.data.nome, 'Talhão Sul');
  assert.deepEqual(record.data.boundary, boundary);
});
