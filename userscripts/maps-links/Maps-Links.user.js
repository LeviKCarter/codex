// ==UserScript==
// @name         Maps Links
// @namespace    levi.maps-links
// @version      1.0.0
// @description  Street addresses on any page become links that open in Google Maps.
// @match        *://*/*
// @exclude      *://www.google.com/maps*
// @exclude      *://maps.google.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/LeviKCarter/codex/main/userscripts/maps-links/Maps-Links.user.js
// @downloadURL  https://raw.githubusercontent.com/LeviKCarter/codex/main/userscripts/maps-links/Maps-Links.user.js
// ==/UserScript==

// Also the content script of the unpacked extension in this folder (manifest.json); it uses no extension APIs.
(() => {
  "use strict";

  const STREET_TYPES = [
    "Street", "St", "Avenue", "Ave", "Av", "Boulevard", "Blvd", "Road", "Rd", "Drive", "Dr", "Lane", "Ln", "Way",
    "Court", "Ct", "Place", "Pl", "Parkway", "Pkwy", "Highway", "Hwy", "Circle", "Cir", "Terrace", "Ter", "Trail",
    "Trl", "Plaza", "Plz", "Square", "Sq", "Loop", "Alley", "Aly", "Pike", "Crossing", "Xing", "Expressway", "Expy",
    "Freeway", "Fwy", "Mall", "Center", "Ctr"
  ];
  const STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
    "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
    "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR"
  ];
  // Title-case headlines ("5 Ways To Find Your Way") look like addresses; a street name has none of these words.
  const NOT_A_STREET = new Set([
    "To", "For", "Of", "And", "Or", "Your", "Our", "My", "In", "On", "With", "At", "From", "Is", "Are", "The",
    "Ways", "Things", "Tips", "Reasons", "Steps", "Days", "Hours", "Minutes", "Mins", "Years", "Weeks",
    "Months", "Times", "People", "Best", "Top", "Easy", "New", "More", "Items", "Results", "Comments", "Likes",
    "Views", "Reviews", "Miles", "Mi"
  ]);

  const typeAlt = STREET_TYPES.flatMap((t) => [t, t.toUpperCase()]).join("|");
  const stateAlt = STATES.join("|");
  const NUMBER = String.raw`(?<![\w$#.:/@+-])\d{1,6}(?:-\d{1,5})?[A-Z]?`;
  const WORD = String.raw`(?:[A-Z][A-Za-z'’.-]*|\d{1,3}(?:st|nd|rd|th))`;
  const UNIT = String.raw`(?:,?\s+(?:Suite|Ste\.?|Unit|Apt\.?|Fl\.?|Floor|#)\s*[A-Za-z0-9-]+)?`;
  const STREET = String.raw`${NUMBER}\s+(?:(?:${WORD}\s+){1,4}(?:${typeAlt})\.?(?:\s+(?:N|S|E|W|NE|NW|SE|SW)\.?)?|(?:(?:N|S|E|W)\.?\s+)?Broadway)(?![\w'’])${UNIT}`;
  const CITY = String.raw`[A-Z][A-Za-z.'’-]*(?:\s+[A-Z][A-Za-z.'’-]*){0,3},?\s+(?:${stateAlt})\.?(?:\s+\d{5}(?:-\d{4})?)?(?![\w'’])(?:,?\s+(?:USA|US|United States)(?![\w'’]))?`;
  const ADDRESS = new RegExp(String.raw`${STREET}(?:,?\s+(${CITY}))?`, "g");
  const CITY_LINE = new RegExp(String.raw`^[\s,]*(${CITY})`);
  const STREET_START = new RegExp(String.raw`^${NUMBER}\s+(${WORD}(?:\s+${WORD}){0,4})`);

  const SKIP = "a, button, script, style, noscript, textarea, input, select, option, code, pre, svg, [contenteditable]:not([contenteditable=\"false\"]), [data-maps-link]";

  const tidy = (text) => text.replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "");
  const mapsUrl = (query) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tidy(query))}`;

  function looksLikeStreet(text) {
    const words = STREET_START.exec(text);
    return !words || !words[1].split(/\s+/).some((w) => NOT_A_STREET.has(w.replace(/[.,]$/, "")));
  }

  // The addresses in one piece of text: [{ start, end, text, city }], city true when the city and state are in it.
  function findAddresses(text) {
    const found = [];
    for (const m of text.matchAll(ADDRESS)) {
      if (looksLikeStreet(m[0])) found.push({ start: m.index, end: m.index + m[0].length, text: m[0], city: !!m[1] });
    }
    return found;
  }

  // "Denver, CO 80206" at the start of the text: { start, end, text } or null.
  function findCityLine(text) {
    const m = CITY_LINE.exec(text);
    if (!m) return null;
    const start = m[0].length - m[1].length;
    return { start, end: m[0].length, text: m[1] };
  }

  if (typeof document === "undefined") {
    globalThis.mapsLinks = { findAddresses, findCityLine, mapsUrl };
    return;
  }

  const skipped = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !el || !!el.closest(SKIP);
  };

  function textNodesIn(root) {
    const nodes = [];
    if (root.nodeType === 3) {
      if (!skipped(root)) nodes.push(root);
      return nodes;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/\d/.test(n.nodeValue) && !skipped(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    return nodes;
  }

  // The "City, ST ZIP" line that follows a street line in its own text node (after a <br> or in the next element).
  function cityAfter(node) {
    const box = node.parentElement?.parentElement?.parentElement ?? node.parentElement;
    if (!box) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    walker.currentNode = node;
    for (let n = walker.nextNode(), steps = 0; n && steps < 4; n = walker.nextNode()) {
      if (!box.contains(n)) return null;
      if (!n.nodeValue.trim()) continue;
      steps++;
      if (skipped(n)) return null;
      const city = findCityLine(n.nodeValue);
      return city ? { node: n, ...city } : null;
    }
    return null;
  }

  const open = (url) => window.open(url, "_blank", "noopener");

  function style(el) {
    el.style.setProperty("cursor", "pointer");
    el.style.setProperty("text-decoration", "underline dotted");
    el.style.setProperty("text-underline-offset", "2px");
    el.title = "Open in Google Maps";
  }

  // The whole element is the address: make it clickable in place and leave the page's own nodes where they are,
  // so a page built with React can still update or remove them.
  function linkElement(el, query) {
    el.dataset.mapsLink = mapsUrl(query);
    style(el);
    if (!el.hasAttribute("role")) el.setAttribute("role", "link");
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    const go = (e) => {
      e.preventDefault();
      e.stopPropagation();
      open(el.dataset.mapsLink);
    };
    el.addEventListener("click", go);
    el.addEventListener("auxclick", (e) => { if (e.button === 1) go(e); });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") go(e); });
  }

  // The address is part of a longer text: the page's text node keeps the text before it, and a link and the rest
  // follow it, so the node stays in its place.
  function linkText(node, start, end, query) {
    const value = node.nodeValue;
    const a = document.createElement("a");
    a.href = mapsUrl(query);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.dataset.mapsLink = a.href;
    a.textContent = value.slice(start, end);
    style(a);
    a.style.setProperty("color", "inherit");
    a.addEventListener("click", (e) => e.stopPropagation());
    const rest = document.createTextNode(value.slice(end));
    node.nodeValue = value.slice(0, start);
    node.after(a, rest);
    return rest;
  }

  // The element holding exactly these pieces of text and nothing else, if there is one.
  function soleHolder(pieces) {
    let el = pieces[0].node.parentElement;
    while (el && !pieces.every((p) => el.contains(p.node))) el = el.parentElement;
    if (!el || el === document.body || el === document.documentElement || el.closest(SKIP)) return null;
    // A <br> between the lines leaves no space in textContent, so spaces and commas are left out of the comparison.
    const letters = (s) => s.replace(/[\s,]+/g, "");
    return letters(el.textContent) === letters(pieces.map((p) => p.text).join("")) ? el : null;
  }

  const taken = new WeakSet();

  function scan(root) {
    for (const node of textNodesIn(root)) {
      if (taken.has(node) || !node.isConnected || skipped(node)) continue;
      let current = node;
      let offset = 0;
      for (const found of findAddresses(node.nodeValue)) {
        const pieces = [{ node, ...found }];
        if (!found.city && !node.nodeValue.slice(found.end).replace(/^[\s,]+/, "")) {
          const city = cityAfter(node);
          if (city) pieces.push(city);
        }
        const query = pieces.map((p) => p.text).join(", ");
        const holder = soleHolder(pieces);
        if (holder) {
          linkElement(holder, query);
          break;
        }
        const [street, city] = pieces;
        const own = soleHolder([street]);
        if (own) linkElement(own, query);
        else current = linkText(current, street.start - offset, street.end - offset, query);
        if (city) {
          taken.add(city.node);
          const cityOwn = soleHolder([city]);
          if (cityOwn) linkElement(cityOwn, query);
          else linkText(city.node, city.start, city.end, query);
        }
        if (own) break;
        offset = found.end;
      }
    }
  }

  let pending = new Set();
  let timer = 0;
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") pending.add(r.target);
      else r.addedNodes.forEach((n) => pending.add(n));
    }
    // At most one scan every 300 ms: a page that never stops changing (a clock, a ticker) still gets scanned.
    if (!timer) timer = setTimeout(flush, 300);
  });
  const watch = () => observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  function flush() {
    timer = 0;
    const roots = [...pending].filter((n) => n.isConnected);
    pending = new Set();
    observer.disconnect();
    try {
      for (const n of roots) scan(n);
    } finally {
      observer.takeRecords();
      watch();
    }
  }

  if (!document.body) return;
  scan(document.body);
  watch();
})();
