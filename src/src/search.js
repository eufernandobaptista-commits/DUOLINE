import { totals } from './rules.js';

export function chooseAIOriginal(s, budget = 2400) {
  const n = s.n, b = Int8Array.from(s.b), banks = s.banks.map(a => a.slice()), sign = s.horizontal === 1 ? 1 : -1;
  const d = new Int16Array(n), er = new Int8Array(n), ec = new Int8Array(n), rows = [], cols = [], empties = [];
  for (let k = 0; k < b.length; k++) {
    let r = Math.floor(k / n), c = k % n;
    rows[k] = r; cols[k] = c; d[r] += b[k]; d[c] -= b[k];
    if (!b[k]) { empties.push(k); if (r !== c) { er[r]++; ec[c]++; } }
  }
  if (!empties.length) return null;

  const started = Date.now(), deadline = started + Math.max(20, budget), TIMEOUT = {};
  let nodes = 0, remaining = empties.length, depthDone = 0;
  let seed = 2166136261;
  for (let k = 0; k < b.length; k++) seed = Math.imul(seed ^ (b[k] + k), 16777619);
  seed ^= s.horizontal;
  function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }

  for (let i = empties.length - 1; i > 0; i--) { let j = Math.floor(random() * (i + 1)); [empties[i], empties[j]] = [empties[j], empties[i]]; }

  let pool = [];
  for (let v = 1; v <= 9; v++) for (let j = 0; j < banks[0][v] + banks[1][v]; j++) pool.push(v);
  const mean = pool.reduce((a, v) => a + v, 0) / pool.length, variance = pool.reduce((a, v) => a + (v - mean) ** 2, 0) / pool.length;
  const low = [0], high = [0];
  for (let i = 1; i <= n; i++) { low[i] = low[i - 1] + (pool[i - 1] || 0); high[i] = high[i - 1] + (pool[pool.length - i] || 0); }

  const rootRemaining = remaining, termCache = new Map();
  function term(delta, x, y) {
    if (!x && !y) return Math.sign(delta);
    if (delta + low[x] - high[y] > 0) return 1;
    if (delta + high[x] - low[y] < 0) return -1;
    let key = (delta + 270) * 4096 + x * 64 + y, cached = termCache.get(key);
    if (cached !== undefined) return cached;
    let t = x + y, imbalance = x - y;
    let spread = Math.sqrt(Math.max(.25, variance * (t - (imbalance * imbalance) / Math.max(1, rootRemaining)) * rootRemaining / Math.max(1, rootRemaining - 1)));
    let value = Math.tanh((delta + mean * imbalance) / (1.15 + 1.35 * spread));
    termCache.set(key, value); return value;
  }

  let positional = 0; for (let i = 0; i < n; i++) positional += term(d[i], er[i], ec[i]);

  function bankSpread(p) {
    let penalty = 0;
    for (let v = 1; v <= 9; v++) {
      let diff = banks[p][v] - banks[1 - p][v];
      penalty += diff < 0 ? Math.abs(diff) * 0.18 : 0;
    }
    return penalty;
  }

  function evaluation() { return positional * sign + (remaining ? 0.08 * (bankSpread(0) - bankSpread(1)) : 0); }
  function checkpoint() { if ((++nodes & 127) === 0 && Date.now() >= deadline) throw TIMEOUT; }
  function estimate(k, v) {
    let r = rows[k], c = cols[k]; if (r === c) return positional;
    return positional - term(d[r], er[r], ec[r]) - term(d[c], er[c], ec[c]) + term(d[r] + v, er[r] - 1, ec[r]) + term(d[c] - v, er[c], ec[c] - 1);
  }

  function apply(m, p) {
    let saved = positional; positional = m.pos === undefined ? estimate(m.k, m.v) : m.pos;
    let r = rows[m.k], c = cols[m.k]; b[m.k] = m.v; banks[p][m.v]--; remaining--;
    if (r !== c) { d[r] += m.v; d[c] -= m.v; er[r]--; ec[c]--; }
    return saved;
  }

  function undo(m, p, saved) {
    let r = rows[m.k], c = cols[m.k]; b[m.k] = 0; banks[p][m.v]++; remaining++;
    if (r !== c) { d[r] -= m.v; d[c] += m.v; er[r]++; ec[c]++; }
    positional = saved;
  }

  const histMoves = s.record?.moves || [];
  const recentOppMoves = histMoves.filter(m => m.jogador === 1).slice(-3);
  const oppRepeatedValue = recentOppMoves.length >= 2 && recentOppMoves.every(m => m.valor === recentOppMoves[0].valor) ? recentOppMoves[0].valor : null;
  const aiLastValue = histMoves.filter(m => m.jogador === 2).slice(-1)[0]?.valor || null;

  function candidates(p, width, exact = false) {
    let list = [], sg = p === 1 ? 1 : -1;
    for (let k of empties) {
      if (b[k]) continue;
      for (let v = 1; v <= 9; v++) {
        if (!banks[p][v]) continue; checkpoint();
        let pos = estimate(k, v);
        let repeatPenalty = 0;
        if (p === 1) {
          if (v === aiLastValue && remaining > 10) repeatPenalty += 0.06;
          if (oppRepeatedValue && v === oppRepeatedValue && remaining > 8) repeatPenalty += 0.08;
          let shortage = banks[0][v] - banks[1][v];
          if (shortage > 1) repeatPenalty += 0.05 * shortage;
        }
        list.push({ k, v, pos, rank: sg * (pos * sign) - repeatPenalty });
      }
    }
    list.sort((a, b) => b.rank - a.rank);
    if (exact || list.length <= width) return list;

    let chosen = [], cellCounts = new Map(), valCounts = new Map();
    const maxPerVal = Math.max(2, Math.ceil(width * 0.35));
    for (let m of list) {
      let cc = cellCounts.get(m.k) || 0, vc = valCounts.get(m.v) || 0;
      if (cc < 2 && vc < maxPerVal) {
        chosen.push(m); cellCounts.set(m.k, cc + 1); valCounts.set(m.v, vc + 1);
        if (chosen.length === width) break;
      }
    }
    if (chosen.length < width) {
      for (let m of list) { if (!chosen.includes(m)) { chosen.push(m); if (chosen.length === width) break; } }
    }
    return chosen;
  }

  const exactLimit = 7, tt = new Map();
  function search(p, depth, alpha, beta) {
    checkpoint(); if (!remaining || !depth) return evaluation();
    let key = null, originalAlpha = alpha, originalBeta = beta;
    if (remaining <= exactLimit) {
      key = p + ':' + depth + ':' + empties.map(k => b[k]).join('') + ':' + banks[0].join('') + ':' + banks[1].join('');
      let hit = tt.get(key);
      if (hit) {
        if (hit.flag === 0) return hit.value;
        if (hit.flag === 1) alpha = Math.max(alpha, hit.value); else beta = Math.min(beta, hit.value);
        if (alpha >= beta) return hit.value;
      }
    }
    const exact = remaining <= exactLimit, width = depth === 1 ? 1 : (remaining < 35 ? 18 : 12);
    let moves = candidates(p, width, exact), best = p === 1 ? -Infinity : Infinity;
    for (let m of moves) {
      let saved = apply(m, p), value;
      try { value = search(1 - p, depth - 1, alpha, beta); } finally { undo(m, p, saved); }
      if (p === 1) { best = Math.max(best, value); alpha = Math.max(alpha, best); }
      else { best = Math.min(best, value); beta = Math.min(beta, best); }
      if (alpha >= beta - 1e-10) break;
    }
    if (key) tt.set(key, { value: best, flag: best <= originalAlpha ? 2 : best >= originalBeta ? 1 : 0 });
    return best;
  }

  let fallback = { k: empties[0], v: banks[1].findIndex((x, i) => i && x > 0) }, roots;
  try { roots = candidates(1, remaining < 35 ? 48 : 32, remaining <= exactLimit); }
  catch (e) { if (e !== TIMEOUT) throw e; return fallback; }
  if (!roots.length) return null;

  let chosen = roots[0], bestScore = chosen.rank; depthDone = 1;
  const maxDepth = remaining <= exactLimit ? remaining : 8;
  for (let depth = 2; depth <= maxDepth; depth++) {
    roots.sort((a, b) => (b.previous ?? b.rank) - (a.previous ?? a.rank));
    let next = chosen, best = -Infinity, completed = 0;
    try {
      for (let m of roots) {
        if (Date.now() >= deadline) throw TIMEOUT;
        let saved = apply(m, 1), value;
        try { value = search(0, depth - 1, best, Infinity); } finally { undo(m, 1, saved); }
        m.next = value; completed++;
        if (value > best + 1e-9) { best = value; next = m; }
      }
      chosen = next; bestScore = best; depthDone = depth;
      for (let m of roots) m.previous = m.next;
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      if (completed) { chosen = next; bestScore = best; } break;
    }
  }
  return { k: chosen.k, v: chosen.v, depth: depthDone, nodes, score: bestScore, exact: remaining <= exactLimit && depthDone === remaining, ms: Date.now() - started };
}

export function chooseAI(s, budget = 2400) {
  const settings = {
    beginner: { time: 100, depth: 1, width: 8, error: .42, noise: .9 },
    easy: { time: 220, depth: 2, width: 10, error: .16, noise: .35 },
    medium: { time: 650, depth: 3, width: 16, error: .03, noise: .08 },
    hard: { time: 1300, depth: 5, width: 24, error: 0, noise: 0 },
    master: { time: 2400, depth: 8, width: 32, error: 0, noise: 0 }
  };
  const cfg = settings[s.aiLevel] || settings.master, style = s.aiStyle || 'standard';
  if (cfg === settings.master && style === 'standard') return chooseAIOriginal(s, budget);

  budget = Math.min(budget, cfg.time);
  const n = s.n, b = Int8Array.from(s.b), banks = s.banks.map(a => a.slice()), sign = s.horizontal === 1 ? 1 : -1;
  const d = new Int16Array(n), er = new Int8Array(n), ec = new Int8Array(n), rows = [], cols = [], empties = [];
  for (let k = 0; k < b.length; k++) {
    let r = Math.floor(k / n), c = k % n;
    rows[k] = r; cols[k] = c; d[r] += b[k]; d[c] -= b[k];
    if (!b[k]) { empties.push(k); if (r !== c) { er[r]++; ec[c]++; } }
  }
  if (!empties.length) return null;

  const started = Date.now(), deadline = started + Math.max(20, budget), TIMEOUT = {};
  let nodes = 0, remaining = empties.length, depthDone = 0;
  let seed = 2166136261;
  for (let k = 0; k < b.length; k++) seed = Math.imul(seed ^ (b[k] + k), 16777619);
  seed ^= s.horizontal;
  function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }

  for (let i = empties.length - 1; i > 0; i--) { let j = Math.floor(random() * (i + 1)); [empties[i], empties[j]] = [empties[j], empties[i]]; }

  let pool = [];
  for (let v = 1; v <= 9; v++) for (let j = 0; j < banks[0][v] + banks[1][v]; j++) pool.push(v);
  const mean = pool.reduce((a, v) => a + v, 0) / pool.length, variance = pool.reduce((a, v) => a + (v - mean) ** 2, 0) / pool.length;
  const low = [0], high = [0];
  for (let i = 1; i <= n; i++) { low[i] = low[i - 1] + (pool[i - 1] || 0); high[i] = high[i - 1] + (pool[pool.length - i] || 0); }

  const weights = Array.from(d, (delta, i) => {
    const lead = delta * sign, space = er[i] + ec[i];
    if (style === 'defensive') return lead > 0 ? 1.8 + 0.7 / (1 + lead / 9) : .7;
    if (style === 'aggressive') return lead < 0 ? 2.1 : .65;
    if (style === 'opportunist') return .5 + 2 / (1 + Math.abs(lead) / 9);
    if (style === 'expansive') return .5 + 1.8 * space / Math.max(1, 2 * (n - 1));
    if (style === 'positional') return .65 + 1.8 * (1 - space / Math.max(1, 2 * (n - 1)));
    if (style === 'unpredictable') return .4 + Math.random() * 1.8;
    return 1;
  });

  const resourceWeight = style === 'economist' ? .38 : .12;
  const rootRemaining = remaining, termCache = new Map();
  function rawTerm(delta, x, y) {
    if (!x && !y) return Math.sign(delta);
    if (delta + low[x] - high[y] > 0) return 1;
    if (delta + high[x] - low[y] < 0) return -1;
    let key = (delta + 270) * 4096 + x * 64 + y, cached = termCache.get(key);
    if (cached !== undefined) return cached;
    let t = x + y, imbalance = x - y;
    let spread = Math.sqrt(Math.max(.25, variance * (t - (imbalance * imbalance) / Math.max(1, rootRemaining)) * rootRemaining / Math.max(1, rootRemaining - 1)));
    let value = Math.tanh((delta + mean * imbalance) / (1.15 + 1.35 * spread));
    termCache.set(key, value); return value;
  }
  function term(delta, x, y, i) { return rawTerm(delta, x, y) * (weights[i] || 1); }

  let positional = 0; for (let i = 0; i < n; i++) positional += term(d[i], er[i], ec[i], i);
  function bankSpread(p) {
    let penalty = 0;
    for (let v = 1; v <= 9; v++) {
      let diff = banks[p][v] - banks[1 - p][v];
      penalty += diff < 0 ? Math.abs(diff) * 0.18 : 0;
    }
    return penalty;
  }

  function evaluation() { return (!remaining ? Array.from(d).reduce((a, v) => a + Math.sign(v), 0) * sign : positional * sign) + (remaining ? resourceWeight * (bankSpread(0) - bankSpread(1)) : 0); }
  function checkpoint() { if ((++nodes & 127) === 0 && Date.now() >= deadline) throw TIMEOUT; }
  function estimate(k, v) {
    let r = rows[k], c = cols[k]; if (r === c) return positional;
    return positional - term(d[r], er[r], ec[r], r) - term(d[c], er[c], ec[c], c) + term(d[r] + v, er[r] - 1, ec[r], r) + term(d[c] - v, er[c], ec[c] - 1, c);
  }

  function apply(m, p) {
    let saved = positional; positional = m.pos === undefined ? estimate(m.k, m.v) : m.pos;
    let r = rows[m.k], c = cols[m.k]; b[m.k] = m.v; banks[p][m.v]--; remaining--;
    if (r !== c) { d[r] += m.v; d[c] -= m.v; er[r]--; ec[c]--; }
    return saved;
  }

  function undo(m, p, saved) {
    let r = rows[m.k], c = cols[m.k]; b[m.k] = 0; banks[p][m.v]++; remaining++;
    if (r !== c) { d[r] -= m.v; d[c] += m.v; er[r]++; ec[c]++; }
    positional = saved;
  }

  const histMoves = s.record?.moves || [];
  const recentOppMoves = histMoves.filter(m => m.jogador === 1).slice(-3);
  const oppRepeatedValue = recentOppMoves.length >= 2 && recentOppMoves.every(m => m.valor === recentOppMoves[0].valor) ? recentOppMoves[0].valor : null;
  const aiLastValue = histMoves.filter(m => m.jogador === 2).slice(-1)[0]?.valor || null;

  function candidates(p, width, exact = false) {
    let list = [], sg = p === 1 ? 1 : -1;
    for (let k of empties) {
      if (b[k]) continue;
      for (let v = 1; v <= 9; v++) {
        if (!banks[p][v]) continue; checkpoint();
        let pos = estimate(k, v);
        let repeatPenalty = 0;
        if (p === 1) {
          if (v === aiLastValue && remaining > 10) repeatPenalty += 0.07;
          if (oppRepeatedValue && v === oppRepeatedValue && remaining > 8) repeatPenalty += 0.09;
          let shortage = banks[0][v] - banks[1][v];
          if (shortage > 1) repeatPenalty += 0.06 * shortage;
        }
        list.push({ k, v, pos, rank: sg * (pos * sign) - repeatPenalty + (p === 1 ? cfg.noise * (Math.random() - .5) : 0) });
      }
    }
    list.sort((a, b) => b.rank - a.rank);
    if (exact || list.length <= width) return list;

    let chosen = [], cellCounts = new Map(), valCounts = new Map();
    const maxPerVal = Math.max(2, Math.ceil(width * 0.35));
    for (let m of list) {
      let cc = cellCounts.get(m.k) || 0, vc = valCounts.get(m.v) || 0;
      if (cc < 2 && vc < maxPerVal) {
        chosen.push(m); cellCounts.set(m.k, cc + 1); valCounts.set(m.v, vc + 1);
        if (chosen.length === width) break;
      }
    }
    if (chosen.length < width) {
      for (let m of list) { if (!chosen.includes(m)) { chosen.push(m); if (chosen.length === width) break; } }
    }
    return chosen;
  }

  const exactLimit = cfg === settings.master ? 7 : 0, tt = new Map();
  function search(p, depth, alpha, beta) {
    checkpoint(); if (!remaining || !depth) return evaluation();
    let key = null, originalAlpha = alpha, originalBeta = beta;
    if (remaining <= exactLimit) {
      key = p + ':' + depth + ':' + empties.map(k => b[k]).join('') + ':' + banks[0].join('') + ':' + banks[1].join('');
      let hit = tt.get(key);
      if (hit) {
        if (hit.flag === 0) return hit.value;
        if (hit.flag === 1) alpha = Math.max(alpha, hit.value); else beta = Math.min(beta, hit.value);
        if (alpha >= beta) return hit.value;
      }
    }
    const exact = remaining <= exactLimit, width = depth === 1 ? 1 : Math.min(cfg.width, remaining < 35 ? 18 : 12);
    let moves = candidates(p, width, exact), best = p === 1 ? -Infinity : Infinity;
    for (let m of moves) {
      let saved = apply(m, p), value;
      try { value = search(1 - p, depth - 1, alpha, beta); } finally { undo(m, p, saved); }
      if (p === 1) { best = Math.max(best, value); alpha = Math.max(alpha, best); }
      else { best = Math.min(best, value); beta = Math.min(beta, best); }
      if (alpha >= beta - 1e-10) break;
    }
    if (key) tt.set(key, { value: best, flag: best <= originalAlpha ? 2 : best >= originalBeta ? 1 : 0 });
    return best;
  }

  if (Math.random() < cfg.error) {
    let k = empties[Math.floor(Math.random() * empties.length)], values = [];
    for (let v = 1; v <= 9; v++) if (banks[1][v]) values.push(v);
    return { k, v: values[Math.floor(Math.random() * values.length)] };
  }

  let fallback = { k: empties[0], v: banks[1].findIndex((x, i) => i && x > 0) }, roots;
  try { roots = candidates(1, Math.min(cfg.width, remaining < 35 ? 48 : 32), remaining <= exactLimit); }
  catch (e) { if (e !== TIMEOUT) throw e; return fallback; }
  if (!roots.length) return null;

  let chosen = roots[0], bestScore = chosen.rank; depthDone = 1;
  const maxDepth = remaining <= exactLimit ? remaining : cfg.depth;
  for (let depth = 2; depth <= maxDepth; depth++) {
    roots.sort((a, b) => (b.previous ?? b.rank) - (a.previous ?? a.rank));
    let next = chosen, best = -Infinity, completed = 0;
    try {
      for (let m of roots) {
        if (Date.now() >= deadline) throw TIMEOUT;
        let saved = apply(m, 1), value;
        try { value = search(0, depth - 1, best, Infinity); } finally { undo(m, 1, saved); }
        m.next = value; completed++;
        if (value > best + 1e-9) { best = value; next = m; }
      }
      chosen = next; bestScore = best; depthDone = depth;
      for (let m of roots) m.previous = m.next;
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      if (completed) { chosen = next; bestScore = best; } break;
    }
  }
  return { k: chosen.k, v: chosen.v, depth: depthDone, nodes, score: bestScore, exact: remaining <= exactLimit && depthDone === remaining, ms: Date.now() - started };
}
