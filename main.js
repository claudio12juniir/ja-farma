require("dotenv").config();
// CORREÇÃO CRÍTICA NA LINHA ABAIXO: Adicionado ipcMain
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { fork } = require('child_process');
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
const { analisarCotacao } = require("./aiService");

let mainWindow;
let serverProcess;

function startServer() {
  serverProcess = fork(path.join(__dirname, 'server.js'));
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
  
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  if (serverProcess) serverProcess.kill();
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
      const data = await pdfParse(buffer);
      // Limpeza de quebras de linha para facilitar leitura da IA
      const textoLimpo = data.text.replace(/\n\s*\n/g, '\n').replace(/\r/g, ''); 
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