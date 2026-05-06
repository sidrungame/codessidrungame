const express = require('express');
const app = express();

app.use(express.json());

// 🔥 AJOUTE ÇA
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  next();
});

const WebSocket = require('ws');
const axios = require('axios');

// Variables GitHub depuis Render
const GITHUB_USER = process.env.GITHUB_USER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Stockage des codes/pseudos et contenu brut du fichier
let codes = {}; // { code: pseudo }
let rawLines = []; // contenu complet du fichier

// Admin temporaire par client
const adminClients = new Set();

// Encode/decode base64 pour GitHub
function encodeContent(str) {
  return Buffer.from(str, 'utf-8').toString('base64');
}
function decodeContent(str) {
  return Buffer.from(str, 'base64').toString('utf-8');
}

// Charger codes depuis GitHub
async function loadCodes() {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/codes.txt`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );

    const content = decodeContent(res.data.content);
    rawLines = content.split('\n');
    codes = {};

    rawLines.forEach(line => {
      if (!line.startsWith('.') && !line.startsWith(' ') && line.includes('/')) {
        const [code, pseudo] = line.split('/');
        codes[code] = pseudo;
      }
    });

    console.log("Codes chargés :", codes);
  } catch (err) {
    console.error("Erreur chargement codes:", err.message);
  }
}

// Sauvegarder fichier sur GitHub
async function saveFile() {
  try {

    removeDuplicates();
    
    const content = rawLines.join('\n');

    const getRes = await axios.get(
      `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/codes.txt`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );

    const sha = getRes.data.sha;

    await axios.put(
      `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/codes.txt`,
      {
        message: "Update codes",
        content: encodeContent(content),
        sha
      },
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );

    console.log("Fichier sauvegardé");
  } catch (err) {
    console.error("Erreur sauvegarde:", err.message);
  }
}

// Trouver ligne du pseudo
function findPseudoLine(pseudo) {
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i].includes('/' + pseudo)) return i;
  }
  return -1;
}

// Trouver ligne d'une catégorie pour un pseudo
function findCategoryLine(pseudo, categorie) {
  const pseudoLine = findPseudoLine(pseudo);
  if (pseudoLine === -1) return -1;

  for (let i = pseudoLine + 1; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line.startsWith('.') && !line.startsWith(' ')) break;
    if (line === '.' + categorie + ':') return i;
  }
  return -1;
}
// =========================
// SUPPRIMER DOUBLONS
// =========================
function removeDuplicates() {

  const seen = new Set();
  const newLines = [];

  for (const line of rawLines) {

    // ignorer catégories et valeurs
    if (line.startsWith('.') || line.startsWith(' ')) {
      newLines.push(line);
      continue;
    }

    if (!seen.has(line)) {
      seen.add(line);
      newLines.push(line);
    }

  }

  rawLines = newLines;
}
// ==========================
// API HTTP (BASE44)
// ==========================
app.post("/create-account", async (req, res) => {

  const { code, pseudo } = req.body;

  if (!code || !pseudo) {
    return res.status(400).json({ error: "Données manquantes" });
  }

  codes[code] = pseudo;
  rawLines.push(`${code}/${pseudo}`);

  await saveFile();

  console.log("Compte ajouté depuis Base44 :", code, pseudo);

  res.json({ success: true });

});

// ==========================
// SERVEUR GLOBAL (Render OK)
// ==========================
const server = app.listen(process.env.PORT || 8080, () => {
  console.log("Serveur HTTP + WS démarré");
});

// WebSocket attaché au serveur HTTP
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {

  ws.adminPending = false;

  ws.on('message', async msg => {

    const message = msg.toString().trim();

    // ----- MOT DE PASSE ADMIN -----
    if (ws.adminPending) {

      if (message === "sidrungameadmin") {

        adminClients.add(ws);
        ws.send("Vous êtes admin temporaire, commande DE|{code} activée");

      } else {

        ws.send("Mot de passe incorrect");

      }

      ws.adminPending = false;
      return;
    }

    // ----- DEMANDE ADMIN -----
    if (message.startsWith("A|")) {

      ws.adminPending = true;
      ws.send("mot de passe admin?");
      return;
    }

    // ----- SUPPRIMER CODE -----
    if (message.startsWith("DE|")) {

      if (!adminClients.has(ws)) {
        ws.send("vous n'êtes pas admin");
        return;
      }

      const codeToDelete = message.slice(3);

      if (!codes[codeToDelete]) {
        ws.send("code introuvable");
        return;
      }

      const pseudo = codes[codeToDelete];

      delete codes[codeToDelete];

      rawLines = rawLines.filter(l => !l.includes(codeToDelete + "/" + pseudo));

      await saveFile();

      ws.send(`Code ${codeToDelete} supprimé avec succès`);
      return;
    }

    // ----- TROUVER CODE PAR PSEUDO -----
    if (message.startsWith("P|")) {

      if (!adminClients.has(ws)) {
        ws.send("vous n'êtes pas admin");
        return;
      }

      const pseudoRecherche = message.slice(2);

      let codeTrouve = null;

      for (const code in codes) {
        if (codes[code] === pseudoRecherche) {
          codeTrouve = code;
          break;
        }
      }

      if (!codeTrouve) {
        ws.send("pseudo introuvable");
        return;
      }

      ws.send(`code/${codeTrouve}`);
      return;
    }

    // ----- ENREGISTRER CODE -----
    if (message.startsWith("E|")) {

      const [code, pseudo] = message.slice(2).split("/");

      if (!code || !pseudo) {
        ws.send("format incorrect");
        return;
      }

      codes[code] = pseudo;
      rawLines.push(`${code}/${pseudo}`);

      await saveFile();

      ws.send("enregistré");
      return;
    }

    // ----- VERIFIER CODE -----
    if (message.startsWith("E?|")) {

      const code = message.slice(3);

      if (!codes[code]) {
        ws.send("erreur");
      } else {
        ws.send(`validé/${codes[code]}`);
      }

      return;
    }

    // =========================
    // CREER CATEGORIE
    // =========================
    if (message.startsWith("EL|")) {

      if (!adminClients.has(ws)) {
        ws.send("vous n'êtes pas admin");
        return;
      }

      const [categorie, pseudo] = message.slice(3).split("/");

      const lineIndex = findPseudoLine(pseudo);

      if (lineIndex === -1) {
        ws.send("pseudo introuvable");
        return;
      }

      if (findCategoryLine(pseudo, categorie) !== -1) {
        ws.send(categorie + " existe déjà");
        return;
      }

      rawLines.splice(lineIndex + 1, 0, "." + categorie + ":");

      await saveFile();

      ws.send("enregistré");
      return;
    }

    // =========================
    // AJOUTER VALEUR
    // =========================
    if (message.startsWith("AEL|")) {

      if (!adminClients.has(ws)) {
        ws.send("vous n'êtes pas admin");
        return;
      }

      const parts = message.slice(4).split("/");

      const categorie = parts[0];
      const pseudo = parts[1];
      const valeur = parts.slice(2).join("/");

      if (!valeur.includes(":")) {
        ws.send("format valeur incorrect");
        return;
      }

      const pseudoLine = findPseudoLine(pseudo);

      if (pseudoLine === -1) {
        ws.send("pseudo introuvable");
        return;
      }

      const catIndex = findCategoryLine(pseudo, categorie);

      if (catIndex === -1) {
        ws.send("catégorie " + categorie + " n'existe pas");
        return;
      }

      rawLines.splice(catIndex + 1, 0, "    " + valeur);

      await saveFile();

      ws.send("enregistré");
      return;
    }

    // =========================
    // MODIFIER VALEUR
    // =========================
    if (message.startsWith("MAEL|")) {

      if (!adminClients.has(ws)) {
        ws.send("vous n'êtes pas admin");
        return;
      }

      const parts = message.slice(5).split("/");

      const categorie = parts[0];
      const pseudo = parts[1];
      const cle = parts[2];
      const modification = parts[3];

      const pseudoLine = findPseudoLine(pseudo);

      if (pseudoLine === -1) {
        ws.send("pseudo introuvable");
        return;
      }

      const catIndex = findCategoryLine(pseudo, categorie);

      if (catIndex === -1) {
        ws.send("catégorie introuvable");
        return;
      }

      let found = false;

      for (let i = catIndex + 1; i < rawLines.length; i++) {

        const line = rawLines[i];

        if (!line.startsWith(" ")) break;

        if (line.includes(cle + ":")) {
          rawLines[i] = "    " + cle + ": " + modification;
          found = true;
          break;
        }
      }

      if (!found) {
        ws.send("valeur introuvable");
        return;
      }

      await saveFile();

      ws.send("modification enregistrée");
      return;
    }

    // =========================
    // SUPPRIMER CATEGORIE
    // =========================
    if (message.startsWith("DBD|")) {

      if (!adminClients.has(ws)) {
        ws.send("vous n'êtes pas admin");
        return;
      }

      const [categorie, pseudo] = message.slice(4).split("/");

      const pseudoLine = findPseudoLine(pseudo);

      if (pseudoLine === -1) {
        ws.send("pseudo introuvable");
        return;
      }

      const catIndex = rawLines.findIndex((l, i) => l === "." + categorie + ":" && i > pseudoLine);

      if (catIndex === -1) {
        ws.send("catégorie introuvable");
        return;
      }

      let endIndex = catIndex + 1;

      while (endIndex < rawLines.length && rawLines[endIndex].startsWith(" ")) {
        endIndex++;
      }

      rawLines.splice(catIndex, endIndex - catIndex);

      await saveFile();

      ws.send("catégorie supprimée avec succès");
      return;
    }

    // =========================
    // LIRE VALEUR
    // =========================
    if (message.startsWith("GET|")) {

      const parts = message.slice(4).split("/");

      const categorie = parts[0];
      const pseudo = parts[1];
      const recherche = parts[2];

      const pseudoLine = findPseudoLine(pseudo);

      if (pseudoLine === -1) {
        ws.send("pseudo introuvable");
        return;
      }

      const catIndex = findCategoryLine(pseudo, categorie);

      if (catIndex === -1) {
        ws.send("catégorie introuvable");
        return;
      }

      for (let i = catIndex + 1; i < rawLines.length; i++) {

        const line = rawLines[i];

        if (!line.startsWith(" ")) break;

        if (line.includes(recherche)) {

          const value = line.split(":")[1].trim();

          ws.send("trouvé/" + value);
          return;
        }
      }

      ws.send("valeur recherchée introuvable");
      return;
    }

    ws.send("commande inconnue");

  });

  ws.on('close', () => {
    adminClients.delete(ws);
  });

});

// Chargement initial
loadCodes();
app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});
