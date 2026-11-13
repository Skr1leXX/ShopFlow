import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "./csv.ts";

test("кавычки и разделители экранируются", () => {
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell("a;b"), '"a;b"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell(null), "");
});

test("формулы Excel обезвреживаются, числа не трогаются", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("+7 900"), "'+7 900");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell("12.5"), "12.5");
});

test("toCsv: BOM, заголовок и строки", () => {
  const out = toCsv(["a", "b"], [[1, "x;y"]]);
  assert.ok(out.startsWith("\uFEFFa;b\r\n"));
  assert.ok(out.endsWith('1;"x;y"\r\n'));
});
