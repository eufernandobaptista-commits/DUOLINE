export function inventory(n) {
  let t = Math.floor(n * n / 2), a = Array(10).fill(Math.floor(t / 9));
  a[0] = 0;
  let r = t % 9;
  if (r % 2) { a[5]++; r--; }
  for (let i = 1; i <= r / 2; i++) { a[i]++; a[10 - i]++; }
  return a;
}

export function totals(s) {
  let R = Array(s.n).fill(0), C = R.slice(), er = R.slice(), ec = R.slice();
  s.b.forEach((v, k) => {
    let r = Math.floor(k / s.n), c = k % s.n;
    R[r] += v; C[c] += v;
    if (!v) { er[r]++; ec[c]++; }
  });
  return { R, C, er, ec };
}

export function score(s) {
  let { R, C } = totals(s), h = 0, v = 0;
  R.forEach((x, i) => { if (x > C[i]) h++; if (x < C[i]) v++; });
  return { h, v, R, C };
}