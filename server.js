const WebSocket = require("ws");
const axios = require("axios");

const port = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port });

let codes = {}; // code → pseudo
let sha = "";

// Charger les codes depuis GitHub au démarrage
async function loadData() {
  const res = await axios.get(
    `https://api.github.com/repos/${process.env.GITHUB_USER}/${process.env.GITHUB_REPO}/contents/codes.txt`,
    { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } }
  );

  const content = Buffer.from(res.data.content, "base64").toString();
  sha = res.data.sha;

  const lines = content.split("\n");
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split("/");
    if (parts.length === 2) {
      const code = parts[0];
      const pseudo = parts[1];
      codes[code] = pseudo;
    }
  }
  console.log("Codes chargés :", codes);
}

// Sauvegarder les codes sur GitHub
async function saveData() {
  let text = "";
  for (const code in codes) {
    text += code + "/" + codes[code] + "\n";
  }

  const encoded = Buffer.from(text).toString("base64");

  const res = await axios.put(
    `https://api.github.com/repos/${process.env.GITHUB_USER}/${process.env.GITHUB_REPO}/contents/codes.txt`,
    {
      message: "Update codes",
      content: encoded,
      sha: sha
    },
    { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } }
  );

  sha = res.data.content.sha; // mettre à jour le sha pour la prochaine écriture
}

// Démarrer le chargement
loadData();

wss.on("connection", ws => {
  console.log("Client connecté");

  ws.on("message", async data => {
    const msg = data.toString();
    console.log("Reçu :", msg);

    if (msg.startsWith("E|")) {
      // Enregistrer un code
      const info = msg.substring(2);
      const parts = info.split("/");
      if (parts.length !== 2) {
        ws.send("erreur"); // format invalide
        return;
      }

      const code = parts[0];
      const pseudo = parts[1];

      if (codes[code]) {
        ws.send("erreur"); // code déjà utilisé
        return;
      }

      codes[code] = pseudo;
      await saveData();
      ws.send("enregistré");

    } else if (msg.startsWith("E?|")) {
      // Vérifier un code
      const code = msg.substring(3);
      if (codes[code]) {
        ws.send("validé/" + codes[code]);
      } else {
        ws.send("erreur");
      }
    } else {
      ws.send("erreur"); // commande inconnue
    }
  });
});
