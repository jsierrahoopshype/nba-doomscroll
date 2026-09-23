/* The editorial classification, for node.
 *
 * THIS FILE HOLDS NO TABLE. js/editorial.js is the single copy, because the
 * browser needs it too: the feed scheduler classifies every card it draws. A
 * second copy here would drift, and the drift would be silent in the worst
 * possible way - the audit would report a mix the feed does not actually serve,
 * and every tuning decision would be made against a feed nobody sees.
 *
 * So the shipped file is loaded headlessly with `new Function`, which is the
 * same trick tools/test_*_markup.mjs uses for the card renderers and the audit
 * uses for js/engine.js. The table is exercised here exactly as the reader's
 * browser exercises it.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "..", "js", "editorial.js");

const win = {};
new Function("window", fs.readFileSync(SRC, "utf8"))(win);

if (!win.DoomEditorial) {
  throw new Error("js/editorial.js did not define window.DoomEditorial");
}

const E = win.DoomEditorial;

/** One per card. The mix targets are expressed in these. */
export const BUCKETS = E.BUCKETS;

/** Additive. A card can carry several. */
export const TRAITS = E.TRAITS;

/** The map, keyed `type|category`. Read js/editorial.js for the reasoning. */
export const BY_TYPE_CATEGORY = E.BY_TYPE_CATEGORY;

/** Fallback by type alone, deliberately thin. */
export const BY_TYPE = E.BY_TYPE;

/** The type a card is filed under, matching what E.sampleMixed buckets on. */
export const typeOf = E.typeOf;

/** The category, which is what separates one `oddity` from another. */
export const categoryOf = E.categoryOf;

/**
 * A card's editorial bucket and traits.
 *
 * @returns {{ bucket: string, traits: string[], matched: string }}
 *   `matched` says which table answered - "type|category", "type", or "none".
 */
export const classify = E.classify;

/** Convenience: does this card carry that trait? */
export const hasTrait = E.hasTrait;

/** Convenience: the bucket alone. */
export const bucketOf = E.bucketOf;

/** The families that §15 groups as data-heavy for its 5-8% target. */
export const DATA_HEAVY_BUCKETS = E.DATA_HEAVY_BUCKETS;

/** Buckets that count as "current NBA" for the 65-70% target. */
export const LIVE_BUCKETS = E.LIVE_BUCKETS;
