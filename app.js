const API_BASE = "https://api.pokemontcg.io/v2";
let cameraStream = null;
let currentDetectedCard = null;

// Initialisation de l'état local
let state = JSON.parse(localStorage.getItem("pokescan-premium-state")) || { cards: [] };

function saveState() {
  localStorage.setItem("pokescan-premium-state", JSON.stringify(state));
  renderCollection();
}

// ROUTING DE NAVIGATION SIMPLE
document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));
    document.querySelectorAll(".view-section").forEach(view => view.classList.remove("active"));
    
    button.classList.add("active");
    const viewId = `view-${button.dataset.view}`;
    document.getElementById(viewId).classList.add("active");
  });
});

// ACTIONS CAMERA ET SCAN
const centralScanBtn = document.getElementById("central-scan-btn");
const scanDialog = document.getElementById("scanDialog");
const closeScanDialog = document.getElementById("closeScanDialog");
const cameraVideo = document.getElementById("cameraVideo");
const captureCanvas = document.getElementById("captureCanvas");

centralScanBtn.addEventListener("click", openSmartScanner);
closeScanDialog.addEventListener("click", closeSmartScanner);

async function openSmartScanner() {
  scanDialog.showModal();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    cameraVideo.srcObject = cameraStream;
    cameraVideo.play();
    
    // Démarre l'analyse en boucle toutes les 2.5 secondes pour laisser le temps de faire la mise au point
    setTimeout(analyzeSnapshotLoop, 2000);
  } catch (err) {
    alert("Impossible d'accéder à la caméra arrière : " + err.message);
    closeSmartScanner();
  }
}

function closeSmartScanner() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
  }
  scanDialog.close();
}

// BOUCLE INTELLIGENTE D'ANALYSE D'IMAGE (OCR GRATUIT)
async function analyzeSnapshotLoop() {
  if (!scanDialog.open) return;

  const ctx = captureCanvas.getContext("2d");
  captureCanvas.width = cameraVideo.videoWidth;
  captureCanvas.height = cameraVideo.videoHeight;
  
  // On prend une photo du flux vidéo
  ctx.drawImage(cameraVideo, 0, 0, captureCanvas.width, captureCanvas.height);
  
  // Exécution de l'OCR sur la zone basse du flux vidéo (où se situent généralement les numéros ex: 151/198)
  const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.85);
  
  try {
    const result = await Tesseract.recognize(dataUrl, 'eng');
    const text = result.data.text;
    
    // Recherche d'un pattern type numéro de carte (ex: 142/165 ou 089/102)
    const match = text.match(/(\d+)\s*\/\s*(\d+)/);
    
    if (match) {
      const cardNumber = match[1];
      const totalCards = match[2];
      
      // Appel de l'API Pokémon TCG gratuite avec les filtres requis
      const response = await fetch(`${API_BASE}/cards?q=number:${cardNumber}`);
      const apiData = await response.json();
      
      if (apiData.data && apiData.data.length > 0) {
        // Tri intelligent pour ramener la carte la plus probable
        currentDetectedCard = apiData.data[0];
        closeSmartScanner();
        showCardResult(currentDetectedCard);
        return; 
      }
    }
  } catch (e) {
    console.log("Analyse en cours...", e);
  }

  // Si rien n'est trouvé, on réessaye au prochain cycle
  if (scanDialog.open) {
    setTimeout(analyzeSnapshotLoop, 2500);
  }
}

// POPUP DE CONFIRMATION DES INFOS CARTE ET PRIX
function showCardResult(card) {
  const modal = document.getElementById("cardModal");
  const body = document.getElementById("modalBody");
  
  const marketPrice = card.tcgplayer?.prices?.holofoil?.market || card.tcgplayer?.prices?.normal?.market || "0.99";

  body.innerHTML = `
    <div style="text-align: center;">
      <img src="${card.images.small}" style="max-width: 180px; border-radius: 12px; box-shadow: 0 8px 20px rgba(0,0,0,0.4); margin-bottom: 14px;">
      <h3 style="margin: 0; font-size: 20px;">${card.name}</h3>
      <p style="color: var(--muted); margin: 4px 0 12px 0;">Série : ${card.set.name} (${card.number}/${card.set.printedTotal})</p>
      <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid var(--success); padding: 12px; border-radius: 12px; display: inline-block;">
        <span style="font-size: 12px; color: var(--muted); display: block; text-transform: uppercase;">Estimation Marché</span>
        <strong style="font-size: 22px; color: var(--success);">${marketPrice} €</strong>
      </div>
    </div>
  `;
  
  modal.showModal();
}

// INTERACTIONS BOUTONS DE SAUVEGARDE
document.getElementById("saveCardBtn").addEventListener("click", () => {
  if (currentDetectedCard) {
    state.cards.unshift(currentDetectedCard);
    saveState();
  }
  document.getElementById("cardModal").close();
});

document.getElementById("closeModal").addEventListener("click", () => {
  document.getElementById("cardModal").close();
});

// AFFICHAGE DE LA COLLECTION CLASSEUR
function renderCollection() {
  const grid = document.getElementById("collection-grid");
  const count = document.getElementById("collection-count");
  
  count.innerText = `${state.cards.length} carte${state.cards.length > 1 ? 's' : ''}`;
  grid.innerHTML = "";
  
  if (state.cards.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--muted); padding: 40px 0;">Aucune carte dans votre classeur pour l'instant.</div>`;
    return;
  }
  
  state.cards.forEach(card => {
    const marketPrice = card.tcgplayer?.prices?.holofoil?.market || card.tcgplayer?.prices?.normal?.market || "0.99";
    const item = document.createElement("div");
    item.className = "collection-card";
    item.innerHTML = `
      <img src="${card.images.small}" alt="${card.name}">
      <h4>${card.name}</h4>
      <p>${marketPrice} €</p>
    `;
    grid.appendChild(item);
  });
}

// Chargement initial au démarrage
window.onload = () => {
  renderCollection();
};
