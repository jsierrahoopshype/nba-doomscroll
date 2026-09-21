/* The Beat the Dream Team card's markup, against what answers and reveals it.
 *
 *     node tools/test_dreamteam_markup.mjs
 *
 * WHY A TEST FOR A CSS SELECTOR
 *
 * This card has no code of its own. It borrows the ballot mechanic from
 * js/app.js for answering, and it borrows one attribute for the reveal:
 * answerQuiz() sets data-done on the .quiz-opts wrapper, and css/styles.css
 * turns that into `visibility:visible` for the ten scoring averages and the two
 * totals.
 *
 * So the contract lives in THREE files and is enforced in none of them. Rename
 * .dt-ppg, or change the attribute, or drop the rule, and the card still
 * renders, still answers, still marks right and wrong, still logs the
 * engagement - and never shows the arithmetic the whole card is about. There is
 * no error, no console warning, nothing in a build log. A reader just taps and
 * sees no numbers.
 *
 * Every hook below is read OUT of app.js and styles.css rather than restated
 * here, so a rename on any side fails here instead of in a reader's hands.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

const win = {};
new Function("window", "document", fs.readFileSync(path.join(REPO, "js", "cards.js"), "utf8"))(
  win, { createElement: () => ({}) });
const C = win.DoomCards;
const appSrc = fs.readFileSync(path.join(REPO, "js", "app.js"), "utf8");
const css = fs.readFileSync(path.join(REPO, "css", "styles.css"), "utf8");

const five = (prefix, season, vals) => ({
  label: prefix,
  total: Math.round(vals.reduce((n, v) => n + v, 0) * 10) / 10,
  players: vals.map((v, i) => ({ name: prefix + " Man " + i, season, ppg: v }))
});

const card = {
  id: "dreamteam-1960s-v-2010s-test", type: "dreamteam", tab: ["quiz"],
  tags: { content_type: "dreamteam", players: [], teams: [], era: "1960s", category: "game" },
  payload: {
    question: "Which five averaged more points a game between them?",
    squads: [five("1960s", "1962-63", [30.1, 24.2, 22.0, 20.5, 18.4]),
             five("2010s", "2015-16", [28.2, 25.0, 21.1, 19.0, 17.5])],
    answer_idx: 0,
    detail: "The 1960s five add up to 115.2 a game, the 2010s five to 110.8.",
    url: "https://hoopsmatic.com/dream-team-game",
    cta: "Build a five of your own"
  }
};

const html = String(C.render(card));

console.log("\nit renders at all");

ck("the renderer is reached", html.length > 200, html.length + " chars");
ck("the question is on it", html.indexOf(card.payload.question) >= 0);
ck("both squads are labelled",
   html.indexOf(">1960s<") >= 0 && html.indexOf(">2010s<") >= 0);
ck("all ten men are named",
   card.payload.squads.every(s => s.players.every(m => html.indexOf(m.name) >= 0)));
ck("all ten seasons are shown",
   (html.match(/class="dt-season"/g) || []).length === 10,
   String((html.match(/class="dt-season"/g) || []).length));

console.log("\nthe answer mechanic it borrows");

ck("app.js routes data-action=\"ballot\" to the answer handler",
   /action === "quiz" \|\| action === "ballot"/.test(appSrc));
ck("and there are exactly two panels carrying it",
   (html.match(/data-action="ballot"/g) || []).length === 2,
   String((html.match(/data-action="ballot"/g) || []).length) + " panels");

ck("app.js reads the answer from .quiz-opts[data-answer-idx]",
   /querySelector\(["']\.quiz-opts["']\)/.test(appSrc) && /dataset\.answerIdx/.test(appSrc));
ck("and the card puts it there",
   /class="quiz-opts dt-opts" data-answer-idx="0"/.test(html),
   (html.match(/data-answer-idx="[^"]*"/) || ["(absent)"])[0]);

ck("app.js indexes the winning panel by that number",
   /wrap\.children\[Number\(wrap\.dataset\.answerIdx\)\]/.test(appSrc));
ck("so the panels must be the wrapper's own children, in order",
   /data-pick="0"[\s\S]*data-pick="1"/.test(html) &&
   !/data-pick="2"/.test(html));

ck("app.js writes the outcome into .quiz-result",
   /querySelector\(["']\.quiz-result["']\)/.test(appSrc));
ck("and the card provides one, hidden", /<div class="quiz-result" hidden><\/div>/.test(html));
ck("app.js shows payload.detail there", /card\.payload\.detail/.test(appSrc));

console.log("\nthe reveal, which is one attribute and one CSS rule");

/* The three-way contract. Each side is read from its own file. */
ck("app.js sets data-done on the wrapper when an answer lands",
   /wrap\.dataset\.done = "1"/.test(appSrc),
   (appSrc.match(/wrap\.dataset\.done = "1"/) || ["(absent)"])[0]);

const revealRule = (css.match(/\.quiz-opts\[data-done\][^{]*\{[^}]*\}/) || [])[0] || "";
ck("the stylesheet has a rule keyed on that attribute", !!revealRule,
   revealRule || "(no [data-done] rule)");
ck("and it makes things visible rather than merely styling them",
   /visibility\s*:\s*visible/.test(revealRule), revealRule.slice(0, 90));

/* THE PAIRING. Every class the reveal rule names must actually be rendered,
 * and every one of them must start hidden - a class that is revealed but was
 * never hidden is a number the reader sees before guessing. */
const revealed = [...revealRule.matchAll(/\.(dt-[a-z-]+)/g)].map(m => m[1]);
ck("the reveal rule names at least the averages and the totals",
   revealed.includes("dt-ppg") && revealed.includes("dt-total"),
   revealed.join(", ") || "(none)");
for (const cls of revealed) {
  const rendered = html.indexOf('class="' + cls + '"') >= 0;
  ck(`.${cls} is rendered by the card`, rendered,
     rendered ? "" : (html.indexOf(cls) >= 0 ? "present but not as its own class" : "not rendered"));
  const own = (css.match(new RegExp("\\n\\." + cls + "\\{[^}]*\\}")) || [])[0] || "";
  const hidden = /visibility\s*:\s*hidden/.test(own);
  ck(`.${cls} starts hidden`, hidden,
     hidden ? "" : (own ? own.replace(/\s+/g, " ").slice(0, 80) : "no base rule found"));
}

console.log("\nwhat the reader must NOT see before answering");

/* The numbers are in the markup, hidden by CSS. That is a deliberate trade and
 * it has one hard requirement: they must never be in the markup UNhidden, and
 * the question itself must not contain the answer. */
ck("no scoring average is printed outside a dt-ppg or dt-total span",
   (() => {
     const stripped = html
       .replace(/<span class="dt-ppg">[^<]*<\/span>/g, "")
       .replace(/<span class="dt-total">[^<]*<\/span>/g, "")
       .replace(/<span class="dt-season">[^<]*<\/span>/g, "");
     return !/\b\d{2}\.\d\b/.test(stripped);
   })(),
   (html.replace(/<span class="dt-(ppg|total|season)">[^<]*<\/span>/g, "")
        .match(/\b\d{2}\.\d\b/) || ["(none, correct)"])[0]);
ck("and the detail line is not in the markup before the answer",
   html.indexOf(card.payload.detail) < 0);

console.log("\nthe tap-through");

{
  const tap = C.tapTarget(card);
  ck("it goes to the game", !!tap && tap.url === "https://hoopsmatic.com/dream-team-game",
     tap && tap.url);
  ck("with the card's own label", !!tap && tap.label === "Build a five of your own",
     tap && tap.label);
}

console.log("\nescaping");

{
  const nasty = JSON.parse(JSON.stringify(card));
  nasty.payload.question = 'Which <script>alert(1)</script> five?';
  nasty.payload.squads[0].label = '<img src=x onerror=alert(1)>';
  nasty.payload.squads[0].players[0].name = '"><script>alert(1)</script>';
  const h = String(C.render(nasty));
  ck("no raw script tag survives", h.indexOf("<script>") < 0);
  ck("no live event handler is introduced", (h.match(/onerror="/g) || []).length === 0,
     String((h.match(/onerror=/g) || []).length) + " counting escaped text");
  ck("the payload came through escaped instead",
     h.indexOf("&lt;img src=x onerror=alert(1)&gt;") >= 0);
  ck("and the panel attributes are not broken out of",
     (h.match(/data-action="ballot"/g) || []).length === 2);
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the card would answer and never show what it was asking about"
                 : "it renders, it answers, and the reveal it borrows still fires");
process.exit(fail ? 1 : 0);
