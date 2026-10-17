'use strict';
import { inventory, totals, score } from './rules.js';
import { chooseAIOriginal, chooseAI } from './search.js';

const $ = id => document.getElementById(id);
let S = null, selected = 5, tool = 'pen', zoom = 1, focus = -1, worker = null, thinking = false, serial = 0;
const COLORS = ['black', 'blue', 'red'];
const AI_LEVELS = {
  beginner: ['Iniciante', 'Busca de uma jogada, escolhas variadas e erros frequentes.'],
  easy: ['Fácil', 'Busca curta, menos alternativas e erros ocasionais.'],
  medium: ['Intermediário', 'Prevê respostas e comete poucos erros deliberados.'],
  hard: ['Difícil', 'Busca mais profunda, sem erros deliberados.'],
  master: ['Mestre · IA original', 'Força original preservada ao selecionar o estilo Padrão.']
};
const AI_STYLES = {
  standard: ['Padrão', 'Equilibra disputas, respostas adversárias e reservas, como na IA original.'],
  defensive: ['Defensivo', 'Prioriza proteger disputas em que está à frente, sobretudo vantagens pequenas.'],
  aggressive: ['Agressivo', 'Prioriza atacar disputas em que está atrás e virar o placar.'],
  opportunist: ['Oportunista', 'Concentra esforço nas disputas próximas do empate.'],
  expansive: ['Expansionista', 'Prefere disputar índices com mais casas vazias e espaço para crescer.'],
  positional: ['Posicional', 'Prioriza índices com poucas casas vazias, buscando consolidar pontos.'],
  economist: ['Econômico', 'Valoriza mais a preservação de números extremos na reserva para o futuro.'],
  unpredictable: ['Imprevisível', 'Varia suas prioridades entre as disputas a cada turno.']
};

function normalizeAI(s) {
  if (!Object.hasOwn(AI_LEVELS, s.aiLevel)) s.aiLevel = 'master';
  if (!Object.hasOwn(AI_STYLES, s.aiStyle)) s.aiStyle = 'standard';
  return s;
}

function aiHelp(prefix) {
  $(prefix + 'Help').textContent = AI_LEVELS[$(prefix + 'Level').value][1] + ' ' + AI_STYLES[$(prefix + 'Style').value][1];
}

for (const prefix of ['setupAI', 'liveAI']) {
  $(prefix + 'Level').value = 'master';
  $(prefix + 'Style').value = 'standard';
  for (const key of ['Level', 'Style']) $(prefix + key).onchange = () => aiHelp(prefix);
  aiHelp(prefix);
}

$('aiSettingsBtn').onclick = () => {
  if (!S || S.mode !== 'ai') { message('Escolha Você × IA em Novo jogo para configurar o adversário.'); return; }
  if (review) { message('Volte à partida para alterar o perfil da IA.'); return; }
  normalizeAI(S);
  $('liveAILevel').value = S.aiLevel;
  $('liveAIStyle').value = S.aiStyle;
  aiHelp('liveAI');
  $('aiSettings').showModal();
};

$('closeAI').onclick = () => $('aiSettings').close();
$('applyAI').onclick = () => {
  if (!S || review || S.activity) return;
  settleClock(); stopAI();
  S.aiLevel = $('liveAILevel').value;
  S.aiStyle = $('liveAIStyle').value;
  if (S.seats) {
    const p = S.seats.findIndex(x => !x.human);
    if (p >= 0) { S.seats[p].level = S.aiLevel; S.seats[p].style = S.aiStyle; }
  }
  $('aiSettings').close(); render(); persist(); aiTurn();
};

function rand() { return crypto.getRandomValues(new Uint8Array(4))[0] / 4294967296; }
function message(t) { $('toast').textContent = t; }
function stopAI() { serial++; if (worker) worker.terminate(); worker = null; thinking = false; }

function setTheme(t) {
  document.body.className = t === 'light' ? '' : t + '-theme';
  try { localStorage.setItem('conquista-theme', t); } catch (e) {}
}
$('theme').onchange = e => setTheme(e.target.value);

for (let n = 8; n <= 30; n++) $('size').add(new Option(n + '×' + n, n));
$('size').value = 19;

function modeFields() {
  const spec = $('mode').value === 'spectator';
  $('localNameField').hidden = $('mode').value !== 'local';
  $('aiSetupFields').hidden = $('mode').value === 'local';
  $('spectatorSettings').hidden = !spec;
  $('opponentNameField').hidden = $('mode').value === 'local';
  $('color2Field').style.display = $('mode').value === 'local' ? 'flex' : 'none';
}
$('mode').onchange = modeFields; modeFields();

$('new').onclick = () => { $('setupError').textContent = ''; $('setup').showModal(); };
$('cancel').onclick = () => $('setup').close();
$('rulesBtn').onclick = () => $('rules').showModal();

function name(p) { return esc(seats(S)[p].name); }
function axis(p) { return p === S.horizontal ? 'H · Horizontal' : 'V · Vertical'; }

function build() {
  let g = $('grid');
  g.innerHTML = '';
  g.style.gridTemplateColumns = `repeat(${S.n + 2},var(--cell-size))`;
  for (let r = -1; r <= S.n; r++) {
    for (let c = -1; c <= S.n; c++) {
      let d = document.createElement('button');
      d.className = 'cell';
      if (r < 0 || r === S.n || c < 0 || c === S.n) {
        d.classList.add('hint');
        if ((r < 0 || r === S.n) && (c < 0 || c === S.n)) {
          d.textContent = '↘'; d.tabIndex = -1; d.disabled = true;
        } else {
          d.dataset.axis = r < 0 || r === S.n ? 'V' : 'H';
          d.dataset.index = d.dataset.axis === 'V' ? c : r;
          d.onclick = () => {
            let i = +d.dataset.index;
            focus = focus === i ? -1 : i;
            paint();
            let q = score(S);
            message(`Disputa ${i + 1}: linha ${q.R[i]} × coluna ${q.C[i]}.`);
          };
        }
      } else {
        let k = r * S.n + c;
        d.dataset.k = k;
        d.onclick = () => clickCell(k);
      }
      g.appendChild(d);
    }
  }
  fit();
}

function fit() {
  if (!S) return;
  let aw = innerWidth - 30, ah = innerHeight - document.querySelector('.header').offsetHeight - 40;
  if (innerWidth > 900) { aw -= S.n + 3; ah -= S.n + 3; }
  let base = Math.max(8, Math.min(Math.floor(aw / (S.n + 2)), Math.floor(ah / (S.n + 2))));
  document.documentElement.style.setProperty('--cell-size', Math.max(8, Math.round(base * zoom)) + 'px');
  $('zoomLabel').textContent = Math.round(zoom * 100) + '%';
}

function compactPanel(folded) {
  const header = document.querySelector('.header');
  header.classList.toggle('compact-panel', folded);
  $('compactPanel').textContent = folded ? '↓ Expandir painel' : '↑ Recolher painel';
  $('compactPanel').setAttribute('aria-expanded', String(!folded));
  $('compactPanel').title = folded ? 'Mostrar todas as informações' : 'Recolher as informações para liberar espaço para o tabuleiro';
  try { localStorage.setItem('conquista-compact-panel', String(folded)); } catch (e) {}
  if (innerWidth > 900) requestAnimationFrame(fit);
}
$('compactPanel').onclick = () => compactPanel(!document.querySelector('.header').classList.contains('compact-panel'));
try { compactPanel(localStorage.getItem('conquista-compact-panel') === 'true'); } catch (e) {}
window.addEventListener('resize', fit);
$('less').onclick = () => { zoom = Math.max(.5, zoom - .25); fit(); };
$('more').onclick = () => { zoom = Math.min(5, zoom + .25); fit(); };
$('fit').onclick = () => { zoom = 1; fit(); };

function paint() {
  if (!S) return;
  let q = score(S);
  for (let d of $('grid').children) {
    if (d.dataset.k !== undefined) {
      let k = +d.dataset.k, r = Math.floor(k / S.n), c = k % S.n;
      d.className = 'cell' + (S.owners[k] === 2 ? ' neutral' : S.owners[k] >= 0 ? ' ' + S.colors[S.owners[k]] : '') + (S.circles.includes(k) ? ' is-circled' : '') + (k === S.last ? ' last' : '') + (focus >= 0 && (r === focus || c === focus) ? ' focus-line' : '');
      d.textContent = S.b[k] || '';
      d.setAttribute('aria-label', `Linha ${r + 1}, coluna ${c + 1}: ${S.b[k] || 'vazia'}`);
      d.title = `L${r + 1} · C${c + 1}${S.owners[k] >= 0 && S.owners[k] < 2 ? ' · ' + name(S.owners[k]) : ''}`;
    } else if (d.dataset.axis) {
      let i = +d.dataset.index, h = d.dataset.axis === 'H';
      d.textContent = h ? q.R[i] : q.C[i];
      d.title = `${h ? 'Linha' : 'Coluna'} ${i + 1}: ${d.textContent} · adversária: ${h ? q.C[i] : q.R[i]}`;
      d.setAttribute('aria-label', d.title);
      d.classList.toggle('winning', h ? q.R[i] > q.C[i] : q.C[i] > q.R[i]);
      d.classList.toggle('chosen', focus === i);
    }
  }
}

function render() {
  if (!S) return;
  normalizeAI(S);
  $('aiSettingsBtn').disabled = S.mode !== 'ai' || !!review || spectator(S) || !!S.activity;
  $('aiSettingsBtn').textContent = S.mode === 'ai' ? 'IA: ' + AI_LEVELS[S.aiLevel][0] + ' · ' + AI_STYLES[S.aiStyle][0] : 'Perfil da IA';
  let q = score(S);
  $('players').innerHTML = [0, 1].map(p => `<div class="player ${!S.done && S.turn === p ? 'turn' : ''}"><b class="${S.colors[p]}">${name(p)}</b> · ${axis(p)} · <b>${p === S.horizontal ? q.h : q.v} pontos</b></div>`).join('');
  $('status').textContent = review ? `Revisão · ${S.moves}/${review.saved.moves} jogadas · H ${q.h} × V ${q.v}` : S.done ? result() : S.paused ? 'Partida pausada · clique em Continuar' : `${thinking ? 'IA pensando…' : 'Vez de ' + name(S.turn) + ' · ' + axis(S.turn)} | ${S.n}×${S.n} | ${S.moves}/${Math.floor(S.n * S.n / 2) * 2} jogadas | Placar provisório`;
  if (!S.banks[S.turn][selected]) selected = S.banks[S.turn].findIndex((x, i) => i && x > 0);
  $('bank').innerHTML = '';
  for (let v = 1; v <= 9; v++) {
    let d = document.createElement('button');
    d.className = `piece ${S.colors[S.turn]} ${selected === v ? 'active' : ''}`;
    d.innerHTML = `${v}<small>×${S.banks[S.turn][v]}</small>`;
    d.disabled = !!review || S.done || thinking || !S.banks[S.turn][v] || S.paused || spectator(S) || isBot(S, S.turn);
    d.setAttribute('aria-label', `Número ${v}, ${S.banks[S.turn][v]} restantes`);
    d.onclick = () => { selected = v; setTool('pen'); render(); };
    $('bank').appendChild(d);
  }
  $('reserves').innerHTML = [0, 1].map(p => `<p><b class="${S.colors[p]}">${name(p)}</b>: ${S.banks[p].slice(1).map((x, i) => `${i + 1}: ${x}`).join(' · ')}</p>`).join('');
  $('pauseGame').disabled = !!review || S.done;
  $('pauseGame').textContent = S.paused ? '▶ Continuar' : 'Ⅱ Pausar';
  $('arenaContext').textContent = S.activity?.type === 'campaign' ? 'Campanha · etapa ' + (S.activity.stage + 1) : S.activity?.type === 'tournament' ? 'Torneio · partida ' + (S.activity.match + 1) : spectator(S) ? 'Espectador · 1 jogada a cada 7 segundos' : 'Partida livre';
  $('nextChallenge').hidden = !S.done || !S.activity;
  $('nextChallenge').textContent = S.activity?.type === 'campaign' ? 'Ver campanha' : 'Ver torneio';
  paint(); updateReview(); clockPaint();
  if (NET.active) netPaint();
}

function setTool(t) {
  tool = t;
  for (let x of ['pen', 'circle', 'erase']) $(x).classList.toggle('active', x === t);
}
for (let t of ['pen', 'circle', 'erase']) $(t).onclick = () => setTool(t);
$('clear').onclick = () => { if (S && !review) { S.circles = []; paint(); persist(); } };

function clickCell(k) {
  if (!S || review) return;
  if (NET.active && tool === 'pen') {
    if (S.b[k]) { message('Casa ocupada.'); return; }
    netMove(k, selected);
    return;
  }
  if ((S.paused || isBot(S, S.turn)) && tool === 'pen') return;
  if (tool !== 'pen') {
    let i = S.circles.indexOf(k);
    if (i >= 0) S.circles.splice(i, 1);
    else if (tool === 'circle') S.circles.push(k);
    paint(); persist(); return;
  }
  if (thinking || S.done) return;
  if (S.b[k]) { message('Casa ocupada. Escolha uma casa vazia.'); return; }
  move(k, selected);
}

function move(k, v) {
  if (NET.active) return netMove(k, v);
  settleClock();
  if (!S || S.done || S.paused || review || S.b[k] || !Number.isInteger(v) || v < 1 || v > 9 || !S.banks[S.turn][v]) return false;
  const p = S.turn;
  S.b[k] = v; S.owners[k] = p; S.banks[p][v]--; S.moves++;
  S.record.moves.push({ numero: S.moves, jogador: p + 1, valor: v, linha: Math.floor(k / S.n) + 1, coluna: k % S.n + 1 });
  S.last = k; S.done = S.moves === Math.floor(S.n * S.n / 2) * 2;
  const c = S.clock?.players[p];
  if (c && c.main <= 0 && c.periods > 0) c.extra = 60000;
  clockStamp = Date.now();
  if (!S.done) S.turn = 1 - S.turn;
  message(S.done ? 'Partida encerrada. Abra “Disputas” para ver o resultado detalhado.' : `${name(S.owners[k])} colocou ${v} em L${Math.floor(k / S.n) + 1}, C${k % S.n + 1}.`);
  if (S.done) onFinish();
  render(); persist();
  if (S.done) showDuels();
  aiTurn();
  return true;
}

function result() {
  if (NET.active && NET.room?.end && NET.room.end.reason !== 'board') {
    return cleanName(seats(S)[1 - NET.room.end.loser].name) + ' venceu por ' + (NET.room.end.reason === 'timeout' ? 'tempo' : 'desistência') + '!';
  }
  if (S.ending) return cleanName(seats(S)[S.ending.winner].name) + ' venceu por ' + (S.ending.reason === 'resign' ? 'desistência' : 'tempo') + '!';
  let q = score(S);
  return q.h === q.v ? `Empate final: ${q.h} × ${q.v}.` : `${name(q.h > q.v ? S.horizontal : 1 - S.horizontal)} venceu por ${Math.max(q.h, q.v)} × ${Math.min(q.h, q.v)}!`;
}

function showDuels() {
  if (!S) return;
  let q = score(S);
  $('duelsTitle').textContent = S.done ? result() : 'Disputas · placar provisório';
  $('duelsBody').innerHTML = '<table><thead><tr><th>Índice</th><th>Horizontal</th><th>Vertical</th><th>Ponto para</th></tr></thead><tbody>' + q.R.map((x, i) => `<tr><td>${i + 1}</td><td>${x}</td><td>${q.C[i]}</td><td>${x === q.C[i] ? 'Empate' : name(x > q.C[i] ? S.horizontal : 1 - S.horizontal)}</td></tr>`).join('') + '</tbody></table>';
  $('duels').showModal();
}
$('duelsBtn').onclick = showDuels;

function persist() {
  if (NET.active) return;
  try { localStorage.setItem('conquista-save-v1', JSON.stringify(review ? review.saved : S)); } catch (e) { message('Salvamento automático indisponível. Use “Salvar partida”.'); }
  rememberTournament();
}

$('save').onclick = () => {
  if (!S) return;
  let u = URL.createObjectURL(new Blob([JSON.stringify(exportGame(review ? review.saved : S), null, 2)], { type: 'application/json' }));
  let a = document.createElement('a'); a.href = u; a.download = 'Conquista-de-Linhas-partida.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
  message('Cópia da partida exportada.');
};

function validatePosition(s) {
  if (s) normalizeAI(s);
  if (!s || s.version !== 1 || !Number.isInteger(s.n) || s.n < 8 || s.n > 30 || !['ai', 'local'].includes(s.mode) || ![0, 1].includes(s.turn) || ![0, 1].includes(s.horizontal) || !Array.isArray(s.colors) || s.colors.length !== 2 || !s.colors.every(c => COLORS.includes(c)) || s.colors[0] === s.colors[1]) throw Error('Formato inválido');
  let len = s.n * s.n, used = [Array(10).fill(0), Array(10).fill(0)], count = 0;
  if (!Array.isArray(s.b) || s.b.length !== len || !Array.isArray(s.owners) || s.owners.length !== len) throw Error('Tabuleiro inválido');
  s.b.forEach((v, k) => {
    let o = s.owners[k];
    if (!Number.isInteger(v) || v < 0 || v > 9 || ![-1, 0, 1, 2].includes(o)) throw Error('Peça inválida');
    if (s.n % 2 && k === Math.floor(len / 2)) {
      if (v !== 5 || o !== 2) throw Error('Centro inválido');
    } else if (v) {
      if (o !== 0 && o !== 1) throw Error('Dono inválido');
      used[o][v]++; count++;
    } else if (o !== -1) throw Error('Casa inválida');
  });
  let bank = inventory(s.n);
  if (!Array.isArray(s.banks) || s.banks.length !== 2 || s.banks.some((a, p) => !Array.isArray(a) || a.length !== 10 || a.some((v, i) => !Number.isInteger(v) || v < 0 || v !== bank[i] - used[p][i]))) throw Error('Reserva inválida');
  let a = used[0].reduce((a, b) => a + b, 0), b = used[1].reduce((a, b) => a + b, 0);
  if (Math.abs(a - b) > 1 || (a > b && s.turn !== 1 && count < Math.floor(len / 2) * 2) || (b > a && s.turn !== 0 && count < Math.floor(len / 2) * 2)) throw Error('Turno inválido');
  if (!Array.isArray(s.circles) || s.circles.some(k => !Number.isInteger(k) || k < 0 || k >= len) || !Number.isInteger(s.last) || s.last < -1 || s.last >= len) throw Error('Anotações inválidas');
  s.moves = count; s.done = count === Math.floor(len / 2) * 2;
  return s;
}

$('load').onclick = () => { if (NET.active) { message('Finalize a partida e clique em Voltar ao jogo local.'); return; } $('file').click(); };
$('file').onchange = async e => {
  let f = e.target.files[0]; if (!f) return;
  try {
    if (f.size > 2000000) throw Error('Arquivo muito grande');
    let next = importGame(JSON.parse(await f.text()));
    let live = review ? review.saved : S;
    if (live && live.moves && !confirm('Substituir a partida atual pela partida do arquivo?')) return;
    restore(next, true);
    message('Partida aberta em revisão. Use as setas ou “Voltar à partida” para continuar.');
  } catch (err) { message('Não foi possível abrir: ' + err.message); }
  e.target.value = '';
};

function restore(s, openReview = false) {
  rememberTournament(); stopAI();
  s.paused = !s.done; clockStamp = Date.now();
  review = null; S = s; focus = -1; zoom = 1;
  build(); render(); persist();
  if (openReview) enterReview(); else aiTurn();
  message(openReview ? 'Partida em revisão. Volte à partida para continuar.' : 'Partida recuperada e pausada. Clique em Continuar.');
}

document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || ['INPUT', 'SELECT'].includes(e.target.tagName)) return;
  if (review) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); reviewAt(review.index - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); reviewAt(review.index + 1); }
    return;
  }
  if (S && !thinking && !S.done && /^[1-9]$/.test(e.key) && S.banks[S.turn][+e.key]) {
    selected = +e.key; setTool('pen'); render();
  }
});

let review = null;
function copyState(s) { return JSON.parse(JSON.stringify(s)); }
function positionSnapshot(s) { const { b, owners, banks, turn, moves, last, done } = s; return copyState({ b, owners, banks, turn, moves, last, done }); }
function startRecord(s) { s.record = { initial: positionSnapshot(s), moves: [] }; return s; }
function baseFromRecord(s) { return { ...s, ...copyState(s.record.initial), circles: [], ending: undefined, record: s.record }; }
function applyRecorded(s, m) {
  if (!m || !Number.isInteger(m.numero) || m.numero !== s.moves + 1 || m.jogador !== s.turn + 1 || !Number.isInteger(m.linha) || m.linha < 1 || m.linha > s.n || !Number.isInteger(m.coluna) || m.coluna < 1 || m.coluna > s.n || !Number.isInteger(m.valor) || m.valor < 1 || m.valor > 9) throw Error('Jogada inválida no histórico');
  let k = (m.linha - 1) * s.n + m.coluna - 1, p = s.turn;
  if (s.done || s.b[k] || !s.banks[p][m.valor]) throw Error('Jogada incompatível com a posição');
  s.b[k] = m.valor; s.owners[k] = p; s.banks[p][m.valor]--; s.moves++; s.last = k; s.done = s.moves === Math.floor(s.n * s.n / 2) * 2; if (!s.done) s.turn = 1 - p;
}

function validate(s) {
  const ending = s.ending; const full = s.moves === Math.floor(s.n * s.n / 2) * 2; s.done = full; delete s.ending;
  validatePosition(s);
  if (s.record === undefined) return startRecord(s);
  if (!s.record || !s.record.initial || !Array.isArray(s.record.moves) || s.record.moves.length > s.n * s.n) throw Error('Histórico inválido');
  let initial = s.record.initial;
  if (!Number.isInteger(initial.moves) || typeof initial.done !== 'boolean') throw Error('Posição inicial inválida');
  let rebuilt = baseFromRecord(s); validatePosition(rebuilt);
  if (rebuilt.moves !== initial.moves || rebuilt.done !== initial.done) throw Error('Contagem inicial inválida');
  for (let m of s.record.moves) applyRecorded(rebuilt, m);
  for (let key of ['b', 'owners', 'banks', 'turn', 'moves', 'last', 'done']) if (JSON.stringify(rebuilt[key]) !== JSON.stringify(s[key])) throw Error('O histórico não corresponde ao estado atual');
  if (ending) {
    if (!['timeout', 'resign'].includes(ending.reason) || ![0, 1].includes(ending.winner) || s.done || (ending.reason === 'timeout' && ending.winner === s.turn)) throw Error('Final por tempo inválido');
    s.ending = ending; s.done = true;
  }
  if (s.seats) {
    if (!Array.isArray(s.seats) || s.seats.length !== 2) throw Error('Participantes inválidos');
    s.seats = s.seats.map(p => ({ ...botSeat(p.name, p.level, p.style), human: p.human === true }));
  }
  if (s.clock) {
    if (![1, 3, 5, 10, 15, 20, 30, 60].includes(s.clock.minutes) || !Array.isArray(s.clock.players) || s.clock.players.length !== 2 || s.clock.players.some(c => !Number.isFinite(c.main) || c.main < 0 || c.main > s.clock.minutes * 60000 || !Number.isInteger(c.periods) || c.periods < 0 || c.periods > 3 || !Number.isFinite(c.extra) || c.extra < 0 || c.extra > 60000)) throw Error('Relógio inválido');
  }
  if (s.activity && (!['campaign', 'tournament'].includes(s.activity.type) || s.activity.type === 'campaign' && (!Number.isInteger(s.activity.stage) || !STAGES[s.activity.stage]))) throw Error('Atividade inválida');
  s.paused = !s.done;
  return s;
}

function coordinates(k, n) { return k < 0 ? null : { linha: Math.floor(k / n) + 1, coluna: k % n + 1 }; }
function encodePosition(s) {
  return {
    jogadasRealizadas: s.moves, jogadorDaVez: s.turn + 1, encerrada: s.done, ultimaCasa: coordinates(s.last, s.n),
    tabuleiro: Array.from({ length: s.n }, (_, r) => s.b.slice(r * s.n, (r + 1) * s.n)),
    autoria: Array.from({ length: s.n }, (_, r) => s.owners.slice(r * s.n, (r + 1) * s.n).map(p => p + 1)),
    reservas: s.banks.map((a, p) => ({ jogador: p + 1, pecas: Object.fromEntries(a.slice(1).map((q, i) => [String(i + 1), q])) }))
  };
}

function decodePosition(pos, n) {
  if (!pos || !Number.isInteger(pos.jogadasRealizadas) || ![1, 2].includes(pos.jogadorDaVez) || typeof pos.encerrada !== 'boolean' || !Array.isArray(pos.reservas) || pos.reservas.length !== 2) throw Error('Posição inválida');
  for (let key of ['tabuleiro', 'autoria']) if (!Array.isArray(pos[key]) || pos[key].length !== n || pos[key].some(r => !Array.isArray(r) || r.length !== n)) throw Error('Matriz inválida');
  let k = -1; if (pos.ultimaCasa !== null) { let c = pos.ultimaCasa; if (!c || !Number.isInteger(c.linha) || !Number.isInteger(c.coluna) || c.linha < 1 || c.coluna < 1 || c.linha > n || c.coluna > n) throw Error('Última casa inválida'); k = (c.linha - 1) * n + c.coluna - 1; }
  return { b: pos.tabuleiro.flat(), owners: pos.autoria.flat().map(p => Number.isInteger(p) ? p - 1 : NaN), banks: pos.reservas.map((a, p) => { if (!a || a.jogador !== p + 1 || !a.pecas) throw Error('Reserva inválida'); return [0, ...Array.from({ length: 9 }, (_, i) => a.pecas[String(i + 1)])]; }), moves: pos.jogadasRealizadas, turn: pos.jogadorDaVez - 1, done: pos.encerrada, last: k };
}

function exportGame(s) {
  const q = score(s), full = s.record.initial.moves === 0;
  return {
    formato: 'Conquista de Linhas', versao: 2, exportadoEm: new Date().toISOString(),
    configuracao: { tamanho: s.n, modo: s.mode, ia: { dificuldade: s.aiLevel || 'master', estilo: s.aiStyle || 'standard' }, jogadorHorizontal: s.horizontal + 1, cores: s.colors.slice(), jogadores: [0, 1].map(p => ({ id: p + 1, nome: seats(s)[p].name, eixo: p === s.horizontal ? 'horizontal' : 'vertical', cor: s.colors[p] })) },
    convencoes: { coordenadas: 'Linha e coluna começam em 1.', tabuleiro: '0 = vazia; 1 a 9 = valor.', pontuacao: 'Linha i contra coluna i; maior soma = 1 ponto.' },
    historico: { completo: full, observacao: full ? 'Completo.' : 'Incompleto.', posicaoInicial: encodePosition(baseFromRecord(s)), jogadas: s.record.moves.map(m => ({ ...m, coordenada: `L${m.linha}, C${m.coluna}` })) },
    estadoAtual: encodePosition(s), anotacoes: s.circles.map(k => coordinates(k, s.n)),
    analise: { somasHorizontais: q.R, somasVerticais: q.C, pontosHorizontal: q.h, pontosVertical: q.v, placarDefinitivo: s.done },
    arena: { id: s.id, seats: s.seats, clock: s.clock, paused: s.paused, ending: s.ending, activity: s.activity, finishedRecorded: s.finishedRecorded }
  };
}

function importGame(raw) {
  if (raw && raw.version === 1) return validate(raw);
  if (!raw || raw.formato !== 'Conquista de Linhas' || raw.versao !== 2 || !raw.configuracao || !raw.historico) throw Error('Formato desconhecido');
  let c = raw.configuracao, n = c.tamanho;
  if (!Number.isInteger(n) || n < 8 || n > 30) throw Error('Tamanho inválido');
  const copy = copyState(raw);
  if (copy.arena?.ending) copy.estadoAtual.encerrada = false;
  let current = decodePosition(copy.estadoAtual, n);
  let s = { version: 1, n, mode: c.modo, aiLevel: c.ia?.dificuldade, aiStyle: c.ia?.estilo, horizontal: c.jogadorHorizontal - 1, colors: c.cores, ...current, circles: copy.anotacoes ? copy.anotacoes.map(x => (x.linha - 1) * n + x.coluna - 1) : [], record: { initial: decodePosition(copy.historico.posicaoInicial, n), moves: copy.historico.jogadas } };
  if (copy.arena) { for (const k of ['id', 'seats', 'clock', 'paused', 'ending', 'activity', 'finishedRecorded']) if (copy.arena[k] !== undefined) s[k] = copy.arena[k]; }
  validate(s);
  return s;
}

function updateReview() {
  $('reviewBar').hidden = !review;
  if (!review) { $('reviewBtn').disabled = !S || (NET.active && NET.room?.stage === 'playing'); return; }
  let count = review.saved.record.moves.length, i = review.index, base = review.saved.record.initial.moves;
  $('reviewFirst').disabled = $('reviewPrev').disabled = i === 0;
  $('reviewNext').disabled = $('reviewLast').disabled = i === count;
  let m = i ? review.saved.record.moves[i - 1] : null;
  $('reviewLabel').textContent = m ? `Jogada ${m.numero} · ${name(m.jogador - 1)} · ${m.valor} em L${m.linha}, C${m.coluna} · ${i}/${count}` : base ? `Posição antiga: ${base} jogadas sem sequência registrada · 0/${count}` : `Início da partida · 0/${count}`;
  $('reviewBtn').disabled = true;
}

function reviewAt(index) {
  if (!review) return;
  review.index = Math.max(0, Math.min(index, review.saved.record.moves.length));
  S = baseFromRecord(review.saved);
  for (let i = 0; i < review.index; i++) applyRecorded(S, review.saved.record.moves[i]);
  if (review.index === review.saved.record.moves.length) {
    S.circles = review.saved.circles.slice();
    if (review.saved.ending) { S.done = true; S.ending = review.saved.ending; }
  }
  render(); updateReview(); fit();
}

function enterReview() {
  if (!S || review) return;
  settleClock(); stopAI();
  review = { saved: S, index: 0 };
  reviewAt(0);
  clockStamp = Date.now();
  message('Revisão pausada. Use as setas para percorrer as jogadas.');
}

function leaveReview() {
  if (!review) return;
  clockStamp = Date.now();
  S = review.saved; review = null;
  render(); updateReview(); fit();
  message(S.done ? 'Posição final restaurada.' : 'Partida restaurada na última jogada.');
  aiTurn();
}
$('reviewBtn').onclick = enterReview;
$('reviewFirst').onclick = () => reviewAt(0);
$('reviewPrev').onclick = () => reviewAt(review.index - 1);
$('reviewNext').onclick = () => reviewAt(review.index + 1);
$('reviewLast').onclick = () => reviewAt(review.saved.record.moves.length);
$('reviewExit').onclick = leaveReview;

const STAGES = [
  ['O Aprendiz', 'beginner', 'standard', 8, 'Leia como cada peça altera duas disputas.'],
  ['A Muralha', 'easy', 'defensive', 8, 'Encontre caminhos para ultrapassar uma defesa.'],
  ['A Centelha', 'easy', 'aggressive', 10, 'Responda à pressão sem abandonar seu plano.'],
  ['A Raposa', 'medium', 'opportunist', 10, 'Cuidado com as disputas perto do empate.'],
  ['O Cartógrafo', 'medium', 'expansive', 12, 'Dispute espaço e escolha onde investir.'],
  ['O Guardião', 'hard', 'positional', 12, 'Aprenda a consolidar os pontos no final.'],
  ['A Tesoureira', 'hard', 'economist', 15, 'Administre sua reserva até o último lance.'],
  ['O Mestre', 'master', 'standard', 19, 'Enfrente a inteligência original.']
];
const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const cleanName = (v, fallback = 'Jogador') => String(v || fallback).trim().slice(0, 28) || fallback;
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const freshMeta = () => ({ version: 1, profile: { name: 'Jogador', avatar: '♟', color: 'blue' }, wins: [], results: [], tournament: null });
let META = freshMeta();
try { const m = JSON.parse(localStorage.getItem('conquista-arena-v1')); if (m && m.version === 1 && Array.isArray(m.wins) && Array.isArray(m.results) && m.profile) META = m; } catch (e) {}

let aiDelay = null, aiDue = 0, clockStamp = Date.now(), lastCheckpoint = 0;
function saveMeta() { try { localStorage.setItem('conquista-arena-v1', JSON.stringify(META)); } catch (e) { message('Não foi possível guardar o progresso. Exporte uma cópia pelo Perfil.'); } }
function humanSeat() { return { name: META.profile.name, human: true, level: 'master', style: 'standard' }; }
function botSeat(n, level = 'medium', style = 'standard') { return { name: cleanName(n, 'IA'), human: false, level: Object.hasOwn(AI_LEVELS, level) ? level : 'master', style: Object.hasOwn(AI_STYLES, style) ? style : 'standard' }; }
function seats(s) { return s.seats || [{ name: 'Você', human: true }, { name: 'IA', human: s.mode === 'local', level: s.aiLevel, style: s.aiStyle }]; }
function isBot(s, p) { return !seats(s)[p].human; }
function spectator(s) { return seats(s).every(x => !x.human); }
function clockNew(minutes) { return minutes ? { minutes, players: [0, 1].map(() => ({ main: minutes * 60000, periods: 3, extra: 60000 })) } : null; }

function settleClock(now = Date.now()) {
  const elapsed = Math.max(0, now - clockStamp); clockStamp = now;
  if (!S || S.done || review || S.paused || !S.clock) return;
  if (NET.active) {
    if (S.clock && !review && NET.room?.game) S.clock.players = OnlineModel.clocks(NET.room, netNow());
    return;
  }
  const c = S.clock.players[S.turn]; let dt = elapsed;
  if (c.main > 0) { const use = Math.min(dt, c.main); c.main -= use; dt -= use; }
  while (dt > 0 && c.periods > 0 && c.main <= 0) {
    if (dt < c.extra) { c.extra -= dt; dt = 0; }
    else { dt -= c.extra; c.periods--; c.extra = c.periods ? 60000 : 0; }
  }
  if (c.main <= 0 && c.periods === 0) finishTimeout(S.turn);
}

function formatTime(ms) { const sec = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
function clockPaint() {
  if (!S) return;
  const labels = seats(S);
  $('clockBoard').innerHTML = labels.map((p, i) => {
    const c = S.clock?.players[i];
    return `<div class="clock-card ${!S.done && S.turn === i ? 'active-clock' : ''}"><span>${esc(p.name)}</span><strong>${c ? formatTime(c.main > 0 ? c.main : c.extra) : '∞'}</strong><small>${c ? (c.main > 0 ? 'Principal · extras 3 × 60s' : `Extra · ${c.periods} período(s) restante(s)`) : 'Sem relógio'}</small></div>`;
  }).join('');
  $('spectatorCountdown').textContent = review ? 'Relógio da posição final · revisão pausada' : S.done ? '' : S.paused ? 'Partida pausada' : spectator(S) ? (aiDue ? 'Próxima jogada em ' + Math.max(0, Math.ceil((aiDue - Date.now()) / 1000)) + 's' : 'IA analisando…') : '';
}

function winner(s) { if (s.ending) return s.ending.winner; const q = score(s); return q.h === q.v ? null : q.h > q.v ? s.horizontal : 1 - s.horizontal; }
function finishTimeout(p) {
  if (!S || S.done) return;
  stopAI(); S.done = true; S.ending = { reason: 'timeout', winner: 1 - p };
  onFinish(); render(); persist();
  message(cleanName(seats(S)[p].name) + ' esgotou o tempo.');
  showDuels();
}

function onFinish() {
  if (!S?.done || review || S.finishedRecorded) return;
  S.finishedRecorded = true; const w = winner(S), ps = seats(S), human = ps.findIndex(x => x.human);
  if (human >= 0 && ps.some(x => !x.human) && !META.results.some(x => x.id === S.id)) {
    META.results.push({ id: S.id, date: new Date().toISOString(), outcome: w === null ? 'draw' : w === human ? 'win' : 'loss', opponent: ps[1 - human].name, kind: S.activity?.type || 'free' });
  }
  if (S.activity?.type === 'campaign' && w === 0 && !META.wins.includes(S.activity.stage)) META.wins.push(S.activity.stage);
  if (S.activity?.type === 'tournament' && META.tournament?.id === S.activity.tournament) {
    const m = META.tournament.matches[S.activity.match];
    if (m && !m.result) {
      const q = score(S), points = [S.horizontal === 0 ? q.h : q.v, S.horizontal === 0 ? q.v : q.h];
      m.result = { winner: w === null ? null : w === 0 ? m.a : m.b, points, timeout: !!S.ending };
      m.state = copyState(S);
    }
  }
  saveMeta();
}

function canReplace() { const live = review ? review.saved : S; return !live || live.done || !live.moves || confirm('Guardar esta posição e iniciar outra partida? A partida atual será substituída.'); }
function launchGame({ n, players, minutes = 0, activity = null }) {
  if (NET.active) { message('Volte ao jogo local antes de iniciar outra partida.'); return false; }
  if (!canReplace()) return false;
  settleClock(); rememberTournament(); stopAI(); review = null;
  const colors = [META.profile.color, COLORS.find(c => c !== META.profile.color)];
  S = {
    version: 1, id: uid(), n, mode: players.every(p => p.human) ? 'local' : 'ai', colors,
    horizontal: Math.floor(rand() * 2), turn: Math.floor(rand() * 2),
    b: Array(n * n).fill(0), owners: Array(n * n).fill(-1),
    banks: [inventory(n), inventory(n)], circles: [], moves: 0, last: -1, done: false,
    seats: copyState(players), aiLevel: players[1].level || 'master', aiStyle: players[1].style || 'standard',
    clock: clockNew(minutes), paused: false, activity
  };
  if (n % 2) { const k = Math.floor(n * n / 2); S.b[k] = 5; S.owners[k] = 2; }
  startRecord(S); zoom = 1; focus = -1; selected = 5; clockStamp = Date.now();
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  build(); render(); persist(); aiTurn();
  return true;
}

function rememberTournament() {
  const live = review ? review.saved : S;
  if (live?.activity?.type === 'tournament' && META.tournament?.id === live.activity.tournament) {
    const m = META.tournament.matches[live.activity.match];
    if (m) m.state = copyState(live);
    saveMeta();
  }
}

function engineState(s) {
  const p = s.turn, bot = seats(s)[p], x = copyState(s);
  if (p === 0) { x.banks = [s.banks[1].slice(), s.banks[0].slice()]; x.horizontal = 1 - s.horizontal; }
  x.turn = 1; x.aiLevel = bot.level || s.aiLevel; x.aiStyle = bot.style || s.aiStyle;
  return x;
}

function aiTurn() {
  if (review || !S || S.done || S.paused || !isBot(S, S.turn) || thinking) return;
  stopAI(); const ticket = serial, started = Date.now(); thinking = true; const watch = spectator(S);
  aiDue = watch ? started + 7000 : 0; render(); const state = engineState(S);
  const deliver = m => {
    if (ticket !== serial || S.paused || review || S.done) return;
    const wait = watch ? Math.max(0, started + 7000 - Date.now()) : 0;
    aiDelay = setTimeout(() => {
      if (ticket !== serial || S.paused || review || S.done) return;
      stopAI();
      if (m) move(m.k, m.v);
      else { render(); message('Não foi encontrada uma jogada.'); }
    }, wait);
  };
  const fallback = () => {
    if (ticket !== serial) return;
    try { deliver(chooseAI(state, 180)); } catch (e) { stopAI(); S.paused = true; render(); message('Falha ao analisar. Continue para tentar novamente.'); }
  };
  try {
    const code = `'use strict';const chooseAIOriginal=${chooseAIOriginal.toString()};const chooseAI=${chooseAI.toString()};onmessage=e=>postMessage(chooseAI(e.data));`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    worker = new Worker(url); URL.revokeObjectURL(url);
    worker.onmessage = e => deliver(e.data);
    worker.onerror = () => { if (ticket !== serial) return; worker?.terminate(); worker = null; fallback(); };
    worker.postMessage(state);
  } catch (e) { setTimeout(fallback, 20); }
}

$('pauseGame').onclick = () => {
  if (!S || S.done || review) return;
  settleClock(); if (S.done) return;
  S.paused = !S.paused; stopAI(); clockStamp = Date.now();
  render(); persist();
  if (!S.paused) aiTurn();
};

function profileOpen() {
  settleClock();
  $('profileName').value = META.profile.name; $('profileAvatar').value = META.profile.avatar; $('profileColor').value = META.profile.color;
  const r = META.results, win = r.filter(x => x.outcome === 'win').length, draw = r.filter(x => x.outcome === 'draw').length;
  $('profileStats').innerHTML = `<p><b>${esc(META.profile.avatar)} ${esc(META.profile.name)}</b></p><p>${r.length} partidas contra IA · ${win} vitórias · ${draw} empates · ${r.length - win - draw} derrotas</p><p>Campanha: ${META.wins.length}/8 etapas</p>`;
  $('profileDialog').showModal();
}
$('profileBtn').onclick = profileOpen;
$('saveProfile').onclick = () => {
  META.profile = { name: cleanName($('profileName').value), avatar: $('profileAvatar').value, color: $('profileColor').value };
  saveMeta(); $('color1').value = META.profile.color; $('onlineNickname').value = META.profile.name;
  $('profileDialog').close(); message('Perfil atualizado para as próximas partidas.');
};

function campaignOpen() {
  $('campaignList').innerHTML = STAGES.map((a, i) => {
    const unlocked = i === 0 || META.wins.includes(i - 1), won = META.wins.includes(i);
    return `<article class="arena-card"><b>${won ? '✓' : unlocked ? '◇' : '🔒'} ${i + 1}. ${a[0]}</b><p>${a[4]}</p><small>${a[3]}×${a[3]} · ${AI_LEVELS[a[1]][0]} · ${AI_STYLES[a[2]][0]}</small><button data-stage="${i}" ${unlocked ? '' : 'disabled'}>${won ? 'Jogar novamente' : unlocked ? 'Desafiar' : 'Bloqueado'}</button></article>`;
  }).join('');
  $('campaignDialog').showModal();
}
$('campaignBtn').onclick = campaignOpen;
$('campaignList').onclick = e => {
  const b = e.target.closest('[data-stage]'); if (!b || b.disabled) return;
  const i = +b.dataset.stage, a = STAGES[i];
  launchGame({ n: a[3], players: [humanSeat(), botSeat(a[0], a[1], a[2])], minutes: +$('campaignTime').value, activity: { type: 'campaign', stage: i } });
};
$('nextChallenge').onclick = () => S.activity?.type === 'campaign' ? campaignOpen() : tournamentOpen();

const optionHTML = (dict, selected) => Object.entries(dict).map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${v[0]}</option>`).join('');
function rosterForm() {
  const count = +$('tournamentCount').value, withHuman = $('tournamentHuman').value === 'yes';
  $('tournamentRoster').innerHTML = Array.from({ length: count }, (_, i) => {
    const h = i === 0 && withHuman;
    return `<div class="roster-row"><input aria-label="Nome ${i + 1}" id="rosterName${i}" maxlength="28" value="${esc(h ? META.profile.name : ['Aurora', 'Atlas', 'Íris', 'Orion', 'Gaia', 'Nero', 'Luna', 'Vega'][i])}">${h ? '<span>Você</span>' : `<select id="rosterLevel${i}">${optionHTML(AI_LEVELS, 'medium')}</select><select id="rosterStyle${i}">${optionHTML(AI_STYLES, Object.keys(AI_STYLES)[i % 8])}</select>`}</div>`;
  }).join('');
}
function standings(t) {
  const rows = t.players.map((p, i) => ({ id: i, name: p.name, played: 0, points: 0, wins: 0, draws: 0, losses: 0, diff: 0 }));
  for (const m of t.matches) {
    if (!m.result) continue;
    const a = rows[m.a], b = rows[m.b];
    a.played++; b.played++; a.diff += m.result.points[0] - m.result.points[1]; b.diff -= m.result.points[0] - m.result.points[1];
    if (m.result.winner === null) { a.points++; b.points++; a.draws++; b.draws++; }
    else { const w = rows[m.result.winner], l = w === a ? b : a; w.points += 3; w.wins++; l.losses++; }
  }
  return rows.sort((a, b) => b.points - a.points || b.wins - a.wins || b.diff - a.diff);
}
function tournamentOpen() { rememberTournament(); renderTournament(); $('tournamentDialog').showModal(); }
function renderTournament() {
  const t = META.tournament; $('tournamentSetup').hidden = !!t;
  if (!t) { $('tournamentCurrent').innerHTML = ''; rosterForm(); return; }
  const rows = standings(t), done = t.matches.every(m => m.result), top = rows[0], champions = rows.filter(r => r.points === top.points && r.wins === top.wins && r.diff === top.diff);
  $('tournamentCurrent').innerHTML = `<p class="note">${t.players.length} participantes · ${t.n}×${t.n} · ${t.matches.filter(m => m.result).length}/${t.matches.length} partidas</p>${done ? `<p class="champion">🏆 Campeão: ${champions.map(r => esc(r.name)).join(', ')}</p>` : ''}<div class="table-scroll"><table><tr><th>Participante</th><th>J</th><th>V</th><th>E</th><th>D</th><th>Pts</th><th>Saldo</th></tr>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td><td><b>${r.points}</b></td><td>${r.diff}</td></tr>`).join('')}</table></div><div>${t.matches.map((m, i) => `<article class="arena-card"><b>${i + 1}. ${esc(t.players[m.a].name)} × ${esc(t.players[m.b].name)}</b><p>${m.result ? (m.result.winner === null ? 'Empate' : 'Venceu: ' + esc(t.players[m.result.winner].name)) + ' · ' + m.result.points.join(' × ') : m.state ? 'Em andamento' : 'Aguardando'}</p><button data-match="${i}">${m.result ? 'Rever partida' : m.state ? 'Continuar' : 'Jogar'}</button></article>`).join('')}</div><button id="newLeague">Criar outra liga</button>`;
  $('newLeague').onclick = () => { if (!confirm('Substituir esta liga?')) return; META.tournament = null; saveMeta(); renderTournament(); };
}
$('tournamentBtn').onclick = tournamentOpen;
$('tournamentCount').onchange = $('tournamentHuman').onchange = rosterForm;
$('createTournament').onclick = () => {
  const count = +$('tournamentCount').value, players = Array.from({ length: count }, (_, i) => i === 0 && $('tournamentHuman').value === 'yes' ? { ...humanSeat(), name: cleanName($('rosterName' + i).value) } : botSeat($('rosterName' + i).value, $('rosterLevel' + i).value, $('rosterStyle' + i).value));
  const matches = [];
  for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) matches.push({ a, b, result: null, state: null });
  META.tournament = { id: uid(), players, n: +$('tournamentSize').value, minutes: +$('tournamentTime').value, matches };
  saveMeta(); renderTournament();
};
$('tournamentCurrent').onclick = e => {
  const b = e.target.closest('[data-match]'); if (!b) return;
  const i = +b.dataset.match, t = META.tournament, m = t.matches[i];
  if (m.state) { if (!canReplace()) return; for (const d of document.querySelectorAll('dialog[open]')) d.close(); restore(copyState(m.state), !!m.result); }
  else launchGame({ n: t.n, players: [t.players[m.a], t.players[m.b]], minutes: t.minutes, activity: { type: 'tournament', tournament: t.id, match: i } });
};

function downloadJSON(value, filename) {
  const u = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })), a = document.createElement('a');
  a.href = u; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
}
$('backupArena').onclick = () => { settleClock(); rememberTournament(); downloadJSON({ format: 'Conquista Arena Backup', version: 1, meta: META, game: review ? review.saved : S }, 'Conquista-progresso.json'); };
$('restoreArena').onclick = () => $('arenaFile').click();
$('arenaFile').onchange = async e => {
  try {
    const f = e.target.files[0]; if (!f) return;
    const b = JSON.parse(await f.text());
    if (b.format !== 'Conquista Arena Backup' || !confirm('Importar este progresso e substituir dados atuais?')) return;
    stopAI(); review = null; S = null; META = b.meta; saveMeta();
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    if (b.game) restore(b.game);
    message('Progresso importado com sucesso.');
  } catch (err) { alert('Erro ao importar: ' + err.message); } finally { e.target.value = ''; }
};

for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => b.closest('dialog').close();
for (let n = 8; n <= 30; n++) $('tournamentSize').add(new Option(n + '×' + n, n));
$('tournamentSize').value = '8';
$('spectatorLevel').innerHTML = optionHTML(AI_LEVELS, 'medium');
$('spectatorStyle').innerHTML = optionHTML(AI_STYLES, 'standard');

$('start').onclick = () => {
  const mode = $('mode').value;
  let players = mode === 'local' ? [humanSeat(), { name: cleanName($('localName').value, 'Jogador 2'), human: true }] : mode === 'spectator' ? [botSeat($('spectatorName').value, $('spectatorLevel').value, $('spectatorStyle').value), botSeat($('opponentName').value, $('setupAILevel').value, $('setupAIStyle').value)] : [humanSeat(), botSeat($('opponentName').value, $('setupAILevel').value, $('setupAIStyle').value)];
  const c = $('color1').value, c2 = $('color2').value;
  if (mode === 'local' && c === c2) { $('setupError').textContent = 'Escolha cores diferentes.'; return; }
  if (launchGame({ n: +$('size').value, players, minutes: +$('timeControl').value })) {
    S.colors = [c, mode === 'local' ? c2 : COLORS.find(x => x !== c)];
    render(); persist();
  }
};
$('color1').value = META.profile.color;

setInterval(() => {
  settleClock(); clockPaint();
  if (S && !review && !S.done && !S.paused && Date.now() - lastCheckpoint > 5000) { lastCheckpoint = Date.now(); persist(); }
}, 200);
window.addEventListener('pagehide', () => { settleClock(); persist(); });

/* ==========================================================================
   MÓDULO ONLINE & FIREBASE
   ========================================================================== */
const ONLINE_CONFIG = { apiKey: 'AIzaSyBZtHJb4YofijbymU3muzA6D03ymFTgIZY', authDomain: 'conquista-de-linhas.firebaseapp.com', databaseURL: 'https://conquista-de-linhas-default-rtdb.firebaseio.com', projectId: 'conquista-de-linhas', storageBucket: 'conquista-de-linhas.firebasestorage.app', messagingSenderId: '1061769524302', appId: '1:1061769524302:web:f7051c0a9c93355f76bf1f' };
const ONLINE_URL = 'https://eufernandobaptista-commits.github.io/conquistasdelinhas/';
const NET = { user: null, api: null, db: null, auth: null, connected: false, offset: 0, room: null, id: null, pending: false, active: false, publicRooms: [], myRooms: new Map(), unsubRoom: null, unsubPresence: null, unsubMine: null, unsubPublic: null, mineListeners: [], presence: null, presenceCancel: null, localState: null, tab: 'public', timeoutAt: 0, wantRoom: new URLSearchParams(location.hash.slice(1)).get('sala') || null };

const OnlineModel = (() => {
  const clone = x => JSON.parse(JSON.stringify(x));
  function initialGame(r, stamp) {
    const b0 = Object.fromEntries(inventory(r.meta.n).slice(1).map((v, i) => [i + 1, v]));
    return { cells: Array(900).fill(0), ply: 0, turn: r.meta.first, at: stamp, prevAt: stamp, last: { k: -1, v: 0, p: -1 }, banks: { 0: { ...b0 }, 1: { ...b0 } }, clocks: { 0: { main: r.meta.minutes * 60000, periods: 3 }, 1: { main: r.meta.minutes * 60000, periods: 3 } } };
  }
  function spend(clock, elapsed, timed = true) {
    if (!timed) return { main: 0, periods: 3, extra: 60000 };
    elapsed = Math.max(0, elapsed);
    const over = Math.max(0, elapsed - clock.main), main = Math.max(0, clock.main - elapsed), periods = Math.max(0, clock.periods - Math.floor(over / 60000));
    return { main, periods, extra: periods ? 60000 - over % 60000 : 0 };
  }
  function accountPrevious(r) {
    const g = r.game; if (!g.ply) return;
    const p = 1 - g.turn, c = spend(g.clocks[p], g.at - g.prevAt, r.meta.minutes > 0);
    g.clocks[p] = { main: c.main, periods: c.periods };
  }
  function member(r, uid) { return uid === r.hostUid ? 0 : uid === r.guestUid ? 1 : -1; }
  function clocks(r, now) {
    const x = clone(r); accountPrevious(x);
    const list = [0, 1].map(p => ({ ...x.game.clocks[p], extra: 60000 }));
    if (r.stage === 'playing') list[r.game.turn] = spend(list[r.game.turn], now - r.game.at, r.meta.minutes > 0);
    if (r.end?.reason === 'timeout') list[r.end.loser] = { main: 0, periods: 0, extra: 0 };
    return list;
  }
  return { clone, initialGame, member, clocks, readyRoom: (meta, uid, name, stamp) => ({ schema: 1, meta, hostUid: uid, hostName: name, guestUid: '', guestName: '', hostReady: false, guestReady: false, stage: 'waiting', action: 'create', createdAt: stamp }) };
})();

const netNow = () => Date.now() + NET.offset;
const netRef = path => NET.api.ref(NET.db, 'onlineV1/' + path);
const netMember = () => NET.user && NET.room ? OnlineModel.member(NET.room, NET.user.uid) : -1;

function netStatus(text) { $('onlineStatus').textContent = text; }
function netError(err) { const text = err?.message || 'Falha na conexão online.'; netStatus(text); message(text); }
function netSwitch(tab) {
  NET.tab = tab;
  for (const t of ['public', 'create', 'mine', 'invite', 'waiting']) $('online-' + t).hidden = t !== tab;
  for (const b of document.querySelectorAll('[data-online-tab]')) b.classList.toggle('active', b.dataset.onlineTab === tab);
  if (tab === 'public' || tab === 'mine') netLists();
}
function netOpen(tab = 'public') {
  if (!NET.active && S && !S.done && !review && !S.paused) $('pauseGame').click();
  for (const d of document.querySelectorAll('dialog[open]')) if (d !== $('onlineDialog')) d.close();
  netSwitch(tab);
  if (!$('onlineDialog').open) $('onlineDialog').showModal();
}
$('roomsBtn').onclick = () => netOpen();
for (const b of document.querySelectorAll('[data-online-tab]')) b.onclick = () => netSwitch(b.dataset.onlineTab);
$('onlineClose').onclick = () => $('onlineDialog').close();
$('onlineRoomBack').onclick = () => { netOpen('waiting'); netWaiting(); };
for (let n = 8; n <= 30; n++) $('onlineSize').add(new Option(n + '×' + n, n));
$('onlineSize').value = '19'; $('onlineNickname').value = META.profile.name;

function netIdentity() {
  const u = NET.user;
  $('onlineGoogle').hidden = !!u; $('onlineGoogle').disabled = !NET.api; $('onlineLogout').hidden = !u;
  $('onlineIdentity').textContent = u ? 'Conectado como ' + cleanName(u.displayName, 'Jogador') : '';
  for (const id of ['onlineCreate', 'onlineJoin']) $(id).disabled = !u || !NET.connected;
  $('onlineConnection').textContent = !NET.api ? 'Conexão indisponível.' : !NET.connected ? 'Aguardando internet…' : u ? 'Conectado · partidas sincronizadas' : 'Conexão pronta · entre com Google';
  if (NET.active) netPaint();
}

async function initOnline() {
  if (!/^https?:$/.test(location.protocol)) { $('onlineConnection').textContent = 'Abra pelo GitHub Pages para jogar online.'; return; }
  try {
    const [app, auth, db] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js')
    ]);
    NET.api = { ...auth, ...db };
    NET.app = app.getApps().find(a => a.name === 'conquista-online-v1') || app.initializeApp(ONLINE_CONFIG, 'conquista-online-v1');
    NET.auth = auth.getAuth(NET.app);
    NET.db = db.getDatabase(NET.app);
    await auth.setPersistence(NET.auth, auth.browserLocalPersistence);
    db.onValue(db.ref(NET.db, '.info/serverTimeOffset'), snap => { NET.offset = Number(snap.val()) || 0; });
    db.onValue(db.ref(NET.db, '.info/connected'), snap => { NET.connected = snap.val() === true; netIdentity(); });
    auth.onAuthStateChanged(NET.auth, user => {
      NET.user = user; netIdentity();
      if (user) {
        if (META.profile.name === 'Jogador') $('onlineNickname').value = cleanName(user.displayName);
        netStartLists();
      }
    });
  } catch (e) { netError(e); }
}

function netStartLists() {
  const A = NET.api;
  A.onValue(A.query(netRef('directory'), A.orderByChild('createdAt'), A.limitToLast(100)), snap => {
    NET.publicRooms = Object.entries(snap.val() || {}).map(([id, v]) => ({ id, ...v }));
    netLists();
  });
}
function netLists() {
  if (!NET.user) { $('onlinePublicList').innerHTML = '<div class="online-empty">Entre com Google para ver as salas.</div>'; return; }
  const q = $('onlineFilter').value.trim().toLocaleLowerCase(), list = NET.publicRooms.filter(r => (r.title + ' ' + r.hostName).toLocaleLowerCase().includes(q));
  $('onlinePublicList').innerHTML = list.length ? list.map(r => `<article class="online-card"><h3>${esc(r.title)}</h3><p>${esc(r.hostName)} · ${r.n}×${r.n}</p><button data-net-join="${esc(r.id)}">Entrar na sala</button></article>`).join('') : '<div class="online-empty">Nenhuma sala pública aberta.</div>';
}
$('onlineFilter').oninput = netLists;
$('onlinePublicList').onclick = e => { const b = e.target.closest('[data-net-join]'); if (b) netJoinRoom(b.dataset.netJoin).catch(netError); };

$('onlineGoogle').onclick = async () => {
  if (!NET.api) return;
  try { const provider = new NET.api.GoogleAuthProvider(); await NET.api.signInWithPopup(NET.auth, provider); } catch (e) { netError(e); }
};
$('onlineLogout').onclick = async () => { try { await NET.api.signOut(NET.auth); } catch (e) { netError(e); } };

function netCode() { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(24)), x => alphabet[x % alphabet.length]).join(''); }
async function netTransaction(id, change) {
  const ref = netRef('rooms/' + id), known = (await NET.api.get(ref)).val();
  const result = await NET.api.runTransaction(ref, r => change(r || OnlineModel.clone(known)), { applyLocally: false });
  return result.snapshot.val();
}

$('onlineCreateForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const title = $('onlineRoomName').value.trim(), nickname = cleanName($('onlineNickname').value), id = netCode();
    const r = OnlineModel.readyRoom({ title, visibility: $('onlineVisibility').value, n: +$('onlineSize').value, minutes: +$('onlineMinutes').value, horizontal: Math.floor(rand() * 2), first: Math.floor(rand() * 2) }, NET.user.uid, nickname, NET.api.serverTimestamp());
    await NET.api.set(netRef('rooms/' + id), r);
    await netWatch(id);
  } catch (err) { netError(err); }
};

async function netJoinRoom(id) {
  id = id.trim().toUpperCase();
  const snap = await NET.api.get(netRef('rooms/' + id));
  if (!snap.exists()) throw Error('Sala não encontrada.');
  let r = snap.val();
  if (OnlineModel.member(r, NET.user.uid) < 0) {
    r = await netTransaction(id, cur => {
      if (cur.stage !== 'waiting' || cur.guestUid) return;
      cur.guestUid = NET.user.uid; cur.guestName = cleanName($('onlineNickname').value || NET.user.displayName);
      return cur;
    });
  }
  await netWatch(id);
}
$('onlineJoin').onclick = () => netJoinRoom($('onlineJoinInput').value).catch(netError);

async function netWatch(id) {
  NET.id = id; netOpen('waiting');
  NET.unsubRoom?.();
  NET.unsubRoom = NET.api.onValue(netRef('rooms/' + id), snap => {
    if (!snap.exists()) return;
    const r = snap.val(), changed = NET.room?.game?.ply !== r.game?.ply || NET.room?.stage !== r.stage;
    NET.room = r; netWaiting();
    if (r.game && changed) netApplyRoom(r);
  });
}

function netWaiting() {
  const r = NET.room; if (!r) return;
  const p = netMember(), ready = p === 0 ? r.hostReady : r.guestReady;
  $('onlineWaiting').innerHTML = `<article class="online-card"><h3>${esc(r.meta.title)}</h3><p>${r.hostName} × ${r.guestName || 'Aguardando…'}</p><div class="controls"><button id="onlineReady">${ready ? 'Cancelar' : 'Estou pronto'}</button>${p === 0 ? `<button id="onlineStart" class="primary" ${r.hostReady && r.guestReady ? '' : 'disabled'}>Iniciar</button>` : ''}</div></article>`;
  if ($('onlineReady')) $('onlineReady').onclick = () => netTransaction(NET.id, x => { if (p === 0) x.hostReady = !x.hostReady; else x.guestReady = !x.guestReady; return x; });
  if ($('onlineStart')) $('onlineStart').onclick = () => netTransaction(NET.id, x => { x.stage = 'playing'; x.game = OnlineModel.initialGame(x, NET.api.serverTimestamp()); return x; });
}

function netApplyRoom(r) {
  if (!NET.active) { NET.localState = review ? review.saved : S; stopAI(); review = null; NET.active = true; zoom = 1; focus = -1; }
  const n = r.meta.n;
  S = {
    version: 1, id: NET.id, n, mode: 'local', colors: ['blue', 'red'], horizontal: r.meta.horizontal, turn: r.meta.first,
    b: Array(n * n).fill(0), owners: Array(n * n).fill(-1), banks: [inventory(n), inventory(n)], circles: [], moves: 0, last: -1, done: false,
    seats: [{ name: r.hostName, human: true }, { name: r.guestName, human: true }], aiLevel: 'master', aiStyle: 'standard', clock: clockNew(r.meta.minutes), paused: false
  };
  if (n % 2) { const k = Math.floor(n * n / 2); S.b[k] = 5; S.owners[k] = 2; }
  startRecord(S);
  for (const cell of Object.values(r.game.cells || {}).filter(Boolean).sort((a, b) => a.seq - b.seq)) {
    const m = { numero: cell.seq, jogador: cell.p + 1, valor: cell.v, linha: Math.floor(cell.k / n) + 1, coluna: cell.k % n + 1 };
    applyRecorded(S, m); S.record.moves.push(m);
  }
  build(); render(); $('onlineDialog').close();
}

function netPaint() {
  if (!NET.active || !S) return;
  $('onlineStrip').hidden = false;
  $('onlineMatchInfo').textContent = `Sala Online: ${NET.room.meta.title}`;
  $('pauseGame').disabled = true; $('aiSettingsBtn').disabled = true;
}

async function netMove(k, v) {
  if (!NET.active || NET.pending || !NET.connected || !NET.room || NET.room.stage !== 'playing' || netMember() !== NET.room.game.turn) return false;
  NET.pending = true;
  try {
    await netTransaction(NET.id, r => {
      const g = r.game, p = g.turn, stamp = NET.api.serverTimestamp();
      g.ply++; g.turn = 1 - p; g.banks[p][v]--; g.cells || = {};
      g.cells[k] = { k, v, p, seq: g.ply, at: stamp };
      return r;
    });
    return true;
  } catch (e) { netError(e); return false; } finally { NET.pending = false; }
}

$('onlineLeaveView').onclick = () => {
  NET.active = false; $('onlineStrip').hidden = true;
  S = NET.localState; build(); render();
};

/* ==========================================================================
   INICIALIZAÇÃO DO JOGO
   ========================================================================== */
try {
  let t = localStorage.getItem('conquista-theme') || 'light';
  if (['light', 'dark', 'sepia'].includes(t)) { $('theme').value = t; setTheme(t); }
  let raw = localStorage.getItem('conquista-save-v1');
  if (raw) { restore(validate(JSON.parse(raw))); message('Última partida recuperada automaticamente.'); }
  else $('setup').showModal();
} catch (e) { $('setup').showModal(); }

initOnline();
