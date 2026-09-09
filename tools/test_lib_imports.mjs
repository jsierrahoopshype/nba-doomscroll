/* Does every builder actually import the helpers it calls?
 *
 *     node tools/test_lib_imports.mjs
 *
 * WHY THIS EXISTS
 *
 * buildRace was moved out of build_races.mjs into lib/race.mjs by a script that
 * appended the new import to a line it matched by hand. The literal did not
 * match, the replace was a silent no-op, and the builder shipped having lost
 * the function without gaining the import. It died on the first race:
 *
 *     ReferenceError: buildRace is not defined
 *
 * Two things that should have caught it did not:
 *
 *   node --check   parses syntax. It does not resolve identifiers, so a file
 *                  calling a name nothing defines passes it cleanly.
 *   the test suite  test_race_axis.mjs imports lib/race.mjs directly. The
 *                  library was fine. Nobody was testing the caller, and the
 *                  caller cannot be imported for a test - it builds on load and
 *                  needs three source repos that are not on every machine.
 *
 * WHAT THIS CHECKS
 *
 * Two questions, both about names nothing defines. Neither needs the builders
 * to run, which matters: they read three source repos on start-up and cannot
 * be imported by a test at all.
 *
 *   1. Does a file USE a name some lib module EXPORTS, without importing it?
 *      That is what extracting a function into lib/ breaks.
 *
 *   2. Does a file use a name NOTHING in it declares? That is what a scripted
 *      edit breaks - the replacement removes the lines that declared something
 *      and leaves a line below still using it:
 *
 *          ReferenceError: extra is not defined
 *
 * The second is a crude no-undef, not a scope analyser. It treats the file as
 * one flat namespace, so a name declared anywhere counts everywhere, and it is
 * narrow about what counts as a binding position - declarations, parameter
 * lists, destructuring, object keys. An earlier version was generous about
 * both and swept every `(...)` and `{...}` for names, which bound `extra` out
 * of `console.log(`${extra[0]}`)` and passed the exact orphan it exists to
 * catch. Generous about scope, strict about position, is the combination that
 * works.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, "lib");

let failures = 0;
const line = s => console.log(s);

/* Comments and strings hold names that are not references: the doc block above
 * says "buildRace" a dozen times. Blank them before looking for identifiers.
 *
 * This is a character scanner rather than a chain of .replace() calls, because
 * the chain version was wrong in a way worth recording. It blanked block
 * comments, then line comments, then backtick templates - and a lone backtick
 * inside an ordinary string paired up with a real template delimiter and blanked
 * two thousand lines of code between them. The test then passed on a file with
 * the import deleted, which is the exact bug it was written to catch.
 *
 * One pass, one state at a time, is the only version of this that can be
 * trusted. `${...}` inside a template is kept: it is code, and a race spec is
 * quite capable of calling a lib helper in there. Regex literals are detected
 * by the usual heuristic - a slash right after an operator or an opening
 * bracket starts a pattern, a slash after a value is division - so that a
 * pattern containing a quote does not open a string that never closes. */
function stripNonCode(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  /* One entry per open template literal. 0 means we are in its text; anything
   * higher is the brace depth inside a ${ } hole, which is code. */
  const tmpl = [];
  let prev = "";        // last non-space character emitted, for the regex test
  let prevWord = "";    // last identifier emitted, for `return /re/`

  const emit = ch => {
    out += ch;
    if (!/\s/.test(ch)) prev = ch;
    if (/[\w$]/.test(ch)) prevWord += ch; else prevWord = "";
  };
  const blank = ch => { out += (ch === "\n" ? "\n" : " "); };
  const inTemplateText = () => tmpl.length && tmpl[tmpl.length - 1] === 0;

  const REGEX_AFTER = "(,=:[!&|?{};+-*%~^<>";
  const REGEX_WORDS = new Set(["return", "typeof", "case", "in", "of", "do", "else", "yield", "await"]);

  while (i < n) {
    const c = src[i], c2 = src[i + 1];

    /* Template text swallows everything - comments and quotes included - until
     * its own backtick or a ${ hole. It has to be tested FIRST. */
    if (inTemplateText()) {
      if (c === "\\") { blank(src[i++]); blank(src[i++]); continue; }
      if (c === "`") { tmpl.pop(); blank(c); i++; continue; }
      if (c === "$" && c2 === "{") { tmpl[tmpl.length - 1] = 1; blank(c); emit("{"); i += 2; continue; }
      blank(src[i++]);
      continue;
    }

    if (c === "/" && c2 === "*") {
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) blank(src[i++]);
      blank(" "); blank(" "); i += 2;
      continue;
    }
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") blank(src[i++]);
      continue;
    }
    if (c === '"' || c === "'") {
      blank(c); i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") { blank(src[i++]); if (i < n) blank(src[i++]); continue; }
        blank(src[i++]);
      }
      if (i < n) blank(src[i++]);
      emit(" ");
      continue;
    }
    if (c === "`") { tmpl.push(0); blank(c); i++; continue; }
    if (tmpl.length && c === "{") { tmpl[tmpl.length - 1]++; emit(c); i++; continue; }
    if (tmpl.length && c === "}") { tmpl[tmpl.length - 1]--; emit(c); i++; continue; }

    if (c === "/" && (prev === "" || REGEX_AFTER.includes(prev) || REGEX_WORDS.has(prevWord))) {
      blank(c); i++;
      let cls = false;
      while (i < n) {
        const r = src[i];
        if (r === "\\") { blank(src[i++]); if (i < n) blank(src[i++]); continue; }
        if (r === "\n") break;
        if (r === "[") cls = true;
        else if (r === "]") cls = false;
        else if (r === "/" && !cls) { blank(src[i++]); break; }
        blank(src[i++]);
      }
      while (i < n && /[a-z]/.test(src[i])) blank(src[i++]);
      emit(" ");
      continue;
    }

    emit(c); i++;
  }
  return out;
}

/* The scanner above is the part of this test most able to fail silently: if it
 * blanks too much, everything passes and nothing is checked. So check it. */
function selfTest() {
  const cases = [
    ['const a = "a ` backtick in a string"; foo(); const b = `t`; bar();',
     ["foo", "bar"], ["backtick"],
     "a lone backtick in a string must not open a template - this is the one that broke it"],
    ['const s = `hello ${ nameOf(x) } there`; after();',
     ["nameOf", "after"], ["hello", "there"],
     "code inside ${ } is code; the text around it is not"],
    ['/* buildRace in a comment */ used();', ["used"], ["buildRace"], "block comments go"],
    ['// buildRace here\nused();', ["used"], ["buildRace"], "line comments go"],
    ["const re = /['\"]/; after();", ["after"], [], "a regex holding quotes does not open a string"],
    ['const q = a / b; keep(q);', ["keep"], [], "division is not a regex"]
  ];
  let bad = 0;
  for (const [src, want, notWant, why] of cases) {
    const got = stripNonCode(src);
    for (const w of want) if (!got.includes(w)) { bad++; line("  SELFTEST lost " + w + " - " + why); }
    for (const w of notWant) if (got.includes(w)) { bad++; line("  SELFTEST kept " + w + " - " + why); }
  }
  return bad;
}

/* Names a file brings in, from anywhere. Default and namespace imports count:
 * `import race from "..."` binds `race`.
 *
 * NOTE: stripNonCode has blanked every string literal, so by the time this runs
 * the module specifier is whitespace - there is no "./lib/race.mjs" left to
 * match on. Two earlier versions of this tried to and matched no import at all,
 * which reported all 31 files as broken and would have gone on doing so. The
 * clause is what matters anyway: everything between `import` and `from`,
 * semicolon-free. */
function importedNames(code) {
  const out = new Set();
  const impRe = /import\s+([^;]*?)\s+from\b/g;
  let im;
  while ((im = impRe.exec(code))) {
    const clause = im[1];
    const braces = clause.match(/\{([\s\S]*?)\}/);
    if (braces) {
      for (const part of braces[1].split(",")) {
        const nm = part.trim().split(/\s+as\s+/).pop().trim();
        if (nm) out.add(nm);
      }
    }
    const bare = clause.replace(/\{[\s\S]*?\}/g, "").replace(/,/g, " ").trim();
    for (const nm of bare.split(/\s+/)) {
      if (nm && nm !== "*" && nm !== "as") out.add(nm.replace(/^\*\s*as\s*/, ""));
    }
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) out.add(ns[1]);
  }
  return out;
}

/* Every name a file BINDS, wherever it does so. Deliberately generous about
 * scope - a name declared anywhere counts everywhere - and deliberately NARROW
 * about position. An early version was generous about both, sweeping every
 * `(...)` and `{...}` for identifiers, which bound `extra` out of
 * `console.log(`${extra[0]}`)` and passed the very orphan it was written to
 * catch. Generous about scope, strict about position, is the combination that
 * works.
 *
 * Used by BOTH checks. It started life inside the second one, and while the
 * first had its own narrower version it reported `score` as missing from
 * build_teammates.mjs, where every occurrence is `a.score` or an object key.
 * One definition, one behaviour. */
function boundNames(code) {
  const bound = new Set();
  let m;

  /* function f / class C / const x / let y / var z */
  const declRe = /(?:^|[^.\w$])(?:function\s*\*?\s*|class\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/g;
  while ((m = declRe.exec(code))) bound.add(m[1]);

  /* One declaration, several names:  let cross = 0, guard = 0;
   * declRe catches only the first. Take anything sitting where a declared name
   * sits - immediately before an = or a comma. */
  const listRe = /(?:^|[^.\w$])(?:const|let|var)\s+([^;\n]*)/g;
  while ((m = listRe.exec(code))) {
    let d;
    const nameRe = /([A-Za-z_$][\w$]*)\s*(?==[^=]|,|$)/g;
    while ((d = nameRe.exec(m[1]))) bound.add(d[1]);
  }

  /* Parameter lists, and nothing else that wears parentheses. */
  const paramRes = [
    /\)?\s*\(([^()]*)\)\s*=>/g,                                  // (a, b) =>
    /function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g,          // function f(a, b)
    /function\s*\*?\s*\(([^()]*)\)/g,                             // function (a, b)
    /catch\s*\(([^()]*)\)/g                                       // catch (e)
  ];
  for (const re of paramRes) {
    while ((m = re.exec(code))) {
      for (const nm of m[1].match(/[A-Za-z_$][\w$]*/g) || []) bound.add(nm);
    }
  }
  /* A single arrow parameter needs no parentheses, and this codebase is full
   * of `s => s.trim()`. */
  const arrowRe = /([A-Za-z_$][\w$]*)\s*=>/g;
  while ((m = arrowRe.exec(code))) bound.add(m[1]);

  /* ES6 SHORTHAND METHODS:  { getItem(k) { … } }  and the same inside a class.
   *
   * Neither the name nor its parameters wear the word `function`, so every
   * regex above walks straight past them and the no-undef check then reports
   * the method and all of its arguments as undeclared. It did exactly that to
   * a fixture object in test_scoreboard.mjs, which is how this gap was found -
   * five names, none of them a real bug.
   *
   * Deliberately anchored to the start of a line plus optional indentation.
   * A looser pattern would match any `name(args) {` and quietly bind the
   * parameters of ordinary CALLS, which is most of a file - that would blunt
   * the whole check rather than fix a corner of it. */
  const methodRe = /^[ \t]*(?:static\s+|async\s+|\*\s*|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/gm;
  while ((m = methodRe.exec(code))) {
    /* Control-flow keywords wear the same shape. Binding `if` is harmless but
     * binding the contents of its condition is not. */
    if (/^(if|for|while|switch|catch|return|function|class|do|else)$/.test(m[1])) continue;
    bound.add(m[1]);
    for (const nm of m[2].match(/[A-Za-z_$][\w$]*/g) || []) bound.add(nm);
  }

  /* Destructuring, in the two places it binds:  const { a, b } = x
   * and  const [head, ...rest] = x  (and the for-of forms of both). */
  const destrRes = [
    /(?:const|let|var|of|in)\s*\{([^{}]*)\}/g,
    /(?:const|let|var|of|in)\s*\[([^\[\]]*)\]/g
  ];
  for (const re of destrRes) {
    while ((m = re.exec(code))) {
      for (const nm of m[1].match(/[A-Za-z_$][\w$]*/g) || []) bound.add(nm);
    }
  }

  /* An object key is not a reference to anything. */
  const keyRe = /([A-Za-z_$][\w$]*)\s*:/g;
  while ((m = keyRe.exec(code))) bound.add(m[1]);

  return bound;
}

/* ---- what lib/ offers ---- */

const exportsByName = new Map();          // name -> lib file that exports it
for (const f of fs.readdirSync(LIB).filter(n => n.endsWith(".mjs"))) {
  const code = stripNonCode(fs.readFileSync(path.join(LIB, f), "utf8"));
  const re = /^\s*export\s+(?:async\s+)?(?:function\s+|class\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(code))) exportsByName.set(m[1], "lib/" + f);
}

line("");
failures += selfTest();
line("  lib/ exports " + exportsByName.size + " names across " +
     new Set([...exportsByName.values()]).size + " modules");
line("  " + "-".repeat(66));

/* ---- who calls them ---- */

const callers = fs.readdirSync(HERE)
  .filter(n => n.endsWith(".mjs"))
  .sort();

for (const f of callers) {
  const src = fs.readFileSync(path.join(HERE, f), "utf8");
  const code = stripNonCode(src);

  const imported = importedNames(code);

  /* The same binding analysis the second check uses. It had its own, narrower
   * version, which did not know an object key from a reference and so reported
   * `score` as missing from a file where every occurrence is `a.score`. */
  const local = boundNames(code);

  const missing = [];
  for (const [name, from] of exportsByName) {
    if (imported.has(name) || local.has(name)) continue;
    /* A bare reference, not a property access (obj.buildRace is not this). */
    const used = new RegExp("(?:^|[^.\\w$])" + name.replace(/\$/g, "\\$") + "\\s*(?:\\(|[^\\w$(])", "m");
    if (used.test(code)) missing.push({ name, from });
  }

  if (missing.length) {
    failures += missing.length;
    line("  FAIL  " + f);
    for (const m2 of missing) {
      line("          uses " + m2.name + " - exported by " + m2.from + ", not imported here");
    }
  }
}


/* ---- names used that nothing in the file defines ----
 *
 * The check above catches one shape: a helper moved into lib/ whose import did
 * not land. It does not catch the other shape, which has now happened twice.
 *
 * Replacing a block of code with a scripted edit removes the lines that DECLARE
 * things, and any line below that still USES them survives as an orphan:
 *
 *     ReferenceError: extra is not defined
 *
 * node --check passes it, because that parses syntax and never resolves a name.
 * The tests pass, because a builder cannot be imported by one.
 *
 * This is a crude no-undef. It is not a scope analyser - it does not know inner
 * from outer, and it treats the file as one flat namespace, which is exactly
 * why it has no false positives worth the name: a variable declared ANYWHERE in
 * the file is accepted everywhere in it. What it catches is the case where the
 * declaration is not in the file at all any more.
 */

const GLOBALS = new Set(`
console process Math JSON Object Array String Number Boolean Date Map Set
WeakMap WeakSet Promise RegExp Error TypeError RangeError SyntaxError Buffer
fetch URL URLSearchParams AbortController AbortSignal Response Request Headers
setTimeout clearTimeout setInterval clearInterval queueMicrotask setImmediate
structuredClone TextEncoder TextDecoder globalThis Symbol Reflect Proxy Intl
BigInt isNaN isFinite parseInt parseFloat encodeURIComponent decodeURIComponent
encodeURI decodeURI performance require module exports __dirname __filename
Infinity NaN undefined null true false this arguments
Function eval escape unescape btoa atob crypto navigator
if else for while do switch case default break continue return function const
let var new typeof instanceof in of try catch finally throw class extends super
import export from as await async yield delete void static get set delete
`.trim().split(/\s+/));

let undef = 0;
for (const f of callers) {
  const code = stripNonCode(fs.readFileSync(path.join(HERE, f), "utf8"));

  const bound = boundNames(code);

  const imported = importedNames(code);

  const missing = new Set();
  const useRe = /(?:^|[^.\w$?])([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = useRe.exec(code))) {
    const nm = m[1];
    if (bound.has(nm) || imported.has(nm) || GLOBALS.has(nm)) continue;
    if (exportsByName.has(nm)) continue;   // already reported above
    missing.add(nm);
  }
  if (missing.size) {
    undef += missing.size;
    line("  FAIL  " + f);
    for (const nm of missing) line("          uses " + nm + " - nothing in the file declares it");
  }
}
failures += undef;

line("  " + callers.length + " files in tools/ checked");
line("");
line(failures
  ? "  " + failures + " name(s) nothing defines. node --check will not tell you this."
  : "  every name a builder uses, it imports or declares.");
line("");
process.exit(failures ? 1 : 0);
