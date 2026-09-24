#!/usr/bin/env node
/* A muted Bluesky account never reaches Buzz.
 *
 *     node tools/test_buzz_muted.mjs
 *
 * Jorge, Sept 24 2026: remove Alejandro Gaitan from the Bluesky list, he does
 * not want to see that content. Two halves, in two repos:
 *
 *   nba-content-stream stops POLLING the account (bluesky_overrides.json
 *   "remove"), so no new posts are published.
 *
 *   This repo stops SHOWING it. The posts already published stay in the index
 *   for up to max_age_days, and without this they would keep appearing for a
 *   week after the account was "removed" - which from where Jorge sits is the
 *   removal not working.
 *
 * The match runs three ways because each field can be missing on its own:
 * the handle in the post URL, the author handle the index carries, and the DID
 * inside the post id, which is the one that survives a handle change. Each is
 * tested alone, so losing any one of them fails here.
 *
 * Reads the real config, so this cannot pass against an imaginary one. Every
 * post below is invented.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
new Function("window", fs.readFileSync(path.join(REPO, "js/buzz.js"), "utf8"))(win);
const muted = win.LiveBuzz.muted;
const CFG = JSON.parse(fs.readFileSync(path.join(REPO, "data", "buzz-sources.json"), "utf8"));

let fail = 0;
function ck(label, ok, note) {
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${note ? "   " + note : ""}`);
}

const HANDLE = "alejandroggo.com";
const DID = "did:plc:eensm34x6vktvhoffhe2e35f";

console.log("\nthe account is on the list");

ck("buzz.js exposes the check", typeof muted === "function");
ck("the handle is muted", (CFG.muted_handles || []).indexOf(HANDLE) >= 0,
   JSON.stringify(CFG.muted_handles));
ck("and so is the DID", (CFG.muted_dids || []).indexOf(DID) >= 0,
   JSON.stringify(CFG.muted_dids));
ck("and the list says why", typeof CFG.muted_note === "string" && CFG.muted_note.length > 40);

console.log("\neach way of recognising a post works on its own");

const byUrl = { source: "bluesky", url: "https://bsky.app/profile/" + HANDLE + "/post/3abc" };
ck("by the handle in the post URL", muted(byUrl, CFG));

const byAuthor = { source: "bluesky", url: "https://example.invalid/x",
                   author: { handle: HANDLE } };
ck("by the author handle", muted(byAuthor, CFG));

/* A handle change is exactly when the other two stop matching. The id is the
 * content-stream form: "bs-" plus the URL-encoded at:// path. */
const byDid = { source: "bluesky", url: "https://bsky.app/profile/new-handle.example/post/3abc",
  id: "bs-" + encodeURIComponent(DID + "/app.bsky.feed.post/3abc") };
ck("by the DID in the post id, after a handle change", muted(byDid, CFG));

ck("case in the handle does not matter",
   muted({ source: "bluesky", url: "https://bsky.app/profile/AlejandroGGO.com/post/1" }, CFG));

console.log("\nand nobody else is caught by it");

ck("another Bluesky account passes",
   !muted({ source: "bluesky", url: "https://bsky.app/profile/shamscharania.com/post/1",
            author: { handle: "shamscharania.com" },
            id: "bs-" + encodeURIComponent("did:plc:somebodyelse/app.bsky.feed.post/1") }, CFG));
/* A near miss, so a substring match cannot pass for an exact one. */
ck("a handle that merely contains it passes",
   !muted({ source: "bluesky", url: "https://bsky.app/profile/notalejandroggo.com.example/post/1" }, CFG));
ck("a Reddit post passes", !muted({ source: "reddit", url: "https://www.reddit.com/r/nba/x" }, CFG));
ck("an empty config mutes nothing", !muted(byUrl, {}));

console.log("\nthe mute runs inside build, before anything else is spent on the item");

const SRC = fs.readFileSync(path.join(REPO, "js/buzz.js"), "utf8");
ck("build() checks it", /if \(muted\(item, cfg\)\) \{ mutedN\+\+; return; \}/.test(SRC));
ck("and reports the count to the console",
   /buzz hid " \+ mutedN \+ " post\(s\) from muted accounts/.test(SRC));

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "a muted account can still reach the feed"
                 : "muted accounts stay out, by handle, author or DID");
process.exit(fail ? 1 : 0);
