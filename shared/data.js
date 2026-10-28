const backupCollections = ['lancamentos', 'contas', 'vacas', 'bezerros', 'config'];
const maximumRecords = 5000;
const maximumRecordBytes = 128_000;

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime())
    && date.getFullYear() === Number(value.slice(0, 4))
    && date.getMonth() + 1 === Number(value.slice(5, 7))
    && date.getDate() === Number(value.slice(8, 10));
}

function validText(value, required = false, maxLength = 500) {
  return (typeof value === 'string' && value.length <= maxLength && (!required || value.trim().length > 0))
    || (!required && value === undefined);
}

function validAmount(value, positive = false) {
  return Number.isFinite(value) && Math.abs(value) <= 1_000_000_000_000 && (!positive || value > 0);
}

export function validRecordId(value) {
  return typeof value === 'string' && /^[\da-z_-]{1,128}$/i.test(value);
}

export function validateRecordData(collection, id, data, today = new Date()) {
  if (!['config', 'lancamentos', 'contas', 'vacas', 'bezerros'].includes(collection)
    || !validRecordId(id)
    || !data || typeof data !== 'object' || Array.isArray(data)) {
    return 'invalid-record';
  }
  if (new TextEncoder().encode(JSON.stringify(data)).length > maximumRecordBytes) return 'record-too-large';
  if (data.ts !== undefined && (!Number.isFinite(data.ts) || data.ts < 0)) return 'invalid-timestamp';

  if (collection === 'config') {
    return id === 'saldo' && validAmount(data.value) ? null : 'invalid-config';
  }
  if (collection === 'lancamentos') {
    if (!['in', 'out'].includes(data.type) || !validAmount(data.value, true)
      || !validDate(data.date) || !validText(data.desc) || !validText(data.cat) || !validText(data.who)) {
      return 'invalid-movement';
    }
  } else if (collection === 'contas') {
    if (!validText(data.desc, true) || !validAmount(data.value, true)
      || !validDate(data.due)) return 'invalid-bill';
  } else if (collection === 'vacas') {
    if (!validText(data.nome, true) || !validText(data.touro) || !validDate(data.cio) || !validDate(data.parto)) return 'invalid-cow';
  } else if (!validText(data.descricao, true) || !validText(data.brinco, true)
    || !validDate(data.nascimento)
    || data.nascimento > `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`) {
    return 'invalid-calf';
  }
  return null;
}

export function validateRestoreRecords(records, today = new Date()) {
  if (!Array.isArray(records) || records.length === 0 || records.length > maximumRecords) {
    throw new Error('invalid-record-count');
  }
  const ids = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || !backupCollections.includes(record.collection)) throw new Error('invalid-record');
    const { collection, id, data } = record;
    if (validateRecordData(collection, id, data, today)) throw new Error('invalid-record-data');
    if (!ids.has(collection)) ids.set(collection, new Set());
    if (ids.get(collection).has(id)) throw new Error('duplicate-id');
    ids.get(collection).add(id);
  }
  return records;
}

export function prepareBackup(backup, today = new Date()) {
  if (!backup || backup.version !== 1 || !backup.collections
    || typeof backup.collections !== 'object' || Array.isArray(backup.collections)) {
    throw new Error('Formato de backup não reconhecido.');
  }
  if (Object.keys(backup.collections).some(name => !backupCollections.includes(name))) {
    throw new Error('O backup contém coleções incompatíveis.');
  }
  const records = [];
  for (const collection of backupCollections) {
    const entries = backup.collections[collection] ?? [];
    if (!Array.isArray(entries)) throw new Error(`A lista ${collection} é inválida.`);
    for (const record of entries) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error(`Há um registro inválido em ${collection}.`);
      }
      const { id, ...data } = record;
      records.push({ collection, id, data });
    }
  }
  try {
    validateRestoreRecords(records, today);
  } catch (error) {
    if (error.message === 'duplicate-id') throw new Error('O backup contém identificadores duplicados.');
    if (error.message === 'invalid-record-count') throw new Error('O backup não contém registros ou excede o limite de 5.000 registros.');
    throw new Error('O backup contém registros inválidos.');
  }
  return records;
}

export function calculateFinance(initial, items, selectedMonth = '', now = new Date()) {
  let income = 0;
  let expenses = 0;
  const categories = {};
  const periodItems = items.filter(item => !selectedMonth
    || (typeof item.date === 'string' && item.date.startsWith(selectedMonth)));
  for (const item of periodItems) {
    if (!Number.isFinite(item.value)) continue;
    if (item.type === 'in') income += item.value;
    else if (item.type === 'out') {
      expenses += item.value;
      const category = item.cat || 'Outros';
      categories[category] = (categories[category] || 0) + item.value;
    }
  }
  const accumulated = initial + items.reduce((total, item) => total + (Number.isFinite(item.value)
    ? item.type === 'in' ? item.value : item.type === 'out' ? -item.value : 0
    : 0), 0);
  const [year, month] = /^\d{4}-\d{2}$/.test(selectedMonth)
    ? selectedMonth.split('-').map(Number)
    : [now.getFullYear(), now.getMonth() + 1];
  const trend = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(year, month - 1 - (5 - index), 1);
    return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, date, balance: 0 };
  });
  const trendByMonth = new Map(trend.map(entry => [entry.key, entry]));
  for (const item of items) {
    if (!validDate(item.date) || !Number.isFinite(item.value) || !['in', 'out'].includes(item.type)) continue;
    const entry = trendByMonth.get(item.date.slice(0, 7));
    if (entry) entry.balance += item.type === 'in' ? item.value : -item.value;
  }
  return { income, expenses, periodBalance: income - expenses, accumulated, categories, trend };
}

export function buildCsv(columns, rows) {
  const csvCell = (value, isNumeric = false) => {
    let text = String(value ?? '');
    if (!isNumeric && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [columns.join(';'), ...rows.map(row =>
    columns.map(key => csvCell(row[key], key === 'valor' && typeof row[key] === 'number')).join(';')
  )].join('\r\n');
}
