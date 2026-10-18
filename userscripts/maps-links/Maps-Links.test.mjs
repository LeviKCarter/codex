// Tests for the address matching in Maps-Links.user.js: `node userscripts/maps-links/Maps-Links.test.mjs` (a path to
// another copy of the script may follow). The script is run with no document, so it only hands over its matchers.
// What it does to a page is checked in a browser on fixture.html (see AGENTS.md).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const file = process.argv[2] ?? fileURLToPath(new URL("./Maps-Links.user.js", import.meta.url));
const context = vm.createContext({});
vm.runInContext(readFileSync(file, "utf8"), context);
const { findAddresses, findCityLine, mapsUrl } = context.mapsLinks;

// Arrays made in the script's context fail deepEqual against this one's, so they are copied over.
const texts = (text) => Array.from(findAddresses(text), (f) => f.text);
let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message.split("\n").join("\n     ")}`);
  }
};

test("the street line of an order page", () => {
  assert.deepEqual(texts("2001 E. Colfax Ave"), ["2001 E. Colfax Ave"]);
  assert.equal(findAddresses("2001 E. Colfax Ave")[0].city, false);
});

test("the city line that follows it", () => {
  assert.equal(findCityLine("Denver, CO 80206")?.text, "Denver, CO 80206");
  assert.equal(findCityLine("\n  , Denver, CO 80206")?.text, "Denver, CO 80206");
  assert.equal(findCityLine("Salt Lake City UT")?.text, "Salt Lake City UT");
});

test("a whole address in one line, inside a sentence", () => {
  const found = findAddresses("Pick up at 2001 E. Colfax Ave, Denver, CO 80206 after 1pm.");
  assert.deepEqual(Array.from(found, (f) => f.text), ["2001 E. Colfax Ave, Denver, CO 80206"]);
  assert.equal(found[0].city, true);
});

test("two addresses in one line", () => {
  assert.deepEqual(texts("From 1600 Pennsylvania Ave NW to 350 Fifth Avenue, New York, NY 10118"), [
    "1600 Pennsylvania Ave NW",
    "350 Fifth Avenue, New York, NY 10118"
  ]);
});

test("street types, numbered streets, units and Broadway", () => {
  assert.deepEqual(texts("1437 Bannock St."), ["1437 Bannock St."]);
  assert.deepEqual(texts("700 16th Street, Suite 200"), ["700 16th Street, Suite 200"]);
  assert.deepEqual(texts("1 Infinite Loop, Cupertino, CA 95014"), ["1 Infinite Loop, Cupertino, CA 95014"]);
  assert.deepEqual(texts("85 S Broadway"), ["85 S Broadway"]);
  assert.deepEqual(texts("1600 AMPHITHEATRE PKWY"), ["1600 AMPHITHEATRE PKWY"]);
});

test("nothing else on an order page is an address", () => {
  for (const text of [
    "Order number: 47355569603395590",
    "Today at 1:47pm MDT",
    "(720) 723-2703",
    "$12.28",
    "1 Burritos",
    "1 Small Chips & Dips",
    "Mexican Coke Carnitas Burrito, Potatoes, Cilantro-Lime White Rice"
  ]) assert.deepEqual(texts(text), [], text);
});

test("headlines and counts are not addresses", () => {
  for (const text of [
    "5 Ways To Find Your Way",
    "10 Tips For Your Drive",
    "3 Reasons To Visit Our Place",
    "12 Comments On This Court",
    "the 3 best drive-ins",
    "We waited 20 minutes on the road",
    "#4 Main St",
    "v2 Main St"
  ]) assert.deepEqual(texts(text), [], text);
});

test("a word that starts with a street type is not one", () => {
  assert.deepEqual(texts("400 Main Stadium Rows"), []);
  assert.equal(findCityLine("Denver, COLORADO"), null);
});

test("the link opens a Google Maps search for the address", () => {
  assert.equal(
    mapsUrl(" 2001 E. Colfax Ave,\n Denver, CO 80206 "),
    "https://www.google.com/maps/search/?api=1&query=2001%20E.%20Colfax%20Ave%2C%20Denver%2C%20CO%2080206"
  );
});

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
