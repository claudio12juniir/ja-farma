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

const arquivoCSV = 'estoque loja online.csv';

connection.connect(err => {
    if (err) return console.error('Erro ao conectar:', err);
    console.log('✅ Conectado ao Banco! Iniciando importação da Loja Online...');

    fs.readFile(path.join(__dirname, arquivoCSV), 'utf8', (err, data) => {
        if (err) return console.error('Erro ao ler arquivo:', err);

        const linhas = data.split('\n');
        let importados = 0;

        // Pula a linha 0 (Cabeçalho: Nº;Nome;Categorias...) e começa da 1
        for (let i = 1; i < linhas.length; i++) {
            const linha = linhas[i].trim();
            if (!linha) continue;

            const colunas = linha.split(';');

            // MAPEAMENTO ESPECÍFICO PARA ESTE ARQUIVO
            // 0: Nº
            // 1: Nome (MedTeste Dengue...)
            // 3: Preço (248.70)
            // 8: Estoque (6)
            // 10: Código de barras
            // 11: Marca (MedTeste)

            const nome = (colunas[1] || 'Produto sem Nome').replace(/"/g, '');
            const marca = colunas[11] || '';
            
            // Tratamento de Preço (O arquivo usa PONTO . como decimal)
            const precoVenda = parseFloat(colunas[3]) || 0;
            
            // Regra de Negócio:
            // Como não temos Custo, vamos chutar 60% do valor de venda (Margem 40%)
            // Como não temos Atacado, vamos dar 10% de desconto no Venda
            const precoCusto = (precoVenda * 0.6).toFixed(2);
            const precoAtacado = (precoVenda * 0.9).toFixed(2);
            
            const estoque = parseInt(colunas[8]) || 0;
            const codigo = colunas[10] || '';
            
            // Descrição combinada
            const descricao = marca ? `Marca: ${marca}` : '';

            const sql = `INSERT INTO produtos (nome, descricao, qtd_estoque, preco_custo, preco_venda, preco_atacado, qtd_atacado, unidade_medida, codigo_barras) VALUES (?, ?, ?, ?, ?, ?, 10, 'UN', ?)`;

            connection.query(sql, [nome, descricao, estoque, precoCusto, precoVenda, precoAtacado, codigo], (err) => {
                if (err) console.log(`Erro na linha ${i}:`, err.message);
            });
            
            importados++;
        }

        console.log(`\n🚀 Sucesso! ${importados} produtos da Loja Online foram enviados.`);
        console.log(`(Aguarde o terminal parar de processar antes de fechar).`);
    });
});