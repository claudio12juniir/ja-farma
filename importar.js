require('dotenv').config();
const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

// CONFIGURAÇÃO DO BANCO
const connection = mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sistema_ja_farma'
});

const arquivoCSV = 'itens sidicom categorizado.csv';

// FUNÇÃO PARA LIMPAR NÚMEROS (1.200,50 -> 1200.50)
function limparNumero(valor) {
    if (!valor) return 0;
    // Remove ponto de milhar e troca vírgula por ponto
    let limpo = valor.toString().replace(/\./g, '').replace(',', '.');
    return parseFloat(limpo) || 0;
}

connection.connect(err => {
    if (err) return console.error('Erro ao conectar:', err);
    console.log('✅ Conectado ao Banco! Iniciando importação...');

    fs.readFile(path.join(__dirname, arquivoCSV), 'utf8', (err, data) => {
        if (err) return console.error('Erro ao ler arquivo:', err);

        // Quebra o arquivo em linhas
        const linhas = data.split('\n');
        let importados = 0;

        // Começa do índice 4 (pula as 3 linhas de lixo + 1 de cabeçalho)
        // O arquivo diz que o cabeçalho está na linha 4 (índice 3), então dados começam na 5 (índice 4)
        for (let i = 4; i < linhas.length; i++) {
            const linha = linhas[i].trim();
            if (!linha) continue;

            const colunas = linha.split(';');

            // MAPEAMENTO DAS COLUNAS (Baseado no seu arquivo)
            // Col 2: Código (000181)
            // Col 3: Nome (GUIA CANULA...)
            // Col 4: Unidade (1)
            // Col 7: Estoque (0)
            // Col 15: Preço Custo (Preço Compra)
            // Col 17: Preço Venda (Preço lista)
            // Col 19: Descrição/Referência (112-50)
            
            const codigo = colunas[2] || '';
            const nome = (colunas[3] || 'Sem Nome').replace(/"/g, ''); // Tira aspas extras
            const unidade = colunas[4] || 'UN';
            const estoque = limparNumero(colunas[7]);
            const precoCusto = limparNumero(colunas[15]);
            const precoVenda = limparNumero(colunas[17]);
            const descricao = colunas[19] || '';

            // Regra de Negócio: Preço Atacado = Venda - 10% (exemplo)
            const precoAtacado = (precoVenda * 0.9).toFixed(2);

            const sql = `INSERT INTO produtos (nome, descricao, qtd_estoque, preco_custo, preco_venda, preco_atacado, qtd_atacado, unidade_medida, codigo_barras) VALUES (?, ?, ?, ?, ?, ?, 10, ?, ?)`;

            connection.query(sql, [nome, descricao, estoque, precoCusto, precoVenda, precoAtacado, unidade, codigo], (err) => {
                if (err) console.log(`Erro na linha ${i}:`, err.message);
            });
            
            importados++;
        }

        console.log(`\n🚀 Processo finalizado! ${importados} produtos enviados para importação.`);
        console.log(`(Pode demorar alguns segundos para o banco processar tudo. Dê um Ctrl+C para sair quando parar de aparecer mensagens).`);
    });
});