// NO INÍCIO DO APP.JS
const API_URL = "https://ja-farma.onrender.com";
// VARIÁVEIS GLOBAIS
let listaClientes = [];
let dadosCotacaoAtual = [];
let usuarioLogado = null;
let authToken = null;

// Fetch com o token de sessão embutido. Usar para toda chamada exceto /login.
async function apiFetch(path, options = {}) {
    const headers = Object.assign({}, options.headers, authToken ? { 'Authorization': `Bearer ${authToken}` } : {});
    const res = await fetch(`${API_URL}${path}`, { ...options, headers });
    if (res.status === 401) {
        alert("Sessão expirada. Faça login novamente.");
        usuarioLogado = null; authToken = null;
        location.reload();
        throw new Error("Não autorizado");
    }
    return res;
}
let nomeClienteFoco = "Cliente Balcão";
let fretePercentualGlobal = 0.30; 
let itensXMLParaImportar = []; 
let paginaAtualEstoque = 1;
let termoBuscaAtual = "";

// Instâncias dos Gráficos
let chartTopItens = null;
let chartMenosVendidos = null;
let chartVolume = null;

// INICIALIZAÇÃO
document.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("not-logged");
    showTab('aba-login');

    const btnLogin = document.getElementById("btn-login");
    if(btnLogin) btnLogin.addEventListener("click", realizarLogin);
    
    const inputBusca = document.getElementById('search-produto');
    if(inputBusca) inputBusca.addEventListener('keyup', (e) => { if(e.key === 'Enter') filtrarEstoqueServer(true); });
});

// ==========================================
// 1. LOGIN E IDENTIFICAÇÃO VISUAL
// ==========================================
// ======================================================
// SUBSTITUA A FUNÇÃO realizarLogin INTEIRA POR ESTA:
// ======================================================

async function realizarLogin() {

    const user = document.getElementById("login-user").value.trim().toLowerCase();
    const pass = document.getElementById("login-pass").value.trim();
    const msgErro = document.getElementById("msg-erro");
    const btn = document.getElementById("btn-login");
console.log(1);
    // Limpa mensagens anteriores
    if(msgErro) {
        msgErro.style.display = "none";
        msgErro.innerText = "";
    }

    if (!user || !pass) {
        if(msgErro) {
            msgErro.innerText = "⚠️ Preencha usuário e senha.";
            msgErro.style.display = "block";
        } else {
            alert("Preencha usuário e senha.");
        }
        return;
    }
console.log(2);
    try {
        btn.innerText = "Conectando...";
        btn.disabled = true;

        console.log("Tentando conectar em:", `${API_URL}/login`);
console.log(3);
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, pass })
        });
console.log(4);
console.log(res);
        // --- AQUI ESTÁ A CORREÇÃO DO ERRO JSON ---
        const textoResposta = await res.text(); // Lê a resposta crua primeiro
        let data;
        
        try { console.log(5);
            console.log(textoResposta);
            data = JSON.parse(textoResposta); // Tenta converter para JSON
            console.log(data);
        } catch (e) {
            // Se falhar, é porque o servidor devolveu erro HTML ou vazio
            console.error("RESPOSTA NÃO É JSON:", textoResposta);
            throw new Error(`O servidor respondeu com erro: ${res.status} - Verifique o console.`);
        }
        // -----------------------------------------

        /* data = {
            status: res.status,
            usuario: { nome: "Administrador", perfil: "ADMIN" }
        }
            */
        
        if (data.success) {
            console.log(6);
            console.log("✅ Login Sucesso! Iniciando transição...");
            usuarioLogado = data.usuario;
            authToken = data.token;
            document.body.classList.remove("not-logged");
            
            // Atualizações Visuais
            const elUser = document.getElementById('display-username');
            if (elUser) elUser.innerText = usuarioLogado.nome;

            const elInitials = document.getElementById('user-initials');
            if (elInitials && usuarioLogado.nome) {
                const iniciais = usuarioLogado.nome.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
                elInitials.innerText = iniciais;
            }

            // ... código anterior (elInitials) ...

            const elGreeting = document.getElementById('greeting-time');
            if (elGreeting) {
                const hora = new Date().getHours();
                
                // 1. Define o ícone e o texto base dependendo da hora
                let icone = "";
                let textoSaudacao = "";
                
                if (hora >= 5 && hora < 12) {
                    icone = "☀️";
                    textoSaudacao = "Bom dia";
                } else if (hora >= 12 && hora < 18) {
                    icone = "🌤️";
                    textoSaudacao = "Boa tarde";
                } else {
                    icone = "🌙";
                    textoSaudacao = "Boa noite";
                }

                // 2. Pega apenas o primeiro nome do usuário para ficar mais amigável
                const primeiroNome = usuarioLogado.nome.split(' ')[0];

                // 3. Injeta um HTML estilizado direto no elemento
                elGreeting.innerHTML = `
                    <span style="font-size: 1.2rem; margin-right: 5px;">${icone}</span>
                    <span style="color: var(--slate-500); font-weight: 400; font-size: 1.1rem;">${textoSaudacao},</span>
                    <strong style="color: var(--slate-900); font-size: 1.1rem; letter-spacing: 0.5px;">${primeiroNome}</strong>!
                `;
            }

            // ... continuação do código (admin-only) ...

            document.querySelectorAll('.admin-only').forEach(btn => {
                if(btn) btn.style.display = (usuarioLogado.perfil === 'ADMIN') ? 'block' : 'none';
            });
            
            const elVendedor = document.getElementById("cotacaoVendedor");
            if(elVendedor) elVendedor.value = usuarioLogado.nome;

            await carregarDadosIniciais();
            showTab('intro'); 

        } else { console.log(7);
            // Senha incorreta (mas o servidor respondeu corretamente)
            if(msgErro) {
                msgErro.innerText = "❌ " + (data.msg || "Usuário ou senha incorretos.");
                msgErro.style.display = "block";
            } else {
                alert(data.msg || "Usuário ou senha incorretos.");
            }
        }
    } catch (error) { 
        console.error("ERRO TÉCNICO:", error);
        
        if (usuarioLogado) {
            showTab('intro');
        } else {
            if(msgErro) {
                // Mostra um erro mais amigável na tela
                msgErro.innerText = "⚠️ Erro de conexão com o Servidor. Tente novamente em 1 minuto.";
                msgErro.style.display = "block";
            } else {
                alert("Erro ao conectar no servidor. Verifique o console.");
            }
        }
    } finally {
        if(btn) {
            btn.innerText = "ACESSAR SISTEMA";
            btn.disabled = false;
        }
    }
}
// 1.1 CARGA INICIAL (pós-login)
async function carregarDadosIniciais() {
    try {
        await Promise.all([
            filtrarEstoqueServer(true),
            carregarHistorico()
        ]);
    } catch (e) { console.error("Erro ao carregar dados iniciais:", e); }
}

// 2. NAVEGAÇÃO
function showTab(id) {
    if (['serv1', 'aba-gestao', 'aba-estoque'].includes(id) && usuarioLogado?.perfil !== 'ADMIN')
        return alert("Acesso restrito ao Administrador.");

    document.querySelectorAll(".tab").forEach(t => { t.style.display = "none"; t.classList.remove('active'); });
    const target = document.getElementById(id);
    if(target) { target.style.display = "block"; target.classList.add('active'); }

    const sidebar = document.getElementById("main-sidebar");
    const content = document.getElementById("main-content");
    if (id === 'aba-login') { sidebar.style.display = "none"; content.style.marginLeft = "0"; }
    else { sidebar.style.display = "flex"; content.style.marginLeft = "336px"; }

    // Gatilhos de carregamento específicos
    if(id === 'serv1') carregarDashboard();
    if(id === 'aba-gestao') { carregarEquipe(); carregarEmpresa(); }
    if(id === 'serv2') carregarHistorico();
    if(id === 'aba-nfe') carregarClientes();
    if(id === 'aba-notas') carregarNotas();
}

// ==========================================
// 3. ESTOQUE (COM PAGINAÇÃO)
// ==========================================
async function filtrarEstoqueServer(reset = true) {
    const termoInput = document.getElementById('search-produto').value;
    const btnCarregar = document.getElementById('loader-estoque');
    const tbody = document.getElementById('tabela-estoque');

    if (reset) {
        paginaAtualEstoque = 1; termoBuscaAtual = termoInput;
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Carregando...</td></tr>';
        if(btnCarregar) btnCarregar.style.display = 'none';
    }

    try {
        const url = termoBuscaAtual
            ? `/produtos?busca=${encodeURIComponent(termoBuscaAtual)}&page=${paginaAtualEstoque}`
            : `/produtos?page=${paginaAtualEstoque}`;
        const res = await apiFetch(url);
        const novosItens = await res.json();

        if (reset) tbody.innerHTML = '';
        if (novosItens.length === 0 && reset) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhum produto encontrado.</td></tr>';
            if(btnCarregar) btnCarregar.style.display = "none";
            return;
        }
        renderizarEstoque(novosItens);
        if (btnCarregar) btnCarregar.style.display = (novosItens.length < 50) ? "none" : "block";

    } catch (e) { console.error(e); if(reset) tbody.innerHTML = '<tr><td colspan="6">Erro conexão.</td></tr>'; }
}

function carregarMaisProdutos() { paginaAtualEstoque++; filtrarEstoqueServer(false); }

function renderizarEstoque(lista) {
    const tbody = document.getElementById('tabela-estoque');
    lista.forEach(prod => {
        const anvisa = prod.anvisa && prod.anvisa !== 'undefined' ? prod.anvisa : '-';
        const prodJson = JSON.stringify(prod).replace(/'/g, "&#39;");
        tbody.innerHTML += `
            <tr>
                <td><strong>${prod.nome}</strong><br><small style="color:var(--slate-500)">${prod.codigo_barras || ''}</small></td>
                <td style="text-align:center;"><span class="badge ${prod.qtd_estoque > 0 ? 'badge-verde':'badge-amarelo'}">${prod.qtd_estoque} un</span></td>
                <td style="text-align:right">R$ ${Number(prod.preco_custo).toFixed(2)}</td>
                <td style="text-align:right">R$ ${Number(prod.preco_venda).toFixed(2)}</td>
                <td>${anvisa}</td>
                <td style="text-align:right"><button class="btn-primary btn-sm" onclick='abrirModalProduto(${prodJson})'>✏</button></td>
            </tr>`;
    });
}

// ==========================================
// 4. CONFIGURAÇÃO DA COTAÇÃO
// ==========================================
function iniciarCotacao() { document.getElementById("dadosCotacaoModal").style.display = "flex"; }
function fecharDadosCotacao() { document.getElementById("dadosCotacaoModal").style.display = "none"; }
async function confirmarDadosCotacao() { console.log("Confirmando dados da cotação...");
    const cli = document.getElementById("cotacaoCliente").value;
    const freteSelect = document.getElementById("cotacaoRegiao").value;
    if(!cli) return alert("Informe o Cliente.");
    nomeClienteFoco = cli; fretePercentualGlobal = parseFloat(freteSelect); 
    fecharDadosCotacao(); showTab('aba-upload'); 
}

// ==========================================
// 5. COTAÇÃO INTELIGENTE (IA + MEMÓRIA)
// ==========================================
async function buscarProdutoNoEstoque(nomeItem) {
    if (!nomeItem) return null;
    let limpo = nomeItem.replace(/[\.\-\/]/g, " ");
    const ignorar = ["DE", "DA", "DO", "COM", "PARA", "P/", "C/", "FRASCO", "CX", "AMPOLA", "UNIDADE", "SOLUCAO"];
    const palavras = limpo.split(" ").filter(p => p.length > 2 && !ignorar.includes(p.toUpperCase()));
    const termo = palavras.slice(0, 3).join(" ");
    const res = await apiFetch(`/produtos?busca=${encodeURIComponent(termo)}`);
    const prods = await res.json();
    return prods.length > 0 ? prods[0] : null;
}

// ==========================================
// 5.1 CADASTRO/EDIÇÃO DE PRODUTO (Estoque)
// ==========================================
function abrirModalProduto(produto = null) {
    document.getElementById('prod-id').value = produto ? produto.id : '';
    document.getElementById('prod-nome').value = produto ? produto.nome : '';
    document.getElementById('prod-codigo').value = produto ? (produto.codigo_barras || '') : '';
    document.getElementById('prod-qtd').value = produto ? produto.qtd_estoque : '';
    document.getElementById('prod-custo').value = produto ? produto.preco_custo : '';
    document.getElementById('prod-venda').value = produto ? produto.preco_venda : '';
    document.getElementById('prod-fabricante').value = produto ? (produto.fabricante || '') : '';
    document.getElementById('prod-anvisa').value = produto ? (produto.anvisa || '') : '';
    document.getElementById('prod-ncm').value = produto ? (produto.ncm || '') : '';
    document.getElementById('prod-cfop').value = produto ? (produto.cfop || '') : '';
    document.getElementById('prod-origem-icms').value = produto ? (produto.origem_icms || '') : '';
    document.getElementById('prod-csosn').value = produto ? (produto.csosn || '') : '';
    document.getElementById('prod-cst-pis').value = produto ? (produto.cst_pis || '') : '';
    document.getElementById('prod-cst-cofins').value = produto ? (produto.cst_cofins || '') : '';
    document.getElementById('tituloModalProd').innerText = produto ? "Editar Produto" : "Novo Produto";
    document.getElementById('modalProduto').style.display = 'flex';
}

async function salvarProduto() {
    const id = document.getElementById('prod-id').value;
    const payload = {
        nome: document.getElementById('prod-nome').value.trim(),
        codigo_barras: document.getElementById('prod-codigo').value.trim(),
        qtd_estoque: Number(document.getElementById('prod-qtd').value) || 0,
        preco_custo: Number(document.getElementById('prod-custo').value) || 0,
        preco_venda: Number(document.getElementById('prod-venda').value) || 0,
        fabricante: document.getElementById('prod-fabricante').value.trim(),
        anvisa: document.getElementById('prod-anvisa').value.trim(),
        ncm: document.getElementById('prod-ncm').value.trim(),
        cfop: document.getElementById('prod-cfop').value.trim(),
        origem_icms: document.getElementById('prod-origem-icms').value.trim(),
        csosn: document.getElementById('prod-csosn').value.trim(),
        cst_pis: document.getElementById('prod-cst-pis').value.trim(),
        cst_cofins: document.getElementById('prod-cst-cofins').value.trim()
    };
    if (!payload.nome) return alert("Informe o nome do produto.");

    try {
        const res = await apiFetch(id ? `/produtos/${id}` : '/produtos', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('modalProduto').style.display = 'none';
            filtrarEstoqueServer(true);
        } else alert(data.msg || "Erro ao salvar produto.");
    } catch (e) { alert("Erro de conexão."); }
}

async function processarAnaliseIA() {
    const btn = document.getElementById("btn-processar");
    const tbody = document.getElementById("tabela-conferencia-body");
    
    const fileBase = document.getElementById('pdf-base').files[0];
    const filesFornecedores = document.getElementById('pdf-fornecedores').files;

    btn.innerText = "⏳ Processando..."; 
    btn.disabled = true;

    try {
        let txtBase = "";
        let modoAnalise = "";

        // --- LÓGICA DE DECISÃO (Fase 1 ou Fase 2) ---

        // CENÁRIO 1: Novo Pedido do Cliente (Tem PDF no campo 1)
        if (fileBase) {
            console.log("Modo: Leitura Inicial do Cliente");
            const leitura = await window.api.readPdfs(window.api.getPathForFile(fileBase));
            txtBase = leitura[0].texto;
            modoAnalise = "INICIAL";
        } 
        // CENÁRIO 2: Comparação de Fornecedores (Sem PDF 1, mas tem PDF 2)
        else if (filesFornecedores.length > 0) {
            console.log("Modo: Comparação de Fornecedores (Usando Memória)");
            
            const memoria = localStorage.getItem('cotacao_pendente_itens');
            if (!memoria) {
                throw new Error("Não encontrei a lista de produtos na memória. Por favor, faça o upload do PDF do Cliente pelo menos uma vez.");
            }
            
            const listaSalva = JSON.parse(memoria);
            txtBase = "LISTA DE PRODUTOS DESEJADOS:\n" + listaSalva.map(i => `- ${i.item} (Qtd: ${i.qtd})`).join("\n");
            modoAnalise = "COMPARACAO";
        } 
        else {
            throw new Error("Selecione o PDF do Cliente (para iniciar) ou PDFs de Fornecedores (para comparar).");
        }

        // --- LEITURA DOS FORNECEDORES (SE HOUVER) ---
        let txtForn = "";
        if (filesFornecedores.length > 0) {
            const paths = Array.from(filesFornecedores).map(f => window.api.getPathForFile(f));
            const resForn = await window.api.readPdfs(paths);
            txtForn = resForn.map(r => r.texto).join("\n");
        }

        // --- ENVIA PARA A IA (backend hospedado) ---
        const resIA = await apiFetch('/api/cotacao/analisar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ textoBase: txtBase, textoFornecedores: txtForn })
        });
        const dataIA = await resIA.json();
        if (!dataIA.success) throw new Error(dataIA.msg || "Falha ao analisar a cotação.");
        const itensIA = dataIA.dados;

        if (!itensIA || itensIA.length === 0) throw new Error("A IA não retornou itens válidos.");

        // Limpa tabela visual
        dadosCotacaoAtual = []; 
        tbody.innerHTML = "";
        let temItemFaltante = false;

        // --- PROCESSAMENTO DOS DADOS RETORNADOS ---
        for (const item of itensIA) {
            const produtoInterno = await buscarProdutoNoEstoque(item.item);
            
            let status="", acao="", cor="", origem=""; 
            let precoReferencia = 0, custoUnit = 0;
            let anvisa = "N/D", fabricante = "N/D";

            // Recupera referência interna
            if (produtoInterno) {
                precoReferencia = Number(produtoInterno.preco_custo);
                anvisa = produtoInterno.anvisa || "Isento";
                fabricante = produtoInterno.fabricante || "Genérico";
            }

            // Lógica de Cores e Decisão
            if (produtoInterno && produtoInterno.qtd_estoque >= item.qtd) {
                // TEM NO ESTOQUE (Verde)
                status = `ESTOQUE (${produtoInterno.qtd_estoque})`;
                acao = "SEPARAR";
                cor = "#dcfce7"; 
                origem = "LOJA";
                custoUnit = Number(produtoInterno.preco_custo);
            } else {
                temItemFaltante = true; 
                
                if (item.valor > 0) {
                    // JÁ TEMOS COTAÇÃO DO FORNECEDOR (Azul)
                    status = `COMPRA (${item.fornecedor})`;
                    acao = "MENOR PREÇO";
                    cor = "#dbeafe"; 
                    origem = "FORNECEDOR";
                    custoUnit = Number(item.valor);
                } else {
                    // AINDA NÃO TEMOS PREÇO (Vermelho)
                    status = "FALTA ESTOQUE";
                    acao = "COTAR";
                    cor = "#fee2e2"; 
                    origem = "PENDENTE";
                    custoUnit = 0;
                }
            }

            // Cálculos Financeiros
            const vendaUnit = custoUnit > 0 ? custoUnit * 1.5 : 0;
            const vendaFreteTotal = (vendaUnit * (1 + fretePercentualGlobal)) * item.qtd;

            dadosCotacaoAtual.push({ 
                item: item.item, qtd: Number(item.qtd), status, acao, origem, 
                precoReferencia, custoUnit, vendaFreteTotal, anvisa, fabricante
            });

            // Renderiza na tela
            let displayPreco = custoUnit > 0 ? `R$ ${custoUnit.toFixed(2)}` : "Aguardando";
            
            tbody.innerHTML += `
            <tr style="background:${cor}; border-bottom:1px solid #e2e8f0;">
                <td style="padding:12px"><b>${item.item}</b><br><small>${origem}</small></td>
                <td style="text-align:center;">${item.qtd}</td>
                <td style="text-align:center;">${status}</td>
                <td style="text-align:right;">
                    <small style="color:var(--slate-500)">Ref: R$ ${precoReferencia.toFixed(2)}</small><br>
                    <strong>${displayPreco}</strong>
                </td>
            </tr>`;
        }

        // --- SALVA NA MEMÓRIA (FASE 1) ---
        if (modoAnalise === "INICIAL") {
            const listaParaSalvar = dadosCotacaoAtual.map(i => ({ item: i.item, qtd: i.qtd }));
            localStorage.setItem('cotacao_pendente_itens', JSON.stringify(listaParaSalvar));
        }
        
        // --- BOTÕES ---
        document.getElementById("status-estoque").style.display = "block";
        let botoesHtml = "";

        if (temItemFaltante) {
            botoesHtml += `<button class="btn-primary btn-warning" onclick="gerarPDFSolicitacaoFornecedor()" style="margin-right: 10px;">📄 PDF Para Fornecedores (Sem Preços)</button>`;
        }
        botoesHtml += `<button class="btn-primary" onclick="finalizarCotacaoEBanco()">✅ Gerar Proposta Cliente</button>`;

        document.getElementById("msg-resumo-estoque").innerHTML = `
            <div style="display:flex; justify-content: flex-end; margin-top:15px;">
                ${botoesHtml}
            </div>`;

    } catch (e) { 
        alert("Atenção: " + e.message); 
        console.error(e);
    } finally { 
        btn.innerText = "INICIAR ANÁLISE"; 
        btn.disabled = false; 
        if(fileBase) document.getElementById('pdf-base').value = ""; // Limpa input
    }
}

// ==========================================
// 6. GERAÇÃO DE PDFS
// ==========================================
function gerarPDFSolicitacaoFornecedor() {
    const faltantes = dadosCotacaoAtual.filter(i => i.origem !== 'LOJA');
    
    if(faltantes.length === 0) return alert("Não há itens faltantes para cotar.");

    const { jsPDF } = window.jspdf; 
    const doc = new jsPDF();

    // Cabeçalho Profissional
    doc.setFillColor(30, 58, 138); 
    doc.rect(0, 0, 210, 30, 'F');
    doc.setFontSize(18); doc.setTextColor(255,255,255); 
    doc.text("SOLICITAÇÃO DE COTAÇÃO", 14, 20);
    
    doc.setFontSize(10); doc.setTextColor(0,0,0);
    doc.text(`Data: ${new Date().toLocaleDateString()}`, 14, 40);
    doc.text("Solicitamos cotação para os itens abaixo. Favor informar valor unitário.", 14, 45);

    // Tabela SEM COLUNA DE PREÇO INTERNO
    const colunas = ["Descrição do Produto", "Quantidade Solicitada", "Observações"];
    const linhas = faltantes.map(i => [
        i.item.toUpperCase(), i.qtd, ""
    ]);

    doc.autoTable({ 
        head: [colunas], body: linhas, startY: 50, theme: 'grid',
        headStyles: { fillColor: [22, 119, 255] },
        styles: { fontSize: 11, cellPadding: 4 }
    });

    doc.save(`Cotacao_Fornecedor_${Date.now()}.pdf`);
}

async function finalizarCotacaoEBanco() {
    const temPendencia = dadosCotacaoAtual.some(i => i.origem !== 'LOJA' && i.custoUnit === 0);
    const statusFinal = temPendencia ? "PENDENTE" : "AGUARDANDO";
    const totalGeral = dadosCotacaoAtual.reduce((acc, i) => acc + i.vendaFreteTotal, 0);

    const novaCotacao = {
        cliente: nomeClienteFoco, vendedor: usuarioLogado.nome,
        data: new Date().toISOString().split('T')[0], status: statusFinal,
        feedback: `Frete: ${(fretePercentualGlobal*100)}%. Total: R$ ${totalGeral.toFixed(2)}`,
        resultadoIA: dadosCotacaoAtual
    };
    await apiFetch(`/cotacoes`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(novaCotacao) });
    carregarHistorico();
    gerarTabelaFinalCliente(dadosCotacaoAtual, nomeClienteFoco);
}

function gerarTabelaFinalCliente(dados, clienteNome) {
    const { jsPDF } = window.jspdf; const doc = new jsPDF('landscape');
    doc.setFillColor(30, 58, 138); doc.rect(0, 0, 297, 30, 'F'); 
    doc.setFontSize(22); doc.setTextColor(255,255,255); doc.text("Proposta Comercial", 14, 18);
    doc.setFontSize(10); doc.setTextColor(0,0,0); doc.text(`Cliente: ${clienteNome}`, 14, 40);
    
    const colunas = ["Item", "Qtd", "Custo Unit", "Custo Total", "Total+Frete", "Anvisa", "Fabricante", "Venda Unit", "Venda Total"];
    const linhas = dados.map(i => [
        i.item, i.qtd, `R$ ${i.custoUnit.toFixed(2)}`, `R$ ${(i.custoUnit*i.qtd).toFixed(2)}`, `R$ ${(i.custoUnit*(1+fretePercentualGlobal)*i.qtd).toFixed(2)}`,
        i.anvisa, i.fabricante, `R$ ${(i.vendaFreteTotal/i.qtd).toFixed(2)}`, `R$ ${i.vendaFreteTotal.toFixed(2)}`
    ]);

    doc.autoTable({ head: [colunas], body: linhas, startY: 45, styles: { fontSize: 8 } });
    const total = dados.reduce((acc, i) => acc + i.vendaFreteTotal, 0);
    doc.text(`TOTAL GERAL: R$ ${total.toFixed(2)}`, 14, doc.lastAutoTable.finalY + 10);
    doc.save(`Proposta_${clienteNome}.pdf`);
}

// ==========================================
// 7. HISTÓRICO E EXCLUSÃO
// ==========================================
async function carregarHistorico() {
    try {
        const res = await apiFetch(`/cotacoes`);
        const dados = await res.json();
        const tbody = document.getElementById("tabela-corpo");

        tbody.innerHTML = "";
        document.querySelectorAll('#stat-total, #stat-total-intro').forEach(el => el.innerText = dados.length);

        let vendas = 0, pendentes = 0;

        dados.forEach(c => {
            if(c.status === 'VENDIDA') vendas++;
            if(c.status === 'PENDENTE' || c.status === 'AGUARDANDO') pendentes++;

            let cor = c.status === 'AGUARDANDO' ? 'badge-azul' : c.status === 'VENDIDA' ? 'badge-verde' : 'badge-amarelo';
            
            tbody.innerHTML += `
            <tr style="cursor: pointer;" onclick="carregarCotacaoParaEdicao(${c.id})">
                <td><strong>${c.cliente}</strong></td>
                <td>${c.vendedor}</td>
                <td>${new Date(c.data).toLocaleDateString()}</td>
                <td><span class="badge ${cor}">${c.status}</span></td>
                <td style="text-align: right;" onclick="event.stopPropagation()">
                    
                    <button onclick="abrirModalFeedback(${c.id})" class="btn-primary btn-icon" title="Escrever Feedback">🖊️</button>
                    <button onclick="alterarStatus(${c.id}, 'VENDIDA')" class="btn-primary btn-sm btn-success" title="Marcar como Vendida">💲</button>

                    <button onclick="excluirCotacao(${c.id})" class="btn-primary btn-sm btn-danger" title="Excluir Permanentemente">✖</button>

                    <button onclick='reimprimirPDF(${JSON.stringify(c).replace(/'/g, "&#39;")})' class="btn-primary btn-sm btn-info" title="Ver PDF">📄</button>
                </td>
            </tr>`;
        });

        document.querySelectorAll('#stat-concluidas, #stat-concluidas-intro').forEach(el => el.innerText = vendas);
        document.querySelectorAll('#stat-pendentes, #stat-pendentes-intro').forEach(el => el.innerText = pendentes);

    } catch (e) { console.error("Erro histórico:", e); }
}

async function excluirCotacao(id) {
    if(confirm("ATENÇÃO: Tem certeza que deseja excluir esta cotação permanentemente?")) {
        try {
            await apiFetch(`/cotacoes/${id}`, { method: 'DELETE' });
            carregarHistorico();
        } catch (e) { alert("Erro ao excluir cotação."); }
    }
}

async function carregarCotacaoParaEdicao(id) {
    const res = await apiFetch(`/cotacoes`);
    const todas = await res.json();
    const cotacao = todas.find(c => c.id === id);
    if(!cotacao || !cotacao.resultadoIA) return alert("Erro ao carregar dados.");
    
    dadosCotacaoAtual = cotacao.resultadoIA;
    nomeClienteFoco = cotacao.cliente;
    
    // Força o modo 'Memória' caso queira comparar novamente
    const listaParaSalvar = dadosCotacaoAtual.map(i => ({ item: i.item, qtd: i.qtd }));
    localStorage.setItem('cotacao_pendente_itens', JSON.stringify(listaParaSalvar));

    // Renderiza
    const tbody = document.getElementById("tabela-conferencia-body");
    tbody.innerHTML = "";
    dadosCotacaoAtual.forEach(item => {
        let cor = item.origem === 'LOJA' ? "#dcfce7" : (item.origem === 'FORNECEDOR' ? "#dbeafe" : "#fee2e2");
        let precoRef = item.precoReferencia ? `R$ ${item.precoReferencia.toFixed(2)}` : "R$ 0.00";
        
        tbody.innerHTML += `
        <tr style="background:${cor}; border-bottom:1px solid #e2e8f0;">
            <td style="padding:12px"><b>${item.item}</b><br><small>${item.origem}</small></td>
            <td style="text-align:center;">${item.qtd}</td>
            <td style="text-align:center;">${item.status}</td>
            <td style="text-align:right;"><small style="color:var(--slate-500)">Ref: ${precoRef}</small><br><strong>R$ ${item.custoUnit.toFixed(2)}</strong></td>
        </tr>`;
    });

    document.getElementById("status-estoque").style.display = "block";
    document.getElementById("msg-resumo-estoque").innerHTML = `
        <div style="display:flex; gap:10px; justify-content: flex-end; margin-top:15px;">
            <button class="btn-primary btn-warning" onclick="gerarPDFSolicitacaoFornecedor()">📦 PDF Fornecedor</button>
            <button class="btn-primary btn-success" onclick="finalizarCotacaoEBanco()">✅ Gerar Tabela Cliente</button>
        </div>`;

    showTab('aba-upload'); 
}

// Funções de Feedback e Status
async function alterarStatus(id, novoStatus) {
    if(novoStatus === 'VENDIDA' && !confirm("Confirmar venda?")) return;
    await apiFetch(`/cotacoes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: novoStatus, feedback: "", resultadoIA: [] }) });
    carregarHistorico();
}
function abrirModalFeedback(id) { document.getElementById('idCotaFeedback').value = id; document.getElementById('modalFeedback').style.display = 'flex'; }
async function salvarFeedbackConfirmado() {
    const id = document.getElementById('idCotaFeedback').value; const txt = document.getElementById('textoFeedback').value;
    await apiFetch(`/cotacoes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'PENDENTE', feedback: txt }) });
    document.getElementById('modalFeedback').style.display = 'none'; carregarHistorico();
}
function reimprimirPDF(c) { if(c.resultadoIA) gerarTabelaFinalCliente(c.resultadoIA, c.cliente); }

// ==========================================
// 8. GRÁFICOS
// ==========================================
async function carregarDashboard() {
    try {
        const resAnalise = await apiFetch(`/analise/dados`);
        const dadosAnalise = await resAnalise.json();
        const resCotacoes = await apiFetch(`/cotacoes`);
        const cotacoes = await resCotacoes.json();

        const ctx1 = document.getElementById('chartTopItens');
        if (chartTopItens) chartTopItens.destroy();
        chartTopItens = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: dadosAnalise.maisVendidos.map(d => d.nome.substring(0, 15) + '...'),
                datasets: [
                    { label: 'Sua Loja (Qtd)', data: dadosAnalise.maisVendidos.map(d => d.qtd), backgroundColor: '#3b82f6', borderRadius: 4 },
                    { label: 'Média Mercado (Qtd)', data: dadosAnalise.maisVendidos.map(d => d.mediaMercadoQtd), backgroundColor: '#94a3b8', borderRadius: 4 }
                ]
            },
            options: { responsive: true, scales: { y: { beginAtZero: true } } }
        });

        const ctx2 = document.getElementById('chartMenosVendidos');
        if (chartMenosVendidos) chartMenosVendidos.destroy();
        chartMenosVendidos = new Chart(ctx2, {
            type: 'line', 
            data: {
                labels: dadosAnalise.menosVendidos.map(d => d.nome.substring(0, 15) + '...'),
                datasets: [
                    { label: 'Seu Preço (R$)', data: dadosAnalise.menosVendidos.map(d => d.preco), borderColor: '#10b981', backgroundColor: '#10b981', borderWidth: 2, pointRadius: 4 },
                    { label: 'Preço Mercado (R$)', data: dadosAnalise.menosVendidos.map(d => d.precoMercado), borderColor: '#ef4444', backgroundColor: '#ef4444', borderWidth: 2, borderDash: [5, 5], pointRadius: 4 }
                ]
            },
            options: { responsive: true, interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true } } }
        });

        const statusCont = { 'VENDIDA': 0, 'PENDENTE': 0, 'AGUARDANDO': 0, 'FINALIZADA': 0 };
        cotacoes.forEach(c => { if (statusCont[c.status] !== undefined) statusCont[c.status]++; });

        const ctx3 = document.getElementById('chartVolumeVendas');
        if (chartVolume) chartVolume.destroy();
        chartVolume = new Chart(ctx3, {
            type: 'doughnut',
            data: {
                labels: Object.keys(statusCont),
                datasets: [{ data: Object.values(statusCont), backgroundColor: ['#10b981', '#f59e0b', '#3b82f6', '#ef4444'] }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });

    } catch (e) { console.error("Erro ao carregar gráficos:", e); }
}

// ==========================================
// 9. GESTÃO DE EQUIPE
// ==========================================
async function carregarEquipe() {
    try {
        const res = await apiFetch(`/usuarios`);
        const usuarios = await res.json();
        const tbody = document.getElementById("tabela-usuarios");
        tbody.innerHTML = "";
        usuarios.forEach(u => {
            const badgeClass = u.perfil === 'ADMIN' ? 'badge-azul' : 'badge-verde';
            const iconPerfil = u.perfil === 'ADMIN' ? '🛡️ ADMIN' : '👤 COLABORADOR';
            tbody.innerHTML += `<tr><td><strong>${u.nome}</strong></td><td>${u.user}</td><td><span style="background:var(--slate-100); padding: 2px 8px; border-radius:4px; font-family: monospace;">••••••••</span></td><td><span class="badge ${badgeClass}">${iconPerfil}</span></td><td style="text-align:right"><button onclick="resetarSenhaUsuario(${u.id})" class="btn-primary btn-sm btn-warning" style="margin-right:5px;" title="Redefinir Senha">🔑</button><button onclick="excluirUsuario(${u.id})" class="btn-primary btn-sm btn-danger" title="Remover Acesso">🗑 Excluir</button></td></tr>`;
        });
    } catch (e) { console.error("Erro ao carregar equipe:", e); }
}

async function adicionarFuncionario() {
    const nome = document.getElementById("new-nome").value.trim();
    const user = document.getElementById("new-user").value.trim();
    const pass = document.getElementById("new-pass").value.trim();
    const perfil = document.getElementById("new-perfil").value;
    if(!nome || !user || !pass) return alert("Por favor, preencha todos os campos.");
    if(pass.length < 6) return alert("A senha deve ter ao menos 6 caracteres.");

    try {
        const res = await apiFetch(`/usuarios`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ nome, user, pass, perfil }) });
        const data = await res.json();
        if (data.code === 'ER_DUP_ENTRY') alert("Login já existe.");
        else if (data.success) {
            alert("Usuário cadastrado!");
            document.getElementById("new-nome").value = ""; document.getElementById("new-user").value = ""; document.getElementById("new-pass").value = "";
            carregarEquipe();
        } else alert(data.msg || "Erro ao salvar.");
    } catch (e) { alert("Erro de conexão."); }
}

async function resetarSenhaUsuario(id) {
    const novaSenha = prompt("Digite a nova senha para este usuário (mínimo 6 caracteres):");
    if (!novaSenha) return;
    if (novaSenha.length < 6) return alert("A senha deve ter pelo menos 6 caracteres.");

    try {
        const res = await apiFetch(`/usuarios/${id}/senha`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ pass: novaSenha }) });
        const data = await res.json();
        if (data.success) alert("Senha atualizada com sucesso.");
        else alert(data.msg || "Erro ao atualizar senha.");
    } catch (e) { alert("Erro de conexão."); }
}

async function excluirUsuario(id) {
    if(usuarioLogado && usuarioLogado.id === id) return alert("Não pode excluir a si mesmo.");
    if(confirm("Remover acesso?")) { await apiFetch(`/usuarios/${id}`, { method: 'DELETE' }); carregarEquipe(); }
}
function logout() { location.reload(); }

// ==========================================
// 10. IMPORTAÇÃO XML E SIDICOM
// ==========================================
function processarArquivoXML(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(e.target.result, "text/xml");
        const itens = xmlDoc.getElementsByTagName("det");
        itensXMLParaImportar = [];
        const tbody = document.getElementById("tbody-xml");
        tbody.innerHTML = "";
        let valorTotalNota = 0;
        for (let i = 0; i < itens.length; i++) {
            const prod = itens[i].getElementsByTagName("prod")[0];
            const nome = prod.getElementsByTagName("xProd")[0]?.textContent || "Sem Nome";
            const ean = prod.getElementsByTagName("cEAN")[0]?.textContent || "";
            const qtd = parseFloat(prod.getElementsByTagName("qCom")[0]?.textContent || 0);
            const vUnit = parseFloat(prod.getElementsByTagName("vUnCom")[0]?.textContent || 0);
            const codigoFinal = (ean === "SEM GTIN" || ean === "") ? `REF-${Date.now()}-${i}` : ean;
            itensXMLParaImportar.push({ nome: nome, codigo_barras: codigoFinal, qtd_estoque: qtd, preco_custo: vUnit });
            const totalItem = qtd * vUnit;
            valorTotalNota += totalItem;
            tbody.innerHTML += `<tr><td>${nome}</td><td>${codigoFinal}</td><td>${qtd}</td><td>R$ ${vUnit.toFixed(2)}</td><td>R$ ${totalItem.toFixed(2)}</td></tr>`;
        }
        document.getElementById("total-xml").innerText = `Total da Nota: R$ ${valorTotalNota.toFixed(2)}`;
        document.getElementById("modalXML").style.display = "flex";
        input.value = ""; 
    };
    reader.readAsText(file);
}

function processarArquivoSidicom(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const linhas = text.split('\n');
        itensXMLParaImportar = [];
        let htmlPreview = "";
        let totalItens = 0;
        const linhasDados = linhas.slice(4).filter(l => l.trim().length > 10);
        linhasDados.forEach(linha => {
            const cols = linha.split(';');
            if(cols.length < 10) return; 
            const codigo = cols[2] ? cols[2].trim() : '';
            const nome = cols[3] ? cols[3].trim() : 'Sem Nome';
            const limparNum = (v) => { if(!v) return 0; return parseFloat(v.replace(/\./g, '').replace(',', '.')) || 0; };
            const estoque = limparNum(cols[7]);      
            const precoCusto = limparNum(cols[15]);  
            const precoVenda = limparNum(cols[17]);  
            if (nome && nome !== 'Produto' && nome !== 'Sem Nome') {
                itensXMLParaImportar.push({ nome, codigo_barras: codigo, qtd_estoque: estoque, preco_custo: precoCusto, preco_venda: precoVenda });
                if(totalItens < 100) {
                    htmlPreview += `<tr><td>${nome}</td><td>${codigo}</td><td>${estoque}</td><td>R$ ${precoCusto.toFixed(2)}</td><td>R$ ${(estoque * precoCusto).toFixed(2)}</td></tr>`;
                }
                totalItens++;
            }
        });
        document.getElementById("tbody-xml").innerHTML = htmlPreview;
        document.getElementById("total-xml").innerText = `Total de Itens Lidos: ${totalItens}`;
        document.querySelector('#modalXML h2').innerText = "Importação Sistema (Sidicom)";
        document.getElementById("modalXML").style.display = "flex";
        input.value = ""; 
    };
    reader.readAsText(file, "ISO-8859-1"); 
}

async function confirmarImportacaoBanco() {
    if (itensXMLParaImportar.length === 0) return alert("Nenhum item para importar.");
    const btn = document.querySelector('#modalXML .btn-primary');
    btn.innerText = "⏳ Importando..."; btn.disabled = true;
    try {
        const res = await apiFetch(`/produtos/importar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(itensXMLParaImportar) });
        const data = await res.json();
        if (data.success) {
            alert(`Sucesso! ${data.qtd} itens processados.`);
            document.getElementById("modalXML").style.display = "none";
            filtrarEstoqueServer(true);
        } else { alert("Erro ao importar."); }
    } catch (e) { alert("Erro na conexão: " + e.message); }
    finally { btn.innerText = "✅ CONFIRMAR E LANÇAR"; btn.disabled = false; }
}

// ==========================================
// 11. CLIENTES (aba NF-e)
// ==========================================
function alternarViewNfe(view) {
    document.getElementById('view-nfe-lista').style.display = view === 'lista' ? 'block' : 'none';
    document.getElementById('view-nfe-cadastro').style.display = view === 'cadastro' ? 'block' : 'none';
    if (view === 'lista') carregarClientes();
}

async function carregarClientes(termo = '') {
    const tbody = document.getElementById('tabela-clientes');
    try {
        const res = await apiFetch(`/clientes${termo ? `?busca=${encodeURIComponent(termo)}` : ''}`);
        const clientes = await res.json();
        listaClientes = clientes;
        tbody.innerHTML = '';
        if (clientes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Nenhum cliente cadastrado.</td></tr>';
            return;
        }
        clientes.forEach(c => {
            tbody.innerHTML += `<tr>
                <td><strong>${c.nome}</strong></td>
                <td>${c.cnpj || '-'}</td>
                <td>${c.cidade || ''}${c.cidade && c.uf ? '/' : ''}${c.uf || ''}</td>
                <td style="text-align:right">
                    <button onclick="abrirEmitirNota(${c.id})" class="btn-primary btn-sm" title="Emitir Nota Fiscal">🧾 Emitir Nota</button>
                    <button onclick="excluirCliente(${c.id})" class="btn-primary btn-sm btn-danger" title="Remover Cliente">🗑</button>
                </td>
            </tr>`;
        });
    } catch (e) { console.error("Erro ao carregar clientes:", e); }
}

function filtrarClientes() {
    const termo = document.getElementById('search-cliente').value;
    carregarClientes(termo);
}

async function salvarNovoCliente() {
    const payload = {
        cnpj: document.getElementById('cad-cnpj').value.trim(),
        nome: document.getElementById('cad-nome').value.trim(),
        ie: document.getElementById('cad-ie').value.trim(),
        cidade: document.getElementById('cad-cidade').value.trim(),
        uf: document.getElementById('cad-uf').value.trim(),
        email: document.getElementById('cad-email').value.trim(),
        logradouro: document.getElementById('cad-logradouro').value.trim(),
        numero: document.getElementById('cad-numero').value.trim(),
        bairro: document.getElementById('cad-bairro').value.trim(),
        cep: document.getElementById('cad-cep').value.trim(),
        codigo_ibge_cidade: document.getElementById('cad-codigo-ibge').value.trim()
    };
    if (!payload.nome) return alert("Informe a Razão Social do cliente.");

    try {
        const res = await apiFetch('/clientes', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) {
            ['cad-cnpj','cad-nome','cad-ie','cad-cidade','cad-uf','cad-email','cad-logradouro','cad-numero','cad-bairro','cad-cep','cad-codigo-ibge'].forEach(id => document.getElementById(id).value = '');
            alternarViewNfe('lista');
        } else alert(data.msg || "Erro ao salvar cliente.");
    } catch (e) { alert("Erro de conexão."); }
}

async function excluirCliente(id) {
    if (confirm("Remover este cliente?")) {
        await apiFetch(`/clientes/${id}`, { method: 'DELETE' });
        carregarClientes();
    }
}

// ==========================================
// 12. DADOS DA EMPRESA (emissora das notas fiscais)
// ==========================================
async function carregarEmpresa() {
    try {
        const res = await apiFetch('/empresa');
        const empresa = await res.json();
        const statusEl = document.getElementById('emp-status-nfeio');
        if (!empresa) { statusEl.textContent = ''; return; }

        document.getElementById('emp-cnpj').value = empresa.cnpj || '';
        document.getElementById('emp-razao-social').value = empresa.razao_social || '';
        document.getElementById('emp-nome-fantasia').value = empresa.nome_fantasia || '';
        document.getElementById('emp-ie').value = empresa.ie || '';
        document.getElementById('emp-tax-regime').value = empresa.tax_regime || 'SimplesNacional';
        document.getElementById('emp-codigo-ibge').value = empresa.codigo_ibge_cidade || '';
        document.getElementById('emp-logradouro').value = empresa.logradouro || '';
        document.getElementById('emp-numero').value = empresa.numero || '';
        document.getElementById('emp-bairro').value = empresa.bairro || '';
        document.getElementById('emp-cep').value = empresa.cep || '';
        document.getElementById('emp-cidade').value = empresa.cidade || '';
        document.getElementById('emp-uf').value = empresa.uf || '';

        statusEl.textContent = empresa.nfeio_company_id
            ? '✅ Sincronizado com a NFe.io'
            : '⚠️ Ainda não sincronizado com a NFe.io — salve os dados pra sincronizar.';
    } catch (e) { console.error('Erro ao carregar dados da empresa:', e); }
}

async function salvarEmpresa() {
    const payload = {
        cnpj: document.getElementById('emp-cnpj').value.trim(),
        razao_social: document.getElementById('emp-razao-social').value.trim(),
        nome_fantasia: document.getElementById('emp-nome-fantasia').value.trim(),
        ie: document.getElementById('emp-ie').value.trim(),
        tax_regime: document.getElementById('emp-tax-regime').value,
        codigo_ibge_cidade: document.getElementById('emp-codigo-ibge').value.trim(),
        logradouro: document.getElementById('emp-logradouro').value.trim(),
        numero: document.getElementById('emp-numero').value.trim(),
        bairro: document.getElementById('emp-bairro').value.trim(),
        cep: document.getElementById('emp-cep').value.trim(),
        cidade: document.getElementById('emp-cidade').value.trim(),
        uf: document.getElementById('emp-uf').value.trim().toUpperCase()
    };
    if (!payload.razao_social || !payload.cnpj) return alert('Informe ao menos Razão Social e CNPJ.');

    try {
        const res = await apiFetch('/empresa', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) {
            alert('Dados da empresa salvos e sincronizados com a NFe.io.');
            carregarEmpresa();
        } else alert(data.msg || 'Erro ao salvar dados da empresa.');
    } catch (e) { alert('Erro de conexão.'); }
}

// ==========================================
// 13. EMISSÃO DE NOTA FISCAL (NFe.io)
// ==========================================
let itensNotaAtual = [];
let resultadosBuscaNota = [];

function abrirEmitirNota(clienteId) {
    const cliente = listaClientes.find(c => c.id === clienteId);
    document.getElementById('nota-cliente-id').value = clienteId;
    document.getElementById('nota-cliente-nome').innerText = cliente ? cliente.nome : '';
    itensNotaAtual = [];
    resultadosBuscaNota = [];
    document.getElementById('nota-busca-produto').value = '';
    document.getElementById('nota-resultados-busca').innerHTML = '';
    document.getElementById('nota-view-confirmar').style.display = 'none';
    document.getElementById('nota-view-montar').style.display = 'block';
    renderItensNota();
    document.getElementById('modalEmitirNota').style.display = 'flex';
}

function fecharModalNota() {
    document.getElementById('modalEmitirNota').style.display = 'none';
}

async function buscarProdutoParaNota() {
    const termo = document.getElementById('nota-busca-produto').value.trim();
    const div = document.getElementById('nota-resultados-busca');
    if (!termo) { div.innerHTML = ''; return; }
    try {
        const res = await apiFetch(`/produtos?busca=${encodeURIComponent(termo)}`);
        resultadosBuscaNota = await res.json();
        if (resultadosBuscaNota.length === 0) { div.innerHTML = '<p style="color:#64748b;">Nenhum produto encontrado.</p>'; return; }
        div.innerHTML = resultadosBuscaNota.map((p, i) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid #e2e8f0;">
                <span>${p.nome} <small style="color:#64748b;">(estoque: ${p.qtd_estoque})</small></span>
                <button class="btn-primary btn-sm" onclick="adicionarItemNota(${i})">+ Adicionar</button>
            </div>
        `).join('');
    } catch (e) { console.error('Erro ao buscar produto:', e); }
}

function adicionarItemNota(idx) {
    const produto = resultadosBuscaNota[idx];
    if (!produto) return;
    if (itensNotaAtual.some(i => i.produto.id === produto.id)) return alert('Este produto já foi adicionado.');
    itensNotaAtual.push({ produto, quantidade: 1, valorUnitario: Number(produto.preco_venda) || 0 });
    renderItensNota();
}

function removerItemNota(idx) {
    itensNotaAtual.splice(idx, 1);
    renderItensNota();
}

function atualizarQuantidadeNota(idx, valor) {
    itensNotaAtual[idx].quantidade = Number(valor) || 1;
}

function atualizarValorUnitarioNota(idx, valor) {
    itensNotaAtual[idx].valorUnitario = Number(valor) || 0;
}

function renderItensNota() {
    const tbody = document.getElementById('nota-tabela-itens');
    if (itensNotaAtual.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Nenhum item adicionado ainda.</td></tr>';
        return;
    }
    tbody.innerHTML = itensNotaAtual.map((item, i) => `
        <tr>
            <td>${item.produto.nome}</td>
            <td><input type="number" min="1" value="${item.quantidade}" class="modal-input" style="width:70px;" onchange="atualizarQuantidadeNota(${i}, this.value)"></td>
            <td><input type="number" step="0.01" value="${item.valorUnitario}" class="modal-input" style="width:100px;" onchange="atualizarValorUnitarioNota(${i}, this.value)"></td>
            <td><button onclick="removerItemNota(${i})" class="btn-primary btn-sm btn-danger">🗑</button></td>
        </tr>
    `).join('');
}

function revisarNota() {
    if (itensNotaAtual.length === 0) return alert('Adicione ao menos um item.');

    let temPendencia = false;
    const linhas = itensNotaAtual.map(item => {
        const p = item.produto;
        const faltando = !p.ncm || !p.cfop;
        if (faltando) temPendencia = true;
        const total = (item.quantidade * item.valorUnitario).toFixed(2);
        return `
            <tr style="${faltando ? 'color:#dc2626;' : ''}">
                <td>${p.nome}</td>
                <td>${item.quantidade}</td>
                <td>R$ ${item.valorUnitario.toFixed(2)}</td>
                <td>R$ ${total}</td>
                <td>${p.ncm || '❌ sem NCM'}</td>
                <td>${p.cfop || '❌ sem CFOP'}</td>
                <td>${p.csosn || '-'}</td>
            </tr>`;
    }).join('');

    const totalGeral = itensNotaAtual.reduce((acc, i) => acc + i.quantidade * i.valorUnitario, 0).toFixed(2);

    document.getElementById('nota-resumo-confirmacao').innerHTML = `
        <div class="container-tabela" style="margin-top: 10px;">
            <table class="team-table">
                <thead><tr><th>Produto</th><th>Qtd</th><th>Vlr Unit.</th><th>Total</th><th>NCM</th><th>CFOP</th><th>CSOSN/CST</th></tr></thead>
                <tbody>${linhas}</tbody>
            </table>
        </div>
        <p style="text-align:right; font-weight:bold; margin-top:10px;">Total da Nota: R$ ${totalGeral}</p>
        ${temPendencia ? '<p style="color:#dc2626; font-weight:bold;">⚠️ Complete o cadastro fiscal (NCM/CFOP) dos produtos destacados antes de emitir — a NFe.io vai recusar a nota sem esses dados.</p>' : ''}
    `;
    document.getElementById('nota-view-montar').style.display = 'none';
    document.getElementById('nota-view-confirmar').style.display = 'block';
}

async function confirmarEmissaoNota() {
    const clienteId = document.getElementById('nota-cliente-id').value;
    const payload = {
        cliente_id: Number(clienteId),
        itens: itensNotaAtual.map(i => ({ produto_id: i.produto.id, quantidade: i.quantidade, valor_unitario: i.valorUnitario }))
    };
    try {
        const res = await apiFetch('/notas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) {
            alert('Nota enviada para a NFe.io. Acompanhe o status em "Notas Fiscais".');
            fecharModalNota();
            showTab('aba-notas');
        } else alert(data.msg || 'Erro ao emitir nota.');
    } catch (e) { alert('Erro de conexão.'); }
}

async function carregarNotas() {
    const tbody = document.getElementById('tabela-notas');
    try {
        const res = await apiFetch('/notas');
        const notas = await res.json();
        if (notas.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhuma nota emitida ainda.</td></tr>'; return; }
        tbody.innerHTML = notas.map(n => {
            const data = n.criado_em ? new Date(n.criado_em).toLocaleString('pt-BR') : '-';
            const docs = [
                n.pdf_url ? `<a href="${n.pdf_url}" target="_blank">PDF</a>` : '',
                n.xml_url ? `<a href="${n.xml_url}" target="_blank">XML</a>` : ''
            ].filter(Boolean).join(' | ') || '-';
            return `<tr>
                <td>${data}</td>
                <td>${n.cliente_nome || '-'}</td>
                <td>${n.status}</td>
                <td>${n.numero || '-'}${n.serie ? '/' + n.serie : ''}</td>
                <td style="text-align:right;">${docs}</td>
            </tr>`;
        }).join('');
    } catch (e) { console.error('Erro ao carregar notas:', e); }
}