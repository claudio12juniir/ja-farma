import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs";

export async function extrairTexto(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument(buffer).promise;

  let texto = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    texto += content.items.map(i => i.str).join(" ") + "\n";
  }

  return texto;
}