const API_BASE = "https://api.pokemontcg.io/v2";
let cameraStream = null;
let currentDetectedCard = null;
let scanActiveLoop = false;

// Chargement initial sécurisé de l'état local original
let state = JSON.parse(localStorage.getItem("pokescan-collection-v3")) || { cards: [], wishlist: [], graded: [] };

function saveState() {
  localStorage.setItem("pokescan-collection-v3", JSON.stringify(state));
  renderAllData();
}

// ROUTER MULTI-VUES (BUREAU + NAVIGATION MOBILE)
const navButtons = document.querySelectorAll(".nav-item, .bottom-nav-item");
navButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const targetView = btn.dataset.view;
    
    // Mettre à jour l'état visuel de tous les boutons correspondants
    navButtons.forEach(b => b.classList.toggle("active", b.dataset.view === targetView));
    
    // Basculer les sections visibles
    document.querySelectorAll(".view-section").forEach(sec => {
      sec.classList.toggle("active", sec.id === `view-${targetView}`);
    });
  });
});

// ACTIONS CAMERA ET OPTIMISATION MOBILE FLUIDE
const centralScanBtn = document.getElementById("central-scan-btn");
const scanDialog = document.getElementById("scanDialog");
const closeScanDialog = document.getElementById("closeScanDialog");
const cameraVideo = document.getElementById("cameraVideo");
const captureCanvas = document.getElementById("captureCanvas");
const scanOverlayStatus = document.getElementById("scanOverlayStatus");

centralScanBtn.addEventListener("click", openOptimizedScanner);
closeScanDialog.addEventListener("click", closeOptimizedScanner);

async function openOptimizedScanner() {
  scanDialog.showModal();
  scanOverlayStatus.innerText = "Démarrage caméra...";
  
  try {
    // Profils de flux fluides optimisés pour éviter le sur-échantillonnage mobile inutile
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { 
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio: false
    });
    cameraVideo.srcObject = cameraStream;
    cameraVideo.play();
    
    scanActiveLoop = true;
    // Laisse 1,5 seconde au téléphone pour faire la mise au point matérielle
    setTimeout(processFluidOCRFrame, 1500);
  } catch (err) {
    alert("Accès caméra refusé ou indisponible : " + err.message);
    closeOptimizedScanner();
  }
}

function closeOptimizedScanner() {
  scanActiveLoop = false;
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
  }
  scanDialog.close();
}

// CROP DE ZONE ULTRA CIBLÉ : Évite de faire ramer le CPU en analysant des gros fichiers
async function processFluidOCRFrame() {
  if (!scanActiveLoop || !scanDialog.open) return;

  const ctx = captureCanvas.getContext("2d");
  
  // Tailles réelles de la vidéo reçue par le capteur
  const vWidth = cameraVideo.videoWidth;
  const vHeight = cameraVideo.videoHeight;

  if (vWidth === 0 || vHeight === 0) {
    if (scanActiveLoop) setTimeout(processFluidOCRFrame, 500);
    return;
  }

  // Définir un micro-canevas pour la zone du numéro de série (bas de la carte)
  // Taille réduite à 320x80 pixels pour un calcul instantané sans lag
  captureCanvas.width = 320;
  captureCanvas.height = 80;

  // Calcul mathématique pour découper uniquement la zone ocr-target-box de l'overlay
  const cropX = Math.floor(vWidth * 0.35);
  const cropY = Math.floor(vHeight * 0.62);
  const cropWidth = Math.floor(vWidth * 0.30);
  const cropHeight = Math.floor(vHeight * 0.12);

  // Dessine uniquement le fragment extrait sur notre canvas miniature
  ctx.drawImage(cameraVideo, cropX, cropY, cropWidth, cropHeight, 0, 0, 320, 80);
  
  // Optionnel : conversion en niveaux de gris basique pour booster l'OCR
  const imgData = ctx.getImageData(0, 0, 320, 80);
  for (let i = 0; i < imgData.data.length; i += 4) {
    let brightness = 0.34 * imgData.data[i] + 0.5 * imgData.data[i + 1] + 0.16 * imgData.data[i + 2];
    imgData.data[i] = brightness;
    imgData.data[i+1] = brightness;
    imgData.data[i+2] = brightness;
  }
  ctx.putImageData(imgData, 0, 0);

  const croppedDataUrl = captureCanvas.toDataURL("image/jpeg", 0.8);

  try {
    scanOverlayStatus.innerText = "Lecture...";
    // Appel OCR rapide léger
    const result = await Tesseract.recognize(croppedDataUrl, 'eng');
    const text = result.data.text || "";
    
    // Regex pour isoler le numéro de série imprimé (Exemple: 145/192 ou 021/078)
    const foundPattern = text.match(/(\d+)\s*[\/\s]\s*(\d+)/);
    
    if (foundPattern) {
      const numberPart = foundPattern[1];
      scanOverlayStatus.innerText = `Trouvé : ${numberPart}! Recherche TCG...`;
      
      // Appel direct de l'API sans aucune interaction textuelle requise
      const apiResponse = await fetch(`${API_BASE}/cards?q=number:${numberPart}`);
      const json = await apiResponse.json();
      
      if (json.data && json.data.length > 0) {
        currentDetectedCard = json.data[0];
        closeOptimizedScanner();
        displayCardResult(currentDetectedCard);
        return; // Cas victorieux, on stoppe la boucle
      }
    }
  } catch (ocrError) {
    console.log("Analyse en arrière-plan...", ocrError);
  }

  // Si rien n'est trouvé, relancer le cycle léger après un court délai fluide (1,8s)
  if (scanActiveLoop) {
    scanOverlayStatus.innerText = "Ajustement...";
    setTimeout(processFluidOCRFrame, 1800);
  }
}

// APPARENCE POPUP DE RÉSULTAT DU MARCHÉ GRATUIT
function displayCardResult(card) {
  const modal = document.getElementById("cardModal");
  const body = document.getElementById("modalBody");
  
  // Extraction intelligente des indicateurs de prix réels
  const price = card.tcgplayer?.prices?.holofoil?.market || card.tcgplayer?.prices?.normal?.market || card.cardmarket?.prices?.trendPrice || "0.50";

  body.innerHTML = `
    <div style="text-align: center;">
      <img src="${card.images.small}" style="max-width: 160px; border-radius: 10px; box-shadow: 0 10px 20px rgba(0,0,0,0.5); margin-bottom: 12px; will-change: transform;">
      <h3 style="margin: 0 0 4px 0; font-size: 18px; color:#fff;">${card.name}</h3>
      <p style="color: var(--muted); font-size:13px; margin: 0 0 16px 0;">${card.set.name} (${card.number}/${card.set.printedTotal})</p>
      
      <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid var(--success); padding: 10px 20px; border-radius: 12px; display: inline-block;">
        <span style="font-size: 11px; color: var(--muted); display: block; text-transform: uppercase;">Prix Moyen Constaté</span>
        <strong style="font-size: 20px; color: var(--success);">${price} €</strong>
      </div>
    </div>
  `;
  
  modal.showModal();
}

// CONSERVATION ET SAUVEGARDE LOCALE DES ENTRÉES SCOUTÉES
document.getElementById("saveCardBtn").addEventListener("click", () => {
  if (currentDetectedCard) {
    // Injection des données au format d'origine pour ne pas briser le reste de votre application
    const transformedCard = {
      id: `id-${Date.now()}`,
      name: currentDetectedCard.name,
      set: currentDetectedCard.set.name,
      number: currentDetectedCard.number,
      rarity: currentDetectedCard.rarity || "Commune",
      condition: "Near Mint",
      quantity: 1,
      price: currentDetectedCard.tcgplayer?.prices?.holofoil?.market || currentDetectedCard.tcgplayer?.prices?.normal?.market || 0.50,
      currency: "EUR",
      image: currentDetectedCard.images.small,
      addedAt: Date.now()
    };
    
    state.cards.unshift(transformedCard);
    saveState();
  }
  document.getElementById("cardModal").close();
});

document.getElementById("closeModal").addEventListener("click", () => {
  document.getElementById("cardModal").close();
});

// METTRE A JOUR TOUTES LES VUES ET COMPTEURS VISUELS DE L'APP
function renderAllData() {
  // 1. Mise à jour des mini-compteurs de l'accueil
  const totalValue = state.cards.reduce((sum, c) => sum + (Number(c.price) * Number(c.quantity)), 0);
  document.getElementById("dash-count").innerText = state.cards.length;
  document.getElementById("dash-value").innerText = `${totalValue.toFixed(2)} €`;
  
  // 2. Remplissage de la grille du classeur (Collection)
  const collectionGrid = document.getElementById("collectionGrid");
  const collectionCount = document.getElementById("collectionCount");
  collectionCount.innerText = `${state.cards.length} carte${state.cards.length > 1 ? 's' : ''}`;
  collectionGrid.innerHTML = "";
  
  if (state.cards.length === 0) {
    collectionGrid.innerHTML = `<div style="grid-column: 1/-1; color: var(--muted); text-align:center; padding: 30px 0;">Votre classeur est vide pour le moment.</div>`;
  } else {
    state.cards.forEach(card => {
      const cardEl = document.createElement("div");
      cardEl.className = "collection-card";
      cardEl.innerHTML = `
        <img src="${card.image}" alt="${card.name}" loading="lazy">
        <h4>${card.name}</h4>
        <p>${Number(card.price).toFixed(2)} €</p>
      `;
      collectionGrid.appendChild(cardEl);
    });
  }

  // 3. Remplissage automatique fictif ou statique des séries de cartes à des fins de complétion
  const setProgress = document.getElementById("setProgress");
  setProgress.innerHTML = `
    <div class="set-row-card">
      <div style="display:flex; justify-content:space-between; font-size:14px;">
        <strong>Écarlate et Violet — 151</strong>
        <span>${state.cards.filter(c => c.set.includes("151")).length} / 165</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${Math.min(100, (state.cards.filter(c => c.set.includes("151")).length / 165) * 100)}%"></div>
      </div>
    </div>
    <div class="set-row-card">
      <div style="display:flex; justify-content:space-between; font-size:14px;">
        <strong>Destinées de Paldea</strong>
        <span>${state.cards.filter(c => c.set.includes("Paldea")).length} / 91</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${Math.min(100, (state.cards.filter(c => c.set.includes("Paldea")).length / 91) * 100)}%"></div>
      </div>
    </div>
  `;
}

// Lancement au chargement complet du script
window.addEventListener("DOMContentLoaded", () => {
  renderAllData();
});
