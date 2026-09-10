/* Does a tile ever fail to meet its own source file?
 *
 *     node tools/test_tile_slugs.mjs
 *
 * Three separate rounds of "the faces are fixed" have left a handful of tiles
 * untouched, and every time the reason was punctuation. A tile is named for a
 * player, its source file is named for the same player, and the two were
 * slugged by different code that disagreed about a full stop.
 *
 * The seven that survived the third round are the fixtures here, by name:
 * D.J. Augustin, P.J. Tucker, P.J. Washington, T.J. McConnell, T.J. Warren,
 * Amar'e Stoudemire and Nenê. If this file passes and one of them is still
 * narrow, the bug is somewhere else - which is the point of naming them.
 */

import { tileSlugVariants, foldDiacritics } from "./lib/faces.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};
/* The question the tool actually asks: can this source file reach that tile? */
const reaches = (file, tile) => tileSlugVariants(file).indexOf(tile) >= 0;

console.log("\nthe seven tiles that stayed narrow after the third fix");

const OBSERVED = [
  ["D.J. Augustin", "dj-augustin"],
  ["P.J. Tucker", "pj-tucker"],
  ["P.J. Washington", "pj-washington"],
  ["T.J. McConnell", "tj-mcconnell"],
  ["T.J. Warren", "tj-warren"],
  ["Amar'e Stoudemire", "amare-stoudemire"],
  ["Nenê", "nen"]
];
for (const [file, tile] of OBSERVED) {
  ck(`${file}  ->  ${tile}`, reaches(file, tile), JSON.stringify(tileSlugVariants(file)));
}

console.log("\nand the ones earlier rounds fixed, which must not regress");

ck("Jusuf Nurkić reaches jusuf-nurkic", reaches("Jusuf Nurkić", "jusuf-nurkic"));
ck("Nikola Jokić reaches nikola-jokic", reaches("Nikola Jokić", "nikola-jokic"));
ck("Luka Dončić reaches luka-doncic", reaches("Luka Dončić", "luka-doncic"));
ck("a plain name is unchanged", reaches("Allen Iverson", "allen-iverson"));
ck("and still produces exactly one form",
   tileSlugVariants("Allen Iverson").length === 1);

console.log("\nprecedence");

{
  /* The exact slug must come first, or a fuzzy match could displace it. The
   * tool relies on this: it indexes level 0 for every folder before level 1. */
  const v = tileSlugVariants("D.J. Augustin");
  ck("the naive form is first", v[0] === "d-j-augustin", v[0]);
  ck("the cut form comes after it", v.indexOf("dj-augustin") > 0);

  const n = tileSlugVariants("Nenê");
  ck("an accented name puts its own spelling first", n[0] === "nen", n[0]);
  ck("and the folded form after", n.indexOf("nene") > 0);
}

console.log("\nnothing empty, nothing duplicated, nothing thrown");

ck("no variant is ever an empty string",
   tileSlugVariants("...").concat(tileSlugVariants("'")).every(v => v.length > 0),
   JSON.stringify(tileSlugVariants("...")));
ck("punctuation only yields nothing rather than a bad key",
   tileSlugVariants("...").length === 0 || tileSlugVariants("...").every(Boolean));
{
  const v = tileSlugVariants("Allen Iverson");
  ck("no duplicates", v.length === new Set(v).size);
}
ck("an empty stem does not throw", Array.isArray(tileSlugVariants("")));
ck("undefined does not throw", Array.isArray(tileSlugVariants()));
ck("a number does not throw", Array.isArray(tileSlugVariants(12)));

console.log("\nthe fold on its own");

ck("ć folds to c", foldDiacritics("ć") === "c");
ck("ê folds to e", foldDiacritics("ê") === "e");
ck("a plain string is untouched", foldDiacritics("Iverson") === "Iverson");

console.log("\nwhat this does NOT claim");

{
  /* Two different players can in principle collide on a cut form. This is not
   * a bug to fix here - the tool reports collisions rather than resolving them
   * silently - but the test states the risk so nobody assumes it away. */
  const a = tileSlugVariants("A.J. Green");
  const b = tileSlugVariants("AJ Green");
  ck("A.J. Green and AJ Green share a form, by design", a.some(x => b.includes(x)),
     JSON.stringify([a, b]));
  ck("but their exact forms still differ", a[0] !== b[0], a[0] + " vs " + b[0]);
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "a tile still cannot reach its source"
                 : "every observed tile reaches its source file");
process.exit(fail ? 1 : 0);
