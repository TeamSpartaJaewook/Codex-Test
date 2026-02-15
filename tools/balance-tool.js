#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'balance.config.js');
const SOURCE_PATH = path.join(ROOT, 'balance.source.json');
const HEADER_ALIASES = {
  key: ['key', 'keys', 'path', 'id', '키', '항목'],
  type: ['type', 'datatype', 'value_type', '타입', '자료형'],
  value: ['value', 'val', '값'],
  description: ['description', 'desc', 'note', 'memo', '설명', '메모'],
};

function usage() {
  console.log('Usage:');
  console.log('  node tools/balance-tool.js set-url <google-sheet-url-or-id> [--sheets a,b,c] [--interval 10]');
  console.log('  node tools/balance-tool.js build [--url <google-sheet-url-or-id>] [--sheets a,b,c]');
  console.log('  node tools/balance-tool.js watch [--interval 10]');
  console.log('  node tools/balance-tool.js list [prefix]');
  console.log('  node tools/balance-tool.js get <path>');
  console.log('');
  console.log('Examples:');
  console.log('  node tools/balance-tool.js set-url "https://docs.google.com/spreadsheets/d/XXXX/edit"');
  console.log('  node tools/balance-tool.js set-url XXXX --sheets economy,buildings,waves,enemies');
  console.log('  node tools/balance-tool.js build');
  console.log('  node tools/balance-tool.js watch --interval 8');
}

function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--url') {
      out.url = args[i + 1];
      i += 1;
      continue;
    }
    if (token === '--sheets') {
      out.sheets = args[i + 1];
      i += 1;
      continue;
    }
    if (token === '--interval') {
      out.interval = args[i + 1];
      i += 1;
      continue;
    }
    out._.push(token);
  }
  return out;
}

function normalizeHeaderCell(cell) {
  return String(cell || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[-_]/g, '');
}

function normalizeType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (t === 'number' || t === 'boolean' || t === 'string' || t === 'json') return t;
  return 'string';
}

function parseTypedValue(type, raw) {
  const t = normalizeType(type);
  const text = String(raw ?? '').trim();

  if (t === 'number') {
    const n = Number(text);
    if (!Number.isFinite(n)) throw new Error(`number 타입 파싱 실패: ${raw}`);
    return n;
  }

  if (t === 'boolean') {
    if (text === 'true') return true;
    if (text === 'false') return false;
    throw new Error(`boolean 타입 파싱 실패(true/false 필요): ${raw}`);
  }

  if (t === 'json') {
    return JSON.parse(text);
  }

  return String(raw ?? '');
}

function serializeBalance(balance) {
  const json = JSON.stringify(balance, null, 2)
    .split('\n')
    .map((line, idx) => (idx === 0 ? line : `  ${line}`))
    .join('\n');

  return `(() => {\n  window.GAME_BALANCE = ${json};\n})();\n`;
}

function parseSpreadsheetId(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Google Sheet URL 또는 Spreadsheet ID가 필요합니다.');

  const urlMatch = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];

  if (/^[a-zA-Z0-9-_]{20,}$/.test(value)) {
    return value;
  }

  throw new Error('Google Sheet URL 형식이 올바르지 않습니다.');
}

function parseSheetNames(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadSourceConfig() {
  if (!fs.existsSync(SOURCE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
  } catch (err) {
    throw new Error('balance.source.json 파싱 실패');
  }
}

function saveSourceConfig(source) {
  fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`요청 실패 ${res.status}: ${url}`);
  }
  return res.text();
}

async function fetchJson(url) {
  const text = await fetchText(url);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`JSON 파싱 실패: ${url}`);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }

    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }

    if (ch === '\r') {
      i += 1;
      continue;
    }

    cell += ch;
    i += 1;
  }

  row.push(cell);
  const hasData = row.some((v) => String(v || '').trim().length > 0);
  if (hasData) rows.push(row);

  return rows;
}

function resolveHeaderMeta(rawCells, normalizedCells, key) {
  const aliases = (HEADER_ALIASES[key] || [key]).map((a) => normalizeHeaderCell(a));
  let prefixIndex = -1;
  let prefixAlias = '';

  for (let i = 0; i < normalizedCells.length; i += 1) {
    const cellNorm = normalizedCells[i];
    for (let j = 0; j < aliases.length; j += 1) {
      const aliasNorm = aliases[j];
      if (!aliasNorm) continue;
      if (cellNorm === aliasNorm) {
        return { index: i, mode: 'exact', aliasNorm, raw: String(rawCells[i] || '') };
      }
      if (prefixIndex < 0 && cellNorm.startsWith(aliasNorm)) {
        prefixIndex = i;
        prefixAlias = aliasNorm;
      }
    }
  }

  if (prefixIndex >= 0) {
    return {
      index: prefixIndex,
      mode: 'prefix',
      aliasNorm: prefixAlias,
      raw: String(rawCells[prefixIndex] || ''),
    };
  }

  return { index: -1, mode: 'none', aliasNorm: '', raw: '' };
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractValueFromCombinedHeaderCell(rawCell, headerKey) {
  const raw = String(rawCell || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return '';

  const aliases = HEADER_ALIASES[headerKey] || [headerKey];
  for (let i = 0; i < aliases.length; i += 1) {
    const alias = String(aliases[i] || '').trim();
    if (!alias) continue;

    const pattern = new RegExp(`^\\s*${escapeRegex(alias)}\\s*[:\\-]?\\s*([\\s\\S]*)$`, 'i');
    const m = raw.match(pattern);
    if (!m) continue;

    const suffix = String(m[1] || '').trim();
    if (suffix) return suffix;
  }

  return '';
}

function parseSheetRows(sheetName, csvText) {
  const aoa = parseCsv(csvText);
  if (!aoa.length) return [];

  let headerRowIndex = -1;
  let keyIdx = -1;
  let typeIdx = -1;
  let valueIdx = -1;
  let descIdx = -1;
  let keyMeta = null;
  let typeMeta = null;
  let valueMeta = null;
  let descMeta = null;

  const scanLimit = Math.min(20, aoa.length);
  for (let r = 0; r < scanLimit; r += 1) {
    const rawHeaderRow = aoa[r] || [];
    const header = rawHeaderRow.map(normalizeHeaderCell);
    const kMeta = resolveHeaderMeta(rawHeaderRow, header, 'key');
    const tMeta = resolveHeaderMeta(rawHeaderRow, header, 'type');
    const vMeta = resolveHeaderMeta(rawHeaderRow, header, 'value');
    const dMeta = resolveHeaderMeta(rawHeaderRow, header, 'description');
    if (kMeta.index >= 0 && tMeta.index >= 0 && vMeta.index >= 0) {
      headerRowIndex = r;
      keyIdx = kMeta.index;
      typeIdx = tMeta.index;
      valueIdx = vMeta.index;
      descIdx = dMeta.index;
      keyMeta = kMeta;
      typeMeta = tMeta;
      valueMeta = vMeta;
      descMeta = dMeta;
      break;
    }
  }

  if (headerRowIndex < 0) {
    const sample = (aoa[0] || []).map((v) => String(v || '').trim()).join(', ');
    throw new Error(`${sheetName}: 시트 헤더는 key,type,value(또는 키,타입,값)를 포함해야 합니다. 첫 행: ${sample}`);
  }

  const rows = [];

  // Google Sheets에서 헤더 셀에 첫 데이터가 줄바꿈으로 합쳐져 내려오는 경우 자동 복구.
  const mergedHeaderData = {
    key: keyMeta && keyMeta.mode === 'prefix' ? extractValueFromCombinedHeaderCell(keyMeta.raw, 'key') : '',
    type: typeMeta && typeMeta.mode === 'prefix' ? extractValueFromCombinedHeaderCell(typeMeta.raw, 'type') : '',
    value: valueMeta && valueMeta.mode === 'prefix' ? extractValueFromCombinedHeaderCell(valueMeta.raw, 'value') : '',
    description: descMeta && descMeta.mode === 'prefix' ? extractValueFromCombinedHeaderCell(descMeta.raw, 'description') : '',
  };
  if (mergedHeaderData.key || mergedHeaderData.type || mergedHeaderData.value || mergedHeaderData.description) {
    rows.push({
      key: mergedHeaderData.key,
      type: normalizeType(mergedHeaderData.type || 'string'),
      value: String(mergedHeaderData.value || ''),
      description: String(mergedHeaderData.description || ''),
    });
  }

  for (let i = headerRowIndex + 1; i < aoa.length; i += 1) {
    const line = aoa[i] || [];
    const key = String(line[keyIdx] || '').trim();
    if (!key || key.startsWith('#')) continue;

    rows.push({
      key,
      type: normalizeType(line[typeIdx]),
      value: String(line[valueIdx] || ''),
      description: descIdx >= 0 ? String(line[descIdx] || '') : '',
    });
  }

  return rows;
}

function setDeep(target, keyPath, value) {
  const parts = String(keyPath)
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!parts.length) throw new Error('빈 key path');

  let cur = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!cur[part] || typeof cur[part] !== 'object' || Array.isArray(cur[part])) {
      cur[part] = {};
    }
    cur = cur[part];
  }

  cur[parts[parts.length - 1]] = value;
}

async function discoverSheetNames(spreadsheetId) {
  const feedUrl = `https://spreadsheets.google.com/feeds/worksheets/${spreadsheetId}/public/basic?alt=json`;
  const json = await fetchJson(feedUrl);
  const entries = (((json || {}).feed || {}).entry) || [];
  const names = [];

  for (let i = 0; i < entries.length; i += 1) {
    const title = entries[i] && entries[i].title && entries[i].title.$t;
    if (title && typeof title === 'string' && title.trim()) {
      names.push(title.trim());
    }
  }

  if (!names.length) {
    throw new Error('시트 목록을 가져오지 못했습니다. 시트를 "링크가 있는 모든 사용자 보기" + "웹에 게시" 상태로 설정하세요.');
  }

  return names;
}

async function fetchSheetCsv(spreadsheetId, sheetName) {
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`;
  const url = `${base}?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  return fetchText(url);
}

async function buildBalanceFromSource(source) {
  const spreadsheetId = source && source.spreadsheetId;
  if (!spreadsheetId) throw new Error('spreadsheetId가 없습니다. 먼저 set-url 실행');

  const sheetNames = (Array.isArray(source.sheetNames) && source.sheetNames.length > 0)
    ? source.sheetNames
    : await discoverSheetNames(spreadsheetId);

  const balance = {};

  for (let i = 0; i < sheetNames.length; i += 1) {
    const sheetName = sheetNames[i];
    if (!sheetName || !sheetName.trim()) continue;
    const category = sheetName.trim();

    const csvText = await fetchSheetCsv(spreadsheetId, sheetName);
    const rows = parseSheetRows(sheetName, csvText);

    const obj = {};
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      try {
        const parsed = parseTypedValue(row.type, row.value);
        setDeep(obj, row.key, parsed);
      } catch (err) {
        throw new Error(`${sheetName}.${row.key}: ${err.message}`);
      }
    }

    balance[category] = obj;
  }

  return balance;
}

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

async function buildOnce(options = {}) {
  const source = options.source || loadSourceConfig();
  if (!source) {
    throw new Error('balance.source.json 이 없습니다. 먼저 set-url 실행');
  }

  const balance = await buildBalanceFromSource(source);
  const output = serializeBalance(balance);
  const nextHash = sha1(output);

  const prev = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8') : '';
  const prevHash = prev ? sha1(prev) : '';
  const changed = nextHash !== prevHash;

  if (changed) {
    fs.writeFileSync(CONFIG_PATH, output, 'utf8');
  }

  return { changed, categoryCount: Object.keys(balance).length, hash: nextHash };
}

function loadBalanceFromConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  const src = fs.readFileSync(CONFIG_PATH, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'balance.config.js' });
  const data = sandbox.window && sandbox.window.GAME_BALANCE;
  return data && typeof data === 'object' ? data : {};
}

function flattenObject(obj, prefix = '', out = []) {
  if (Array.isArray(obj)) {
    out.push([prefix, obj]);
    return out;
  }

  if (!obj || typeof obj !== 'object') {
    out.push([prefix, obj]);
    return out;
  }

  const keys = Object.keys(obj).sort();
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const next = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, next, out);
    } else {
      out.push([next, value]);
    }
  }
  return out;
}

function getByPath(obj, pathValue) {
  const parts = String(pathValue || '')
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean);

  let cur = obj;
  for (let i = 0; i < parts.length; i += 1) {
    if (!cur || typeof cur !== 'object' || !(parts[i] in cur)) {
      return { found: false, value: undefined };
    }
    cur = cur[parts[i]];
  }
  return { found: true, value: cur };
}

function printValue(v) {
  if (typeof v === 'string') return v;
  return JSON.stringify(v, null, 2);
}

async function cmdSetUrl(argv) {
  const raw = argv._[0];
  const spreadsheetId = parseSpreadsheetId(raw);
  const sheetNames = parseSheetNames(argv.sheets);
  const intervalSec = Number(argv.interval || 8);

  const source = {
    type: 'google-sheets',
    spreadsheetId,
    spreadsheetUrl: raw && raw.includes('http') ? raw : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    sheetNames,
    pollIntervalSec: Number.isFinite(intervalSec) && intervalSec >= 2 ? Math.floor(intervalSec) : 8,
    updatedAt: new Date().toISOString(),
  };

  saveSourceConfig(source);
  console.log(`saved: ${SOURCE_PATH}`);
  console.log(`spreadsheetId: ${spreadsheetId}`);

  try {
    const result = await buildOnce({ source });
    console.log(`built: ${result.categoryCount} categories -> balance.config.js`);
  } catch (err) {
    console.warn(`warning: initial build failed: ${err.message}`);
  }
}

async function cmdBuild(argv) {
  let source = loadSourceConfig();

  if (argv.url) {
    const spreadsheetId = parseSpreadsheetId(argv.url);
    source = {
      ...(source || {}),
      type: 'google-sheets',
      spreadsheetId,
      spreadsheetUrl: argv.url,
      sheetNames: argv.sheets ? parseSheetNames(argv.sheets) : ((source && source.sheetNames) || []),
      pollIntervalSec: (source && source.pollIntervalSec) || 8,
      updatedAt: new Date().toISOString(),
    };
    saveSourceConfig(source);
  }

  if (!source) {
    if (fs.existsSync(CONFIG_PATH)) {
      console.warn('warning: source 설정이 없어 기존 balance.config.js를 사용합니다. (balance:set-url로 URL 등록 가능)');
      return;
    }
    throw new Error('source 설정이 없습니다. 먼저 balance:set-url 실행');
  }

  try {
    const result = await buildOnce({ source });
    if (result.changed) {
      console.log(`built: ${result.categoryCount} categories -> balance.config.js (updated)`);
    } else {
      console.log(`built: ${result.categoryCount} categories -> balance.config.js (no change)`);
    }
  } catch (err) {
    if (fs.existsSync(CONFIG_PATH)) {
      console.warn(`warning: build 실패, 기존 balance.config.js 유지: ${err.message}`);
      return;
    }
    throw err;
  }
}

async function cmdWatch(argv) {
  const source = loadSourceConfig();
  if (!source) {
    throw new Error('source 설정이 없습니다. 먼저 balance:set-url 실행');
  }

  const intervalSec = Number(argv.interval || source.pollIntervalSec || 8);
  const pollIntervalMs = Math.max(2000, (Number.isFinite(intervalSec) ? intervalSec : 8) * 1000);

  let running = false;
  let lastHash = '';

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await buildOnce({ source });
      if (result.hash !== lastHash) {
        lastHash = result.hash;
        console.log(`[balance-watch] rebuilt (${result.categoryCount} categories, changed=${result.changed})`);
      }
    } catch (err) {
      console.warn(`[balance-watch] build failed: ${err.message}`);
    } finally {
      running = false;
    }
  };

  console.log(`[balance-watch] source: ${source.spreadsheetId}`);
  console.log(`[balance-watch] interval: ${Math.floor(pollIntervalMs / 1000)}s`);
  await tick();
  setInterval(tick, pollIntervalMs);
}

function cmdList(argv) {
  const prefix = String(argv._[0] || '').trim();
  const balance = loadBalanceFromConfig();
  const rows = flattenObject(balance).filter(([k]) => !prefix || k.startsWith(prefix));
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  for (let i = 0; i < rows.length; i += 1) {
    const [k, v] = rows[i];
    console.log(`${k} = ${printValue(v)}`);
  }
}

function cmdGet(argv) {
  const key = String(argv._[0] || '').trim();
  if (!key) throw new Error('get은 path가 필요합니다. 예: waves.spawnTotalPerWave');
  const balance = loadBalanceFromConfig();
  const result = getByPath(balance, key);
  if (!result.found) throw new Error(`path를 찾을 수 없습니다: ${key}`);
  console.log(printValue(result.value));
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const argv = parseArgs(rest);

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
    return;
  }

  if (cmd === 'set-url') {
    await cmdSetUrl(argv);
    return;
  }
  if (cmd === 'build') {
    await cmdBuild(argv);
    return;
  }
  if (cmd === 'watch') {
    await cmdWatch(argv);
    return;
  }
  if (cmd === 'list') {
    cmdList(argv);
    return;
  }
  if (cmd === 'get') {
    cmdGet(argv);
    return;
  }

  throw new Error(`알 수 없는 명령: ${cmd}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
