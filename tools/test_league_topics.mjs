/* Which entity-less posts Buzz is allowed to keep.
 *
 *     node tools/test_league_topics.mjs
 *
 * Buzz drops anything with no player or team tag, and that rule is load
 * bearing: the accounts this feed follows post about their own lives and other
 * sports between NBA posts. The league-topic exemption punches a hole in it, so
 * the hole has to be exactly the right size.
 *
 *   TOO TIGHT and the tab keeps missing the league's own conversation - Silver,
 *   the CBA, expansion, officiating, the TV deal.
 *
 *   TOO LOOSE and every untagged post about somebody's dinner comes back, which
 *   is the state this rule was written to escape. That is the failure worth
 *   testing, because it arrives quietly: the tab just fills with noise.
 *
 * The term lists are read from data/buzz-sources.json, the real config, so this
 * cannot pass against an imaginary one. The post text is invented.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
new Function("window", fs.readFileSync(path.join(REPO, "js/buzz.js"), "utf8"))(win);
const leagueTopic = win.LiveBuzz.leagueTopic;
const CFG = JSON.parse(fs.readFileSync(path.join(REPO, "data", "buzz-sources.json"), "utf8"));

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};
const hit = (title, body) => leagueTopic({ title: title, body_excerpt: body || "" }, CFG);

console.log("\nthe config this is judged against");

{
  const lt = CFG.league_topics || {};
  ck("league_topics exists and is on", lt.on === true);
  ck("it has both tiers and the markers",
     (lt.strong || []).length > 5 && (lt.weak || []).length > 5 && (lt.markers || []).length > 1,
     (lt.strong || []).length + " strong, " + (lt.weak || []).length + " weak");
  ck("no term appears in both tiers, which would make the weak rule dead code",
     !(lt.weak || []).some(w => (lt.strong || []).indexOf(w) >= 0));
}

console.log("\nwhat gets in, naming nobody");

{
  ck("Adam Silver", !!hit("Adam Silver spoke about an invented plan."));
  ck("the board of governors", !!hit("The board of governors met about an invented item."));
  ck("NBA Europe", !!hit("An invented update on NBA Europe."));
  ck("collective bargaining", !!hit("An invented note on collective bargaining."));
  ck("the draft lottery", !!hit("Invented reaction to the draft lottery."));
  ck("the second apron", !!hit("An invented explainer on the second apron."));
  ck("a term in the body, not the title",
     !!hit("An invented headline", "Deep in the post, load management came up."));
}

console.log("\nwhat needs a marker before it counts");

{
  /* These are the words four other leagues also use. Alone they must not open
   * the gate; alongside an NBA marker they must. */
  ck("bare expansion does not qualify", !hit("An invented story about expansion."));
  ck("NBA expansion does", !!hit("An invented story about NBA expansion."));
  ck("bare officiating does not", !hit("Invented complaints about officiating."));
  ck("league officiating does", !!hit("Invented complaints about league officiating."));
  ck("bare ratings do not", !hit("The invented ratings were up."));
  ck("basketball ratings do", !!hit("The invented basketball ratings were up."));
  ck("bare salary cap does not", !hit("An invented salary cap question."));
  ck("NBA salary cap does", !!hit("An invented NBA salary cap question."));
}

console.log("\nwhat stays out");

{
  /* THE ONE THAT MATTERS. This is the material the entity rule exists to drop,
   * and the exemption must not hand any of it back. */
  ck("somebody's dinner", !hit("An invented post about what I had for dinner."));
  ck("a podcast plug", !hit("New invented episode is up, link in bio."));
  ck("a joke with no subject", !hit("An invented joke that lands on nobody."));
  ck("an empty post", !hit(""));
  ck("a post that is only a marker", !hit("nba"));
  ck("a null item does not throw", leagueTopic(null, CFG) === null);
  ck("a missing config does not throw", leagueTopic({ title: "Adam Silver" }, {}) === null);
  ck("on:false switches the whole thing off",
     leagueTopic({ title: "Adam Silver spoke" },
                 { league_topics: Object.assign({}, CFG.league_topics, { on: false }) }) === null);
}

console.log("\nword boundaries");

{
  /* A substring match here would be worse than useless: "apron" inside
   * "aprons", "officials" inside "unofficially". */
  ck("a term inside a longer word does not match",
     !hit("An invented note on NBA aproned chefs."));
  ck("but the term itself, punctuated, does",
     !!hit("An invented note on the NBA apron."));
  ck("hyphens are not a barrier",
     !!hit("An invented note on the NBA play-in tournament."));
  ck("case does not matter", !!hit("ADAM SILVER said an invented thing."));
}

console.log("\nwhat it returns");

{
  const t = hit("Adam Silver spoke about an invented plan.");
  ck("it returns the term that matched, not just true", typeof t === "string" && t.length > 3, t);
  ck("and null, not false, when nothing matched", hit("nothing here") === null);
}

console.log(fail ? "\n" + fail + " failure(s)"
                 : "\nthe league's own conversation gets in; the noise still does not");
process.exit(fail ? 1 : 0);
