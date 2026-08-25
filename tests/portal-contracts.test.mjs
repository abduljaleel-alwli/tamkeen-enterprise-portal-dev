import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("admin navigation has a functional render target for every item", async () => {
  const source = await read("app/AdminPortal.tsx");
  const ids = [...source.matchAll(/\{ id: "([^"]+)", label:/g)].map((match) => match[1]);
  assert.ok(ids.length >= 10);
  for (const id of ids) assert.match(source, new RegExp(`page===\\"${id}\\"`), `missing admin view: ${id}`);
});

test("employee navigation has a functional render target for every item", async () => {
  const source = await read("app/employee/EmployeePortal.tsx");
  const navBlock = source.slice(source.indexOf("const nav:"), source.indexOf("const demoEmployee"));
  const ids = [...navBlock.matchAll(/id:"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids.includes("guide") && ids.includes("meetings"));
  for (const id of ids) assert.match(source, new RegExp(`tab===\\"${id}\\"`), `missing employee view: ${id}`);
  assert.doesNotMatch(source, /className="ep-mark"/);
});

test("new operating modules expose persisted API handlers", async () => {
  const expectations = {
    "app/api/meetings/route.ts": ["GET", "POST", "PATCH"],
    "app/api/announcements/route.ts": ["GET", "POST", "PATCH"],
    "app/api/development/route.ts": ["GET", "POST", "PATCH"],
    "app/api/receipt-reports/route.ts": ["GET", "POST"],
    "app/api/support/route.ts": ["GET", "POST"],
    "app/api/tasks/route.ts": ["PATCH"],
  };
  for (const [path, handlers] of Object.entries(expectations)) {
    const source = await read(path);
    for (const handler of handlers) assert.match(source, new RegExp(`export async function ${handler}\\(`), `${path} lacks ${handler}`);
  }
});

test("branding, favicon, support and live-update contracts are present", async () => {
  const [layout, sidebar, support, live] = await Promise.all([
    read("app/layout.tsx"), read("app/sidebar-logo-refresh.css"), read("app/SupportCenter.tsx"), read("app/live-sync.ts"),
  ]);
  assert.match(layout, /tamkeen-mark-flat\.png/);
  assert.match(sidebar, /Tajawal/);
  assert.match(support, /wa\.me\/966531948556/);
  assert.match(live, /BroadcastChannel/);
  assert.match(live, /setInterval/);
});

test("login and both portal shells include mobile and tablet breakpoints", async () => {
  const [login, employee, admin] = await Promise.all([
    read("app/login/login.css"), read("app/employee/employee.css"), read("app/globals.css"),
  ]);
  assert.match(login, /max-width:930px/);
  assert.match(login, /max-width:580px/);
  assert.match(login, /100svh/);
  assert.match(employee, /max-width:800px/);
  assert.match(employee, /max-width:560px/);
  assert.match(admin, /max-width:820px/);
  assert.match(admin, /max-width:560px/);
});
