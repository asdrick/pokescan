const sampleCards = [
  { name: "Dracaufeu", set: "Évolutions Prismatiques", number: "034/165", rarity: "Holo Rare", condition: "Near Mint", quantity: 1, price: 42, location: "Classeur principal · page 1", rating: 9 },
  { name: "Pikachu", set: "151", number: "025/165", rarity: "Common", condition: "Mint", quantity: 3, price: 6, location: "Classeur principal · page 2", rating: 8 },
  { name: "Mew ex", set: "Destinées de Paldea", number: "216/091", rarity: "Secret Rare", condition: "Gem Mint", quantity: 1, price: 88, location: "Investissement", rating: 10 },
  { name: "Évoli", set: "Évolutions Prismatiques", number: "133/165", rarity: "Uncommon", condition: "Excellent", quantity: 2, price: 5, location: "Échanges", rating: 7 }
];

const setTargets = {
  "Évolutions Prismatiques": 165,
  "151": 165,
  "Destinées de Paldea": 91,
  "Fable Nébuleuse": 99
};

const state = loadState();

const viewTitles = {
  dashboard: "Tableau de bord",
  scanner: "Scanner intelligent",
  collection: "Collection",
  sets: "Séries",
  wishlist: "Wishlist",
  graded: "Cartes gradées"
};

function loadState() {
  const saved = localStorage.getItem("pokecollection-free");
  if (saved) return JSON.parse(saved);

  return {
    cards: sampleCards.map((card, index) => ({ ...card, id: createId(), addedAt: Date.now() - index * 86400000 })),
    wishlist: [
      { id: createId(), name: "Lugia V Alternate Art", budget: 140, priority: "Haute" },
      { id: createId(), name: "Noctali VMAX", budget: 220, priority: "Moyenne" }
    ],
    graded: [
      { id: createId(), name: "Mew ex", company: "PSA", grade: 10, cert: "PSA-000124", value: 210 }
    ],
    dark: false
  };
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function saveState() {
  localStorage.setItem("pokecollection-free", JSON.stringify(state));
}

function money(value) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value || 0);
}

function plural(count, singular, pluralWord) {
  return `${count} ${count > 1 ? pluralWord : singular}`;
}

function currentFilter() {
  return document.querySelector("#globalSearch").value.trim().toLowerCase();
}

function filteredCards() {
  const filter = currentFilter();
  if (!filter) return state.cards;
  return state.cards.filter(card => `${card.name} ${card.set} ${card.number} ${card.rarity}`.toLowerCase().includes(filter));
}

function switchView(view) {
  document.querySelectorAll(".view").forEach(section => section.classList.toggle("active-view", section.id === view));
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  document.querySelector("#viewTitle").textContent = viewTitles[view];
}

function renderDashboard() {
  const total = state.cards.reduce((sum, card) => sum + Number(card.quantity), 0);
  const value = state.cards.reduce((sum, card) => sum + Number(card.price) * Number(card.quantity), 0);
  const duplicates = state.cards.reduce((sum, card) => sum + Math.max(0, Number(card.quantity) - 1), 0);
  const setNames = Object.keys(setTargets);
  const averageProgress = setNames.reduce((sum, setName) => sum + setCompletion(setName), 0) / setNames.length;

  document.querySelector("#metricTotal").textContent = total;
  document.querySelector("#metricValue").textContent = money(value);
  document.querySelector("#metricDuplicates").textContent = duplicates;
  document.querySelector("#metricProgress").textContent = `${Math.round(averageProgress)}%`;

  const recent = [...state.cards].sort((a, b) => b.addedAt - a.addedAt).slice(0, 4);
  document.querySelector("#recentCount").textContent = plural(recent.length, "entrée", "entrées");
  document.querySelector("#recentCards").innerHTML = recent.length ? recent.map(compactCardRow).join("") : empty("Aucune carte ajoutée.");

  const chart = document.querySelector("#valueChart");
  const points = [42, 55, 60, 58, 76, 82, 88, 92, 106, 118, 125, Math.max(130, value)];
  const max = Math.max(...points);
  chart.innerHTML = points.map(point => `<span class="bar" style="height:${Math.max(12, point / max * 100)}%"></span>`).join("");
}

function setCompletion(setName) {
  const owned = new Set(state.cards.filter(card => card.set === setName).map(card => card.number)).size;
  return Math.min(100, owned / setTargets[setName] * 100);
}

function compactCardRow(card) {
  return `
    <div class="compact-row">
      <div class="thumb"></div>
      <div>
        <strong>${escapeHtml(card.name)}</strong>
        <div class="compact-meta">${escapeHtml(card.set)} · ${escapeHtml(card.number)}</div>
      </div>
      <strong>${money(Number(card.price) * Number(card.quantity))}</strong>
    </div>
  `;
}

function renderCollection() {
  const cards = filteredCards();
  document.querySelector("#collectionCount").textContent = plural(cards.length, "carte", "cartes");
  document.querySelector("#collectionGrid").innerHTML = cards.length ? cards.map(card => `
    <article class="collection-card">
      <div class="collection-art"></div>
      <div class="card-title">
        <div>
          <strong>${escapeHtml(card.name)}</strong>
          <div class="card-meta">${escapeHtml(card.set)} · ${escapeHtml(card.number)}</div>
        </div>
        <strong>${money(card.price)}</strong>
      </div>
      <p class="card-meta">${escapeHtml(card.rarity)} · ${escapeHtml(card.condition)} · x${card.quantity}</p>
      <p>${escapeHtml(card.location || "Localisation non renseignée")}</p>
      <div class="card-meta">Note personnelle : ${card.rating}/10</div>
      <div class="card-actions">
        <button class="mini-button" data-plus="${card.id}" type="button">+1</button>
        <button class="mini-button" data-minus="${card.id}" type="button">-1</button>
        <button class="mini-button" data-delete="${card.id}" type="button">Supprimer</button>
      </div>
    </article>
  `).join("") : empty("Aucune carte ne correspond à la recherche.");
}

function renderSets() {
  document.querySelector("#setProgress").innerHTML = Object.entries(setTargets).map(([setName, target]) => {
    const owned = new Set(state.cards.filter(card => card.set === setName).map(card => card.number)).size;
    const percent = Math.round(setCompletion(setName));
    return `
      <article class="set-card">
        <div class="panel-heading">
          <h3>${escapeHtml(setName)}</h3>
          <span>${owned}/${target}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        <p class="card-meta">${percent}% terminé · reverse/holo à compléter</p>
      </article>
    `;
  }).join("");
}

function renderWishlist() {
  document.querySelector("#wishlistList").innerHTML = state.wishlist.length ? state.wishlist.map(item => `
    <div class="compact-row">
      <div class="thumb"></div>
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <div class="compact-meta">Priorité ${escapeHtml(item.priority)} · budget ${money(item.budget)}</div>
      </div>
      <button class="mini-button" data-wish-delete="${item.id}" type="button">Retirer</button>
    </div>
  `).join("") : empty("Wishlist vide.");
}

function renderGraded() {
  document.querySelector("#gradedList").innerHTML = state.graded.length ? state.graded.map(item => `
    <div class="compact-row">
      <div class="thumb"></div>
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <div class="compact-meta">${escapeHtml(item.company)} ${item.grade} · cert. ${escapeHtml(item.cert || "non renseignée")}</div>
      </div>
      <strong>${money(item.value)}</strong>
    </div>
  `).join("") : empty("Aucune carte gradée.");
}

function renderAll() {
  document.body.classList.toggle("dark", state.dark);
  document.querySelector("#themeToggle").textContent = state.dark ? "Mode clair" : "Mode sombre";
  renderDashboard();
  renderCollection();
  renderSets();
  renderWishlist();
  renderGraded();
}

function empty(text) {
  return `<div class="empty-state">${text}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll("[data-view-jump]").forEach(button => {
  button.addEventListener("click", () => switchView(button.dataset.viewJump));
});

document.querySelector("#themeToggle").addEventListener("click", () => {
  state.dark = !state.dark;
  saveState();
  renderAll();
});

document.querySelector("#printExport").addEventListener("click", () => window.print());
document.querySelector("#globalSearch").addEventListener("input", renderAll);

document.querySelector("#cardForm").addEventListener("submit", event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.cards.unshift({
    id: createId(),
    name: form.get("name"),
    set: form.get("set"),
    number: form.get("number"),
    rarity: form.get("rarity"),
    condition: form.get("condition"),
    quantity: Number(form.get("quantity")),
    price: Number(form.get("price")),
    location: form.get("location"),
    rating: Number(form.get("rating")),
    addedAt: Date.now()
  });
  event.currentTarget.reset();
  saveState();
  renderAll();
});

document.querySelector("#collectionGrid").addEventListener("click", event => {
  const plus = event.target.closest("[data-plus]");
  const minus = event.target.closest("[data-minus]");
  const del = event.target.closest("[data-delete]");
  if (!plus && !minus && !del) return;

  const id = plus?.dataset.plus || minus?.dataset.minus || del?.dataset.delete;
  const card = state.cards.find(item => item.id === id);
  if (plus && card) card.quantity += 1;
  if (minus && card) card.quantity = Math.max(1, card.quantity - 1);
  if (del) state.cards = state.cards.filter(item => item.id !== id);
  saveState();
  renderAll();
});

document.querySelector("#wishlistForm").addEventListener("submit", event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.wishlist.unshift({
    id: createId(),
    name: form.get("name"),
    budget: Number(form.get("budget")),
    priority: form.get("priority")
  });
  event.currentTarget.reset();
  saveState();
  renderAll();
});

document.querySelector("#wishlistList").addEventListener("click", event => {
  const button = event.target.closest("[data-wish-delete]");
  if (!button) return;
  state.wishlist = state.wishlist.filter(item => item.id !== button.dataset.wishDelete);
  saveState();
  renderAll();
});

document.querySelector("#gradedForm").addEventListener("submit", event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.graded.unshift({
    id: createId(),
    name: form.get("name"),
    company: form.get("company"),
    grade: Number(form.get("grade")),
    cert: form.get("cert"),
    value: Number(form.get("value"))
  });
  event.currentTarget.reset();
  saveState();
  renderAll();
});

document.querySelector("#cardImage").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;
  const preview = document.querySelector("#scanPreview");
  preview.style.backgroundImage = `url(${URL.createObjectURL(file)})`;
  preview.classList.remove("hidden");
});

document.querySelector("#analyzeScan").addEventListener("click", () => {
  const detected = sampleCards[Math.floor(Math.random() * sampleCards.length)];
  document.querySelector("#scanConfidence").textContent = "Confiance 92%";
  document.querySelector("#scanResult").className = "scan-result scan-card";
  document.querySelector("#scanResult").innerHTML = `
    <div class="collection-art"></div>
    <div>
      <strong>${escapeHtml(detected.name)}</strong>
      <div class="card-meta">${escapeHtml(detected.set)} · ${escapeHtml(detected.number)} · ${escapeHtml(detected.rarity)}</div>
    </div>
    <p>Prix estimé : <strong>${money(detected.price)}</strong></p>
    <button id="addDetected" class="primary-button" type="button">Ajouter à la collection</button>
  `;
  document.querySelector("#addDetected").addEventListener("click", () => {
    state.cards.unshift({ ...detected, id: createId(), addedAt: Date.now() });
    saveState();
    renderAll();
    switchView("collection");
  });
});

renderAll();
