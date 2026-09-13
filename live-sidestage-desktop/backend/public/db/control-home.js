(function () {
  const preview = document.getElementById("overlay-preview");
  const titleEl = document.getElementById("home-title");
  const pathEl = document.getElementById("home-path");
  const copyBtn = document.getElementById("copy-overlay-url");
  const testBtn = document.getElementById("fire-current-gift");
  const detailBtn = document.getElementById("open-widget-detail");
  const giftInput = document.getElementById("pseudo-gift-input");
  const recentEl = document.getElementById("recent-events");
  const recentEmptyEl = document.getElementById("recent-empty");
  const effectCountEl = document.getElementById("tonight-effect-count");
  const searchEl = document.getElementById("control-search");

  let widgetUrls = {};
  let broadcasterConfigured = false;
  let packagedElectron = false;
  let overlayCopyUrl = "";
  let selected = "top-gift";

  const widgets = {
    "top-gift": {
      title: "トップギフトランキング",
      pathLabel: "widgets / top-gift",
      overlayPath: "/overlays/top-gift",
      copy: () => copyUrl(widgetUrls.topGiftLoaderUrl, widgetUrls.topGiftOverlayUrl, "/overlays/top-gift"),
      detail: "/widgets"
    },
    effects: {
      title: "エフェクト",
      pathLabel: "overlays / effects",
      overlayPath: "/overlays/effects/1",
      copy: () => copyUrl(widgetUrls.effectsOverlayUrl, null, "/overlays/effects/1"),
      detail: "/event-categories"
    },
    "goal-gifts": {
      title: "目標ギフト",
      pathLabel: "widgets / goal-gifts",
      overlayPath: "/overlays/goal-gifts",
      copy: () => copyUrl(widgetUrls.goalGiftsLoaderUrl, widgetUrls.goalGiftsOverlayUrl, "/overlays/goal-gifts"),
      detail: "/widgets"
    },
    timer: {
      title: "タイマー",
      pathLabel: "widgets / timer",
      overlayPath: "/overlays/timer",
      copy: () => copyUrl(widgetUrls.timerLoaderUrl, widgetUrls.timerOverlayUrl, "/overlays/timer"),
      detail: "/widgets"
    }
  };

  function copyUrl(loaderUrl, overlayUrl, overlayPath) {
    if (packagedElectron) {
      return loaderUrl || overlayUrl || (location.origin + overlayPath);
    }
    return location.origin + overlayPath;
  }

  function withCard(baseUrl) {
    try {
      const previewUrl = new URL(baseUrl, window.location.origin);
      previewUrl.searchParams.set("card", "1");
      previewUrl.searchParams.delete("preview");
      previewUrl.searchParams.delete("sample");
      return previewUrl.toString();
    } catch {
      const separator = String(baseUrl).includes("?") ? "&" : "?";
      return `${baseUrl}${separator}card=1`;
    }
  }

  function overlayHostLabel(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.host;
    } catch {
      return location.host;
    }
  }

  function showHome() {
    if (typeof window.setCurrentRoute === "function") {
      window.setCurrentRoute("/home");
    }
  }

  function applySelection(key) {
    const spec = widgets[key];
    if (!spec) return;
    selected = key;
    document.querySelectorAll(".file[data-widget]").forEach((el) => {
      el.classList.toggle("on", el.dataset.widget === key);
    });
    titleEl.textContent = spec.title;
    overlayCopyUrl = spec.copy();
    pathEl.textContent = `${spec.pathLabel} · ${overlayHostLabel(overlayCopyUrl)}`;
    if (preview) {
      if (!broadcasterConfigured) {
        preview.removeAttribute("src");
        preview.src = "about:blank";
        return;
      }
      const nextSrc = withCard(spec.overlayPath);
      if (preview.getAttribute("src") !== nextSrc) {
        preview.src = nextSrc;
      }
    }
  }

  async function loadStateExtras() {
    try {
      const response = await fetch("/api/state");
      const payload = await response.json();
      broadcasterConfigured = Boolean(payload.broadcasterIdConfigured || payload.broadcasterId);
      packagedElectron = Boolean(payload.isPackagedElectron);
    } catch {}
    try {
      const response = await fetch("/api/widgets/config");
      const payload = await response.json();
      widgetUrls = payload.widgetUrls || {};
    } catch {}
    try {
      const response = await fetch("/api/effects/config");
      const payload = await response.json();
      const events = payload.events || payload.effectEvents || [];
      const count = Array.isArray(events) ? events.length : Number(payload.count || 0);
      if (effectCountEl) effectCountEl.textContent = String(count);
    } catch {}
    applySelection(selected);
  }

  async function copyOverlay() {
    const value = overlayCopyUrl || widgets[selected].copy();
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  async function fireGift() {
    const giftName = String(giftInput?.value || "").trim() || "Rose";
    await fetch("/api/test-data/gifts/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ giftName, repeatCount: 1 })
    }).catch(() => {});
    await fetch("/api/effects/gift-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ giftName, diamondCount: 1, repeatCount: 1 })
    }).catch(() => {});
    prependRecent(giftName + " → テスト送信");
  }

  function syncRecentEmpty() {
    if (!recentEmptyEl) return;
    recentEmptyEl.hidden = Boolean(recentEl && recentEl.children.length);
  }

  function prependRecent(title, ago) {
    if (!recentEl) return;
    const row = document.createElement("div");
    row.className = "ev";
    const label = document.createElement("b");
    label.textContent = title;
    row.append(label);
    if (ago) row.append(String(ago));
    recentEl.prepend(row);
    while (recentEl.children.length > 8) recentEl.lastElementChild.remove();
    syncRecentEmpty();
  }

  function timeAgo(ts) {
    const delta = Math.max(0, Date.now() - ts);
    if (delta < 2000) return "now";
    if (delta < 60000) return Math.round(delta / 1000) + "s";
    return Math.round(delta / 60000) + "m";
  }

  function filterNav(query) {
    const q = String(query || "").trim().toLowerCase();
    document.querySelectorAll("button.n, button.file").forEach((el) => {
      const hay = (el.textContent || "").toLowerCase();
      el.classList.toggle("is-filtered", Boolean(q) && !hay.includes(q));
    });
  }

  copyBtn?.addEventListener("click", () => { copyOverlay().catch(() => {}); });
  testBtn?.addEventListener("click", () => { fireGift().catch(() => {}); });
  detailBtn?.addEventListener("click", () => {
    const spec = widgets[selected];
    if (spec?.detail && typeof window.setCurrentRoute === "function") {
      window.setCurrentRoute(spec.detail);
    }
  });

  giftInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      fireGift().catch(() => {});
    }
  });

  searchEl?.addEventListener("input", () => filterNav(searchEl.value));
  searchEl?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const hit = document.querySelector("button.n:not(.is-filtered), button.file:not(.is-filtered)");
    if (hit) {
      event.preventDefault();
      hit.click();
    }
  });

  document.querySelectorAll(".file[data-widget]").forEach((el) => {
    el.addEventListener("click", () => {
      showHome();
      applySelection(el.dataset.widget);
    });
  });
  document.querySelectorAll(".file[data-view-path]").forEach((el) => {
    el.addEventListener("click", () => {
      const path = el.dataset.viewPath;
      if (path && typeof window.setCurrentRoute === "function") {
        window.setCurrentRoute(path);
      }
    });
  });

  const socket = window.controlSocket || (window.io ? window.io() : null);
  socket?.on("effects:playback", (payload) => {
    const gift = payload?.giftName || payload?.triggerName || "effect";
    const dest = payload?.eventName || payload?.audioUrl || ("画面" + (payload?.screen || ""));
    prependRecent(`${gift} → ${dest}`, timeAgo(Date.now()));
  });
  socket?.on("admin_day_updated", () => {
    loadStateExtras();
  });

  syncRecentEmpty();
  loadStateExtras();
  window.controlHomeApplySelection = applySelection;
})();
