require('dotenv').config({ path: process.env.ENV_PATH || require('path').join(__dirname, '.env') });
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const aiService = require('./aiService');
const nfeioService = require('./nfeioService');

const app = express();

// Atrás do proxy do Render, sem isso req.ip vira sempre o IP do proxy e o
// rate-limit de login abaixo passaria a bloquear todo mundo junto.
app.set('trust proxy', 1);

// Só aceita chamadas sem Origin (Electron/file://) ou do próprio localhost.
// Bloqueia sites abertos no navegador comum de lerem/chamarem esta API.
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || origin === 'null') return callback(null, true);
        callback(new Error('Origem não permitida'));
    }
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.query('SELECT 1')
    .then(() => console.log("✅ Conectado ao Postgres com sucesso!"))
    .catch((err) => console.error("❌ ERRO NO BANCO:", err.message));

// ==========================================
// SESSÕES (tokens em memória, expiram em 8h)
// ==========================================
const sessions = new Map();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function criarSessao(usuario) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
        id: usuario.id, nome: usuario.nome, perfil: usuario.perfil,
        expires: Date.now() + SESSION_TTL_MS
    });
    return token;
}

function requireAuth(req, res, next) {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const sessao = token ? sessions.get(token) : null;
    if (!sessao || sessao.expires < Date.now()) {
        if (token) sessions.delete(token);
        return res.status(401).json({ success: false, msg: 'Sessão inválida ou expirada. Faça login novamente.' });
    }
    req.usuario = sessao;
    next();
}

function requireAdmin(req, res, next) {
    if (req.usuario.perfil !== 'ADMIN') return res.status(403).json({ success: false, msg: 'Acesso restrito ao administrador.' });
    next();
}

setInterval(() => {
    const agora = Date.now();
    for (const [token, sessao] of sessions) if (sessao.expires < agora) sessions.delete(token);
}, 30 * 60 * 1000);

// ==========================================
// RATE LIMIT DE LOGIN (proteção contra força bruta)
// ==========================================
const loginAttempts = new Map();
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 5 * 60 * 1000;

function checarRateLimit(ip) {
    const registro = loginAttempts.get(ip);
    if (!registro || !registro.blockedUntil) return true;
    if (registro.blockedUntil <= Date.now()) { loginAttempts.delete(ip); return true; }
    return false;
}

function registrarFalha(ip) {
    const registro = loginAttempts.get(ip) || { count: 0 };
    registro.count++;
    if (registro.count >= MAX_TENTATIVAS) registro.blockedUntil = Date.now() + BLOQUEIO_MS;
    loginAttempts.set(ip, registro);
}

function limparTentativas(ip) { loginAttempts.delete(ip); }

// ==========================================
// ROTAS PÚBLICAS
// ==========================================
app.get('/', (req, res) => res.send("Sistema Online 🚀"));

app.post('/login', async (req, res) => {
    const ip = req.ip;
    if (!checarRateLimit(ip)) {
        return res.status(429).json({ success: false, msg: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    }

    const { user, pass } = req.body;
    if (!user || !pass) return res.status(400).json({ success: false, msg: 'Informe usuário e senha.' });

    try {
        const { rows } = await pool.query('SELECT * FROM usuarios WHERE "user" = $1', [String(user).toLowerCase()]);
        if (rows.length === 0) { registrarFalha(ip); return res.json({ success: false, msg: "Login incorreto" }); }

        const usuarioDb = rows[0];
        let ok = false;
        try { ok = await bcrypt.compare(pass, usuarioDb.pass_hash); } catch (e) { ok = false; }

        if (!ok) { registrarFalha(ip); return res.json({ success: false, msg: "Login incorreto" }); }

        limparTentativas(ip);
        const token = criarSessao(usuarioDb);
        res.json({ success: true, token, usuario: { id: usuarioDb.id, nome: usuarioDb.nome, perfil: usuarioDb.perfil } });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// A partir daqui, todas as rotas exigem login
app.use(requireAuth);

// ==========================================
// PRODUTOS
// ==========================================
app.get('/produtos', async (req, res) => {
    const pagina = Math.max(1, parseInt(req.query.page) || 1);
    const limite = 50;
    const offset = (pagina - 1) * limite;
    const busca = req.query.busca ? `%${req.query.busca}%` : null;

    const sql = busca
        ? "SELECT * FROM produtos WHERE nome ILIKE $1 OR codigo_barras ILIKE $2 ORDER BY nome LIMIT $3 OFFSET $4"
        : "SELECT * FROM produtos ORDER BY nome LIMIT $1 OFFSET $2";
    const params = busca ? [busca, busca, limite, offset] : [limite, offset];

    try {
        const { rows } = await pool.query(sql, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

app.post('/produtos', requireAdmin, async (req, res) => {
    const { nome, codigo_barras, qtd_estoque, preco_custo, preco_venda, fabricante, anvisa, ncm, cfop, csosn, origem_icms, cst_pis, cst_cofins } = req.body;
    if (!nome) return res.status(400).json({ success: false, msg: 'Nome é obrigatório.' });

    const sql = "INSERT INTO produtos (nome, codigo_barras, qtd_estoque, preco_custo, preco_venda, fabricante, anvisa, ncm, cfop, csosn, origem_icms, cst_pis, cst_cofins) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id";
    try {
        const { rows } = await pool.query(sql, [nome, codigo_barras || null, Number(qtd_estoque) || 0, Number(preco_custo) || 0, Number(preco_venda) || 0, fabricante || null, anvisa || null, ncm || null, cfop || null, csosn || null, origem_icms || null, cst_pis || null, cst_cofins || null]);
        res.json({ success: true, id: rows[0].id });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

app.put('/produtos/:id', requireAdmin, async (req, res) => {
    const { nome, codigo_barras, qtd_estoque, preco_custo, preco_venda, fabricante, anvisa, ncm, cfop, csosn, origem_icms, cst_pis, cst_cofins } = req.body;
    if (!nome) return res.status(400).json({ success: false, msg: 'Nome é obrigatório.' });

    const sql = "UPDATE produtos SET nome=$1, codigo_barras=$2, qtd_estoque=$3, preco_custo=$4, preco_venda=$5, fabricante=$6, anvisa=$7, ncm=$8, cfop=$9, csosn=$10, origem_icms=$11, cst_pis=$12, cst_cofins=$13 WHERE id=$14";
    try {
        await pool.query(sql, [nome, codigo_barras || null, Number(qtd_estoque) || 0, Number(preco_custo) || 0, Number(preco_venda) || 0, fabricante || null, anvisa || null, ncm || null, cfop || null, csosn || null, origem_icms || null, cst_pis || null, cst_cofins || null, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

app.post('/produtos/importar', requireAdmin, async (req, res) => {
    const produtos = req.body;
    if (!Array.isArray(produtos) || produtos.length === 0) return res.json({ success: false, msg: "Nada para importar" });

    const COLUNAS = 5;
    const placeholders = produtos.map((_, i) => {
        const base = i * COLUNAS;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    }).join(', ');
    const values = produtos.flatMap(p => [p.nome, p.codigo_barras, Number(p.qtd_estoque) || 0, Number(p.preco_custo) || 0, Number(p.preco_venda) || 0]);

    const sql = `INSERT INTO produtos (nome, codigo_barras, qtd_estoque, preco_custo, preco_venda) VALUES ${placeholders}`;
    try {
        await pool.query(sql, values);
        res.json({ success: true, qtd: produtos.length });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// ==========================================
// COTAÇÕES
// ==========================================
app.get('/cotacoes', async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT * FROM cotacoes ORDER BY criado_em DESC");
        const dados = rows.map(r => {
            let resultadoIA = [];
            try { resultadoIA = typeof r.resultado_ia === 'string' ? JSON.parse(r.resultado_ia) : (r.resultado_ia || []); } catch (e) { resultadoIA = []; }
            return { ...r, resultadoIA };
        });
        res.json(dados);
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

app.post('/cotacoes', async (req, res) => {
    const { cliente, vendedor, data, status, feedback, resultadoIA } = req.body;
    if (!cliente) return res.status(400).json({ success: false, msg: 'Cliente é obrigatório.' });

    const sql = "INSERT INTO cotacoes (cliente, vendedor, data, status, feedback, resultado_ia) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id";
    try {
        const { rows } = await pool.query(sql, [cliente, vendedor || null, data || null, status || 'AGUARDANDO', feedback || '', JSON.stringify(resultadoIA || [])]);
        res.json({ success: true, id: rows[0].id });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

app.put('/cotacoes/:id', async (req, res) => {
    const { status, feedback, resultadoIA } = req.body;
    const campos = [];
    const valores = [];
    if (status !== undefined) { campos.push(`status=$${campos.length + 1}`); valores.push(status); }
    if (feedback !== undefined) { campos.push(`feedback=$${campos.length + 1}`); valores.push(feedback); }
    if (Array.isArray(resultadoIA) && resultadoIA.length > 0) { campos.push(`resultado_ia=$${campos.length + 1}`); valores.push(JSON.stringify(resultadoIA)); }
    if (campos.length === 0) return res.json({ success: true });

    valores.push(req.params.id);
    try {
        await pool.query(`UPDATE cotacoes SET ${campos.join(', ')} WHERE id=$${valores.length}`, valores);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

app.delete('/cotacoes/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM cotacoes WHERE id=$1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// ==========================================
// USUÁRIOS (equipe) — admin apenas
// ==========================================
app.get('/usuarios', requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id, nome, "user", perfil FROM usuarios ORDER BY nome');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

app.post('/usuarios', requireAdmin, async (req, res) => {
    const { nome, user, pass, perfil } = req.body;
    if (!nome || !user || !pass) return res.status(400).json({ success: false, msg: 'Preencha todos os campos.' });
    if (pass.length < 6) return res.status(400).json({ success: false, msg: 'A senha deve ter ao menos 6 caracteres.' });

    try {
        const hash = await bcrypt.hash(pass, 10);
        const { rows } = await pool.query(
            'INSERT INTO usuarios (nome, "user", pass_hash, perfil) VALUES ($1, $2, $3, $4) RETURNING id',
            [nome, user.toLowerCase(), hash, perfil === 'ADMIN' ? 'ADMIN' : 'COLABORADOR']
        );
        res.json({ success: true, id: rows[0].id });
    } catch (err) {
        if (err.code === '23505') return res.json({ success: false, code: 'ER_DUP_ENTRY', msg: 'Login já existe.' });
        res.status(500).json({ success: false, msg: err.message });
    }
});

app.put('/usuarios/:id/senha', requireAdmin, async (req, res) => {
    const { pass } = req.body;
    if (!pass || pass.length < 6) return res.status(400).json({ success: false, msg: 'A senha deve ter ao menos 6 caracteres.' });

    try {
        const hash = await bcrypt.hash(pass, 10);
        await pool.query("UPDATE usuarios SET pass_hash=$1 WHERE id=$2", [hash, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

app.delete('/usuarios/:id', requireAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM usuarios WHERE id=$1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// ==========================================
// CLIENTES (carteira, aba NF-e)
// ==========================================
app.get('/clientes', async (req, res) => {
    const busca = req.query.busca ? `%${req.query.busca}%` : null;
    const sql = busca ? "SELECT * FROM clientes WHERE nome ILIKE $1 OR cnpj ILIKE $2 ORDER BY nome" : "SELECT * FROM clientes ORDER BY nome";
    const params = busca ? [busca, busca] : [];
    try {
        const { rows } = await pool.query(sql, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

app.post('/clientes', async (req, res) => {
    const { cnpj, nome, ie, cidade, uf, email, bairro, logradouro, numero, cep, codigo_ibge_cidade } = req.body;
    if (!nome) return res.status(400).json({ success: false, msg: 'Razão social é obrigatória.' });

    const sql = "INSERT INTO clientes (cnpj, nome, ie, cidade, uf, email, bairro, logradouro, numero, cep, codigo_ibge_cidade) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id";
    try {
        const { rows } = await pool.query(sql, [cnpj || null, nome, ie || null, cidade || null, uf || null, email || null, bairro || null, logradouro || null, numero || null, cep || null, codigo_ibge_cidade || null]);
        res.json({ success: true, id: rows[0].id });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

app.delete('/clientes/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM clientes WHERE id=$1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// ==========================================
// EMPRESA EMISSORA (dados fiscais da J.A., usados nas notas) — admin apenas
// ==========================================
app.get('/empresa', requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT * FROM empresa_emissora WHERE id=1");
        res.json(rows[0] || null);
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// Salva os dados cadastrais da empresa e sincroniza com a NFe.io no mesmo passo
// (cria a Empresa lá na primeira vez, atualiza nas próximas).
app.put('/empresa', requireAdmin, async (req, res) => {
    const { cnpj, razao_social, nome_fantasia, ie, tax_regime, bairro, logradouro, numero, cep, cidade, uf, codigo_ibge_cidade } = req.body;
    if (!razao_social || !cnpj) return res.status(400).json({ success: false, msg: 'Razão social e CNPJ são obrigatórios.' });

    try {
        const { rows: existentes } = await pool.query("SELECT nfeio_company_id FROM empresa_emissora WHERE id=1");
        const nfeioCompanyIdAtual = existentes[0] ? existentes[0].nfeio_company_id : null;

        const companyPayload = {
            Name: razao_social,
            TradeName: nome_fantasia || undefined,
            FederalTaxNumber: Number(String(cnpj).replace(/\D/g, '')),
            TaxRegime: tax_regime || 'SimplesNacional',
            Address: {
                State: uf,
                City: { Code: codigo_ibge_cidade, Name: cidade },
                District: bairro,
                Street: logradouro,
                Number: numero,
                PostalCode: String(cep || '').replace(/\D/g, ''),
                Country: 'BRA'
            }
        };

        let empresaNfeio;
        try {
            empresaNfeio = await nfeioService.upsertCompany(nfeioCompanyIdAtual, companyPayload);
        } catch (erroNfeio) {
            return res.status(502).json({ success: false, msg: `Dados salvos localmente, mas a NFe.io recusou: ${erroNfeio.message}` });
        }

        const nfeioCompanyId = (empresaNfeio && (empresaNfeio.Id || empresaNfeio.id)) || nfeioCompanyIdAtual;

        await pool.query(`
            INSERT INTO empresa_emissora (id, cnpj, razao_social, nome_fantasia, ie, tax_regime, bairro, logradouro, numero, cep, cidade, uf, codigo_ibge_cidade, nfeio_company_id, atualizado_em)
            VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
            ON CONFLICT (id) DO UPDATE SET
                cnpj=$1, razao_social=$2, nome_fantasia=$3, ie=$4, tax_regime=$5, bairro=$6, logradouro=$7,
                numero=$8, cep=$9, cidade=$10, uf=$11, codigo_ibge_cidade=$12, nfeio_company_id=$13, atualizado_em=CURRENT_TIMESTAMP
        `, [cnpj, razao_social, nome_fantasia || null, ie || null, tax_regime || null, bairro || null, logradouro || null, numero || null, cep || null, cidade || null, uf || null, codigo_ibge_cidade || null, nfeioCompanyId || null]);

        res.json({ success: true, nfeio_company_id: nfeioCompanyId });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// ==========================================
// NOTAS FISCAIS (emissão via NFe.io)
// ==========================================
app.post('/notas', async (req, res) => {
    const { cliente_id, cotacao_id, itens, operationNature } = req.body;
    if (!cliente_id || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ success: false, msg: 'Informe o cliente e ao menos um item.' });
    }

    try {
        const { rows: empresaRows } = await pool.query("SELECT nfeio_company_id FROM empresa_emissora WHERE id=1");
        const nfeioCompanyId = empresaRows[0] && empresaRows[0].nfeio_company_id;
        if (!nfeioCompanyId) {
            return res.status(400).json({ success: false, msg: 'Cadastre e salve os dados da empresa emissora antes de emitir notas (aba Equipe).' });
        }

        const { rows: clienteRows } = await pool.query("SELECT * FROM clientes WHERE id=$1", [cliente_id]);
        if (clienteRows.length === 0) return res.status(404).json({ success: false, msg: 'Cliente não encontrado.' });
        const cliente = clienteRows[0];

        const produtoIds = itens.map(i => i.produto_id);
        const { rows: produtoRows } = await pool.query("SELECT * FROM produtos WHERE id = ANY($1::int[])", [produtoIds]);
        const produtosPorId = new Map(produtoRows.map(p => [p.id, p]));

        const itensCompletos = itens.map(i => {
            const produto = produtosPorId.get(i.produto_id);
            if (!produto) throw Object.assign(new Error(`Produto ${i.produto_id} não encontrado.`), { code: 'PRODUTO_INEXISTENTE' });
            return { produto, quantidade: Number(i.quantidade) || 1, valorUnitario: Number(i.valor_unitario) || Number(produto.preco_venda) || 0 };
        });

        let payload;
        try {
            payload = nfeioService.buildInvoicePayload({ cliente, itens: itensCompletos, operationNature });
        } catch (erroValidacao) {
            return res.status(400).json({ success: false, msg: erroValidacao.message, code: erroValidacao.code });
        }

        const notaNfeio = await nfeioService.issueProductInvoice(nfeioCompanyId, payload);

        const { rows } = await pool.query(`
            INSERT INTO notas_fiscais (cliente_id, cotacao_id, nfeio_invoice_id, status, serie, numero, itens)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
        `, [
            cliente_id, cotacao_id || null, notaNfeio.id || notaNfeio.Id || null,
            notaNfeio.status || 'Processing', notaNfeio.serie || null, notaNfeio.number || null,
            JSON.stringify(payload.items)
        ]);

        res.json({ success: true, id: rows[0].id, nfeio: notaNfeio });
    } catch (err) {
        console.error('Erro ao emitir nota:', err);
        res.status(err.status === 400 ? 400 : 500).json({ success: false, msg: err.message, detalhes: err.data });
    }
});

app.get('/notas', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT n.*, c.nome AS cliente_nome
            FROM notas_fiscais n LEFT JOIN clientes c ON c.id = n.cliente_id
            ORDER BY n.criado_em DESC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

app.get('/notas/:id', async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT * FROM notas_fiscais WHERE id=$1", [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ success: false, msg: 'Nota não encontrada.' });
        let nota = rows[0];

        if (nota.status === 'Processing' && nota.nfeio_invoice_id) {
            const { rows: empresaRows } = await pool.query("SELECT nfeio_company_id FROM empresa_emissora WHERE id=1");
            const nfeioCompanyId = empresaRows[0] && empresaRows[0].nfeio_company_id;
            if (nfeioCompanyId) {
                try {
                    const atual = await nfeioService.getProductInvoice(nfeioCompanyId, nota.nfeio_invoice_id);
                    if (atual && atual.status && atual.status !== nota.status) {
                        const pdfUrl = atual.authorization && atual.authorization.pdf ? atual.authorization.pdf : null;
                        const xmlUrl = atual.authorization && atual.authorization.xml ? atual.authorization.xml : null;
                        const chaveAcesso = atual.authorization && atual.authorization.accessKey ? atual.authorization.accessKey : null;
                        await pool.query(
                            "UPDATE notas_fiscais SET status=$1, pdf_url=$2, xml_url=$3, chave_acesso=$4 WHERE id=$5",
                            [atual.status, pdfUrl, xmlUrl, chaveAcesso, nota.id]
                        );
                        nota = { ...nota, status: atual.status, pdf_url: pdfUrl, xml_url: xmlUrl, chave_acesso: chaveAcesso };
                    }
                } catch (e) { console.error('Erro ao consultar status na NFe.io:', e.message); }
            }
        }

        res.json(nota);
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// ==========================================
// ANÁLISE / DASHBOARD — admin apenas
// ==========================================
app.get('/analise/dados', requireAdmin, async (req, res) => {
    try {
        const { rows: produtos } = await pool.query("SELECT nome, qtd_estoque, preco_venda FROM produtos");
        const { rows: cotacoesVendidas } = await pool.query("SELECT resultado_ia FROM cotacoes WHERE status='VENDIDA'");

        // Vendidos = agregado real das cotações fechadas. "Mercado" ainda não tem
        // fonte de dados externa, então usamos a própria base como referência comparativa.
        const vendasPorItem = {};
        cotacoesVendidas.forEach(c => {
            let itens = [];
            try { itens = typeof c.resultado_ia === 'string' ? JSON.parse(c.resultado_ia) : (c.resultado_ia || []); } catch (e) { itens = []; }
            itens.forEach(i => {
                if (!i.item) return;
                vendasPorItem[i.item] = (vendasPorItem[i.item] || 0) + (Number(i.qtd) || 0);
            });
        });

        const maisVendidos = Object.entries(vendasPorItem)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([nome, qtd]) => ({ nome, qtd, mediaMercadoQtd: Math.round(qtd * 0.85) }));

        const mediaGeral = produtos.length ? produtos.reduce((acc, p) => acc + Number(p.preco_venda || 0), 0) / produtos.length : 0;
        const menosVendidos = [...produtos]
            .sort((a, b) => b.qtd_estoque - a.qtd_estoque)
            .slice(0, 10)
            .map(p => ({ nome: p.nome, preco: Number(p.preco_venda), precoMercado: Number(mediaGeral.toFixed(2)) }));

        res.json({ maisVendidos, menosVendidos });
    } catch (e) {
        res.status(500).json({ success: false, msg: e.message });
    }
});

// ==========================================
// COTAÇÃO VIA IA
// ==========================================
app.post('/api/cotacao/analisar', async (req, res) => {
    try {
        const { textoBase, textoFornecedores } = req.body;
        if (!textoBase) return res.status(400).json({ success: false, msg: "Texto do cliente é obrigatório." });

        const itensExtraidos = await aiService.analisarCotacao({ textoBase, textoFornecedores });
        res.json({ success: true, dados: itensExtraidos });
    } catch (erro) {
        console.error("Erro na IA:", erro);
        res.status(500).json({ success: false, msg: erro.message });
    }
});

// Handler de erro genérico (evita vazar stack trace, ex: rejeição de CORS ou JSON inválido)
app.use((err, req, res, next) => {
    console.error(err.message);
    res.status(400).json({ success: false, msg: 'Requisição inválida.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
