const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function analisarCotacao({ textoBase, textoFornecedores }) {
  console.log("🤖 IA: Recebi o texto. Tamanho base:", textoBase.length);

  // Se o texto for muito curto, nem gasta dinheiro com IA
  if (textoBase.length < 50) {
    console.warn("⚠️ ALERTA: Texto do PDF muito curto ou vazio. Pode ser imagem escaneada.");
    return [];
  }

  const prompt = `
    ATUE COMO UM PARSER DE DADOS JSON.
    
    ENTRADA: Texto de pedido farmacêutico.
    SAÍDA: Apenas JSON (Array de objetos).

    TAREFA:
    1. Extraia TODOS os itens solicitados no TEXTO BASE.
    2. Se houver TEXTO FORNECEDORES, cruze preços (menor valor).
    3. Normalizar: "Cx", "Fr", "Amp" -> Ignorar na descrição, focar no produto.
    4. Qtd: Se não achar número explícito, assuma 1.

    MODELO OBRIGATÓRIO:
    [
      { "item": "Nome Produto", "qtd": 10, "fornecedor": "Nome ou null", "valor": 0.00 }
    ]

    OBS: NÃO escreva "Aqui está o JSON". Mande APENAS o código.

    --- TEXTO BASE ---
    ${textoBase.substring(0, 50000)}

    --- TEXTO FORNECEDORES ---
    ${textoFornecedores ? textoFornecedores.substring(0, 50000) : "Nenhum."}
  `;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 4096
    });

    let content = response.choices[0].message.content.trim();
    console.log("📩 Resposta da IA (Primeiros 100 chars):", content.substring(0, 100));

    // --- CAMADA 1: LIMPEZA BÁSICA ---
    // Remove blocos de código markdown (```json ... ```)
    content = content.replace(/^```json/g, "").replace(/^```/g, "").replace(/```$/g, "").trim();

    try {
      // TENTATIVA 1: Parse direto
      const jsonDireto = JSON.parse(content);
      console.log(`✅ Sucesso Direto! ${jsonDireto.length} itens.`);
      return jsonDireto;
    } catch (e1) {
      console.warn("⚠️ Falha no Parse Direto. Tentando extração avançada...");

      // --- CAMADA 2: EXTRAÇÃO DE ARRAY ---
      // Procura onde começa '[' e onde termina ']'
      const inicio = content.indexOf('[');
      const fim = content.lastIndexOf(']');
      
      if (inicio !== -1 && fim !== -1) {
        try {
          const jsonRecortado = content.substring(inicio, fim + 1);
          const lista = JSON.parse(jsonRecortado);
          console.log(`✅ Sucesso Recortado! ${lista.length} itens.`);
          return lista;
        } catch (e2) {
          console.warn("⚠️ Falha no Recorte. Tentando modo cirúrgico...");
        }
      }

      // --- CAMADA 3: MODO CIRÚRGICO (ITEM A ITEM) ---
      // Se a lista quebrou no meio, salvamos o que deu pra ler
      const regex = /\{[^{}]*\}/g; 
      const matches = content.match(regex);
      
      if (!matches) throw new Error("Nenhum objeto JSON encontrado.");

      const itensSalvos = [];
      for (const m of matches) {
        try {
            itensSalvos.push(JSON.parse(m));
        } catch (err) {} // Ignora item quebrado
      }

      if (itensSalvos.length > 0) {
        console.log(`✅ Modo Cirúrgico salvou ${itensSalvos.length} itens.`);
        return itensSalvos;
      } else {
        throw new Error("Falha total na conversão JSON.");
      }
    }

  } catch (error) {
    console.error("❌ ERRO FATAL AI SERVICE:", error);
    return []; // Retorna vazio para não travar o app
  }
}

module.exports = { analisarCotacao };