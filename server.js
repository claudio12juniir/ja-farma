require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const aiService = require('./aiService');

const app = express();

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

const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sistema_ja_farma',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
const poolPromise = pool.promise();

pool.getConnection((err, conn) => {
    if (err) console.error("❌ ERRO NO BANCO:", err.message);
    else {
        console.log("✅ Conectado ao MySQL com sucesso!");
        conn.release();
    }
});

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

app.post('/login', (req, res) => {
    const ip = req.ip;
    if (!checarRateLimit(ip)) {
        return res.status(429).json({ success: false, msg: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    }

    const { user, pass } = req.body;
    if (!user || !pass) return res.status(400).json({ success: false, msg: 'Informe usuário e senha.' });

    pool.query("SELECT * FROM usuarios WHERE user = ?", [String(user).toLowerCase()], async (err, results) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        if (results.length === 0) { registrarFalha(ip); return res.json({ success: false, msg: "Login incorreto" }); }

        const usuarioDb = results[0];
        let ok = false;
        try { ok = await bcrypt.compare(pass, usuarioDb.pass_hash); } catch (e) { ok = false; }

        if (!ok) { registrarFalha(ip); return res.json({ success: false, msg: "Login incorreto" }); }

        limparTentativas(ip);
        const token = criarSessao(usuarioDb);
        res.json({ success: true, token, usuario: { id: usuarioDb.id, nome: usuarioDb.nome, perfil: usuarioDb.perfil } });
    });
});

// A partir daqui, todas as rotas exigem login
app.use(requireAuth);

// ==========================================
// PRODUTOS
// ==========================================
app.get('/produtos', (req, res) => {
    const pagina = Math.max(1, parseInt(req.query.page) || 1);
    const limite = 50;
    const offset = (pagina - 1) * limite;
    const busca = req.query.busca ? `%${req.query.busca}%` : null;

    const sql = busca
        ? "SELECT * FROM produtos WHERE nome LIKE ? OR codigo_barras LIKE ? ORDER BY nome LIMIT ? OFFSET ?"
        : "SELECT * FROM produtos ORDER BY nome LIMIT ? OFFSET ?";
    const params = busca ? [busca, busca, limite, offset] : [limite, offset];

    pool.query(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        res.json(rows);
    });
});

app.post('/produtos', requireAdmin, (req, res) => {
    const { nome, codigo_barras, qtd_estoque, preco_custo, preco_venda, fabricante, anvisa } = req.body;
    if (!nome) return res.status(400).json({ success: false, msg: 'Nome é obrigatório.' });

    const sql = "INSERT INTO produtos (nome, codigo_barras, qtd_estoque, preco_custo, preco_venda, fabricante, anvisa) VALUES (?, ?, ?, ?, ?, ?, ?)";
    pool.query(sql, [nome, codigo_barras || null, Number(qtd_estoque) || 0, Number(preco_custo) || 0, Number(preco_venda) || 0, fabricante || null, anvisa || null], (err, result) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        res.json({ success: true, id: result.insertId });
    });
});

app.put('/produtos/:id', requireAdmin, (req, res) => {
    const { nome, codigo_barras, qtd_estoque, preco_custo, preco_venda, fabricante, anvisa } = req.body;
    if (!nome) return res.status(400).json({ success: false, msg: 'Nome é obrigatório.' });

    const sql = "UPDATE produtos SET nome=?, codigo_barras=?, qtd_estoque=?, preco_custo=?, preco_venda=?, fabricante=?, anvisa=? WHERE id=?";
    pool.query(sql, [nome, codigo_barras || null, Number(qtd_estoque) || 0, Number(preco_custo) || 0, Number(preco_venda) || 0, fabricante || null, anvisa || null, req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        res.json({ success: true });
    });
});

app.post('/produtos/importar', requireAdmin, (req, res) => {
    const produtos = req.body;
    if (!Array.isArray(produtos) || produtos.length === 0) return res.json({ success: false, msg: "Nada para importar" });

    const sql = "INSERT INTO produtos (nome, codigo_barras, qtd_estoque, preco_custo, preco_venda) VALUES ?";
    const values = produtos.map(p => [p.nome, p.codigo_barras, Number(p.qtd_estoque) || 0, Number(p.preco_custo) || 0, Number(p.preco_venda) || 0]);

    pool.query(sql, [values], (err) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        res.json({ success: true, qtd: produtos.length });
    });
});

// ==========================================
// COTAÇÕES
// ==========================================
app.get('/cotacoes', (req, res) => {
    pool.query("SELECT * FROM cotacoes ORDER BY criado_em DESC", (err, rows) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        const dados = rows.map(r => {
            let resultadoIA = [];
            try { resultadoIA = typeof r.resultado_ia === 'string' ? JSON.parse(r.resultado_ia) : (r.resultado_ia || []); } catch (e) { resultadoIA = []; }
            return { ...r, resultadoIA };
        });
        res.json(dados);
    });
});

app.post('/cotacoes', (req, res) => {
    const { cliente, vendedor, data, status, feedback, resultadoIA } = req.body;
    if (!cliente) return res.status(400).json({ success: false, msg: 'Cliente é obrigatório.' });

    const sql = "INSERT INTO cotacoes (cliente, vendedor, data, status, feedback, resultado_ia) VALUES (?, ?, ?, ?, ?, ?)";
    pool.query(sql, [cliente, vendedor || null, data || null, status || 'AGUARDANDO', feedback || '', JSON.stringify(resultadoIA || [])], (err, result) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        res.json({ success: true, id: result.insertId });
    });
});

app.put('/cotacoes/:id', (req, res) => {
    const { status, feedback, resultadoIA } = req.body;
    const campos = [];
    const valores = [];
    if (status !== undefined) { campos.push('status=?'); valores.push(status); }
    if (feedback !== undefined) { campos.push('feedback=?'); valores.push(feedback); }
    if (Array.isArray(resultadoIA) && resultadoIA.length > 0) { campos.push('resultado_ia=?'); valores.push(JSON.stringify(resultadoIA)); }
    if (campos.length === 0) return res.json({ success: true });

    valores.push(req.params.id);
    pool.query(`UPDATE cotacoes SET ${campos.join(', ')} WHERE id=?`, valores, (err) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        res.json({ success: true });
    });
});

app.delete('/cotacoes/:id', (req, res) => {
    pool.query("DELETE FROM cotacoes WHERE id=?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        res.json({ success: true });
    });
});

// ==========================================
// USUÁRIOS (equipe) — admin apenas
// ==========================================
app.get('/usuarios', requireAdmin, (req, res) => {
    pool.query("SELECT id, nome, user, perfil FROM usuarios ORDER BY nome", (err, rows) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        res.json(rows);
    });
});

app.post('/usuarios', requireAdmin, async (req, res) => {
    const { nome, user, pass, perfil } = req.body;
    if (!nome || !user || !pass) return res.status(400).json({ success: false, msg: 'Preencha todos os campos.' });
    if (pass.length < 6) return res.status(400).json({ success: false, msg: 'A senha deve ter ao menos 6 caracteres.' });

    try {
        const hash = await bcrypt.hash(pass, 10);
        pool.query("INSERT INTO usuarios (nome, user, pass_hash, perfil) VALUES (?, ?, ?, ?)",
            [nome, user.toLowerCase(), hash, perfil === 'ADMIN' ? 'ADMIN' : 'COLABORADOR'],
            (err, result) => {
                if (err) {
                    if (err.code === 'ER_DUP_ENTRY') return res.json({ success: false, code: 'ER_DUP_ENTRY', msg: 'Login já existe.' });
                    return res.status(500).json({ success: false, msg: err.message });
                }
                res.json({ success: true, id: result.insertId });
            });
    } catch (e) { res.status(500).json({ success: false, msg: e.message }); }
});

app.put('/usuarios/:id/senha', requireAdmin, async (req, res) => {
    const { pass } = req.body;
    if (!pass || pass.length < 6) return res.status(400).json({ success: false, msg: 'A senha deve ter ao menos 6 caracteres.' });

    try {
        const hash = await bcrypt.hash(pass, 10);
        pool.query("UPDATE usuarios SET pass_hash=? WHERE id=?", [hash, req.params.id], (err) => {
            if (err) return res.status(500).json({ success: false, msg: err.message });
            res.json({ success: true });
        });
    } catch (e) { res.status(500).json({ success: false, msg: e.message }); }
});

app.delete('/usuarios/:id', requireAdmin, (req, res) => {
    pool.query("DELETE FROM usuarios WHERE id=?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        res.json({ success: true });
    });
});

// ==========================================
// CLIENTES (carteira, aba NF-e)
// ==========================================
app.get('/clientes', (req, res) => {
    const busca = req.query.busca ? `%${req.query.busca}%` : null;
    const sql = busca ? "SELECT * FROM clientes WHERE nome LIKE ? OR cnpj LIKE ? ORDER BY nome" : "SELECT * FROM clientes ORDER BY nome";
    const params = busca ? [busca, busca] : [];
    pool.query(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        res.json(rows);
    });
});

app.post('/clientes', (req, res) => {
    const { cnpj, nome, ie, cidade, uf, email } = req.body;
    if (!nome) return res.status(400).json({ success: false, msg: 'Razão social é obrigatória.' });

    const sql = "INSERT INTO clientes (cnpj, nome, ie, cidade, uf, email) VALUES (?, ?, ?, ?, ?, ?)";
    pool.query(sql, [cnpj || null, nome, ie || null, cidade || null, uf || null, email || null], (err, result) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        res.json({ success: true, id: result.insertId });
    });
});

app.delete('/clientes/:id', (req, res) => {
    pool.query("DELETE FROM clientes WHERE id=?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        res.json({ success: true });
    });
});

// ==========================================
// ANÁLISE / DASHBOARD — admin apenas
// ==========================================
app.get('/analise/dados', requireAdmin, async (req, res) => {
    try {
        const [produtos] = await poolPromise.query("SELECT nome, qtd_estoque, preco_venda FROM produtos");
        const [cotacoesVendidas] = await poolPromise.query("SELECT resultado_ia FROM cotacoes WHERE status='VENDIDA'");

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
app.listen(PORT, '127.0.0.1', () => console.log(`Rodando na porta ${PORT}`));
