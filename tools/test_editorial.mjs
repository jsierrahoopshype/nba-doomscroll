/* The editorial classification, against every card that actually exists.
 *
 *     node tools/test_editorial.mjs
 *
 * WHY THIS IS THE IMPORTANT TEST IN THE SET
 *
 * A classification map is the kind of thing that looks finished and is not. It
 * was written by reading the pools as they are today, and the failure mode is
 * silent: add a pool, or change one builder's `category`, and those cards fall
 * through to `other`. `other` is not a bucket the scheduler has targets for,
 * so they would be served by whatever the fallback path does - which is how the
 * feed got database-heavy in the first place.
 *
 * So this suite refuses a fallthrough. Every card in every committed pool must
 * match on (type, category) exactly. Nothing is allowed to land on the
 * type-only fallback or on `other`, and a new pool therefore fails the suite
 * until somebody has made an editorial decision about it. That is the point.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  classify, bucketOf, hasTrait, typeOf, categoryOf,
  BUCKETS, TRAITS, BY_TYPE_CATEGORY
} from "./lib/editorial.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const DATA = path.join(REPO, "data");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* Every pool the repo ships, read the way For You reads them. */
const pools = fs.readdirSync(DATA).filter(f => /-pool\.json$/.test(f)).sort();
const all = [];
for (const f of pools) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); }
  catch (e) { ck(`${f} parses`, false, e.message); continue; }
  for (const c of (j.cards || [])) all.push(Object.assign({ _pool: f }, c));
}

console.log(`\nthe corpus: ${all.length} cards across ${pools.length} pools`);
ck("there are cards to classify", all.length > 1000, all.length + " cards");

console.log("\nnothing falls through");

{
  /* THE ASSERTION THIS FILE EXISTS FOR. */
  const loose = all.filter(c => classify(c).matched !== "type|category");
  const byKey = new Map();
  for (const c of loose) {
    const k = typeOf(c) + "|" + categoryOf(c) + "  (" + c._pool + ")";
    byKey.set(k, (byKey.get(k) || 0) + 1);
  }
  ck("every card matches on type AND category", loose.length === 0,
     loose.length
       ? `${loose.length} card(s) fell back: ` +
         [...byKey].slice(0, 6).map(([k, n]) => `${k} x${n}`).join("  |  ")
       : "");

  const other = all.filter(c => bucketOf(c) === "other");
  ck("nothing lands in the `other` bucket", other.length === 0,
     other.length ? `${other.length} card(s), e.g. ${typeOf(other[0])}|${categoryOf(other[0])}` : "");
}

console.log("\nthe map is a map, not a pile");

{
  const badBucket = Object.entries(BY_TYPE_CATEGORY)
    .filter(([, v]) => BUCKETS.indexOf(v.bucket) < 0);
  ck("every row's bucket is a declared bucket", badBucket.length === 0,
     badBucket.map(([k, v]) => k + " -> " + v.bucket).join(", "));

  const badTrait = [];
  for (const [k, v] of Object.entries(BY_TYPE_CATEGORY)) {
    for (const t of v.traits) if (TRAITS.indexOf(t) < 0) badTrait.push(k + " -> " + t);
  }
  ck("every row's traits are declared traits", badTrait.length === 0, badTrait.join(", "));

  /* A row nothing matches is either a typo or a pool that no longer exists.
   * Live types are exempt: buzz and trades are fetched in the browser and are
   * correctly absent from every committed pool. */
  const seen = new Set(all.map(c => typeOf(c) + "|" + categoryOf(c)));
  const dead = Object.keys(BY_TYPE_CATEGORY)
    .filter(k => !seen.has(k))
    .filter(k => !/^(buzz|trade|tradetrend|tradedigest|traderank|rumor|daily)\|/.test(k));
  ck("no row is dead weight", dead.length === 0,
     dead.length ? dead.join(", ") + "  (nothing in any pool matches these)" : "");
}

console.log("\nthe distinctions that a type-only map could not make");

{
  /* Each of these pairs shares a `type` and belongs in different buckets. If
   * the classification ever collapses back to type alone, these are what
   * break, and they are the reason the feed over-served awards material. */
  const pick = (pool, n) => (all.find(c => c._pool === pool) || null);

  const careerOddity = pick("career-pool.json");
  const ballotOddity = pick("oddity-pool.json");
  const awardHistory = pick("award-history-pool.json");
  const standingRec  = pick("record-pool.json");
  ck("career oddities are history", careerOddity && bucketOf(careerOddity) === "history_record",
     careerOddity && typeOf(careerOddity) + "|" + categoryOf(careerOddity) + " -> " + bucketOf(careerOddity));
  ck("ballot oddities are awards, though both are type `oddity`",
     ballotOddity && bucketOf(ballotOddity) === "awards_voting",
     ballotOddity && bucketOf(ballotOddity));
  ck("award-history stories are awards, per the brief, not generic history",
     awardHistory && bucketOf(awardHistory) === "awards_voting",
     awardHistory && bucketOf(awardHistory));
  ck("standing records are history", standingRec && bucketOf(standingRec) === "history_record",
     standingRec && bucketOf(standingRec));

  const realRace = all.find(c => typeOf(c) === "race" && categoryOf(c) === "team");
  const ballotRace = pick("ballotrace-pool.json");
  ck("a team race is a comparison", realRace && bucketOf(realRace) === "comparison",
     realRace && bucketOf(realRace));
  ck("a ballot race is awards voting, though both are type `race`",
     ballotRace && bucketOf(ballotRace) === "awards_voting",
     ballotRace && bucketOf(ballotRace));
  /* AND IT KEEPS THE ANIMATION TRAITS. This is the case that justifies traits
   * existing at all: one card is awards-voting by subject and a media-heavy
   * animation by mechanism, and both facts have to survive. */
  ck("and it is still media-heavy and autoplay",
     ballotRace && hasTrait(ballotRace, "media_heavy") && hasTrait(ballotRace, "autoplay"));
}

console.log("\nCap Call is a game, not a salary card");

{
  const capcall = all.find(c => typeOf(c) === "capcall");
  const passive = all.find(c => bucketOf(c) === "money_cap_static");
  ck("Cap Call's bucket is `game`", capcall && bucketOf(capcall) === "game",
     capcall && bucketOf(capcall));
  ck("and it is playable", capcall && hasTrait(capcall, "playable"));
  /* It still declares its subject, so a scheduler can keep it away from a
   * passive salary card without having to treat it as one. */
  ck("but it still says it is about money", capcall && hasTrait(capcall, "money_related"));
  ck("a passive salary card is NOT playable",
     passive && !hasTrait(passive, "playable"),
     passive && typeOf(passive) + "|" + categoryOf(passive));
}

console.log("\nthe playable set, and Guess the Player inside it");

{
  const playable = all.filter(c => hasTrait(c, "playable"));
  const gtp = all.filter(c => hasTrait(c, "guess_the_player"));
  const kinds = new Set(playable.map(c => typeOf(c)));
  ck("several different games are playable", kinds.size >= 5,
     [...kinds].sort().join(", "));
  ck("Guess the Player carries its own trait", gtp.length > 0, gtp.length + " cards");
  /* §9 caps Guess the Player separately from other playables, so the trait has
   * to be narrower than `playable` or the cap would throttle Career Map and
   * Dream Team too. */
  ck("and that trait is narrower than `playable`", gtp.length < playable.length,
     `${gtp.length} of ${playable.length} playable cards`);
  ck("Career Map and Dream Team are playable but not Guess the Player",
     ["careermap", "dreamteam"].every(t => {
       const c = all.find(x => typeOf(x) === t);
       return c && hasTrait(c, "playable") && !hasTrait(c, "guess_the_player");
     }));
}

console.log("\nwhat the corpus actually contains, by bucket");

{
  const byBucket = {};
  for (const c of all) byBucket[bucketOf(c)] = (byBucket[bucketOf(c)] || 0) + 1;
  const total = all.length;
  for (const b of Object.keys(byBucket).sort((a, b2) => byBucket[b2] - byBucket[a])) {
    const n = byBucket[b];
    console.log(`  ${b.padEnd(18)}${String(n).padStart(6)}  ${(100 * n / total).toFixed(1)}% of the archive`);
  }
  /* NOT A TARGET - the archive's shape is not the feed's shape, and the whole
   * job of the scheduler is that they differ. Printed because the contrast is
   * the argument: there is no `live` here at all, so a sampler left to the
   * archive alone can only ever produce a database feed. */
  ck("the archive contains no live cards, which is why a scheduler is needed",
     !byBucket.live, byBucket.live ? byBucket.live + " live cards found in pools" : "");
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "a card would reach the feed with no editorial identity"
                 : "every card in every pool knows what it is");
process.exit(fail ? 1 : 0);
