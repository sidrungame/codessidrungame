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

// 🔥 NOUVEAU : CLASSEMENTS
let classements = {};

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

// 🔥 NOUVEAU : SAUVEGARDE CLASSEMENTS
async function saveClassements() {
  try {
    const content = JSON.stringify(classements, null, 2);

    const getRes = await axios.get(
      `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/classements.txt`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );

    const sha = getRes.data.sha;

    await axios.put(
      `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/classements.txt`,
      {
        message: "Update classements",
        content: encodeContent(content),
        sha
      },
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );

    console.log("Classements sauvegardés");
  } catch (err) {
    console.error("Erreur sauvegarde classements:", err.message);
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
// SERVEUR GLOBAL
// ==========================
const server = app.listen(process.env.PORT || 8080, () => {
  console.log("Serveur HTTP + WS démarré");
});

const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {

  ws.adminPending = false;

  ws.on('message', async msg => {

    const message = msg.toString().trim();

    // =========================
    // 🔥 CLASSEMENTS (NOUVEAU)
    // =========================
    if (message.startsWith("CL|")) {

      const [categorie, scoreStr, pseudo] = message.slice(3).split("/");
      const score = parseInt(scoreStr);

      if (!categorie || !pseudo || isNaN(score)) {
        ws.send("format incorrect");
        return;
      }

      if (!classements[categorie]) {
        classements[categorie] = [];
      }

      const existing = classements[categorie].find(e => e.pseudo === pseudo);

      if (existing) {
        if (score > existing.score) {
          existing.score = score;
        }
      } else {
        classements[categorie].push({ pseudo, score });
      }

      classements[categorie].sort((a, b) => b.score - a.score);
      classements[categorie] = classements[categorie].slice(0, 20);

      ws.send("score enregistré");
      return;
    }

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

    if (message.startsWith("A|")) {
      ws.adminPending = true;
      ws.send("mot de passe admin?");
      return;
    }

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

    if (message.startsWith("E?|")) {

      const code = message.slice(3);

      if (!codes[code]) {
        ws.send("erreur");
      } else {
        ws.send(`validé/${codes[code]}`);
      }

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

// 🔥 SYNC CLASSEMENTS TOUTES LES 5 MIN
setInterval(async () => {

  try {

    await saveClassements();

    const json = JSON.stringify({
  type: "classements_update",
  data: classements
});

const base64 = Buffer.from(json).toString("base64");

await axios.get(
  `https://appsidrungame.base44.app/LeaderboardReceiver?payload=${base64}`
);

    console.log("Classements envoyés à Base44");

  } catch (err) {
    console.error("Erreur sync classements:", err.message);
  }

}, 5 * 60 * 1000);

app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});
