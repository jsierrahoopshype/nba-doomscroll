/* YouTube URL parsing, which is where a silent regression would hurt most.
 *
 *     node tools/test_yt_video.mjs
 *
 * A card whose URL does not yield an id falls back to a plain thumbnail and a
 * link out - correct, and completely invisible. So the failure mode of this
 * function is "the feature quietly stops existing for some cards", which is
 * exactly the kind of thing worth pinning down.
 *
 * WHAT THIS DOES NOT COVER, deliberately stated: the coordinator behaviour -
 * that a click pauses a running race, that nothing auto-starts while autoplay
 * is off, that the iframe is only ever built on play - needs a real browser
 * with IntersectionObserver and a layout. Those were verified here with
 * Playwright and request interception; they are not re-checkable on a machine
 * without it, and a test that silently skips is worse than no test, so there
 * is not one.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
new Function("window", fs.readFileSync(path.join(REPO, "js/yt-video.js"), "utf8"))(win);
const videoId = win.YtVideo.videoId;

const CASES = [
  // [url, expected id or null]
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://youtu.be/dQw4w9WgXcQ?t=90", "dQw4w9WgXcQ"],
  // Shorts are most of what this source carries.
  ["https://www.youtube.com/shorts/abc123XYZ_-", "abc123XYZ_-"],
  ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  // Must NOT produce an id: these are not single videos.
  ["https://www.youtube.com/@hoopshype", null],
  ["https://www.youtube.com/c/SomeChannel", null],
  ["https://www.youtube.com/playlist?list=PL123456789", null],
  // Not YouTube at all.
  ["https://bsky.app/profile/x/post/y", null],
  ["https://www.reddit.com/r/nba/comments/abc/def/", null],
  // Junk must not throw.
  ["", null],
  [null, null],
  [undefined, null]
];

let failures = 0;
for (const [url, want] of CASES) {
  let got;
  try { got = videoId(url); }
  catch (e) { got = "THREW: " + e.message; }
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${String(url).slice(0, 52).padEnd(54)} -> ${got}` +
    (ok ? "" : `   (want ${want})`));
}

/* The id goes straight into an embed URL, so anything outside YouTube's own
 * alphabet must never reach it. */
const nasty = videoId("https://www.youtube.com/watch?v=abc\"><script>x</script>");
if (nasty && /[^A-Za-z0-9_-]/.test(nasty)) {
  console.log(`  FAIL id carries characters outside [A-Za-z0-9_-]: ${nasty}`);
  failures++;
} else {
  console.log(`  ok   an id is always [A-Za-z0-9_-] only (got ${nasty})`);
}

console.log(failures ? `\n${failures} failed` : "\nall URL cases pass");
process.exit(failures ? 1 : 0);
