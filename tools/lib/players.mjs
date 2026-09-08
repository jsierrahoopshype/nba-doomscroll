/* The player resolver, for Node.
 *
 * This file deliberately contains NO RULES. It loads js/player-resolver.js -
 * the same file the browser loads - and re-exports it, so the builders and the
 * feed can never disagree about whether a text names a player.
 *
 * The alternative was a second copy in ESM. Two copies of this particular rule
 * drift silently, and the symptom of the drift is a card carrying the wrong
 * person's name under a quote, which nobody notices until someone is annoyed
 * in public. One implementation, loaded twice.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "..", "js", "player-resolver.js");

const scope = {};
new Function("window", fs.readFileSync(SRC, "utf8"))(scope);

if (!scope.PlayerResolve) {
  throw new Error("js/player-resolver.js did not attach PlayerResolve — the file moved or changed shape");
}

export const { resolve, buildIndex, surnameOf, fold, yearsIn, WORD_SURNAMES } = scope.PlayerResolve;
export default scope.PlayerResolve;
