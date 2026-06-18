/* ═══════════════════════════════════════════════════════════════════
   cms-reader.js — runtime každé GTW šablony (žije v template-base, dědí ho
   každá niche šablona i klientský klon). Bez závislostí, vanilla.

   CO DĚLÁ (a co tím pádem NESMÍ klon rozbít):
   1) Načte obsah  → window.__CMS_CONTENT__  nebo  fetch('./content.json')
   2) Aplikuje TÉMA (content.theme) na <body data-*>  → CSS reaguje (paleta/hero/…)
   3) Hydratuje SINGLETONY  [data-cms="cesta.k.hodnote"]  (text/​html/​image/​attr)
   4) Renderuje KOLEKCE     [data-cms-collection="key"]  z content.collections[key]
                            přes <template data-cms-item>  s poli [data-cms-field="f"]
   5) Zapojí FORMULÁŘE      [data-cms-form="key"] → POST /__submit (rezervace /__reserve)

   KONTRAKT S OVERLAYEM: manifest.collections[].schema (pole f/type/label/options)
   je TÝŽ objekt, který klientský CMS overlay čte, aby postavil editor. Šablona
   tedy MODUL jen DEKLARUJE (manifest) + OZNAČÍ (data-cms-*) — overlay ho spravuje
   automaticky. Žádný per-web kód modulu. Viz MODULES.md.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const LANG = () => document.documentElement.getAttribute("data-lang") || "cs";

  // hodnota může být skalár nebo {cs,en} — vyber dle jazyka
  function val(v) {
    if (v && typeof v === "object" && !Array.isArray(v) && ("cs" in v || "en" in v)) {
      return v[LANG()] ?? v.cs ?? v.en ?? "";
    }
    return v;
  }
  // bezpečné čtení "a.b.c" z objektu
  function path(obj, p) {
    return p.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  /* ── 2) TÉMA — content.theme → <body data-axis="value"> (sedí na #tweaks systém) ── */
  function applyTheme(theme) {
    if (!theme) return;
    Object.entries(theme).forEach(([axis, value]) => {
      if (value != null) document.body.setAttribute("data-" + axis, String(value));
    });
  }

  /* ── 3) SINGLETONY — [data-cms="path"] ── */
  function hydrateSingletons(content) {
    document.querySelectorAll("[data-cms]").forEach((el) => {
      const key = el.getAttribute("data-cms");
      // "hero.title" → singletons (PLOCHÝ klíč s tečkou — tvar content.json/DB!),
      // "settings.web.name" / "settings.contact.phone" → plná (vnořená) cesta
      let raw = (content.singletons || {})[key];
      if (raw == null) raw = path(content.singletons || {}, key);
      if (raw == null) raw = path(content, key);
      if (raw == null) return;
      const v = val(raw);
      // prázdná hodnota = "nevyplněno": volitelně schovej element, nikdy nenuluj atribut
      if (el.hasAttribute("data-cms-hide-empty")) el.toggleAttribute("hidden", v === "");
      if (el.hasAttribute("data-cms-image")) {
        if (el.tagName === "IMG") el.src = v;
        else el.style.backgroundImage = `url("${v}")`;
      } else if (el.hasAttribute("data-cms-attr")) {
        if (v !== "") el.setAttribute(el.getAttribute("data-cms-attr"), v);
      } else if (el.hasAttribute("data-cms-html")) {
        el.innerHTML = v;
      } else {
        el.textContent = v;
      }
    });
  }

  /* ── 4) KOLEKCE — [data-cms-collection="key"] + <template data-cms-item> ── */
  function renderCollections(content) {
    document.querySelectorAll("[data-cms-collection]").forEach((host) => {
      const key = host.getAttribute("data-cms-collection");
      const tpl = host.querySelector("template[data-cms-item]");
      if (!tpl) return;
      // volitelný filtr kategorie/í (comma-separated, case-insensitive) — 1 kolekce, víc stránek
      const catAttr = host.getAttribute("data-cms-category");
      const cats = catAttr ? catAttr.toLowerCase().split(",").map((s) => s.trim()) : null;
      let items = (content.collections && content.collections[key]) || [];
      items = items
        .filter((it) => it.published !== false)
        .filter((it) => !cats || cats.includes(String(val(it.cat) || it.cat || "").toLowerCase()))
        .sort((a, b) => (a.position || 0) - (b.position || 0));

      // Index dříve vyrenderovaných položek podle data-id. Statické "seed" dlaždice
      // psané v šabloně i klony z minulého renderu sem patří — chceme je HYDRATOVAT
      // NA MÍSTĚ, ne smazat a naklonovat holý <template>. Tím přežijí per-pozici třídy
      // (např. bento galerie g-1..g-5, .reveal) i atributy, které <template data-cms-item>
      // nenese. Bez tohohle galerie po renderu zkolabovala a nahraná fotka se neukázala.
      const existing = new Map();
      host.querySelectorAll("[data-cms-rendered]").forEach((n) => {
        const id = n.getAttribute("data-id");
        if (id && !existing.has(id)) existing.set(id, n);
        else n.remove(); // bez id nebo duplicitní = stale klon → pryč
      });

      items.forEach((item) => {
        const id = item.id != null ? String(item.id) : null;
        let node = id != null ? existing.get(id) : null;
        if (node) {
          existing.delete(id); // hydratace na místě → zachová třídy/atributy seed dlaždice
        } else {
          node = tpl.content.firstElementChild.cloneNode(true);
          node.setAttribute("data-cms-rendered", "");
          if (id != null) node.setAttribute("data-id", id);
        }
        if (item.cat != null) node.setAttribute("data-tags", String(val(item.cat) || item.cat).toLowerCase());
        node.querySelectorAll("[data-cms-field]").forEach((fEl) => {
          const f = fEl.getAttribute("data-cms-field");
          if (!(f in item)) return;
          const v = val(item[f]);
          if (fEl.hasAttribute("data-cms-image")) {
            if (!v) return; // bez obrázku nech placeholder (deko v template)
            if (fEl.tagName === "IMG") fEl.src = v; else fEl.style.backgroundImage = `url("${v}")`;
          } else fEl.textContent = v;
        });
        host.appendChild(node); // seřadí dle position; <template> zůstává na svém místě
      });

      // statické položky neodpovídající žádné publikované položce (skryté/smazané) → pryč
      existing.forEach((n) => n.remove());
    });
  }

  /* ── 5a) REZERVAČNÍ KALENDÁŘ (ADR-0037 F4) — volitelný enhancer rezervačního
     formuláře. Když form obsahuje [data-reserve-calendar], nahradí volné pole „termín"
     kalendářem: vyber den → GET __slots?date= (worker generuje volné sloty z dostupnosti
     klienta) → vyber čas → skrytá pole date+time → POST __reserve (auto-confirm). Bez
     [data-reserve-calendar] zůstává legacy chování (volné date pole → rezervace bez času). ── */
  const CS_MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
  const CS_DOW = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

  function ymd(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  // Buňky měsíce, pondělím počínaje (null = výplň před 1. dnem / po posledním).
  function monthCells(year, month) {
    const offset = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  function wireReservationCalendar(form) {
    const mount = form.querySelector("[data-reserve-calendar]");
    if (!mount) return false;
    const dateInput = form.querySelector('input[name="date"]');
    const timeInput = form.querySelector('input[name="time"]');
    if (!dateInput || !timeInput) return false;

    const today = startOfDay(new Date());
    const maxDay = new Date(today); maxDay.setDate(maxDay.getDate() + 92); // ~3 měsíce dopředu
    let view = new Date(today.getFullYear(), today.getMonth(), 1);

    mount.classList.add("rc");
    mount.innerHTML =
      '<div class="rc-head">' +
        '<button type="button" class="rc-nav" data-rc-prev aria-label="Předchozí měsíc">‹</button>' +
        '<span class="rc-title" aria-live="polite"></span>' +
        '<button type="button" class="rc-nav" data-rc-next aria-label="Další měsíc">›</button>' +
      "</div>" +
      '<div class="rc-dow" aria-hidden="true">' + CS_DOW.map((d) => "<span>" + d + "</span>").join("") + "</div>" +
      '<div class="rc-days" role="group" aria-label="Vyberte den"></div>' +
      '<div class="rc-slots" data-rc-slots aria-live="polite"></div>';

    const titleEl = mount.querySelector(".rc-title");
    const daysEl = mount.querySelector(".rc-days");
    const slotsEl = mount.querySelector(".rc-slots");
    const prevBtn = mount.querySelector("[data-rc-prev]");
    const nextBtn = mount.querySelector("[data-rc-next]");

    function msg(text) { slotsEl.innerHTML = '<p class="rc-msg">' + text + "</p>"; }
    function clearPressed(scope) { scope.querySelectorAll('[aria-pressed="true"]').forEach((b) => b.setAttribute("aria-pressed", "false")); }

    async function loadSlots(dateStr, dayBtn) {
      clearPressed(daysEl);
      dayBtn.setAttribute("aria-pressed", "true");
      dateInput.value = dateStr;
      timeInput.value = "";
      msg("Načítám volné časy…");
      try {
        const res = await fetch("__slots?date=" + dateStr);
        const data = await res.json();
        const slots = (data && data.slots) || [];
        if (!slots.length) { msg("Na tento den nejsou volné termíny — zkuste jiný den."); return; }
        slotsEl.innerHTML = "";
        slots.forEach((t) => {
          const b = document.createElement("button");
          b.type = "button"; b.className = "rc-slot"; b.textContent = t;
          b.setAttribute("aria-pressed", "false");
          b.addEventListener("click", () => { clearPressed(slotsEl); b.setAttribute("aria-pressed", "true"); timeInput.value = t; });
          slotsEl.appendChild(b);
        });
      } catch (e) {
        msg("Termíny se teď nepodařilo načíst. Zkuste to prosím za chvíli.");
      }
    }

    function render() {
      const y = view.getFullYear(), m = view.getMonth();
      titleEl.textContent = CS_MONTHS[m] + " " + y;
      prevBtn.disabled = y === today.getFullYear() && m === today.getMonth();
      nextBtn.disabled = new Date(y, m, 1) >= new Date(maxDay.getFullYear(), maxDay.getMonth(), 1);
      daysEl.innerHTML = "";
      monthCells(y, m).forEach((d) => {
        if (!d) { const sp = document.createElement("span"); sp.className = "rc-empty"; sp.setAttribute("aria-hidden", "true"); daysEl.appendChild(sp); return; }
        const b = document.createElement("button");
        b.type = "button"; b.className = "rc-day"; b.textContent = String(d.getDate());
        if (d < today || d > maxDay) { b.disabled = true; }
        else {
          const ds = ymd(d);
          b.setAttribute("data-date", ds);
          b.setAttribute("aria-pressed", "false");
          b.setAttribute("aria-label", d.getDate() + ". " + CS_MONTHS[m]);
          b.addEventListener("click", () => loadSlots(ds, b));
        }
        daysEl.appendChild(b);
      });
    }

    prevBtn.addEventListener("click", () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); render(); });
    nextBtn.addEventListener("click", () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); render(); });
    render();
    msg("Vyberte den v kalendáři.");

    form.__resetCal = function () {
      clearPressed(daysEl);
      dateInput.value = ""; timeInput.value = "";
      msg("Vyberte den v kalendáři.");
    };
    return true; // má kalendář → vyžaduje vybraný slot
  }

  /* ── 5b) FORMULÁŘE — [data-cms-form="key"] → __submit (rezervace → __reserve) ── */
  function wireForms(content) {
    const recipient = path(content, "settings.forms.recipient") || "";
    document.querySelectorAll("[data-cms-form]").forEach((form) => {
      if (form.dataset.cmsWired) return; // idempotence (boot může běžet víckrát)
      form.dataset.cmsWired = "1";
      const key = form.getAttribute("data-cms-form");
      const isReservation = key === "reservation" || key === "rezervace";
      // RELATIVNÍ cesta (žádné úvodní /): pod proxy náhledem se resolvne na
      // /prototype/<slug>/__submit, na vlastní doméně na /__submit.
      const endpoint = isReservation ? "__reserve" : "__submit";
      const needsSlot = isReservation && wireReservationCalendar(form);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        // Kalendář vyžaduje vybraný termín (skrytá pole date+time) — bez něj neodesílat.
        if (needsSlot && (!data.date || !data.time)) {
          const slots = form.querySelector("[data-rc-slots]");
          if (slots) slots.innerHTML = '<p class="rc-msg rc-msg--warn">Vyberte prosím termín (den a čas).</p>';
          return;
        }
        const payload = { form: key, recipient, fields: data, ts: Date.now() };
        try {
          const res = await fetch(endpoint, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error(res.status);
          form.dispatchEvent(new CustomEvent("cms:form-ok", { bubbles: true, detail: payload }));
          form.reset();
          if (typeof form.__resetCal === "function") form.__resetCal();
        } catch (err) {
          // DEMO fallback: žádný Worker (statický náhled) → jen oznámit, neztratit UX
          form.dispatchEvent(new CustomEvent("cms:form-demo", { bubbles: true, detail: payload }));
          console.info("[cms-reader] form (demo, no backend):", payload);
        }
      });
    });
  }

  /* ── init ── */
  async function boot() {
    let content = window.__CMS_CONTENT__;
    if (!content) {
      try { content = await (await fetch("./content.json", { cache: "no-store" })).json(); }
      catch (e) { console.warn("[cms-reader] content.json nenačten — šablona běží s výchozím HTML."); return; }
    }
    window.__CMS_CONTENT__ = content;
    if (content.settings && content.settings.web && content.settings.web.lang) {
      document.documentElement.setAttribute("data-lang", content.settings.web.lang);
    }
    applyTheme(content.theme);
    hydrateSingletons(content);
    renderCollections(content);
    wireForms(content);
    document.dispatchEvent(new CustomEvent("cms:ready", { detail: content }));
  }

  // vystavit pro overlay/CMS (re-render po editaci, přepnutí jazyka)
  window.CMSReader = {
    boot,
    render() { const c = window.__CMS_CONTENT__; if (c) { applyTheme(c.theme); hydrateSingletons(c); renderCollections(c); } },
    setLang(l) { document.documentElement.setAttribute("data-lang", l); this.render(); },
    get content() { return window.__CMS_CONTENT__; },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
