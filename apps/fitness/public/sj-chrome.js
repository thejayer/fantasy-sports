// Strictly Jayers chrome for the fitness PWA (accent + cross-host links).
(function () {
  const ACCENTS = [
    { name: "Signal Red", hex: "#ec3013" },
    { name: "Ink", hex: "#201e1d" },
    { name: "Pine", hex: "#1f4d3a" },
    { name: "Cobalt", hex: "#2b4a8b" },
  ];
  const STORAGE_KEY = "sj-accent";

  function meta(name) {
    const node = document.querySelector(`meta[name="${name}"]`);
    return node && node.getAttribute("content") ? node.getAttribute("content").replace(/\/+$/, "") : "";
  }

  const community = meta("sj-community") || "https://strictlyjayers.com";
  const fantasy = meta("sj-fantasy") || "https://fantasy.strictlyjayers.com";
  const vibe = meta("sj-vibe") || "https://vibe.strictlyjayers.com";

  document.querySelectorAll("[data-sj-community]").forEach((el) => {
    if (el.tagName === "A") el.setAttribute("href", community);
  });
  document.querySelectorAll("[data-sj-community-bets]").forEach((el) => {
    if (el.tagName === "A") el.setAttribute("href", community + "/bets");
  });
  document.querySelectorAll("[data-sj-fantasy]").forEach((el) => {
    if (el.tagName === "A") el.setAttribute("href", fantasy);
  });
  document.querySelectorAll("[data-sj-settings]").forEach((el) => {
    if (el.tagName === "A") el.setAttribute("href", fantasy + "/settings");
  });
  document.querySelectorAll("[data-sj-vibe]").forEach((el) => {
    if (el.tagName === "A") el.setAttribute("href", vibe);
  });

  function readAccent() {
    try {
      // Shared cookie from the hub's Profile & settings page wins.
      const m = document.cookie.match(/(?:^|; )sj-accent=([^;]*)/);
      const shared = m ? decodeURIComponent(m[1]) : null;
      if (shared && /^#[0-9a-fA-F]{6}$/.test(shared)) return shared;
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && /^#[0-9a-fA-F]{6}$/.test(saved)) return saved;
    } catch {
      /* ignore */
    }
    return ACCENTS[0].hex;
  }

  function applyAccent(hex) {
    document.documentElement.style.setProperty("--color-accent", hex);
  }

  function renderAccount(user) {
    const wrap = document.getElementById("sjAccount");
    const name = document.getElementById("sjAccountName");
    const signOut = document.getElementById("sjSignOut");
    if (!wrap || !name || !signOut || !user) return;
    name.textContent = user.name || user.email || "Member";
    const avatar = document.getElementById("sjAccountAvatar");
    if (avatar) {
      const img = user.image_url || user.image;
      if (img && /^https:\/\//i.test(img)) {
        const el = document.createElement("img");
        el.src = img;
        el.alt = "";
        el.width = 24;
        el.height = 24;
        el.referrerPolicy = "no-referrer";
        avatar.replaceChildren(el);
      } else {
        avatar.textContent = (user.name || user.email || "SJ")
          .split(/[\s@._-]+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((p) => p[0].toUpperCase())
          .join("");
      }
    }
    wrap.hidden = false;
    signOut.hidden = false;
    signOut.addEventListener("click", async () => {
      try {
        const csrfRes = await fetch("/api/auth/csrf", { credentials: "same-origin" });
        const csrf = csrfRes.ok ? await csrfRes.json() : {};
        const body = new URLSearchParams();
        if (csrf.csrfToken) body.set("csrfToken", csrf.csrfToken);
        body.set("callbackUrl", "/login");
        await fetch("/api/auth/signout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        });
      } catch {
        /* still leave */
      }
      location.replace("/login");
    });
  }

  if (window.__sjFitness?.user) {
    renderAccount(window.__sjFitness.user);
  } else {
    window.addEventListener("sj-fitness-ready", () => {
      renderAccount(window.__sjFitness && window.__sjFitness.user);
    });
  }

  const current = readAccent();
  applyAccent(current);
  const picker = document.getElementById("accentPicker");
  if (!picker) return;
  picker.setAttribute("role", "group");
  ACCENTS.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = item.hex === current ? "accent-swatch is-active" : "accent-swatch";
    button.style.background = item.hex;
    button.title = item.name;
    button.setAttribute("aria-label", item.name);
    button.setAttribute("aria-pressed", item.hex === current ? "true" : "false");
    button.addEventListener("click", () => {
      applyAccent(item.hex);
      try {
        localStorage.setItem(STORAGE_KEY, item.hex);
      } catch {
        /* ignore */
      }
      picker.querySelectorAll(".accent-swatch").forEach((node) => {
        const active = node === button;
        node.classList.toggle("is-active", active);
        node.setAttribute("aria-pressed", active ? "true" : "false");
      });
    });
    picker.appendChild(button);
  });
})();
