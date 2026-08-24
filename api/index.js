
// ─────────────────────────────────────────────────────────────
//  홍열이네 설문 데이터 저장용 API (Vercel Serverless Function)
//  화면은 프로젝트 루트의 index.html이 담당하고, 이 파일은 저장/집계만 담당합니다.
//  외부 npm 패키지 없이 Upstash Redis(Vercel KV) REST API를 fetch로 직접 호출합니다.
//  → package.json 없이도 배포됩니다.
// ─────────────────────────────────────────────────────────────

const COUNT_KEY = 'hongyeol:count';
const TALLY_KEY = 'hongyeol:tally';
const NICK_KEY = 'hongyeol:nicknames';

// Vercel 프로젝트 > Storage > KV 를 연결하면 아래 두 값이 자동으로 주입됩니다.
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// Vercel 환경변수에 ADMIN_CODE 를 추가하면 그 값을 쓰고, 없으면 기본값 1234 를 씁니다.
const ADMIN_CODE = process.env.ADMIN_CODE || '1234';

// 질문별 선택지 개수 (1~4번 질문: 5단계, 5번 질문: 4단계)
const QUESTION_OPTION_COUNTS = [5, 5, 5, 5, 4];

function emptyTally() {
  return QUESTION_OPTION_COUNTS.map((n) => new Array(n).fill(0));
}

async function redis(command) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error('kv error: ' + r.status);
  const data = await r.json();
  return data.result;
}

async function kvGetJSON(key, fallback) {
  const raw = await redis(['GET', key]);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}
async function kvSetJSON(key, value) {
  await redis(['SET', key, JSON.stringify(value)]);
}
async function kvGetNumber(key) {
  const raw = await redis(['GET', key]);
  return raw ? parseInt(raw, 10) : 0;
}
async function kvSetNumber(key, value) {
  await redis(['SET', key, String(value)]);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const count = await kvGetNumber(COUNT_KEY);
      const code = req.query.code;
      const isAdmin = code && code === ADMIN_CODE;

      if (!isAdmin) {
        return res.status(200).json({ count });
      }

      const tally = await kvGetJSON(TALLY_KEY, emptyTally());
      const nicknames = await kvGetJSON(NICK_KEY, []);
      return res.status(200).json({ count, tally, nicknames });
    }

    if (req.method === 'POST') {
      const { answers, nickname } = req.body || {};
      if (
        !Array.isArray(answers) ||
        answers.length !== QUESTION_OPTION_COUNTS.length ||
        !nickname ||
        typeof nickname !== 'string'
      ) {
        return res.status(400).json({ error: 'invalid payload' });
      }

      const tally = await kvGetJSON(TALLY_KEY, emptyTally());
      answers.forEach((idx, qi) => {
        if (Number.isInteger(idx) && idx >= 0 && idx < QUESTION_OPTION_COUNTS[qi]) {
          tally[qi][idx] = (tally[qi][idx] || 0) + 1;
        }
      });

      const count = (await kvGetNumber(COUNT_KEY)) + 1;

      const nicknames = await kvGetJSON(NICK_KEY, []);
      nicknames.push({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        nickname: nickname.slice(0, 10),
        time: new Date().toISOString(),
        redeemed: false,
        redeemedAt: null,
      });
      if (nicknames.length > 500) nicknames.splice(0, nicknames.length - 500);

      await kvSetNumber(COUNT_KEY, count);
      await kvSetJSON(TALLY_KEY, tally);
      await kvSetJSON(NICK_KEY, nicknames);

      return res.status(200).json({ count });
    }

    if (req.method === 'PATCH') {
      const { id, code } = req.body || {};
      if (code !== ADMIN_CODE) return res.status(401).json({ error: 'unauthorized' });

      const nicknames = await kvGetJSON(NICK_KEY, []);
      const idx = nicknames.findIndex((n) => n.id === id);
      if (idx === -1) return res.status(404).json({ error: 'not found' });

      nicknames[idx].redeemed = true;
      nicknames[idx].redeemedAt = new Date().toISOString();
      await kvSetJSON(NICK_KEY, nicknames);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
