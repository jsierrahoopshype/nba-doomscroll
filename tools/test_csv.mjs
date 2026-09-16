/* The twenty lines every builder reading a game log depends on.
 *
 *     node tools/test_csv.mjs
 *
 * A parser that drops a cell does not fail; it produces a row with one fewer
 * field and every number after it shifted by one column. So the cases here are
 * the ones that shift columns: a comma inside a quoted team name, a quote
 * inside a quoted cell, and a row shorter than the header.
 */

import { parseCsv, splitCsvLine } from "./lib/csv.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

console.log("\nsplitting a line");

ck("plain cells", splitCsvLine("a,b,c").join("|") === "a|b|c");
ck("a quoted cell keeps its comma",
   splitCsvLine('a,"Portland, Oregon",c').join("|") === "a|Portland, Oregon|c",
   splitCsvLine('a,"Portland, Oregon",c').join("|"));
ck("an escaped quote becomes one quote",
   splitCsvLine('a,"he said ""no""",c')[1] === 'he said "no"',
   splitCsvLine('a,"he said ""no""",c')[1]);
ck("an empty cell stays empty", splitCsvLine("a,,c")[1] === "");
ck("a trailing comma yields a trailing empty cell", splitCsvLine("a,b,").length === 3);
ck("one cell, no commas", splitCsvLine("only").join("|") === "only");
ck("nothing at all is one empty cell", splitCsvLine("").join("|") === "");
ck("null does not throw", splitCsvLine(null).join("|") === "");

console.log("\nwhole files");

{
  const rows = parseCsv('game_id,team_name_home,pts_home\r\n1,"Portland, Oregon",108\r\n2,Boston,99\r\n');
  ck("two rows", rows.length === 2, String(rows.length));
  ck("keyed by the header", rows[0].game_id === "1" && rows[0].pts_home === "108");
  ck("the comma inside quotes did not shift a column",
     rows[0].team_name_home === "Portland, Oregon", rows[0].team_name_home);
  ck("CRLF and LF both work", rows[1].team_name_home === "Boston");
}

{
  /* THE ONE THAT MATTERS. A short row must yield "" and not undefined: a
   * builder doing parseInt(row.pts_home) on undefined gets NaN and puts it in
   * a card, which is the shape of every invented-number bug in this repo. */
  const rows = parseCsv("a,b,c\n1,2\n");
  ck("a short row pads with empty strings", rows[0].c === "", JSON.stringify(rows[0]));
  ck("and never with undefined", rows[0].c !== undefined);
}

{
  const rows = parseCsv("a,b\n1,2,3\n");
  ck("an over-long row keeps what the header asks for",
     Object.keys(rows[0]).length === 2, Object.keys(rows[0]).join(","));
}

console.log("\nrubbish in");

ck("an empty file is no rows", parseCsv("").length === 0);
ck("whitespace only is no rows", parseCsv("\n\n  \n").length === 0);
ck("undefined does not throw", parseCsv(undefined).length === 0);
ck("a header with no data rows is no rows", parseCsv("a,b,c\n").length === 0);
ck("blank lines in the middle are skipped",
   parseCsv("a\n1\n\n2\n").length === 2, String(parseCsv("a\n1\n\n2\n").length));

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "a shifted column is a wrong number in a card"
                 : "every cell lands in the column its header names");
process.exit(fail ? 1 : 0);
