const express = require('express');
const app = express();

app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  next();
});

const WebSocket = require('ws');
const axios = require('axios');

// Variables GitHub
const GITHUB_USER = process.env.GITHUB_USER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Stockage
let codes = {};
let rawLines = [];

// 🔥 CLASSEMENTS
let classements = {};

// Admin
const adminClients = new Set();

// Base64 helpers
function encodeContent(str) {
  return Buffer.from(str, 'utf-8').toString('base64');
}
function decodeContent(str) {
  return Buffer.from(str, 'base64').toString('utf-8');
}

// ==========================
// LOAD CODES
// ==========================
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

// ==========================
// SAVE CLASSEMENTS (FIXÉ)
// ==========================
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

  } catch (err) {
    console.error("Erreur save classements:", err.message);
  }
}

// ==========================
// SAVE CODES
// ==========================
async function saveFile() {
  try {

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

  } catch (err) {
    console.error("Erreur sauvegarde:", err.message);
  }
}

// ==========================
// SERVER
// ==========================
const server = app.listen(process.env.PORT || 8080, () => {
  console.log("Serveur HTTP + WS démarré");
});

const wss = new WebSocket.Server({ server });

// ==========================
// WS
// ==========================
wss.on('connection', ws => {

  ws.adminPending = false;

  ws.on('message', async msg => {

    const message = msg.toString().trim();

    // =========================
    // 🔥 CLASSEMENTS FIXÉ
    // =========================
    if (message.startsWith("CL|")) {

      const parts = message.slice(3).split("/");

      const categorie = (parts[0] || "").trim();
      const score = parseInt(parts[1]);
      const pseudo = (parts[2] || "").trim();

      if (!categorie || !pseudo || isNaN(score)) {
        ws.send("format incorrect");
        return;
      }

      if (!classements[categorie]) {
        classements[categorie] = [];
      }

      let list = classements[categorie];

      const existing = list.find(e => e.pseudo === pseudo);

      if (existing) {
        if (score > existing.score) {
          existing.score = score;
        }
      } else {
        list.push({ pseudo, score });
      }

      // tri + top 20
      list.sort((a, b) => b.score - a.score);
      classements[categorie] = list.slice(0, 20);

      ws.send("score enregistré");
      return;
    }

    // =========================
    // ADMIN
    // =========================
    if (ws.adminPending) {

      if (message === "sidrungameadmin") {
        adminClients.add(ws);
        ws.send("admin ok");
      } else {
        ws.send("mot de passe incorrect");
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

      if (!adminClients.has(ws)) return ws.send("pas admin");

      const codeToDelete = message.slice(3);

      if (!codes[codeToDelete]) return ws.send("code introuvable");

      const pseudo = codes[codeToDelete];

      delete codes[codeToDelete];
      rawLines = rawLines.filter(l => !l.includes(codeToDelete + "/" + pseudo));

      await saveFile();

      ws.send(`Code supprimé`);
      return;
    }

    if (message.startsWith("E|")) {

      const [code, pseudo] = message.slice(2).split("/");

      if (!code || !pseudo) return ws.send("format incorrect");

      codes[code] = pseudo;
      rawLines.push(`${code}/${pseudo}`);

      await saveFile();

      ws.send("enregistré");
      return;
    }

    if (message.startsWith("E?|")) {

      const code = message.slice(3);

      if (!codes[code]) ws.send("erreur");
      else ws.send(`validé/${codes[code]}`);

      return;
    }
if (message.startsWith("CLDEL|")) {

  const [categorie, pseudo] = message.slice(6).split("/");

  if (!categorie || !pseudo) {
    ws.send("format incorrect");
    return;
  }

  if (!classements[categorie]) {
    ws.send("catégorie inexistante");
    return;
  }

  classements[categorie] = classements[categorie]
    .filter(e => e.pseudo !== pseudo);

  ws.send("score supprimé");

  return;
}
    ws.send("commande inconnue");

  });

  ws.on('close', () => {
    adminClients.delete(ws);
  });

});

// ==========================
// INIT
// ==========================
loadCodes();

// ==========================
// SYNC BASE44 (CORRIGÉ SAFE)
// ==========================
setInterval(async () => {

  try {

    await saveClassements();

    const payload = {
      type: "classements_update",
      data: classements
    };

    const base64 = Buffer.from(JSON.stringify(payload)).toString("base64");

    await axios.get(
      `https://appsidrungame.base44.app/LeaderboardReceiver?payload=${encodeURIComponent(base64)}`
    );

    console.log("Classements envoyés à Base44");

  } catch (err) {
    console.error("Erreur sync classements:", err.message);
  }

}, 5 * 60 * 1000);

// ==========================
// HEALTHCHECK
// ==========================
app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});
