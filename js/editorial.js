/* What a card IS, editorially, above its raw type.
 *
 * THE SINGLE COPY. This table is used by three different things: the feed
 * scheduler in the browser (js/schedule.js), the audit tool and its test suite
 * in node. It lives here, as a browser IIFE, and tools/lib/editorial.mjs loads
 * THIS FILE headlessly with `new Function` - the same trick tools/test_*.mjs
 * already use for js/engine.js and the card renderers.
 *
 * A second copy in tools/ would drift, and the drift would be invisible: the
 * audit would report a mix the feed does not serve, and the tuning would be
 * done against a feed nobody sees.
 */
(function (root) {
  "use strict";

  /* What a card IS, editorially, above its raw type.
   *
   * WHY THIS EXISTS
   *
   * The feed felt like a HoopsHype database rather than an NBA feed, and the
   * cause is not the amount of database content. It is that E.sampleMixed
   * type-balances the batch: it deliberately equalizes types so a thin pool is
   * not buried under a fat one. That is right for on-this-day cards, which is
   * why it was written. Applied across fourteen archive types it PROMOTES the
   * smallest database families to the same footing as the largest:
   *
   *     vs 1920   compare 1500   quiz 1078   otd 1069   trivia 700
   *     mates 700  race 342   oddity 217   salary 207   ballot 160
   *     capcall 120   lean 99   careermap 60   dreamteam 40
   *
   * ballot at 160 cards and lean at 99 get a slice the size of vs at 1,920. So
   * awards-voting material, which should be a curiosity, arrives at roughly the
   * rate of the feed's biggest family.
   *
   * `type` cannot fix this on its own, because type does not map to editorial
   * meaning:
   *
   *   `oddity` is career oddities (history), ballot oddities (awards voting),
   *   award-history stories (awards voting) AND standing records (history).
   *   `race` is team records races (a data animation) AND ballot races (awards
   *   voting wearing an animation).
   *   `salary` is passive cap trivia AND, in the vault, on-this-day money facts.
   *
   * So the key is (type, category), which was checked against every card in
   * every pool and is both unique and complete. tools/test_editorial.mjs asserts
   * that: a card that falls through to `other` fails the suite, which is what
   * stops this map quietly rotting as pools are added.
   *
   * BUCKETS are one-per-card and drive the mix targets. TRAITS are additive and
   * drive the adjacency caps, because one card is legitimately several things at
   * once: Cap Call is a GAME whose subject is money, and a comparison is a
   * comparison whether or not it autoplays.
   */

  /** One per card. The mix targets are expressed in these. */
  var BUCKETS = [
    "live",             // happening now: buzz, trades, transactions
    "game",             // playable
    "history_record",   // on this day, records, career oddities
    "comparison",       // vs, compare, teammates, races - data-led
    "animation",        // reserved: long-form animated pieces, if separated later
    "awards_voting",    // ballots, voters, media lean, award-history voting
    "money_cap_static", // passive salary/cap facts. NOT Cap Call.
    "other"
  ];

  /** Additive. A card can carry several. */
  var TRAITS = [
    "playable",
    "media_heavy",
    "autoplay",
    "current",
    "database_generated",
    "money_related",
    "guess_the_player"   // its own cap, separate from `playable`
  ];

  /* The map. Key is `type|category`, and every row was read off the real pools.
   *
   * Kept as data rather than as a chain of conditionals so the audit tool, the
   * app and the test all consult one table. */
  const T = (bucket, ...traits) => ({ bucket, traits });

  var BY_TYPE_CATEGORY = {
    /* ---- live. Not in any committed pool: buzz and trades are fetched in the
     * reader's browser, which is exactly why the type-balanced draw cannot give
     * them a fair share on its own and buzzShare() has to reserve it. ---- */
    "buzz|":              T("live", "current", "media_heavy"),
    "trade|":             T("live", "current"),
    "tradetrend|":        T("live", "current"),
    "tradedigest|":       T("live", "current"),
    "traderank|":         T("live", "current"),

    /* ---- games. Playable, and the reason Cap Call is here rather than in
     * money_cap_static: Jorge's brief is explicit that a playable salary game is
     * a game that happens to be about money, not a salary database card. ---- */
    "quiz|guess-the-player":     T("game", "playable", "guess_the_player", "database_generated"),
    /* content_type is `trivia`, raw type is `friv`, and typeOf prefers
     * content_type. Keyed on what typeOf actually returns. */
    "trivia|frivolities":        T("game", "playable", "database_generated"),
    "trivia|trivia":             T("game", "playable", "database_generated"),
    "careermap|game":            T("game", "playable", "database_generated"),
    "dreamteam|game":            T("game", "playable", "database_generated"),
    "capcall|value":             T("game", "playable", "money_related", "database_generated"),

    /* ---- history and records. What a hardcore fan reads without needing
     * context, and the material that breaks up live cards without feeling
     * generated. ---- */
    "otd|on-this-day":           T("history_record", "database_generated"),
    "oddity|record":             T("history_record", "database_generated"),
    "oddity|career":             T("history_record", "database_generated"),

    /* ---- comparisons and races. The data-led family. media_heavy and autoplay
     * are what the §16 adjacency caps key on; `vs` is a static score card and
     * carries neither. ---- */
    "vs|comparison":             T("comparison", "database_generated"),
    "vs|cross-era":              T("comparison", "database_generated"),
    "compare|comparison":        T("comparison", "media_heavy", "autoplay", "database_generated"),
    "compare|cross-era":         T("comparison", "media_heavy", "autoplay", "database_generated"),
    "mates|teammates-era":       T("comparison", "media_heavy", "autoplay", "database_generated"),
    "mates|teammates-cross-era": T("comparison", "media_heavy", "autoplay", "database_generated"),
    "race|team":                 T("comparison", "media_heavy", "autoplay", "database_generated"),
    "race|career":               T("comparison", "media_heavy", "autoplay", "database_generated"),
    "race|playoffs":             T("comparison", "media_heavy", "autoplay", "database_generated"),
    /* THE LONG TAIL OF THE RACE POOL. Six more categories, two and three cards
     * each, which a top-four sample of the pool did not show and which the
     * no-fallthrough test caught immediately. Enumerated from the complete key
     * list rather than sampled again. */
    "race|franchise":            T("comparison", "media_heavy", "autoplay", "database_generated"),
    "race|international":        T("comparison", "media_heavy", "autoplay", "database_generated"),
    "race|college":              T("comparison", "media_heavy", "autoplay", "database_generated"),
    "race|draft":                T("comparison", "media_heavy", "autoplay", "database_generated"),
    "race|history":              T("comparison", "media_heavy", "autoplay", "database_generated"),
    /* A race ABOUT money is still a race. §6 targets PASSIVE salary database
     * facts; an animation is not passive, so this follows the Cap Call rule:
     * bucketed by what it is, trait-tagged with what it is about. */
    "race|salary":               T("comparison", "media_heavy", "autoplay", "money_related", "database_generated"),

    /* ---- awards and voting. THE FAMILY THAT NEEDS THE BIG REDUCTION, and the
     * reason it has to be a bucket rather than a type: these are five different
     * types and the reader experiences them as one repeated subject.
     *
     * `race|awards` and `race|ballot` are races by mechanism and awards-voting by
     * subject, so they take the awards bucket and keep the animation traits -
     * which is precisely the case a single mutually-exclusive category could not
     * express. ---- */
    "ballot|ballot-trivia":      T("awards_voting", "database_generated"),
    "oddity|ballot-oddity":      T("awards_voting", "database_generated"),
    "oddity|award-history":      T("awards_voting", "database_generated"),
    "lean|media-lean":           T("awards_voting", "media_heavy", "autoplay", "database_generated"),
    "race|ballot":               T("awards_voting", "media_heavy", "autoplay", "database_generated"),
    "race|awards":               T("awards_voting", "media_heavy", "autoplay", "database_generated"),

    /* ---- passive money. ~1 per 100 cards. Cap Call is deliberately NOT here. */
    "salary|salary":             T("money_cap_static", "money_related", "database_generated"),
    "salary|cap-share":          T("money_cap_static", "money_related", "database_generated"),
    "salary|bargain":            T("money_cap_static", "money_related", "database_generated"),

    /* ---- the Daily Five is its own surface, not a feed family. */
    "daily|":                    T("game", "playable")
  };

  /** Fallback by type alone, for a card whose category is new or absent.
   *
   * Deliberately thin. A miss here is reported by the test rather than silently
   * absorbed, because the whole point of the table is that adding a pool forces
   * an editorial decision instead of defaulting into the feed. */
  var BY_TYPE = {
    buzz: T("live", "current", "media_heavy"),
    trade: T("live", "current"),
    rumor: T("live", "current"),
    quiz: T("game", "playable", "guess_the_player"),
    otd: T("history_record"),
    vs: T("comparison"),
    compare: T("comparison", "media_heavy", "autoplay"),
    mates: T("comparison", "media_heavy", "autoplay"),
    race: T("comparison", "media_heavy", "autoplay"),
    ballot: T("awards_voting"),
    lean: T("awards_voting", "media_heavy", "autoplay"),
    salary: T("money_cap_static", "money_related"),
    salaryrank: T("money_cap_static", "money_related"),
    capcall: T("game", "playable", "money_related"),
    careermap: T("game", "playable"),
    dreamteam: T("game", "playable"),
    friv: T("game", "playable"),
    trivia: T("game", "playable")
  };

  /** The type a card is filed under, matching what E.sampleMixed buckets on. */
  function typeOf(card) {
    return (card && card.tags && card.tags.content_type) || (card && card.type) || "other";
  }

  /** The category, which is what separates one `oddity` from another. */
  function categoryOf(card) {
    return (card && card.tags && card.tags.category) || "";
  }

  /**
   * A card's editorial bucket and traits.
   *
   * @returns {{ bucket: string, traits: string[], matched: string }}
   *   `matched` says which table answered - "type|category", "type", or "none" -
   *   so a caller can tell a real classification from a fallback.
   */
  function classify(card) {
    const t = typeOf(card);
    const c = categoryOf(card);
    const exact = BY_TYPE_CATEGORY[t + "|" + c];
    if (exact) return { bucket: exact.bucket, traits: exact.traits.slice(), matched: "type|category" };
    const byType = BY_TYPE[t];
    if (byType) return { bucket: byType.bucket, traits: byType.traits.slice(), matched: "type" };
    return { bucket: "other", traits: [], matched: "none" };
  }

  /** Convenience: does this card carry that trait? */
  function hasTrait(card, trait) {
    return classify(card).traits.indexOf(trait) >= 0;
  }

  /** Convenience: the bucket alone. */
  function bucketOf(card) {
    return classify(card).bucket;
  }

  /** The families that §15 groups as data-heavy for its 5-8% target. */
  var DATA_HEAVY_BUCKETS = ["comparison", "animation"];

  /** Buckets that count as "current NBA" for the 65-70% target. */
  var LIVE_BUCKETS = ["live"];

  root.DoomEditorial = {
    BUCKETS: BUCKETS, TRAITS: TRAITS,
    BY_TYPE_CATEGORY: BY_TYPE_CATEGORY, BY_TYPE: BY_TYPE,
    typeOf: typeOf, categoryOf: categoryOf, classify: classify,
    hasTrait: hasTrait, bucketOf: bucketOf,
    DATA_HEAVY_BUCKETS: DATA_HEAVY_BUCKETS, LIVE_BUCKETS: LIVE_BUCKETS
  };
})(typeof window !== "undefined" ? window : this);
