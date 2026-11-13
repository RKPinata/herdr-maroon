// node test/panels.test.mjs
import assert from "node:assert/strict";
import { showSteps } from "../lib/panels.js";

const stack = (hidden, active) => ({ id: "root", children: [{ id: "panel", hidden, children: [{ id: "panel-body", type: "stack", active, children: [{ id: "files" }, { id: "filer-pro" }] }] }] });
assert.deepEqual(showSteps(stack(false, "filer-pro"), "filer-pro"), []);
assert.deepEqual(showSteps(stack(true, "filer-pro"), "filer-pro"), [["layout.select", { stack: "panel-body", child: "filer-pro" }], ["layout.show", { id: "panel" }]]);
assert.deepEqual(showSteps(stack(false, "files"), "filer-pro"), [["layout.select", { stack: "panel-body", child: "filer-pro" }], ["layout.show", { id: "panel" }]]);
const column = { id: "root", children: [{ id: "panel", hidden: false, children: [{ id: "panel-body", type: "column", children: [{ id: "files" }, { id: "filer-pro", hidden: true }] }] }] };
assert.deepEqual(showSteps(column, "filer-pro"), [["layout.show", { id: "files" }], ["layout.show", { id: "filer-pro" }], ["layout.show", { id: "panel" }]]);
assert.deepEqual(showSteps({ id: "root" }, "filer-pro"), []);
console.log("panels ok");
