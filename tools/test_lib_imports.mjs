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
 * Not a linter. One question only, which is the question that shape of bug
 * always answers wrongly: does a tools/*.mjs file USE a name that a lib module
 * EXPORTS, without importing it and without defining it itself?
 *
 * That is exactly what extracting a function into lib/ can break, and it is
 * checkable without running anything or resolving the source repos.
 *
 * A name defined locally is fine (a file may have its own `money`). A name
 * imported is fine. A name that is neither, and that some lib exports, is the
 * bug - the extraction happened and the import did not land.
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

  /* Names this file brings in, from anywhere. Default and namespace imports
   * count too - `import race from "..."` binds `race`. */
  const imported = new Set();
  /* NOTE: stripNonCode has blanked every string literal, so by the time this
   * runs the module specifier is whitespace - there is no "./lib/race.mjs" left
   * to match on. Two earlier versions of this line tried to and matched no
   * import at all, which reported all 31 files as broken and would have
   * reported them as broken forever. The clause is what matters anyway, and it
   * is everything between `import` and `from`, semicolon-free. */
  const impRe = /import\s+([^;]*?)\s+from\b/g;
  let im;
  while ((im = impRe.exec(code))) {
    const clause = im[1];
    const braces = clause.match(/\{([\s\S]*?)\}/);
    if (braces) {
      for (const part of braces[1].split(",")) {
        const nm = part.trim().split(/\s+as\s+/).pop().trim();
        if (nm) imported.add(nm);
      }
    }
    const bare = clause.replace(/\{[\s\S]*?\}/g, "").replace(/,/g, " ").trim();
    for (const nm of bare.split(/\s+/)) {
      if (nm && nm !== "*" && nm !== "as") imported.add(nm.replace(/^\*\s*as\s*/, ""));
    }
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) imported.add(ns[1]);
  }

  /* Names this file defines for itself, at any depth. Deliberately generous:
   * a false "it's local" only costs us a miss, a false "it's missing" costs a
   * failing test on working code. */
  const local = new Set();
  const declRe = /(?:^|[^.\w$])(?:function\s*\*?\s*|class\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/g;
  let dm;
  while ((dm = declRe.exec(code))) local.add(dm[1]);
  /* const { a, b } = ... and function params named after a lib export. */
  const destrRe = /(?:const|let|var)\s*\{([^}]*)\}\s*=/g;
  while ((dm = destrRe.exec(code))) {
    for (const part of dm[1].split(",")) {
      const nm = part.trim().split(/[:=]/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) local.add(nm);
    }
  }

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

line("  " + callers.length + " files in tools/ checked");
line("");
line(failures
  ? "  " + failures + " missing import(s). node --check will not tell you this."
  : "  every lib name a builder calls, it imports.");
line("");
process.exit(failures ? 1 : 0);
