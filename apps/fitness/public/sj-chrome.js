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

  document.querySelectorAll("[data-sj-community]").forEach((el) => {
    if (el.tagName === "A") el.setAttribute("href", community);
  });
  document.querySelectorAll("[data-sj-fantasy]").forEach((el) => {
    if (el.tagName === "A") el.setAttribute("href", fantasy);
  });

  function readAccent() {
    try {
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

  const picker = document.getElementById("accentPicker");
  if (!picker) return;
  const current = readAccent();
  applyAccent(current);
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
