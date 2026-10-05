// ==UserScript==
// @name         Reddit Quick Mute — Mobile
// @namespace    levi.hbr.quick-mute.mobile
// @version      1.1.3
// @updateURL    https://raw.githubusercontent.com/LeviKCarter/codex/main/userscripts/Reddit-Quick-Mute-Mobile.user.js
// @downloadURL  https://raw.githubusercontent.com/LeviKCarter/codex/main/userscripts/Reddit-Quick-Mute-Mobile.user.js
// @description  Mute and immediately hide subreddits; restore your PC extension's downvote-to-block and blocked-author hiding.
// @match        https://www.reddit.com/*
// @match        https://reddit.com/*
// @match        https://m.reddit.com/*
// @match        https://new.reddit.com/*
// @match        https://old.reddit.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// @releaseHash  d33b426f0d20645d03b3258a9b80c434b84888c4a8ec4c9d6c2a783ba8444c8f
// ==/UserScript==

(() => {
  "use strict";
  if (window.__hbrQuickMuteMobile) return;
  window.__hbrQuickMuteMobile = true;
  const storageListeners = new Set();
  function areaStore(area) {
    return {
      get(keys, callback) {
        const stored = GM_getValue("hbrStorage:" + area, {});
        const result = keys === null ? {...stored} : {};
        const names = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {});
        for (const key of names) {
          if (Object.prototype.hasOwnProperty.call(stored, key)) result[key] = stored[key];
          else if (keys && !Array.isArray(keys) && typeof keys === "object") result[key] = keys[key];
        }
        queueMicrotask(() => callback(result));
      },
      set(values, callback = () => {}) {
        const old = GM_getValue("hbrStorage:" + area, {});
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          if (JSON.stringify(old[key]) !== JSON.stringify(value)) changes[key] = {oldValue: old[key], newValue: value};
        }
        GM_setValue("hbrStorage:" + area, {...old, ...values});
        queueMicrotask(() => {
          callback();
          if (Object.keys(changes).length) for (const listener of storageListeners) listener(changes, area);
        });
      }
    };
  }
  const chrome = {storage: {
    sync: areaStore("sync"), local: areaStore("local"),
    onChanged: {addListener(listener) {storageListeners.add(listener)}}
  }};
(() => {
  "use strict";

  const DEFAULTS = {
    enabled: true,
    hideNativeBlocked: true,
    usernames: []
  };

  const CANDIDATE_SELECTOR = [
    "shreddit-comment",
    "shreddit-post",
    "shreddit-profile-comment",
    "shreddit-mod-comment",
    "shreddit-comment-lite",
    "[data-testid='comment']",
    ".Comment",
    ".Post",
    ".thing.comment",
    ".thing.link"
  ].join(",");

  const AUTHOR_LINK_SELECTOR = [
    "a[href*='/user/']",
    "a[href^='/u/']",
    "a[href*='reddit.com/u/']"
  ].join(",");

  const DOWNVOTE_SELECTOR = [
    "button[downvote]",
    "button[aria-label='downvote' i]",
    "button[data-click-id='downvote']",
    "button[data-adclicklocation='downvote']",
    "[data-testid='downvote']",
    ".arrow.down",
    ".arrow.downmod"
  ].join(",");

  const HIDDEN_ATTR = "data-hide-blocked-redditors-hidden";
  const BLOCK_BUTTON_ATTR = "data-hide-blocked-redditors-block-button";
  const BLOCK_BUTTON_USER_ATTR = "data-hide-blocked-redditors-block-user";
  const BLOCK_MARKERS = new Set([
    "blocked",
    "[blocked]",
    "blocked author",
    "blocked user",
    "blocked account"
  ]);
  const NON_BLOCKABLE_USERS = new Set([
    "",
    "blocked",
    "[blocked]",
    "deleted",
    "[deleted]"
  ]);

  let settings = { ...DEFAULTS };
  let hiddenUsers = new Set();
  let observer = null;
  let scanQueued = false;
  const pendingScanRoots = new Set();
  let lastUrl = location.href;
  let currentUsername = "";
  let cachedModhash = "";
  const sessionBlockedUsers = new Set();
  const nativeBlockedUsers = new Set();
  const blockingUsers = new Set();
  let syncInProgress = false;
  const NATIVE_BLOCKS_CACHE_KEY = "cachedNativeBlockedUsers";
  const NATIVE_BLOCKS_CACHE_TIME_KEY = "cachedNativeBlockedTime";
  const CACHE_TTL_MS = 5 * 60 * 1000;

  function normalizeUsername(value) {
    return String(value || "")
      .trim()
      .replace(/^https?:\/\/(?:www\.)?reddit\.com\/(?:user|u)\//i, "")
      .replace(/^\/?(?:user|u)\//i, "")
      .replace(/^u\//i, "")
      .replace(/^@/, "")
      .replace(/\/.*$/, "")
      .trim()
      .toLowerCase();
  }

  function setSettings(next) {
    settings = {
      enabled: next.enabled !== false,
      hideNativeBlocked: next.hideNativeBlocked !== false,
      usernames: Array.isArray(next.usernames) ? next.usernames : []
    };

    hiddenUsers = new Set(
      settings.usernames
        .map(normalizeUsername)
        .filter(Boolean)
    );
  }

  function usernameFromLink(link) {
    if (!(link instanceof Element)) return "";

    const href = link.getAttribute("href") || "";
    const match = href.match(/\/(?:user|u)\/([^/?#]+)/i);
    return match ? normalizeUsername(match[1]) : "";
  }

  function ownAuthorLink(el) {
    const links = el.querySelectorAll?.(AUTHOR_LINK_SELECTOR);
    let bestLink = null;
    let bestScore = -1;

    for (const link of links || []) {
      if (link.closest(CANDIDATE_SELECTOR) !== el) continue;

      const username = usernameFromLink(link);
      if (!username) continue;

      // Reddit often links both the avatar and the visible username to the
      // same profile. Prefer the visible text link so our control lands next
      // to the username instead of between the avatar and the name.
      const visibleText = String(link.textContent || "").trim().toLowerCase();
      const ariaLabel = String(link.getAttribute("aria-label") || "").trim().toLowerCase();
      const title = String(link.getAttribute("title") || "").trim().toLowerCase();

      let score = 0;
      if (visibleText === username || visibleText === `u/${username}`) score += 100;
      else if (visibleText.includes(username)) score += 80;
      else if (visibleText) score += 30;

      if (ariaLabel.includes(username)) score += 20;
      if (title.includes(username)) score += 10;
      if (link.querySelector("img,svg,faceplate-img") && !visibleText) score -= 25;

      if (score > bestScore) {
        bestScore = score;
        bestLink = link;
      }
    }

    return bestLink;
  }

  function authorFromElement(el) {
    if (!(el instanceof Element)) return "";

    for (const attr of ["author", "data-author", "author-name", "data-author-name"]) {
      const value = normalizeUsername(el.getAttribute?.(attr));
      if (value) return value;
    }

    // If this candidate wraps another comment/post (e.g. shreddit-mod-comment),
    // check the inner comment element's author attributes first.
    if (el.tagName && el.tagName.toLowerCase() === "shreddit-mod-comment") {
      const inner = el.querySelector("shreddit-comment, [author], [data-author], [author-name]");
      if (inner && inner !== el) {
        const innerAuthor = authorFromElement(inner);
        if (innerAuthor) return innerAuthor;
      }
    }

    const link = ownAuthorLink(el);
    if (link) {
      const user = usernameFromLink(link);
      if (user) return user;
    }

    // Check specific Reddit author-name containers in comment header/meta
    const metaAuthorNode = el.querySelector?.('div[slot="commentMeta"] .author-name-meta, [slot="authorName"], [data-testid="comment_author_link"]');
    if (metaAuthorNode && metaAuthorNode.closest(CANDIDATE_SELECTOR) === el) {
      const text = normalizeUsername(metaAuthorNode.textContent);
      if (text && !NON_BLOCKABLE_USERS.has(text)) return text;
    }

    return "";
  }

  // Reads only text belonging to this post/comment, not text from nested
  // child comments. That prevents one blocked reply from hiding its parent.
  function ownVisibleText(el) {
    const chunks = [];
    const walker = document.createTreeWalker(
      el,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const owner = parent.closest(CANDIDATE_SELECTOR);
          return owner === el
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node;
    let total = 0;
    while ((node = walker.nextNode()) && total < 2500) {
      const value = node.nodeValue?.trim();
      if (!value) continue;
      chunks.push(value);
      total += value.length;
    }

    return chunks.join(" ").toLowerCase();
  }

  function isNativeBlocked(el, author) {
    if (!settings.hideNativeBlocked) return false;

    if (BLOCK_MARKERS.has(author)) return true;

    const text = ownVisibleText(el);
    if (!text) return false;

    return (
      /\bblocked author\b/i.test(text) ||
      /\bblocked user\b/i.test(text) ||
      /\bblocked account\b/i.test(text)
    );
  }

  function shouldHide(el) {
    if (!settings.enabled) return false;

    const author = authorFromElement(el);

    if (
      author &&
      (hiddenUsers.has(author) ||
        sessionBlockedUsers.has(author) ||
        nativeBlockedUsers.has(author))
    ) {
      return true;
    }

    return isNativeBlocked(el, author);
  }

  function hide(el) {
    if (el.hasAttribute(HIDDEN_ATTR)) return;
    el.setAttribute(HIDDEN_ATTR, "true");
    el.style.setProperty("display", "none", "important");
  }

  function unhide(el) {
    if (!el.hasAttribute(HIDDEN_ATTR)) return;
    el.removeAttribute(HIDDEN_ATTR);
    el.style.removeProperty("display");
  }

  function styleBlockButton(button) {
    const set = (property, value) => {
      button.style.setProperty(property, value, "important");
    };

    // Reddit applies aggressive global button styles on some layouts. Reset
    // them and explicitly size this control so it cannot collapse into a
    // circle or cover the author name.
    set("all", "initial");
    set("display", "inline-flex");
    set("align-items", "center");
    set("justify-content", "center");
    set("box-sizing", "border-box");
    set("position", "static");
    set("float", "none");
    set("flex", "0 0 auto");
    set("width", "auto");
    set("min-width", "44px");
    set("max-width", "none");
    set("height", "44px");
    set("min-height", "44px");
    set("touch-action", "manipulation");
    set("margin", "0 0 0 6px");
    set("padding", "0 6px");
    set("border", "1px solid currentColor");
    set("border-radius", "999px");
    set("background", "transparent");
    set("color", "inherit");
    set("font-family", "inherit");
    set("font-size", "11px");
    set("font-weight", "500");
    set("line-height", "16px");
    set("white-space", "nowrap");
    set("text-indent", "0");
    set("letter-spacing", "normal");
    set("cursor", "pointer");
    set("opacity", "0.72");
    set("vertical-align", "middle");
    set("overflow", "visible");
    set("transform", "none");
  }

  function findOwnBlockButton(el) {
    const buttons = el.querySelectorAll?.(`[${BLOCK_BUTTON_ATTR}]`);

    for (const button of buttons || []) {
      if (button.closest(CANDIDATE_SELECTOR) === el) return button;
    }

    return null;
  }

  function setBlockButtonState(button, state, username, message = "") {
    if (!(button instanceof HTMLButtonElement)) return;

    button.disabled = state === "blocking" || state === "blocked";
    button.dataset.state = state;
    button.title = message || `Block u/${username} on Reddit`;
    button.setAttribute("aria-label", button.title);

    if (state === "blocking") {
      button.textContent = "Blocking…";
      button.style.setProperty("cursor", "wait");
      button.style.setProperty("opacity", "0.55");
    } else if (state === "blocked") {
      button.textContent = "Blocked";
      button.style.setProperty("cursor", "default");
      button.style.setProperty("opacity", "0.55");
    } else if (state === "error") {
      button.textContent = "Block failed";
      button.style.setProperty("cursor", "pointer");
      button.style.setProperty("opacity", "1");
    } else {
      button.textContent = "Block";
      button.style.setProperty("cursor", "pointer");
      button.style.setProperty("opacity", "0.72");
    }
  }

  function markUserButtonsBlocked(username) {
    document.querySelectorAll(`[${BLOCK_BUTTON_ATTR}]`).forEach((button) => {
      if (button.getAttribute(BLOCK_BUTTON_USER_ATTR) === username) {
        setBlockButtonState(button, "blocked", username, `u/${username} is blocked`);
      }
    });
  }

  async function getRedditSession() {
    if (cachedModhash && currentUsername) {
      return { modhash: cachedModhash, username: currentUsername };
    }

    const response = await fetch("/api/me.json?raw_json=1", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Reddit session check failed (${response.status})`);
    }

    const payload = await response.json();
    const data = payload?.data || {};
    const modhash = String(data.modhash || "").trim();
    const username = normalizeUsername(data.name || "");

    if (!modhash || !username) {
      throw new Error("Log in to Reddit before blocking users");
    }

    cachedModhash = modhash;
    currentUsername = username;
    return { modhash, username };
  }

  async function getAccountFullname(username) {
    try {
      const response = await fetch(`/user/${encodeURIComponent(username)}/about.json?raw_json=1`, {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) return "";
      const payload = await response.json();
      const id = String(payload?.data?.id || "").trim();
      return id ? `t2_${id}` : "";
    } catch {
      return "";
    }
  }

  async function blockRedditUser(username) {
    const normalized = normalizeUsername(username);
    if (NON_BLOCKABLE_USERS.has(normalized)) {
      throw new Error("That account cannot be blocked");
    }

    const session = await getRedditSession();
    if (session.username === normalized) {
      throw new Error("You cannot block your own account");
    }

    const accountFullname = await getAccountFullname(normalized);
    const body = new URLSearchParams({
      api_type: "json",
      name: normalized,
      raw_json: "1",
      uh: session.modhash
    });

    if (accountFullname) body.set("account_id", accountFullname);

    const response = await fetch("/api/block_user", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "X-Modhash": session.modhash,
        "X-Requested-With": "XMLHttpRequest"
      },
      body: body.toString()
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Reddit may return an empty success body.
    }

    const errors = payload?.json?.errors;
    if (!response.ok || (Array.isArray(errors) && errors.length)) {
      const detail = Array.isArray(errors) && errors.length
        ? errors.map((error) => error?.[1] || error?.[0]).filter(Boolean).join(", ")
        : `HTTP ${response.status}`;
      throw new Error(`Reddit did not block u/${normalized}: ${detail}`);
    }

    return normalized;
  }

  function extractUsernamesFromBlockPayload(payload) {
    const list = [];
    if (!payload) return list;

    // Standard Reddit /prefs/blocked.json format: { kind: "UserList", data: { children: [ { name: "...", id: "..." } ] } }
    const children = payload?.data?.children || payload?.children;
    if (Array.isArray(children)) {
      for (const item of children) {
        const name = item?.name || item?.data?.name || item?.node?.name;
        if (name) list.push(normalizeUsername(name));
      }
    } else if (Array.isArray(payload?.data)) {
      for (const item of payload.data) {
        const name = item?.name || item?.username;
        if (name) list.push(normalizeUsername(name));
      }
    } else if (Array.isArray(payload)) {
      for (const item of payload) {
        const name = typeof item === "string" ? item : item?.name || item?.username;
        if (name) list.push(normalizeUsername(name));
      }
    }

    return list.filter(Boolean);
  }

  async function fetchNativeBlockedFromEndpoint(url) {
    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) return null;

      const payload = await response.json();
      return extractUsernamesFromBlockPayload(payload);
    } catch {
      return null;
    }
  }

  async function syncNativeBlockedUsers(force = false) {
    if (!settings.enabled || syncInProgress) return;
    syncInProgress = true;

    try {
      if (!force && typeof chrome !== "undefined" && chrome.storage?.local) {
        const cached = await new Promise((resolve) => {
          chrome.storage.local.get(
            [NATIVE_BLOCKS_CACHE_KEY, NATIVE_BLOCKS_CACHE_TIME_KEY],
            resolve
          );
        });

        const cachedList = cached?.[NATIVE_BLOCKS_CACHE_KEY];
        const cachedTime = cached?.[NATIVE_BLOCKS_CACHE_TIME_KEY] || 0;
        const now = Date.now();

        if (Array.isArray(cachedList) && now - cachedTime < CACHE_TTL_MS) {
          for (const u of cachedList) {
            nativeBlockedUsers.add(u);
          }
          scan();
          syncInProgress = false;
          return;
        }
      }

      // Try /prefs/blocked.json first, then fallback to /api/v1/me/blocked
      let usernames = await fetchNativeBlockedFromEndpoint("/prefs/blocked.json?limit=100&raw_json=1");
      if (!usernames || !usernames.length) {
        const fallback = await fetchNativeBlockedFromEndpoint("/api/v1/me/blocked?limit=100&raw_json=1");
        if (fallback && fallback.length) {
          usernames = fallback;
        }
      }

      if (Array.isArray(usernames)) {
        for (const u of usernames) {
          nativeBlockedUsers.add(u);
        }

        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({
            [NATIVE_BLOCKS_CACHE_KEY]: Array.from(nativeBlockedUsers),
            [NATIVE_BLOCKS_CACHE_TIME_KEY]: Date.now()
          });
        }

        scan();
      }
    } catch {
      // Non-fatal: logged out or Reddit API transient error
    } finally {
      syncInProgress = false;
    }
  }

  function loadCachedNativeBlocked() {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get([NATIVE_BLOCKS_CACHE_KEY], (cached) => {
        const cachedList = cached?.[NATIVE_BLOCKS_CACHE_KEY];
        if (Array.isArray(cachedList)) {
          for (const u of cachedList) {
            nativeBlockedUsers.add(normalizeUsername(u));
          }
          scan();
        }
      });
    }
  }

  function persistBlockedUser(username) {
    if (!username || typeof chrome === "undefined" || !chrome.storage?.sync) return;

    chrome.storage.sync.get(DEFAULTS, (stored) => {
      const currentList = Array.isArray(stored?.usernames) ? stored.usernames : [];
      const normalizedCurrent = currentList.map(normalizeUsername);
      if (!normalizedCurrent.includes(username)) {
        const nextList = [...currentList, username];
        chrome.storage.sync.set({ usernames: nextList }, () => {
          if (chrome.storage?.local) {
            chrome.storage.local.set({
              [NATIVE_BLOCKS_CACHE_KEY]: Array.from(nativeBlockedUsers)
            });
          }
        });
      }
    });
  }

  async function blockAndHideUser(username, button = null, source = "button") {
    const normalized = normalizeUsername(username);
    if (NON_BLOCKABLE_USERS.has(normalized)) return false;
    if (blockingUsers.has(normalized) || sessionBlockedUsers.has(normalized)) return false;

    blockingUsers.add(normalized);
    if (button) setBlockButtonState(button, "blocking", normalized);

    try {
      const blockedUsername = await blockRedditUser(normalized);
      sessionBlockedUsers.add(blockedUsername);
      nativeBlockedUsers.add(blockedUsername);
      markUserButtonsBlocked(blockedUsername);
      persistBlockedUser(blockedUsername);

      // Give the successful state one paint before the extension hides all
      // visible posts/comments from the newly blocked account.
      requestAnimationFrame(() => requestAnimationFrame(() => scan()));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reddit block failed";

      if (button) {
        setBlockButtonState(button, "error", normalized, message);
        window.setTimeout(() => {
          if (button.isConnected && !sessionBlockedUsers.has(normalized)) {
            setBlockButtonState(button, "idle", normalized);
          }
        }, 2500);
      } else {
        console.warn(`[Hide Blocked Redditors] ${source} block failed for u/${normalized}: ${message}`);
      }

      return false;
    } finally {
      blockingUsers.delete(normalized);
    }
  }

  async function handleBlockClick(event, button, username) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    await blockAndHideUser(username, button, "Block button");
  }

  function voteStateForCandidate(candidate) {
    if (!(candidate instanceof Element)) return "";

    const ownState = String(candidate.getAttribute("vote-state") || "").toUpperCase();
    if (ownState) return ownState;

    const stateNode = candidate.querySelector(":scope > [vote-state], [vote-state]");
    return String(stateNode?.getAttribute("vote-state") || "").toUpperCase();
  }

  function candidateFromVoteStateNode(node) {
    if (!(node instanceof Element)) return null;
    if (node.matches(CANDIDATE_SELECTOR)) return node;
    return node.closest(CANDIDATE_SELECTOR);
  }

  function handleVoteStateMutation(mutation) {
    if (!settings.enabled || mutation.attributeName !== "vote-state") return;

    const stateNode = mutation.target;
    if (!(stateNode instanceof Element)) return;

    const previousState = String(mutation.oldValue || "").toUpperCase();
    const nextState = String(stateNode.getAttribute("vote-state") || "").toUpperCase();

    // Ignore initial hydration. Only act on a real transition from an existing
    // vote state into DOWN, e.g. NONE -> DOWN or UP -> DOWN.
    if (!previousState || previousState === "DOWN" || nextState !== "DOWN") return;

    const candidate = candidateFromVoteStateNode(stateNode);
    if (!candidate) return;

    const username = authorFromElement(candidate);
    if (!username || NON_BLOCKABLE_USERS.has(username)) return;

    const button = findOwnBlockButton(candidate);
    void blockAndHideUser(username, button, "Downvote vote-state");
  }

  function downvoteControlFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (node instanceof Element && node.matches(DOWNVOTE_SELECTOR)) return node;
    }

    const target = event.target instanceof Element ? event.target : null;
    return target?.closest(DOWNVOTE_SELECTOR) || null;
  }

  function voteCandidateFromEvent(event, control) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (node instanceof Element && node.matches(CANDIDATE_SELECTOR)) return node;
    }
    return control?.closest(CANDIDATE_SELECTOR) || null;
  }

  function isDownvoted(candidate, control) {
    if (!(candidate instanceof Element) || !(control instanceof Element)) return false;

    if (voteStateForCandidate(candidate) === "DOWN") {
      return true;
    }

    if (String(control.getAttribute("aria-pressed") || "").toLowerCase() === "true") {
      return true;
    }

    if (control.classList.contains("downmod") || control.querySelector?.(".icon-downvote_fill")) {
      return true;
    }

    const selected = candidate.querySelector(
      "button[downvote][aria-pressed='true'], " +
      "button[aria-label='downvote' i][aria-pressed='true'], " +
      "button[data-click-id='downvote'][aria-pressed='true'], " +
      ".arrow.downmod"
    );
    return !!selected;
  }

  function waitForDownvote(candidate, control, timeoutMs = 500) {
    return new Promise((resolve) => {
      const started = performance.now();

      const check = () => {
        if (!candidate.isConnected || !control.isConnected) {
          resolve(false);
          return;
        }

        if (isDownvoted(candidate, control)) {
          resolve(true);
          return;
        }

        if (performance.now() - started >= timeoutMs) {
          resolve(false);
          return;
        }

        window.setTimeout(check, 35);
      };

      window.setTimeout(check, 0);
    });
  }

  function handleDownvoteClick(event) {
    if (!settings.enabled) return;
    if (event.button !== undefined && event.button !== 0) return;

    const control = downvoteControlFromEvent(event);
    if (!control) return;

    const candidate = voteCandidateFromEvent(event, control);
    if (!candidate) return;

    const username = authorFromElement(candidate);
    if (!username || NON_BLOCKABLE_USERS.has(username)) return;

    // Do not interfere with Reddit's vote click. Wait until Reddit has applied
    // the click and block only if the resulting state is actually DOWN. This
    // prevents an un-downvote click from blocking the author.
    void waitForDownvote(candidate, control).then((downvoted) => {
      if (!downvoted) return;
      const button = findOwnBlockButton(candidate);
      void blockAndHideUser(username, button, "Downvote");
    });
  }

  function ensureBlockButton(el) {
    if (!(el instanceof Element)) return;

    const authorLink = ownAuthorLink(el);
    if (!authorLink) return;

    const username = usernameFromLink(authorLink);
    if (NON_BLOCKABLE_USERS.has(username)) return;
    if (currentUsername && username === currentUsername) return;

    let button = findOwnBlockButton(el);
    if (button) {
      if (button.getAttribute(BLOCK_BUTTON_USER_ATTR) !== username) {
        button.remove();
        button = null;
      } else {
        return;
      }
    }

    button = document.createElement("button");
    button.type = "button";
    button.setAttribute(BLOCK_BUTTON_ATTR, "true");
    button.setAttribute(BLOCK_BUTTON_USER_ATTR, username);
    styleBlockButton(button);
    const isUserBlocked =
      sessionBlockedUsers.has(username) ||
      nativeBlockedUsers.has(username) ||
      hiddenUsers.has(username);

    setBlockButtonState(
      button,
      isUserBlocked ? "blocked" : "idle",
      username
    );

    button.addEventListener("click", (event) => {
      void handleBlockClick(event, button, username);
    });

    authorLink.insertAdjacentElement("afterend", button);
  }

  function processElement(el) {
    if (!(el instanceof Element)) return;
    if (!el.matches(CANDIDATE_SELECTOR)) return;

    if (shouldHide(el)) {
      hide(el);
      return;
    }

    unhide(el);
    ensureBlockButton(el);
  }

  function scan(root = document) {
    if (!settings.enabled) {
      document
        .querySelectorAll(`[${HIDDEN_ATTR}]`)
        .forEach(unhide);
      return;
    }

    if (root instanceof Element && root.matches(CANDIDATE_SELECTOR)) {
      processElement(root);
    }

    root
      .querySelectorAll?.(CANDIDATE_SELECTOR)
      .forEach(processElement);
  }

  function queueScan(root = document) {
    const scanRoot = root instanceof Element || root instanceof Document ? root : document;
    pendingScanRoots.add(scanRoot);

    if (scanQueued) return;
    scanQueued = true;

    requestAnimationFrame(() => {
      scanQueued = false;

      const roots = Array.from(pendingScanRoots);
      pendingScanRoots.clear();

      if (roots.includes(document)) {
        scan(document);
        return;
      }

      // A single Reddit render can insert several independent post/comment
      // subtrees before the next animation frame. Keep every queued root
      // instead of silently dropping all but the first one.
      const connectedRoots = roots.filter((candidate) => candidate.isConnected);
      for (const rootCandidate of connectedRoots) {
        const coveredByAnotherRoot = connectedRoots.some(
          (other) => other !== rootCandidate && other.contains(rootCandidate)
        );
        if (!coveredByAnotherRoot) scan(rootCandidate);
      }
    });
  }

  function scheduleRouteRescan() {
    [0, 80, 200, 450, 900].forEach((delay) => {
      window.setTimeout(() => queueScan(document), delay);
    });
  }

  function checkForRouteChange() {
    try {
      if (typeof location === "undefined" || !location?.href) return;
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      scheduleRouteRescan();
    } catch {
      // Document or window context has been destroyed
    }
  }

  function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
      checkForRouteChange();

      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          if (mutation.attributeName === "vote-state") {
            handleVoteStateMutation(mutation);
          }

          const target = mutation.target;
          if (target instanceof Element) {
            const candidate = target.matches(CANDIDATE_SELECTOR)
              ? target
              : target.closest(CANDIDATE_SELECTOR);
            if (candidate) processElement(candidate);
          }
          continue;
        }

        if (mutation.type === "characterData") {
          const parent = mutation.target.parentElement;
          const candidate = parent?.closest(CANDIDATE_SELECTOR);
          if (candidate) processElement(candidate);
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          queueScan(node);
        }

        // Reddit sometimes reuses an existing post/comment shell and removes
        // extension-owned children before repopulating it. Re-scan that shell
        // so the Block button is restored without requiring a page refresh.
        if (mutation.removedNodes.length && mutation.target instanceof Element) {
          queueScan(mutation.target.closest(CANDIDATE_SELECTOR) || mutation.target);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      attributeFilter: [
        "author",
        "data-author",
        "author-name",
        "data-author-name",
        "class",
        "href",
        "vote-state",
        "distinguished-as",
        "is-mod-distinguished",
        "stickied"
      ]
    });
  }

  window.addEventListener("popstate", scheduleRouteRescan);
  window.addEventListener("hashchange", scheduleRouteRescan);
  window.addEventListener("pageshow", scheduleRouteRescan);
  window.addEventListener("focus", checkForRouteChange);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      checkForRouteChange();
      queueScan(document);
    }
  });

  if (window.navigation?.addEventListener) {
    window.navigation.addEventListener("navigate", scheduleRouteRescan);
  }

  document.addEventListener("click", handleDownvoteClick, true);

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    setSettings(stored);
    loadCachedNativeBlocked();
    scan();
    startObserver();
    void syncNativeBlockedUsers();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;

    chrome.storage.sync.get(DEFAULTS, (stored) => {
      setSettings(stored);

      // Re-evaluate everything so removing a username immediately restores it.
      document
        .querySelectorAll(`[${HIDDEN_ATTR}]`)
        .forEach(unhide);

      scan();
    });
  });
})();

(() => {
  "use strict";
  const POSTS = "shreddit-post,.Post,.thing.link,[data-testid='post-container']";
  const BUTTON = "data-hbr-mute";
  const pending = new Set();
  const storedMuted = GM_getValue("hbrMutedSubreddits", []);
  const muted = new Set((Array.isArray(storedMuted) ? storedMuted : []).map(normalize).filter(Boolean));
  const hiddenAttribute = "data-hbr-muted-subreddit";
  const hideStyle = document.createElement("style");
  hideStyle.textContent = `[${hiddenAttribute}] { display: none !important; }`;
  (document.head || document.documentElement).append(hideStyle);

  function hideMutedPosts() {
    document.querySelectorAll(POSTS).forEach(post => {
      const name = postSubreddit(post);
      if (muted.has(name)) {
        if (post.getAttribute(hiddenAttribute) !== name) post.setAttribute(hiddenAttribute, name);
      } else if (post.hasAttribute(hiddenAttribute)) {
        post.removeAttribute(hiddenAttribute);
      }
    });
  }
  GM_registerMenuCommand("Clear local subreddit hiding list", () => {
    muted.clear();
    GM_setValue("hbrMutedSubreddits", []);
    document.querySelectorAll(`[${BUTTON}]`).forEach(button => setState(button, button.getAttribute(BUTTON), "idle"));
    hideMutedPosts();
    announce("Local subreddit hiding cleared. Use Reddit Settings to unmute communities on your account.");
  });
  let enabled = true;
  let queued = false;

  function normalize(value) {
    const name = String(value || "").trim().replace(/^\/?r\//i, "").toLowerCase();
    return /^[a-z0-9_]{2,21}$/.test(name) && !["all", "popular", "mod", "friends"].includes(name) && !name.startsWith("u_") ? name : "";
  }

  function fromHref(value, rootOnly = false) {
    try {
      const url = new URL(value, location.origin);
      if (!/(^|\.)reddit\.com$/.test(url.hostname)) return "";
      const match = url.pathname.match(rootOnly ? /^\/r\/([^/]+)\/?$/i : /^\/r\/([^/]+)(?:\/|$)/i);
      return match ? normalize(match[1]) : "";
    } catch { return ""; }
  }

  function postSubreddit(post) {
    // The outer post's metadata is authoritative, including crossposts.
    for (const attr of ["subreddit-name", "subreddit-prefixed-name", "data-subreddit"]) {
      const name = normalize(post.getAttribute(attr));
      if (name) return name;
    }
    const permalink = fromHref(post.getAttribute("permalink") || "");
    if (permalink) return permalink;
    const link = [...post.querySelectorAll("a[href]")].find(link =>
      link.closest(POSTS) === post && (link.matches(".subreddit,[data-click-id='subreddit']") || link.getAttribute("slot") === "full-post-link"));
    if (link) return fromHref(link.getAttribute("href"));
    // Mobile cards may expose only a regular community link in their header.
    const headerLink = [...post.querySelectorAll("a[href]")].find(link =>
      link.closest(POSTS) === post && fromHref(link.getAttribute("href"), true));
    return headerLink ? fromHref(headerLink.getAttribute("href"), true) : "";
  }

  function setState(button, name, state, message = "") {
    button.dataset.state = state;
    button.disabled = state === "pending" || state === "muted";
    button.textContent = state === "pending" ? "Muting…" : state === "muted" ? `Muted r/${name}` : state === "error" ? "Mute failed · Retry" : `Mute r/${name}`;
    button.title = message || `Mute r/${name} on Reddit`;
    button.setAttribute("aria-label", button.title);
  }

  function updateButtons(name, state, message) {
    document.querySelectorAll(`[${BUTTON}]`).forEach(button => {
      if (button.getAttribute(BUTTON) === name) setState(button, name, state, message);
    });
  }

  function announce(message) {
    let status = document.getElementById("hbr-mute-status");
    if (!status) {
      status = document.createElement("div");
      status.id = "hbr-mute-status";
      status.setAttribute("role", "status");
      status.style.cssText = "position:fixed;bottom:24px;left:12px;right:12px;z-index:2147483647;background:#202020;color:#fff;padding:12px 18px;border-radius:10px;max-width:400px;box-sizing:border-box;overflow-wrap:anywhere;pointer-events:none;font:14px/1.4 system-ui;box-shadow:0 3px 16px #0006";
      document.body.append(status);
    }
    status.textContent = message;
    clearTimeout(announce.timer);
    announce.timer = setTimeout(() => status.remove(), 8000);
  }

  function postIdentity(post) {
    return ["id", "post-id", "data-fullname", "permalink", "subreddit-name", "data-subreddit"]
      .map(attr => post.getAttribute(attr) || "").join("|");
  }

  // Stay inside this card, including open component roots, but never enter
  // a nested crosspost or comment. Do not search the page for a substitute.
  function ownVoteNodes(post) {
    const nodes = [];
    function visit(root) {
      for (const el of root.children) {
        if (el.matches(POSTS + ",shreddit-comment,.Comment,.thing.comment,[data-testid='comment']")) continue;
        nodes.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
        visit(el);
      }
    }
    if (post.shadowRoot) visit(post.shadowRoot);
    visit(post);
    return nodes;
  }

  async function downvotePost(post, name, identity) {
    const selector = "button[downvote],button[aria-label='downvote' i],button[data-click-id='downvote'],button[data-adclicklocation='downvote'],[data-testid='downvote'],.arrow.down,.arrow.downmod";
    const started = performance.now();
    let clicked = false;
    while (performance.now() - started < 2000) {
      if (!enabled || !post.isConnected || postSubreddit(post) !== name || postIdentity(post) !== identity) break;
      const nodes = ownVoteNodes(post);
      const controls = nodes.filter(el => el.matches(selector));
      if ([post, ...nodes].some(el => el.getAttribute("vote-state")?.toUpperCase() === "DOWN") ||
          controls.some(el => el.getAttribute("aria-pressed") === "true" || el.classList.contains("downmod") || el.querySelector(".icon-downvote_fill"))) {
        return "Post is downvoted.";
      }
      const control = controls.find(el => typeof el.click === "function" &&
        !el.matches(":disabled,[disabled],[aria-disabled='true']") && !el.closest("[hidden],[aria-hidden='true']"));
      if (!clicked && control) {
        // Exactly one click: a second click could undo a successful vote.
        clicked = true;
        control.click();
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return clicked ? "Downvote clicked; Reddit's vote state was not confirmed." : "Post downvote unavailable; no vote was clicked.";
  }

  async function mute(name, post) {
    if (!enabled || pending.has(name) || muted.has(name)) return;
    pending.add(name);
    const identity = postIdentity(post);
    // Hide first: the tap should clear the feed without waiting on Reddit.
    muted.add(name);
    hideMutedPosts();
    updateButtons(name, "pending");
    try {
      const csrfCookie = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("csrf_token="));
      if (!csrfCookie) throw new Error("Log in to Reddit, then try again.");
      const csrf = decodeURIComponent(csrfCookie.slice("csrf_token=".length));
      let id = post.getAttribute("subreddit-id");
      if (!/^t5_[a-z0-9]+$/i.test(id || "")) {
        const about = await fetch(`/r/${encodeURIComponent(name)}/about.json?raw_json=1`, {credentials: "include", signal: AbortSignal.timeout(15000)});
        if (!about.ok) throw new Error(`Could not identify r/${name} (HTTP ${about.status}).`);
        const data = (await about.json())?.data;
        if (normalize(data?.display_name) !== name || !/^t5_[a-z0-9]+$/i.test(data?.name || "")) throw new Error("Reddit returned an unexpected community. Refresh and retry.");
        id = data.name;
      }
      // Matches Reddit's native community-mute modal and GraphQL transport.
      const response = await fetch("/svc/shreddit/graphql", {
        method: "POST", credentials: "include", signal: AbortSignal.timeout(20000),
        headers: {Accept: "application/json", "Content-Type": "application/json"},
        body: JSON.stringify({operation: "UpdateSubredditMuteSettings", variables: {input: {subredditId: id}}, csrf_token: csrf})
      });
      if (!response.ok) throw new Error(`Reddit could not mute r/${name} (HTTP ${response.status}).`);
      const result = await response.json();
      if (result.errors?.length || result.data?.updateSubredditMuteSettings?.ok !== true) {
        throw new Error(`Reddit did not confirm the mute for r/${name}. Check your muted communities or retry.`);
      }
      muted.add(name);
      // Keep the successful account action successful even if local storage is unavailable.
      try { GM_setValue("hbrMutedSubreddits", [...muted]); } catch (error) { console.warn("Could not save local hiding list", error); }
      hideMutedPosts();
      updateButtons(name, "muted", `r/${name} is muted on Reddit`);
      // Keep a successful mute successful even if the post disappears or its
      // vote control fails. Existing downvote/block handling receives the click.
      let voteMessage;
      try { voteMessage = await downvotePost(post, name, identity); }
      catch { voteMessage = "Post downvote unavailable; mute succeeded."; }
      announce(`Muted r/${name} on Reddit. ${voteMessage}`);
    } catch (error) {
      // Reddit did not mute it, so bring the posts back with a Retry button.
      muted.delete(name);
      hideMutedPosts();
      const message = error.name === "TimeoutError" ? "Reddit took too long to respond. Check your muted communities before retrying." : error.message || "Mute failed. Please retry.";
      updateButtons(name, "error", message);
      announce(message);
    } finally {
      pending.delete(name);
    }
  }

  function ensureButton(post) {
    const name = postSubreddit(post);
    let button = [...post.querySelectorAll(`[${BUTTON}]`)].find(button => button.closest(POSTS) === post);
    if (button && (!enabled || button.getAttribute(BUTTON) !== name)) {
      button.closest(".hbr-quick-mute-row").remove(); button = null;
    }
    if (!enabled || !name || button) return;
    const row = document.createElement("div");
    row.className = "hbr-quick-mute-row";
    row.style.cssText = "display:block!important;width:100%!important;box-sizing:border-box!important;padding:4px 0!important;position:relative!important;z-index:2!important";
    button = document.createElement("button");
    button.type = "button";
    button.setAttribute(BUTTON, name);
    button.style.cssText = "all:initial!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;min-height:44px!important;max-width:100%!important;padding:8px 14px!important;border:1px solid currentColor!important;border-radius:22px!important;color:inherit!important;background:transparent!important;font:600 14px/20px system-ui!important;white-space:normal!important;overflow-wrap:anywhere!important;cursor:pointer!important;touch-action:manipulation!important;-webkit-tap-highlight-color:transparent!important";
    setState(button, name, pending.has(name) ? "pending" : muted.has(name) ? "muted" : "idle");
    // Keep a tap from opening the post. A single click handler also supports keyboards.
    for (const type of ["pointerdown", "pointerup"]) {
      button.addEventListener(type, event => event.stopPropagation());
    }
    button.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      if (postSubreddit(post) !== name) { schedule(); return; }
      void mute(name, post);
    });
    row.append(button);
    // Reddit renders post content through named slots; unslotted elements can disappear.
    // A separate credit-bar item avoids squeezing the mobile header's links and menu.
    if (post.matches("shreddit-post")) {
      const credit = [...post.children].find(el => el.getAttribute("slot") === "credit-bar");
      const title = [...post.children].find(el => el.getAttribute("slot") === "title");
      if (credit) {
        row.setAttribute("slot", "credit-bar"); credit.after(row);
      } else if (title) {
        row.setAttribute("slot", "title"); title.before(row);
      } else {
        // Hydration may expose the slots after the card is inserted. Retry, don't
        // insert an invisible button that would prevent a later successful attempt.
        return;
      }
    } else {
      const header = [...post.querySelectorAll(".tagline,[data-testid='post_author_link']")]
        .find(el => el.closest(POSTS) === post);
      if (header) header.after(row);
      else post.prepend(row);
    }
  }

  function scan() {
    queued = false;
    hideMutedPosts();
    document.querySelectorAll(POSTS).forEach(ensureButton);
  }
  function schedule() {
    if (!queued) { queued = true; requestAnimationFrame(scan); }
  }
  const observer = new MutationObserver(mutations => {
    // Ignore our own state text changes to avoid rescan loops.
    if (mutations.some(m => !m.target.closest?.(`[${BUTTON}],#hbr-mute-status`))) schedule();
  });
  function start() {
    if (!document.body) { setTimeout(start, 50); return; }
    scan();
    observer.observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["subreddit-name", "subreddit-prefixed-name", "subreddit-id", "data-subreddit", "permalink", "href", "slot"]
    });
  }
  start();
  window.addEventListener("popstate", schedule);
  window.addEventListener("pageshow", schedule);
})();

})();
