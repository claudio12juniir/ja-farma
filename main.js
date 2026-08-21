// CORREÇÃO CRÍTICA NA LINHA ABAIXO: Adicionado ipcMain
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

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
