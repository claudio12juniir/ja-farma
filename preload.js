const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
    // Caminho real do arquivo no disco (Electron 32+ não expõe mais File.path)
    getPathForFile: (file) => webUtils.getPathForFile(file),

    // Função para ler o texto dos PDFs
    readPdfs: (paths) => ipcRenderer.invoke("read-pdfs", paths),
    
    // Função para enviar os textos para a IA
    compararCotacao: (dados) => ipcRenderer.invoke("comparar-cotacao", dados),
    
    // Função para gerar PDF (se necessário via backend)
    exportarPdf: (dados) => ipcRenderer.invoke("exportar-pdf", dados)
});