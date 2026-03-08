const WebSocket = require("ws");
const axios = require("axios");

const port = process.env.PORT || 3000;

const wss = new WebSocket.Server({ port });

let codes = {};
let sha = "";

async function loadData(){

const res = await axios.get(
`https://api.github.com/repos/${process.env.GITHUB_USER}/${process.env.GITHUB_REPO}/contents/codes.txt`,
{
headers:{Authorization:`token ${process.env.GITHUB_TOKEN}`}
}
);

const content = Buffer.from(res.data.content,"base64").toString();

sha = res.data.sha;

const lines = content.split("\n");

for(const line of lines){

if(!line) continue;

const parts = line.split("/");

codes[parts[0]] = parts[1];

}

console.log("codes chargés :", codes);

}

async function saveData(){

let text = "";

for(const code in codes){

text += code + "/" + codes[code] + "\n";

}

const encoded = Buffer.from(text).toString("base64");

await axios.put(
`https://api.github.com/repos/${process.env.GITHUB_USER}/${process.env.GITHUB_REPO}/contents/codes.txt`,
{
message:"update codes",
content:encoded,
sha:sha
},
{
headers:{Authorization:`token ${process.env.GITHUB_TOKEN}`}
}
);

}

loadData();

wss.on("connection", ws => {

console.log("client connecté");

ws.on("message", async data => {

const msg = data.toString();

console.log("reçu :", msg);

if(msg.startsWith("E|")){

const info = msg.substring(2);

const parts = info.split("/");

const code = parts[0];
const pseudo = parts[1];

codes[code] = pseudo;

await saveData();

ws.send("enregistré");

}

else if(msg.startsWith("E?|")){

const code = msg.substring(3);

if(codes[code]){

ws.send("validé/" + codes[code]);

}else{

ws.send("erreur");

}

}

});

});
