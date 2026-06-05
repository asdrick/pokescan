const API_BASE = "https://api.pokemontcg.io/v2";
const PAGE_SIZE = 24;

const fallbackCards = [
  { name: "Charizard ex", set: "Obsidian Flames", number: "125/197", rarity: "Double Rare", condition: "Near Mint", quantity: 1, price: 12, currency: "EUR", image: "", location: "Classeur principal", rating: 9 },
  { name: "Pikachu", set: "Scarlet & Violet 151", number: "025/165", rarity: "Common", condition: "Mint", quantity: 3, price: 3, currency: "EUR", image: "", location: "Page 2", rating: 8 },
  { name: "Mew ex", set: "Paldean Fates", number: "216/091", rarity: "Special Illustration Rare", condition: "Gem Mint", quantity: 1, price: 88, currency: "EUR", image: "", location: "Investissement", rating: 10 }
];

const state = loadState();
let apiSets = [];
let apiCards = [];
let apiPage = 1;
let lastApiQuery = "";
let cameraStream = null;
let lastCapturedImage = "";

const viewTitles = {
  dashboard: "Tableau de bord",
  scanner: "Scanner intelligent",
  database: "Base cartes",
  collection: "Collection",
  sets: "Séries",
  wishlist: "Wishlist",
  graded: "Cartes gradées"
};

function loadState() {
  const saved = localStorage.getItem("pokescan-collection-v2");
  if (saved) return JSON.parse(saved);
  return {
    cards: fallbackCards.map((card, index) => ({ ...card, id: createId(), addedAt: Date.now() - index * 86400000 })),
    wishlist: [
      { id: createId(), name: "Umbreon VMAX", budget: 220, priority: "Haute" },
      { id: createId(), name: "Lugia V Alternate Art", budget: 140, priority: "Moyenne" }
    ],
    graded: [
      { id: createId(), name: "Mew ex", company: "PSA", grade: 10, cert: "PSA-000124", value: 210 }
    ],
    light: false
  };
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function saveState() {
  localStorage.setItem("pokescan-collection-v2", JSON.stringify(state));
}

function money(value, currency = "EUR") {
  const safeCurrency = currency === "USD" ? "USD" : "EUR";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: safeCurrency, maximumFractionDigits: 2 }).format(Number(value || 0));
}

function plural(count, singular, pluralWord) {
  return `${count} ${count > 1 ? pluralWord : singular}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function setApiStatus(mode, text) {
  const status = document.querySelector("#apiStatus");
  status.className = `api-status ${mode}`;
  status.innerHTML = `<span class="pulse"></span>${escapeHtml(text)}`;
}

async function apiGet(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json();
}

function extractPrice(card) {
  const cm = card.cardmarket?.prices;
  if (cm) {
    const eur = cm.trendPrice || cm.averageSellPrice || cm.lowPrice || cm.avg1 || cm.avg7 || cm.avg30;
    if (eur) return { value: Number(eur), currency: "EUR", source: "Cardmarket" };
  }

  const variants = Object.values(card.tcgplayer?.prices || {});
  for (const variant of variants) {
    const usd = variant.market || variant.mid || variant.low;
    if (usd) return { value: Number(usd), currency: "USD", source: "TCGPlayer" };
  }

  return { value: 0, currency: "EUR", source: "Non disponible" };
}

function apiCardToCollection(card) {
  const price = extractPrice(card);
  return {
    id: createId(),
    apiId: card.id,
    name: card.name,
    set: card.set?.name || "Série inconnue",
    setId: card.set?.id || "",
    number: card.number || "",
    rarity: card.rarity || "Non renseignée",
    condition: "Near Mint",
    quantity: 1,
    price: price.value,
    currency: price.currency,
    priceSource: price.source,
    image: card.images?.large || card.images?.small || "",
    location: "À classer",
    rating: 8,
    addedAt: Date.now(),
    hp: card.hp || "",
    types: card.types || [],
    artist: card.artist || "",
    releaseDate: card.set?.releaseDate || ""
  };
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
  if (view === "database" && apiCards.length === 0) searchApiCards(true);
}

function renderDashboard() {
  const total = state.cards.reduce((sum, card) => sum + Number(card.quantity || 0), 0);
  const value = state.cards.reduce((sum, card) => sum + Number(card.price || 0) * Number(card.quantity || 0), 0);
  const duplicates = state.cards.reduce((sum, card) => sum + Math.max(0, Number(card.quantity || 0) - 1), 0);

  document.querySelector("#metricTotal").textContent = total;
  document.querySelector("#metricValue").textContent = money(value);
  document.querySelector("#metricDuplicates").textContent = duplicates;
  document.querySelector("#metricSets").textContent = apiSets.length || "…";

  const recent = [...state.cards].sort((a, b) => b.addedAt - a.addedAt).slice(0, 4);
  document.querySelector("#recentCount").textContent = plural(recent.length, "entrée", "entrées");
  document.querySelector("#recentCards").innerHTML = recent.length ? recent.map(compactCardRow).join("") : empty("Aucune carte ajoutée.");

  const points = state.cards.slice(0, 12).map(card => Math.max(2, Number(card.price || 0) * Number(card.quantity || 1)));
  while (points.length < 12) points.unshift(Math.max(4, points.length * 7));
  const max = Math.max(...points, 1);
  document.querySelector("#valueChart").innerHTML = points.map(point => `<span class="bar" style="height:${Math.max(12, point / max * 100)}%"></span>`).join("");
}

function compactCardRow(card) {
  const img = card.image ? `<img class="thumb" src="${escapeHtml(card.image)}" alt="">` : `<div class="thumb"></div>`;
  return `
    <div class="compact-row">
      ${img}
      <div>
        <strong>${escapeHtml(card.name)}</strong>
        <div class="compact-meta">${escapeHtml(card.set)} · ${escapeHtml(card.number)}</div>
      </div>
      <strong>${money(Number(card.price) * Number(card.quantity), card.currency)}</strong>
    </div>
  `;
}

function renderCollection() {
  const cards = filteredCards();
  document.querySelector("#collectionCount").textContent = plural(cards.length, "carte", "cartes");
  document.querySelector("#collectionGrid").innerHTML = cards.length ? cards.map(card => collectionCard(card)).join("") : empty("Aucune carte ne correspond à la recherche.");
}

function collectionCard(card) {
  const art = card.image ? `<img class="card-img" src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}">` : `<div class="collection-art"></div>`;
  return `
    <article class="collection-card">
      ${art}
      <div class="card-title">
        <div>
          <strong>${escapeHtml(card.name)}</strong>
          <div class="card-meta">${escapeHtml(card.set)} · ${escapeHtml(card.number)}</div>
        </div>
        <strong>${money(card.price, card.currency)}</strong>
      </div>
      <p class="card-meta">${escapeHtml(card.rarity)} · ${escapeHtml(card.condition)} · x${card.quantity}</p>
      <div class="price-stack">
        <div class="price-pill"><span>Source</span><strong>${escapeHtml(card.priceSource || "Manuel")}</strong></div>
        <div class="price-pill"><span>Note perso</span><strong>${card.rating}/10</strong></div>
      </div>
      <p>${escapeHtml(card.location || "Localisation non renseignée")}</p>
      <div class="card-actions">
        <button class="mini-button" data-plus="${card.id}" type="button">+1</button>
        <button class="mini-button" data-minus="${card.id}" type="button">-1</button>
        <button class="mini-button" data-open-local="${card.id}" type="button">Détails</button>
        <button class="mini-button" data-delete="${card.id}" type="button">Supprimer</button>
      </div>
    </article>
  `;
}

function renderSets() {
  const sets = apiSets.length ? apiSets : [];
  document.querySelector("#setsCount").textContent = sets.length ? plural(sets.length, "série", "séries") : "API en cours";
  document.querySelector("#setProgress").innerHTML = sets.length ? sets.map(set => {
    const owned = new Set(state.cards.filter(card => card.setId === set.id || card.set === set.name).map(card => card.number)).size;
    const total = set.total || set.printedTotal || 1;
    const percent = Math.min(100, Math.round(owned / total * 100));
    return `
      <article class="set-card">
        <div class="panel-heading">
          <h3>${escapeHtml(set.name)}</h3>
          <span>${owned}/${total}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        <p class="card-meta">${percent}% terminé · sortie ${escapeHtml(set.releaseDate || "inconnue")}</p>
        <button class="mini-button" data-set-search="${escapeHtml(set.id)}" type="button">Voir les cartes</button>
      </article>
    `;
  }).join("") : empty("Les séries seront affichées dès que l’API répond.");
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

function renderApiCards() {
  document.querySelector("#dbCount").textContent = apiCards.length ? plural(apiCards.length, "résultat", "résultats") : "Aucun résultat";
  document.querySelector("#apiCardsGrid").innerHTML = apiCards.length ? apiCards.map(apiCardTile).join("") : empty("Cherche une carte ou une série.");
}

function apiCardTile(card) {
  const price = extractPrice(card);
  return `
    <article class="collection-card">
      <img class="card-img" src="${escapeHtml(card.images?.small || card.images?.large || "")}" alt="${escapeHtml(card.name)}">
      <div class="card-title">
        <div>
          <strong>${escapeHtml(card.name)}</strong>
          <div class="card-meta">${escapeHtml(card.set?.name || "")} · ${escapeHtml(card.number || "")}</div>
        </div>
        <strong>${price.value ? money(price.value, price.currency) : "N/A"}</strong>
      </div>
      <div class="price-stack">
        <div class="price-pill"><span>Prix</span><strong>${escapeHtml(price.source)}</strong></div>
        <div class="price-pill"><span>Rareté</span><strong>${escapeHtml(card.rarity || "N/A")}</strong></div>
      </div>
      <div class="card-actions">
        <button class="mini-button" data-api-open="${escapeHtml(card.id)}" type="button">Détails</button>
        <button class="mini-button" data-api-add="${escapeHtml(card.id)}" type="button">Ajouter</button>
      </div>
    </article>
  `;
}

function renderAll() {
  document.body.classList.toggle("light", state.light);
  document.querySelector("#themeToggle").textContent = state.light ? "Mode sombre" : "Mode clair";
  renderDashboard();
  renderCollection();
  renderSets();
  renderWishlist();
  renderGraded();
  renderApiCards();
}

function empty(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

async function loadSets() {
  try {
    setApiStatus("", "Connexion API");
    const data = await apiGet("/sets", { orderBy: "-releaseDate" });
    apiSets = data.data || [];
    const select = document.querySelector("#apiSetFilter");
    select.innerHTML = `<option value="">Toutes les séries</option>` + apiSets.map(set => `<option value="${escapeHtml(set.id)}">${escapeHtml(set.name)}</option>`).join("");
    setApiStatus("online", "API connectée");
  } catch (error) {
    setApiStatus("offline", "API indisponible");
  }
  renderAll();
}

function buildCardQuery(search, setId) {
  const parts = [];
  const clean = search.trim().replace(/"/g, "");
  if (clean) {
    if (/^\d+\/?\d*$/.test(clean)) parts.push(`number:${clean.split("/")[0]}`);
    else if (clean.includes(" ")) parts.push(`name:"${clean}"`);
    else parts.push(`name:${clean}*`);
  }
  if (setId) parts.push(`set.id:${setId}`);
  return parts.join(" ");
}

async function searchApiCards(reset = true) {
  const search = document.querySelector("#apiSearch").value;
  const setId = document.querySelector("#apiSetFilter").value;
  const q = buildCardQuery(search, setId);
  if (reset || q !== lastApiQuery) {
    apiPage = 1;
    apiCards = [];
  }
  lastApiQuery = q;
  try {
    setApiStatus("", "Recherche API");
    const data = await apiGet("/cards", {
      page: apiPage,
      pageSize: PAGE_SIZE,
      q,
      orderBy: "-set.releaseDate"
    });
    apiCards = [...apiCards, ...(data.data || [])];
    apiPage += 1;
    setApiStatus("online", "API connectée");
  } catch (error) {
    setApiStatus("offline", "Erreur API");
    document.querySelector("#apiCardsGrid").innerHTML = empty("Impossible de charger l’API pour le moment.");
  }
  renderAll();
}

async function identifyScan() {
  const query = document.querySelector("#scanQuery").value.trim() || "Pikachu";
  document.querySelector("#scanConfidence").textContent = "Recherche...";
  document.querySelector("#scanResult").innerHTML = empty("Recherche de correspondances...");
  try {
    const data = await apiGet("/cards", {
      page: 1,
      pageSize: 6,
      q: buildCardQuery(query, ""),
      orderBy: "-set.releaseDate"
    });
    const cards = data.data || [];
    const knownIds = new Set(apiCards.map(card => card.id));
    apiCards = [...cards.filter(card => !knownIds.has(card.id)), ...apiCards];
    document.querySelector("#scanConfidence").textContent = cards.length ? "Cartes candidates" : "Aucun résultat";
    document.querySelector("#scanResult").className = "scan-result";
    document.querySelector("#scanResult").innerHTML = cards.length ? cards.map(apiCardTile).join("") : empty("Aucune carte trouvée. Essaie avec le nom anglais, ex: Charizard.");
    if (cards[0]) openCardModal(cards[0], true);
  } catch (error) {
    document.querySelector("#scanConfidence").textContent = "API indisponible";
    document.querySelector("#scanResult").innerHTML = empty("L’identification en ligne n’a pas répondu.");
  }
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera");
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 1920 } },
      audio: false
    });
    const video = document.querySelector("#cameraVideo");
    video.srcObject = cameraStream;
    await video.play();
    document.querySelector("#scanPhoto").classList.add("hidden");
    video.classList.remove("hidden");
    document.querySelector("#scanConfidence").textContent = "Caméra active";
  } catch (error) {
    document.querySelector("#scanConfidence").textContent = "Caméra bloquée";
    document.querySelector("#scanResult").innerHTML = empty("Sur iPhone, ouvre l’app en HTTPS avec Safari et accepte l’accès caméra.");
  }
}

async function captureScan() {
  const video = document.querySelector("#cameraVideo");
  const canvas = document.querySelector("#captureCanvas");
  if (!video.videoWidth) {
    document.querySelector("#scanConfidence").textContent = "Pas d’image caméra";
    return;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  lastCapturedImage = canvas.toDataURL("image/jpeg", .92);
  document.querySelector("#scanPhoto").src = lastCapturedImage;
  document.querySelector("#scanPhoto").classList.remove("hidden");
  video.classList.add("hidden");
  document.querySelector("#scanConfidence").textContent = "Image capturée";
  await tryReadText(canvas);
}

async function tryReadText(canvas) {
  if (!window.TextDetector) {
    document.querySelector("#scanResult").innerHTML = empty("Photo capturée. Si le nom n’apparaît pas automatiquement, écris-le dans le champ puis clique Identifier.");
    return;
  }
  try {
    const detector = new TextDetector();
    const results = await detector.detect(canvas);
    const text = results.map(item => item.rawValue).join(" ").trim();
    if (text) {
      document.querySelector("#scanQuery").value = text.split(/\s+/).slice(0, 4).join(" ");
      document.querySelector("#scanConfidence").textContent = "Texte détecté";
    }
  } catch (error) {
    document.querySelector("#scanResult").innerHTML = empty("OCR non disponible dans ce navigateur. La capture reste utilisable avec recherche manuelle.");
  }
}

function openCardModal(card, fromScan = false) {
  const price = card.apiId ? { value: card.price, currency: card.currency, source: card.priceSource || "Collection" } : extractPrice(card);
  const image = card.image || card.images?.large || card.images?.small || "";
  const name = card.name;
  document.querySelector("#modalTitle").textContent = fromScan ? "Carte scannée" : name;
  document.querySelector("#modalBody").innerHTML = `
    <div class="modal-card">
      ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(name)}">` : `<div class="collection-art"></div>`}
      <div>
        <h2>${escapeHtml(name)}</h2>
        <p class="card-meta">${escapeHtml(card.set?.name || card.set || "")} · ${escapeHtml(card.number || "")} · ${escapeHtml(card.rarity || "")}</p>
        <div class="price-stack">
          <div class="price-pill"><span>Prix estimé</span><strong>${price.value ? money(price.value, price.currency) : "Non disponible"}</strong></div>
          <div class="price-pill"><span>Source prix</span><strong>${escapeHtml(price.source)}</strong></div>
          <div class="price-pill"><span>Type</span><strong>${escapeHtml((card.types || []).join(", ") || "N/A")}</strong></div>
          <div class="price-pill"><span>Artiste</span><strong>${escapeHtml(card.artist || "N/A")}</strong></div>
        </div>
        ${lastCapturedImage && fromScan ? `<p class="card-meta">Image capturée disponible dans le scanner.</p>` : ""}
        <button class="primary-button" data-modal-add="${escapeHtml(card.id || card.apiId || "")}" type="button">Ajouter à la collection</button>
      </div>
    </div>
  `;
  document.querySelector("#cardModal").showModal();
}

function addApiCardById(id) {
  const card = apiCards.find(item => item.id === id);
  if (!card) return;
  state.cards.unshift(apiCardToCollection(card));
  saveState();
  renderAll();
}

document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
document.querySelectorAll("[data-view-jump]").forEach(button => button.addEventListener("click", () => switchView(button.dataset.viewJump)));

document.querySelector("#themeToggle").addEventListener("click", () => {
  state.light = !state.light;
  saveState();
  renderAll();
});

document.querySelector("#printExport").addEventListener("click", () => window.print());
document.querySelector("#globalSearch").addEventListener("input", renderAll);
document.querySelector("#apiSearchButton").addEventListener("click", () => searchApiCards(true));
document.querySelector("#loadMoreCards").addEventListener("click", () => searchApiCards(false));
document.querySelector("#apiSearch").addEventListener("keydown", event => { if (event.key === "Enter") searchApiCards(true); });
document.querySelector("#apiSetFilter").addEventListener("change", () => searchApiCards(true));
document.querySelector("#startCamera").addEventListener("click", startCamera);
document.querySelector("#captureScan").addEventListener("click", captureScan);
document.querySelector("#analyzeScan").addEventListener("click", identifyScan);
document.querySelector("#closeModal").addEventListener("click", () => document.querySelector("#cardModal").close());

document.querySelector("#cardImage").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  lastCapturedImage = URL.createObjectURL(file);
  document.querySelector("#scanPhoto").src = lastCapturedImage;
  document.querySelector("#scanPhoto").classList.remove("hidden");
  document.querySelector("#cameraVideo").classList.add("hidden");
  document.querySelector("#scanConfidence").textContent = "Photo importée";
});

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
    currency: "EUR",
    priceSource: "Manuel",
    location: form.get("location"),
    rating: Number(form.get("rating")),
    image: "",
    addedAt: Date.now()
  });
  event.currentTarget.reset();
  saveState();
  renderAll();
});

document.addEventListener("click", event => {
  const apiAdd = event.target.closest("[data-api-add]");
  const apiOpen = event.target.closest("[data-api-open]");
  const setSearch = event.target.closest("[data-set-search]");
  const modalAdd = event.target.closest("[data-modal-add]");
  const plus = event.target.closest("[data-plus]");
  const minus = event.target.closest("[data-minus]");
  const del = event.target.closest("[data-delete]");
  const openLocal = event.target.closest("[data-open-local]");
  const wishDel = event.target.closest("[data-wish-delete]");

  if (apiAdd) addApiCardById(apiAdd.dataset.apiAdd);
  if (apiOpen) {
    const card = apiCards.find(item => item.id === apiOpen.dataset.apiOpen);
    if (card) openCardModal(card);
  }
  if (setSearch) {
    document.querySelector("#apiSetFilter").value = setSearch.dataset.setSearch;
    document.querySelector("#apiSearch").value = "";
    switchView("database");
    searchApiCards(true);
  }
  if (modalAdd) {
    const card = apiCards.find(item => item.id === modalAdd.dataset.modalAdd);
    if (card) addApiCardById(card.id);
    document.querySelector("#cardModal").close();
  }
  if (plus || minus || del || openLocal) {
    const id = plus?.dataset.plus || minus?.dataset.minus || del?.dataset.delete || openLocal?.dataset.openLocal;
    const card = state.cards.find(item => item.id === id);
    if (plus && card) card.quantity += 1;
    if (minus && card) card.quantity = Math.max(1, card.quantity - 1);
    if (del) state.cards = state.cards.filter(item => item.id !== id);
    if (openLocal && card) openCardModal(card);
    saveState();
    renderAll();
  }
  if (wishDel) {
    state.wishlist = state.wishlist.filter(item => item.id !== wishDel.dataset.wishDelete);
    saveState();
    renderAll();
  }
});

document.querySelector("#wishlistForm").addEventListener("submit", event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.wishlist.unshift({ id: createId(), name: form.get("name"), budget: Number(form.get("budget")), priority: form.get("priority") });
  event.currentTarget.reset();
  saveState();
  renderAll();
});

document.querySelector("#gradedForm").addEventListener("submit", event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.graded.unshift({ id: createId(), name: form.get("name"), company: form.get("company"), grade: Number(form.get("grade")), cert: form.get("cert"), value: Number(form.get("value")) });
  event.currentTarget.reset();
  saveState();
  renderAll();
});

renderAll();
loadSets();
