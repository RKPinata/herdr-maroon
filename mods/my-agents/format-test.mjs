// node format-test.mjs
import assert from "node:assert/strict";
import { duration, contextColor } from "./format.js";

const min = 60000;
assert.equal(duration(0), "<1m");
assert.equal(duration(59999), "<1m");
assert.equal(duration(-5 * min), "<1m");
assert.equal(duration(min), "1m");
assert.equal(duration(4 * min + 59999), "4m");
assert.equal(duration(59 * min), "59m");
assert.equal(duration(60 * min), "1h");
assert.equal(duration(64 * min), "1h 4m");
assert.equal(duration(23 * 60 * min + 59 * min), "23h 59m");
assert.equal(duration(24 * 60 * min), "1d");
assert.equal(duration(2 * 24 * 60 * min + 5 * 60 * min), "2d");

const t = { ansi1: "red", ansi2: "green", ansi3: "yellow" };
assert.equal(contextColor(t, 0), "green");
assert.equal(contextColor(t, 49), "green");
assert.equal(contextColor(t, 50), "yellow");
assert.equal(contextColor(t, 79), "yellow");
assert.equal(contextColor(t, 80), "red");
assert.equal(contextColor(t, 100), "red");

console.log("format-test: ok");
