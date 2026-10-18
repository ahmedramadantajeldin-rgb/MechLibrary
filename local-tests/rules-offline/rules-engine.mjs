// OFFLINE model of the Firestore Security Rules language — just enough of it to run firestore.rules in tests
// when the real Firebase Emulator cannot be downloaded or started.
//
// IMPORTANT: this is a MODEL written by the project, not Google's rules engine. It is useful for catching logic
// mistakes (wrong conditions, missing checks, ordering of owner/admin/public) but it can NOT prove how real
// Firestore behaves. The authoritative check is the same test file run against the real emulator:
//   npx firebase-tools emulators:exec --only firestore --project demo-mech "node --test local-tests/rules.test.mjs"
//
// Supported: match / nested match / wildcards ({x}, {x=**}), function (no recursion), allow <ops>: if <expr>,
// && || ! == != < <= > >= + - * / % ?: in is, member access, [index], method calls, list/map literals, get(), exists(),
// path literals with $(…) interpolation, request.auth / request.time / request.resource / resource.
// Errors (missing field, null access, get() of a missing document, …) make the whole expression an error → denied,
// and && / || treat an error as absorbed when the other side decides the result (like Google's rules language).

export class Ts { constructor(ms) { this.ms = ms; } }
class RuleError extends Error {}
const fail = (m) => { throw new RuleError(m); };

/* ------------------------------------------------------------ tokenizer */
function tokenize(src) {
  const out = []; let i = 0;
  const push = (t, v) => out.push({ t, v });
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    const prev = out[out.length - 1];
    if (prev && prev.t === 'id' && prev.v === 'match') {               // match pattern, e.g. /databases/{database}/documents
      const m = /^\S+/.exec(src.slice(i)); push('pattern', m[0]); i += m[0].length; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, s = '';
      while (src[j] !== c) {
        if (src[j] === '\\') { const n = src[j + 1]; s += n === 'n' ? '\n' : n === 't' ? '\t' : n; j += 2; }   // '\\' → one backslash, so '\\s' reaches the regex as \s
        else s += src[j++];
        if (j >= src.length) fail('unterminated string');
      }
      push('str', s); i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) { const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i)); push('num', Number(m[0])); i += m[0].length; continue; }
    if (/[A-Za-z_]/.test(c)) { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)); push('id', m[0]); i += m[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '<=', '>='].includes(two)) { push('op', two); i += 2; continue; }
    if (c === '/' && (!prev || ['op', 'punct'].includes(prev.t) && !(prev.v === ')' || prev.v === ']') || (prev.t === 'id' && ['if', 'return'].includes(prev.v)))) {
      // path literal: /seg/seg/$(expr)/…
      let j = i, parts = [];
      while (src[j] === '/') {
        j++;
        let seg = [];
        while (j < src.length && !/[\s,;)\]]/.test(src[j]) && src[j] !== '/') {
          if (src[j] === '$' && src[j + 1] === '(') {
            let depth = 1, k = j + 2; while (depth) { if (src[k] === '(') depth++; else if (src[k] === ')') depth--; k++; }
            seg.push({ expr: src.slice(j + 2, k - 1) }); j = k;
          } else { let k = j; while (k < src.length && !/[\s,;)\]/$]/.test(src[k])) k++; seg.push(src.slice(j, k)); j = k; }
        }
        parts.push(seg);
      }
      push('path', parts); i = j; continue;
    }
    if ('+-*/%<>!?:.,;()[]{}='.includes(c)) { push(/[.,;()[\]{}:?=]/.test(c) ? 'punct' : 'op', c); i++; continue; }
    fail('bad character ' + c);
  }
  return out;
}

/* ------------------------------------------------------------ parser (rules file + expressions) */
class Parser {
  constructor(tokens) { this.k = tokens; this.i = 0; }
  peek(o = 0) { return this.k[this.i + o]; }
  next() { return this.k[this.i++]; }
  is(t, v) { const x = this.peek(); return x && x.t === t && (v === undefined || x.v === v); }
  eat(t, v) { if (this.is(t, v)) return this.next(); return null; }
  need(t, v) { const x = this.eat(t, v); if (!x) fail(`expected ${v || t} but got ${JSON.stringify(this.peek())}`); return x; }

  file() {
    // rules_version = '2';  service cloud.firestore { match … }
    this.need('id', 'rules_version'); this.need('punct', '='); this.need('str'); this.need('punct', ';');
    this.need('id', 'service'); this.need('id'); this.need('punct', '.'); this.need('id'); this.need('punct', '{');
    const matches = [];
    while (!this.is('punct', '}')) matches.push(this.match());
    this.need('punct', '}');
    return matches;
  }
  match() {
    this.need('id', 'match');
    const pattern = this.need('pattern').v; this.need('punct', '{');
    const node = { pattern, functions: {}, allows: [], matches: [] };
    while (!this.is('punct', '}')) {
      if (this.is('id', 'match')) node.matches.push(this.match());
      else if (this.is('id', 'function')) { const f = this.func(); node.functions[f.name] = f; }
      else if (this.is('id', 'allow')) node.allows.push(this.allow());
      else fail('unexpected ' + JSON.stringify(this.peek()));
    }
    this.need('punct', '}');
    return node;
  }
  func() {
    this.need('id', 'function'); const name = this.need('id').v; this.need('punct', '(');
    const params = [];
    while (!this.is('punct', ')')) { params.push(this.need('id').v); this.eat('punct', ','); }
    this.need('punct', ')'); this.need('punct', '{'); this.need('id', 'return');
    const body = this.expr(); this.need('punct', ';'); this.need('punct', '}');
    return { name, params, body };
  }
  allow() {
    this.need('id', 'allow'); const ops = [];
    do { ops.push(this.need('id').v); } while (this.eat('punct', ','));
    this.need('punct', ':'); this.need('id', 'if');
    const cond = this.expr(); this.need('punct', ';');
    return { ops, cond };
  }

  expr() { return this.ternary(); }
  ternary() {
    const c = this.or();
    if (this.eat('punct', '?')) { const a = this.ternary(); this.need('punct', ':'); const b = this.ternary(); return { k: 'cond', c, a, b }; }
    return c;
  }
  or() { let l = this.and(); while (this.eat('op', '||')) l = { k: 'or', l, r: this.and() }; return l; }
  and() { let l = this.eq(); while (this.eat('op', '&&')) l = { k: 'and', l, r: this.eq() }; return l; }
  eq() { let l = this.rel(); for (;;) { const o = this.eat('op', '==') || this.eat('op', '!='); if (!o) return l; l = { k: 'bin', o: o.v, l, r: this.rel() }; } }
  rel() {
    let l = this.add();
    for (;;) {
      const o = this.eat('op', '<') || this.eat('op', '<=') || this.eat('op', '>') || this.eat('op', '>=');
      if (o) { l = { k: 'bin', o: o.v, l, r: this.add() }; continue; }
      if (this.eat('id', 'in')) { l = { k: 'in', l, r: this.add() }; continue; }
      if (this.eat('id', 'is')) { l = { k: 'is', l, type: this.need('id').v }; continue; }
      return l;
    }
  }
  add() { let l = this.mul(); for (;;) { const o = this.eat('op', '+') || this.eat('op', '-'); if (!o) return l; l = { k: 'bin', o: o.v, l, r: this.mul() }; } }
  mul() { let l = this.unary(); for (;;) { const o = this.eat('op', '*') || this.eat('op', '/') || this.eat('op', '%'); if (!o) return l; l = { k: 'bin', o: o.v, l, r: this.unary() }; } }
  unary() { if (this.eat('op', '!')) return { k: 'not', e: this.unary() }; if (this.eat('op', '-')) return { k: 'neg', e: this.unary() }; return this.postfix(); }
  postfix() {
    let e = this.primary();
    for (;;) {
      if (this.eat('punct', '.')) { const n = this.need('id').v; if (this.is('punct', '(')) e = { k: 'method', obj: e, name: n, args: this.args() }; else e = { k: 'member', obj: e, name: n }; }
      else if (this.eat('punct', '[')) { const idx = this.expr(); this.need('punct', ']'); e = { k: 'index', obj: e, idx }; }
      else return e;
    }
  }
  args() { this.need('punct', '('); const a = []; while (!this.is('punct', ')')) { a.push(this.expr()); this.eat('punct', ','); } this.need('punct', ')'); return a; }
  primary() {
    const t = this.next();
    if (!t) fail('unexpected end');
    if (t.t === 'num' || t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'path') return { k: 'path', parts: t.v.map((seg) => seg.map((p) => (typeof p === 'string' ? p : { expr: new Parser(tokenize(p.expr)).expr() }))) };
    if (t.t === 'punct' && t.v === '(') { const e = this.expr(); this.need('punct', ')'); return e; }
    if (t.t === 'punct' && t.v === '[') { const items = []; while (!this.is('punct', ']')) { items.push(this.expr()); this.eat('punct', ','); } this.need('punct', ']'); return { k: 'list', items }; }
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') return { k: 'lit', v: t.v === 'true' };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (this.is('punct', '(')) return { k: 'call', name: t.v, args: this.args() };
      return { k: 'var', name: t.v };
    }
    fail('unexpected token ' + JSON.stringify(t));
  }
}

/* ------------------------------------------------------------ evaluator */
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Ts) && !(v instanceof SetVal);
class SetVal { constructor(a) { this.a = [...new Set(a)]; } }
const eqv = (a, b) => {
  if (a instanceof Ts && b instanceof Ts) return a.ms === b.ms;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eqv(x, b[i]));
  if (isMap(a) && isMap(b)) { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => k in b && eqv(a[k], b[k])); }
  return a === b;
};
const cmpv = (a, b) => {
  if (a instanceof Ts && b instanceof Ts) return a.ms - b.ms;
  if ((typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string')) return a < b ? -1 : a > b ? 1 : 0;
  fail('cannot compare');
};
const TYPES = {
  string: (v) => typeof v === 'string', bool: (v) => typeof v === 'boolean', int: (v) => Number.isInteger(v), float: (v) => typeof v === 'number', number: (v) => typeof v === 'number',
  list: Array.isArray, map: isMap, timestamp: (v) => v instanceof Ts, path: (v) => v && v.__path !== undefined, null: (v) => v === null
};

class Ctx {
  constructor(db, request, resource) { this.db = db; this.request = request; this.resource = resource; }
}

function evaluate(node, env, ctx) {
  const ev = (n) => evaluate(n, env, ctx);
  switch (node.k) {
    case 'lit': return node.v;
    case 'list': return node.items.map(ev);
    case 'path': {
      let s = '';
      for (const seg of node.parts) { s += '/'; for (const p of seg) s += typeof p === 'string' ? p : String(evaluate(p.expr, env, ctx)); }
      return { __path: s };
    }
    case 'var': {
      if (node.name in env.vars) return env.vars[node.name];
      if (node.name === 'request') return ctx.request;
      if (node.name === 'resource') { if (ctx.resource == null) fail('resource is null'); return ctx.resource; }
      fail('unknown variable ' + node.name);
    }
    case 'member': {
      const o = ev(node.obj);
      if (o === null || o === undefined) fail('member of null: ' + node.name);
      if (isMap(o) && node.name in o) return o[node.name];
      fail('missing field ' + node.name);
    }
    case 'index': {
      const o = ev(node.obj), i = ev(node.idx);
      if (Array.isArray(o)) { if (i < 0 || i >= o.length) fail('index out of range'); return o[i]; }
      if (isMap(o) && i in o) return o[i];
      fail('bad index');
    }
    case 'not': { const v = ev(node.e); if (typeof v !== 'boolean') fail('! on non-bool'); return !v; }
    case 'neg': return -ev(node.e);
    case 'cond': { const c = ev(node.c); if (typeof c !== 'boolean') fail('condition not bool'); return c ? ev(node.a) : ev(node.b); }
    case 'and': case 'or': {
      const isAnd = node.k === 'and', short = !isAnd;               // && is decided by false, || by true
      let err = null, l, r;
      try { l = ev(node.l); } catch (e) { if (!(e instanceof RuleError)) throw e; err = e; }
      if (!err && l === short) return short;
      if (!err && typeof l !== 'boolean') fail('non-boolean operand');
      try { r = ev(node.r); } catch (e) { if (!(e instanceof RuleError)) throw e; err = err || e; r = undefined; }
      if (r === short) return short;                                // error absorbed when the other side decides
      if (err) throw err;
      if (typeof r !== 'boolean') fail('non-boolean operand');
      return !short;
    }
    case 'bin': {
      const l = ev(node.l), r = ev(node.r);
      switch (node.o) {
        case '==': return eqv(l, r);
        case '!=': return !eqv(l, r);
        case '<': return cmpv(l, r) < 0;
        case '<=': return cmpv(l, r) <= 0;
        case '>': return cmpv(l, r) > 0;
        case '>=': return cmpv(l, r) >= 0;
        case '+': if (typeof l === 'string' && typeof r === 'string') return l + r; if (typeof l === 'number' && typeof r === 'number') return l + r; fail('bad +');
        case '-': return l - r;
        case '*': return l * r;
        case '/': return l / r;
        case '%': return l % r;
      }
      fail('bad operator');
    }
    case 'in': {
      const l = ev(node.l), r = ev(node.r);
      if (Array.isArray(r)) return r.some((x) => eqv(x, l));
      if (r instanceof SetVal) return r.a.some((x) => eqv(x, l));
      if (isMap(r)) { if (typeof l !== 'string') fail('map key must be string'); return l in r; }
      fail('bad in');
    }
    case 'is': { const v = ev(node.l); const f = TYPES[node.type]; if (!f) fail('unknown type ' + node.type); return !!f(v); }
    case 'method': return callMethod(ev(node.obj), node.name, node.args.map(ev));
    case 'call': {
      const args = node.args.map(ev);
      if (node.name === 'exists' || node.name === 'get') {
        const m = /^\/databases\/[^/]+\/documents\/([^/]+)\/([^/]+)$/.exec(args[0] && args[0].__path);
        if (!m) fail('bad path for ' + node.name);
        const d = ctx.db.read(m[1], m[2]);
        if (node.name === 'exists') return d !== null;
        if (d === null) fail('document does not exist');
        return { data: d.data, id: m[2] };
      }
      const f = env.lookupFunction(node.name);
      if (!f) fail('unknown function ' + node.name);
      const vars = { ...f.scopeVars }; f.params.forEach((p, i) => { vars[p] = args[i]; });
      return evaluate(f.body, { vars, lookupFunction: f.lookup }, ctx);
    }
  }
  fail('bad node ' + node.k);
}

function callMethod(o, name, a) {
  if (typeof o === 'string') {
    if (name === 'lower') return o.toLowerCase();
    if (name === 'upper') return o.toUpperCase();
    if (name === 'size') return o.length;
    if (name === 'matches') { try { return new RegExp('^(?:' + a[0] + ')$').test(o); } catch (_) { fail('bad regex'); } }   // whole-string match, like RE2 in rules
    if (name === 'trim') return o.trim();
  }
  if (Array.isArray(o)) { if (name === 'size') return o.length; if (name === 'hasAny') return a[0].some((x) => o.some((y) => eqv(x, y))); }
  if (isMap(o)) {
    if (name === 'keys') return new SetVal(Object.keys(o));
    if (name === 'size') return Object.keys(o).length;
    if (name === 'get') return a[0] in o ? o[a[0]] : a[1];
  }
  if (o instanceof SetVal) {
    if (name === 'hasOnly') return o.a.every((x) => a[0].some((y) => eqv(x, y)));
    if (name === 'hasAll') return a[0].every((y) => o.a.some((x) => eqv(x, y)));
    if (name === 'hasAny') return a[0].some((y) => o.a.some((x) => eqv(x, y)));
    if (name === 'size') return o.a.length;
  }
  fail(`no method ${name}`);
}

/* ------------------------------------------------------------ public API */
export class RulesEngine {
  constructor(source) { this.roots = new Parser(tokenize(source)).file(); }

  /** op: 'get'|'list'|'create'|'update'|'delete'. segs: ['admins','x@y.z'].
   *  resource/incoming: plain data objects (Ts for timestamps) or null. Returns true only if an `allow` matched and was true. */
  allowed({ op, segs, auth, resource, incoming, time, db }) {
    const request = { auth, time, resource: incoming == null ? null : { data: incoming }, path: segs };
    const res = resource == null ? null : { data: resource, id: segs[segs.length - 1] };
    const ctx = new Ctx(db, request, res);
    const full = ['databases', '(default)', 'documents', ...segs];
    for (const root of this.roots) if (this.walk(root, full, {}, null, op, ctx)) return true;
    return false;
  }

  walk(node, segs, parentVars, parentLookup, op, ctx) {
    const rest = matchPattern(node.pattern, segs, parentVars);
    if (!rest) return false;
    const vars = rest.vars;
    const funcs = {};
    const lookup = (name) => funcs[name] || (parentLookup ? parentLookup(name) : null);
    for (const [name, f] of Object.entries(node.functions)) funcs[name] = { ...f, scopeVars: vars, lookup };
    if (rest.remaining.length === 0) {
      for (const a of node.allows) {
        if (!a.ops.some((o) => o === op || o === 'read' && (op === 'get' || op === 'list') || o === 'write' && ['create', 'update', 'delete'].includes(op))) continue;
        try { if (evaluate(a.cond, { vars, lookupFunction: lookup }, ctx) === true) return true; } catch (e) { if (!(e instanceof RuleError)) throw e; }
      }
    }
    for (const m of node.matches) if (this.walk(m, rest.remaining, vars, lookup, op, ctx)) return true;
    return false;
  }
}

function matchPattern(pattern, segs, vars) {
  const ps = pattern.split('/').filter(Boolean), out = { ...vars }; let i = 0;
  for (const p of ps) {
    const w = /^\{([A-Za-z_]\w*)(=\*\*)?\}$/.exec(p);
    if (w && w[2]) { out[w[1]] = { __path: '/' + segs.slice(i).join('/') }; return segs.length - i >= 1 ? { vars: out, remaining: [] } : null; }
    if (i >= segs.length) return null;
    if (w) out[w[1]] = segs[i]; else if (p !== segs[i]) return null;
    i++;
  }
  return { vars: out, remaining: segs.slice(i) };
}
