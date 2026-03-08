// server.js
const WebSocket = require('ws');
const axios = require('axios');

// Variables GitHub depuis Render
const GITHUB_USER = process.env.GITHUB_USER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Stockage des codes/pseudos
let codes = {}; // { code: pseudo }

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

    codes = {};

    content.split('\n').forEach(line => {
      if (line.trim()) {
        const [code, pseudo] = line.split('/');
        codes[code] = pseudo;
      }
    });

    console.log("Codes chargés :", codes);

  } catch (err) {
    console.error("Erreur chargement codes:", err.message);
  }
}

// Sauvegarder codes sur GitHub
async function saveCodes() {
  try {

    const content = Object.entries(codes)
      .map(([c, p]) => `${c}/${p}`)
      .join('\n');

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

    console.log("Codes sauvegardés");

  } catch (err) {
    console.error("Erreur sauvegarde codes:", err.message);
  }
}

// WebSocket
const wss = new WebSocket.Server({ port: 8080 }, () => {
  console.log("Serveur WebSocket prêt sur 8080");
});

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

      delete codes[codeToDelete];

      await saveCodes();

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

      await saveCodes();

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

    ws.send("commande inconnue");

  });

  ws.on('close', () => {

    adminClients.delete(ws);

  });

});

// Chargement initial
loadCodes();
