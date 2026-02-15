const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8787);
const ROOT_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, 'leaderboard.json');
const MAX_BODY_SIZE = 64 * 1024;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function makeDefaultDb() {
  return { players: {} };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;

  const allowAll = ALLOWED_ORIGINS.includes('*');
  const allowed = allowAll || ALLOWED_ORIGINS.includes(origin);
  if (!allowed) return;

  res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin);
  if (!allowAll) {
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function normalizePlayerId(raw) {
  if (typeof raw !== 'string') return '';
  const id = raw.trim().slice(0, 16);
  if (id.length < 2) return '';
  if (/[\u0000-\u001F]/.test(id)) return '';
  return id;
}

function compareScoresDesc(a, b) {
  if ((b.wave || 0) !== (a.wave || 0)) return (b.wave || 0) - (a.wave || 0);
  if ((b.kills || 0) !== (a.kills || 0)) return (b.kills || 0) - (a.kills || 0);
  if ((b.minerals || 0) !== (a.minerals || 0)) return (b.minerals || 0) - (a.minerals || 0);
  return (b.timeSec || 0) - (a.timeSec || 0);
}

function buildRankings(db) {
  const rows = [];
  const players = db.players || {};
  const keys = Object.keys(players);
  for (let i = 0; i < keys.length; i += 1) {
    const player = players[keys[i]];
    if (!player || !player.bestScore) continue;
    rows.push({
      playerId: player.playerId,
      timeSec: toInt(player.bestScore.timeSec),
      wave: toInt(player.bestScore.wave, 1),
      kills: toInt(player.bestScore.kills),
      minerals: toInt(player.bestScore.minerals),
      updatedAt: toInt(player.bestScore.updatedAt),
    });
  }
  rows.sort(compareScoresDesc);
  return rows.slice(0, 100);
}

async function ensureDbFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch (err) {
    await fs.writeFile(DATA_FILE, JSON.stringify(makeDefaultDb(), null, 2), 'utf8');
  }
}

async function readDb() {
  await ensureDbFile();
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid db');
    if (!parsed.players || typeof parsed.players !== 'object') {
      parsed.players = {};
    }
    return parsed;
  } catch (err) {
    const fallback = makeDefaultDb();
    await fs.writeFile(DATA_FILE, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

async function writeDb(db) {
  await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

let dbQueue = Promise.resolve();
function withDb(mutator) {
  const runner = async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  };
  dbQueue = dbQueue.then(runner, runner);
  return dbQueue;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new HttpError(413, '요청 크기가 너무 큽니다', 'BODY_TOO_LARGE'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new HttpError(400, 'JSON 형식이 올바르지 않습니다', 'BAD_JSON'));
      }
    });
    req.on('error', () => reject(new HttpError(400, '요청을 읽을 수 없습니다', 'BAD_REQUEST')));
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/rankings' && req.method === 'GET') {
    const db = await readDb();
    sendJson(res, 200, { ok: true, rankings: buildRankings(db) });
    return;
  }

  if (pathname === '/api/register' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const playerId = normalizePlayerId(body.playerId);
    if (!playerId) {
      throw new HttpError(400, '아이디 형식이 올바르지 않습니다 (2~16자)', 'INVALID_ID');
    }

    const result = await withDb(async (db) => {
      const players = db.players || (db.players = {});
      if (players[playerId]) {
        throw new HttpError(409, '이미 존재하는 아이디입니다', 'ID_EXISTS');
      }
      players[playerId] = {
        playerId,
        createdAt: Date.now(),
        bestScore: null,
        lastPlayedAt: 0,
      };
      return { ok: true, playerId };
    });

    sendJson(res, 200, result);
    return;
  }

  if (pathname === '/api/score' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const playerId = normalizePlayerId(body.playerId);
    if (!playerId) {
      throw new HttpError(400, '아이디 형식이 올바르지 않습니다', 'INVALID_ID');
    }

    const payload = {
      playerId,
      timeSec: toInt(body.timeSec),
      wave: Math.max(1, toInt(body.wave, 1)),
      kills: toInt(body.kills),
      minerals: toInt(body.minerals),
      updatedAt: Date.now(),
    };

    const result = await withDb(async (db) => {
      const players = db.players || (db.players = {});
      const player = players[playerId];
      if (!player) {
        throw new HttpError(404, '등록되지 않은 아이디입니다', 'ID_NOT_FOUND');
      }

      const prev = player.bestScore;
      const updated = !prev || compareScoresDesc(payload, prev) < 0;
      if (updated) {
        player.bestScore = payload;
      }
      player.lastPlayedAt = Date.now();
      return { ok: true, updated };
    });

    sendJson(res, 200, result);
    return;
  }

  throw new HttpError(404, 'API 경로를 찾을 수 없습니다', 'NOT_FOUND');
}

async function serveStatic(req, res, pathname) {
  let requestPath = pathname;
  if (requestPath === '/') {
    requestPath = '/index.html';
  }

  const decoded = decodeURIComponent(requestPath);
  const filePath = path.normalize(path.join(ROOT_DIR, decoded));
  if (!filePath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { ok: false, error: '접근이 허용되지 않습니다', code: 'FORBIDDEN' });
    return;
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    sendJson(res, 404, { ok: false, error: '파일을 찾을 수 없습니다', code: 'NOT_FOUND' });
    return;
  }

  let finalPath = filePath;
  if (stat.isDirectory()) {
    finalPath = path.join(filePath, 'index.html');
  }

  try {
    const data = await fs.readFile(finalPath);
    const ext = path.extname(finalPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  } catch (err) {
    sendJson(res, 404, { ok: false, error: '파일을 찾을 수 없습니다', code: 'NOT_FOUND' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    applyCorsHeaders(req, res);

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const code = err instanceof HttpError ? err.code : 'INTERNAL_ERROR';
    const message = err instanceof HttpError ? err.message : '서버 오류가 발생했습니다';
    sendJson(res, status, { ok: false, error: message, code });
  }
});

server.on('error', (err) => {
  console.error(`[Mineral Survivor] 서버 시작 실패: ${err.message}`);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`[Mineral Survivor] http://${HOST}:${PORT}`);
});
