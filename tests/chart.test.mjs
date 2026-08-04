import { test } from "node:test";
import assert from "node:assert/strict";
import { chartModel, formatRate } from "../js/chart.js";
import { historySupported, HISTORY_CODES } from "../js/history.js";

const SERIES = [
  ["2026-07-07", 95.0],
  ["2026-07-08", 96.5],
  ["2026-07-09", 94.2],
  ["2026-07-10", 97.1],
];

test("chartModel maps points into the padded plot area", () => {
  const m = chartModel(SERIES, 340, 120);
  assert.equal(m.points.length, 4);
  assert.equal(m.min, 94.2);
  assert.equal(m.max, 97.1);
  // x strictly increasing, evenly spaced
  for (let i = 1; i < m.points.length; i++) assert.ok(m.points[i].x > m.points[i - 1].x);
  // extremes hit the plot edges: max → top pad, min → bottom of inner area
  const top = m.points.find((p) => p.value === m.max);
  const bottom = m.points.find((p) => p.value === m.min);
  assert.ok(Math.abs(top.y - 10) < 0.01);
  assert.ok(Math.abs(bottom.y - (120 - 18)) < 0.01);
  assert.match(m.path, /^M/);
  assert.match(m.area, /Z$/);
});

test("chartModel survives a flat series", () => {
  const m = chartModel([["2026-07-07", 5], ["2026-07-08", 5]]);
  assert.ok(m.points.every((p) => Number.isFinite(p.y)));
});

test("formatRate uses significant digits across magnitudes", () => {
  assert.equal(formatRate(95.401315), "95.401");
  assert.equal(formatRate(0.0123456), "0.012346");
  assert.equal(formatRate(25000.4), "25,000");
});

test("history support covers the majors, not the exotics", () => {
  assert.ok(historySupported("EUR", "INR"));
  assert.ok(historySupported("HUF", "INR"));
  assert.ok(!historySupported("VND", "INR")); // not in ECB set
  assert.ok(!historySupported("EUR", "NPR"));
  assert.ok(HISTORY_CODES.has("USD"));
});
