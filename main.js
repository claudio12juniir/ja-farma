// CORREÇÃO CRÍTICA NA LINHA ABAIXO: Adicionado ipcMain
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

// Template usado para criar a config inicial em cada máquina onde o app é
// instalado (build empacotado). Em dev (npm start) continuamos usando o
// .env do próprio projeto, sem tocar nisso.
const ENV_TEMPLATE = `OPENAI_API_KEY=

# Banco de dados (MySQL local)
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=sistema_ja_farma

# Servidor
PORT=3000
`;

function resolveEnvPath() {
  if (!app.isPackaged) return path.join(__dirname, ".env");

  const envPath = path.join(app.getPath("userData"), ".env");
  if (!fs.existsSync(envPath)) {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, ENV_TEMPLATE, "utf8");
    console.warn(
      `⚠️  Configuração inicial criada em ${envPath}. Preencha DB_PASSWORD e OPENAI_API_KEY antes de usar o sistema.`
    );
  }
  return envPath;
}

const ENV_PATH = resolveEnvPath();
require("dotenv").config({ path: ENV_PATH });

const { analisarCotacao } = require("./aiService");

// pdf-parse embute um pdfjs de 2017 incompatível com o V8 do Electron 43+
// (falha com "bad XRef entry"/UnknownErrorException em PDFs válidos).
// Usamos o pdfjs-dist moderno (já é dependência do projeto) via import
// dinâmico, pois só é distribuído como ESM.
let pdfjsLibPromise;
function getPdfjsLib() {
  if (!pdfjsLibPromise) pdfjsLibPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsLibPromise;
}

async function extrairTextoPDF(buffer) {
  const pdfjsLib = await getPdfjsLib();
  const standardFontDataUrl = path.join(__dirname, "node_modules/pdfjs-dist/standard_fonts") + path.sep;
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl,
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  let texto = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    texto += content.items.map((it) => it.str).join(" ") + "\n";
  }
  return texto;
}

let mainWindow;

function setupAutoUpdate() {
  if (!app.isPackaged) return;

  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = true;

  autoUpdater.on("update-downloaded", () => {
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Atualização disponível",
        message: "Uma nova versão foi baixada. Reiniciar agora para instalar?",
        buttons: ["Reiniciar agora", "Depois"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on("error", (err) => {
    console.error("❌ Erro no auto-update:", err);
  });

  autoUpdater.checkForUpdatesAndNotify();
}

function startServer() {
  // Roda o Express no próprio processo principal, em vez de um processo
  // filho separado (child_process.fork+ELECTRON_RUN_AS_NODE e
  // utilityProcess.fork foram testados e ambos derrubam o app com um crash
  // nativo do V8 — EXC_BREAKPOINT dentro do compilador JIT — ao relançar o
  // binário do Electron como processo filho a partir do processo principal
  // já inicializado; reproduzido tanto em dev quanto no build assinado).
  // server.js só faz app.listen(), então basta dar require() nele aqui.
  require("./server.js");
  console.log("🚀 Servidor API iniciado!");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    title: "J.A Produtos Farmacêuticos",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), 
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile("index.html");
}

app.whenReady().then(() => {
  startServer();
  createWindow();
  setupAutoUpdate();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --- COMUNICAÇÃO (IPC) ---

ipcMain.handle("read-pdfs", async (event, filePaths) => {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  const resultados = [];
  for (const filePath of paths) {
    try {
      const buffer = fs.readFileSync(filePath);
      const textoBruto = await extrairTextoPDF(buffer);
      // Limpeza de quebras de linha para facilitar leitura da IA
      const textoLimpo = textoBruto.replace(/\n\s*\n/g, '\n').replace(/\r/g, '');
      resultados.push({ texto: textoLimpo, path: filePath });
    } catch (err) {
      console.error("Erro PDF:", err);
    }
  }
  return resultados;
});

ipcMain.handle("comparar-cotacao", async (event, dados) => {
  return await analisarCotacao(dados);
});