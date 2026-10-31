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
    if (el.tagName === "A") el.setAttribute("href", community + "/profile");
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
    signOut.addEventListener("click", () => openSignOutConfirm(signOut));
  }

  /*
    The same confirm as www, hub and vibe (their React SignOutDialog; styles in
    sj-ui .sj-confirm*). "Sign out" posts a form to this site's own
    /api/auth/signout-all, which signs fitness out and walks the browser
    through the other Strictly Jayers sites. Keep the words in step with
    SignOutDialog.tsx; packages/sj-ui/check.sh checks them.
  */
  const SIGN_OUT_TITLE = "Sign out of all Strictly Jayers sites?";
  const SIGN_OUT_BODY = "You'll need to sign in with Google again.";
  const SIGN_OUT_ACTION = "/api/auth/signout-all";

  function openSignOutConfirm(opener) {
    if (document.querySelector('[data-sj-confirm="signout"]')) return;
    const make = (tag, className, text) => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (text) el.textContent = text;
      return el;
    };
    const scrim = make("div", "sj-confirm-scrim");
    scrim.dataset.sjConfirm = "signout";
    const dialog = make("div", "sj-confirm");
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "sj-confirm-title");
    dialog.setAttribute("aria-describedby", "sj-confirm-body");
    const grip = make("span", "sj-confirm-grip");
    grip.setAttribute("aria-hidden", "true");
    const title = make("h2", "", SIGN_OUT_TITLE);
    title.id = "sj-confirm-title";
    const body = make("p", "", SIGN_OUT_BODY);
    body.id = "sj-confirm-body";
    const form = make("form", "sj-confirm-actions");
    form.method = "post";
    form.action = SIGN_OUT_ACTION;
    const confirm = make("button", "sj-confirm-btn sj-confirm-btn-danger", "Sign out");
    confirm.type = "submit";
    const cancel = make("button", "sj-confirm-btn", "Cancel");
    cancel.type = "button";
    form.append(confirm, cancel);
    dialog.append(grip, title, body, form);
    scrim.append(dialog);

    function close() {
      document.removeEventListener("keydown", onKey);
      scrim.remove();
      if (opener && opener.focus) opener.focus();
    }
    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialog.querySelectorAll("button:not([disabled])");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    cancel.addEventListener("click", close);
    scrim.addEventListener("mousedown", (event) => {
      if (event.target === scrim) close();
    });
    form.addEventListener("submit", () => {
      confirm.disabled = true;
      confirm.textContent = "Signing out…";
    });
    document.addEventListener("keydown", onKey);
    document.body.append(scrim);
    cancel.focus();
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
