/* Which rumors a calendar day gets to show.
 *
 *     node tools/test_onthisday.mjs
 *
 * EVERY FIXTURE BELOW IS INVENTED. Not a paraphrase, not a shortened real one -
 * made up. The archive content rule applies to test files exactly as it does
 * to everything else, and a test fixture is the easiest place in a repo for
 * real content to end up sitting in public forever.
 *
 * build_rumors_onthisday.mjs downloads 435 MB on start-up, so the rules live in
 * lib/onthisday.mjs and this is what checks them.
 */

import { isBlocked, score, pickForDay, forStorage, trim, TEXT_CAP, QUOTE_CAP } from "./lib/onthisday.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

const e = (year, opts) => Object.assign({
  year,
  date: year + "-03-14",
  text: "Invented placeholder sentence for a test fixture.",
  quote: null,
  outlet: "Test Outlet",
  url: "https://example.invalid/" + year,
  tags: []
}, opts || {});

console.log("\nthe editorial filter");

{
  const bl = { terms: ["arrested"], whole: new Set(["dui"]) };
  ck("a blocked term anywhere blocks the entry",
     isBlocked(e(2020, { text: "He was arrested downtown" }), bl));
  ck("a clean entry passes", !isBlocked(e(2020), bl));

  /* whole-word terms are on that list precisely because they appear inside
   * innocent words. Matching them as substrings would block half the archive. */
  ck("a whole-word term matches as a word", isBlocked(e(2020, { text: "a dui charge" }), bl));
  ck("and NOT inside a longer word", !isBlocked(e(2020, { text: "he plays for dudley" }), bl));

  ck("the quote is searched too", isBlocked(e(2020, { quote: "I was arrested" }), bl));
  ck("the tags are searched too", isBlocked(e(2020, { tags: ["arrested"] }), bl));
  ck("the outlet is searched too", isBlocked(e(2020, { outlet: "Arrested Weekly" }), bl));

  /* THE ONE THAT MATTERS. No list means no filter, and no filter must mean
   * nothing passes - the same fail-closed choice js/rumors.js makes. */
  ck("no blocklist blocks EVERYTHING rather than passing it", isBlocked(e(2020), null));
  ck("an empty list still blocks nothing that is clean",
     !isBlocked(e(2020), { terms: [], whole: new Set() }));
}

console.log("\nwhat makes a card worth showing");

{
  const plain = e(2020);
  const quoted = e(2020, { quote: "An invented quotation." });
  const tagged = e(2020, { tags: ["A Player"] });
  ck("a real quote outweighs a tag", score(quoted) > score(tagged));
  ck("a tag beats nothing", score(tagged) > score(plain));
  ck("length only breaks near-ties",
     score(e(2020, { text: "x".repeat(280) })) - score(plain) < 1,
     (score(e(2020, { text: "x".repeat(280) })) - score(plain)).toFixed(2));
  ck("scoring an empty object does not throw", typeof score({}) === "number");
}

console.log("\nspreading a day across the years");

{
  /* The real shape of the problem: one year floods the day. */
  const flood = [];
  for (let i = 0; i < 400; i++) flood.push(e(2021, { quote: "q" + i }));
  for (const y of [2012, 2015, 2018, 2024]) flood.push(e(y));

  const got = pickForDay(flood, 30, 3);
  const from2021 = got.filter(x => x.year === 2021).length;
  ck("no year exceeds its cap, however many it has", from2021 === 3, from2021 + " from 2021");
  ck("the quiet years are represented",
     [2012, 2015, 2018, 2024].every(y => got.some(x => x.year === y)),
     [...new Set(got.map(x => x.year))].sort().join(","));
  ck("without the cap it would have been all one year",
     flood.filter(x => x.year === 2021).length === 400);
}

{
  /* A day where only three years have anything should still fill up. */
  const thin = [];
  for (const y of [2019, 2020, 2021]) for (let i = 0; i < 5; i++) thin.push(e(y));
  const got = pickForDay(thin, 30, 3);
  ck("a thin day takes perYear from each rather than one each",
     got.length === 9, String(got.length));
}

{
  const many = [];
  for (let y = 2010; y <= 2025; y++) for (let i = 0; i < 5; i++) many.push(e(y));
  const got = pickForDay(many, 30, 3);
  ck("the per-day cap is hard", got.length === 30, String(got.length));
  ck("newest years come first", got[0].year === 2025, String(got[0].year));
  ck("and the cap is what stops it, not the supply", many.length === 80);
}

{
  ck("an empty day returns nothing", pickForDay([], 30, 3).length === 0);
  ck("undefined does not throw", pickForDay(undefined, 30, 3).length === 0);
  ck("nulls in the list are skipped", pickForDay([null, e(2020), null], 30, 3).length === 1);
  ck("an entry with no usable year is dropped, not counted as year NaN",
     pickForDay([{ text: "x", date: "not-a-date" }], 30, 3).length === 0);
  ck("a zero cap falls back to a sane default rather than returning nothing",
     pickForDay([e(2020)], 0, 0).length === 1);
}

{
  /* Within a year, the better card wins the first slot. */
  const year = [e(2020, { url: "plain" }), e(2020, { url: "quoted", quote: "q" })];
  const got = pickForDay(year, 1, 3);
  ck("the quoted entry takes the single slot", got[0].url === "quoted", got[0].url);
}

console.log("\nhow much of an entry survives the cut");

/* THE BUG THIS PINS DOWN. The first build cut both fields at a flat 280
 * characters. `text` is the passage and `quote` is the excerpt inside it that
 * the card underlines and links, so a cut landing before the end of that
 * excerpt leaves a bucket the card cannot draw a link on - and it fails
 * silently, falling back to linking the outlet. Roughly a third of the buckets
 * were built that way. */
{
  /* The excerpt sits PAST the cap, which is the case that used to break. */
  const before = "A".repeat(TEXT_CAP + 100);
  const excerpt = "THE INVENTED EXCERPT";
  const passage = before + excerpt + "B".repeat(200);

  ck("a blind cut at the cap would have lost the excerpt",
     passage.slice(0, TEXT_CAP).indexOf(excerpt) < 0);
  ck("and the old flat 280 would have lost it too",
     passage.slice(0, 280).indexOf(excerpt) < 0);

  const cut = trim(passage, excerpt);
  ck("trim keeps the excerpt inside the passage",
     cut.text.indexOf(excerpt) >= 0, "cut to " + cut.text.length + " chars");
  ck("the cut lands right at the end of it, not further",
     cut.text.length === before.length + excerpt.length,
     cut.text.length + " vs " + (before.length + excerpt.length));
  ck("what came after the excerpt is dropped, which is the cheap loss",
     cut.text.indexOf("B") < 0);
  ck("the excerpt itself comes back whole", cut.quote === excerpt);
}

{
  /* The common case, by a distance: the passage is well under the cap and
   * nothing is cut at all. Median passage in the archive is 442 characters. */
  const whole = "An invented passage of ordinary length.";
  const cut = trim(whole, "invented passage");
  ck("a short passage is not touched", cut.text === whole);
  ck("nor its excerpt", cut.quote === "invented passage");
}

{
  const long = "C".repeat(TEXT_CAP + 500);
  ck("with no excerpt at all the cap is just a cap",
     trim(long, null).text.length === TEXT_CAP);
  ck("and the quote stays null, not empty string", trim(long, null).quote === null);
}

{
  /* An excerpt the passage does not contain - typography the two fields
   * disagree on. There is nothing to protect, so the plain cap applies. */
  const long = "D".repeat(TEXT_CAP + 500);
  ck("an excerpt that is not in the passage does not extend the cut",
     trim(long, "not in there").text.length === TEXT_CAP);
}

{
  const huge = "E".repeat(QUOTE_CAP + 200);
  ck("a runaway excerpt is capped too",
     trim("x", huge).quote.length === QUOTE_CAP, String(trim("x", huge).quote.length));
}

{
  ck("null text does not throw", trim(null, null).text === "");
  ck("the caps are the measured ones, not the old flat 280",
     TEXT_CAP > 280 && QUOTE_CAP > 280, TEXT_CAP + "/" + QUOTE_CAP);
}

console.log("\nwhat gets stored");

{
  const stored = forStorage(e(2020, { quote: "q", tags: ["A Player"] }));
  ck("the working score is not shipped", !("s" in stored) && !("year" in stored),
     Object.keys(stored).join(","));
  ck("the link survives, because every card has to lead back",
     stored.url === "https://example.invalid/2020");
  ck("a missing outlet gets the house name", forStorage(e(2020, { outlet: null })).outlet === "HoopsHype");
  ck("a missing quote is null, not undefined", forStorage(e(2020)).quote === null);
  ck("tags are always an array", Array.isArray(forStorage({ tags: null }).tags));
}

console.log(fail ? "\n" + fail + " failure(s)" : "\na day is sixteen years of the league, not one afternoon");
process.exit(fail ? 1 : 0);
