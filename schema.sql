CREATE DATABASE IF NOT EXISTS sistema_ja_farma CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE sistema_ja_farma;

CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    user VARCHAR(50) NOT NULL UNIQUE,
    pass_hash VARCHAR(100) NOT NULL,
    perfil VARCHAR(20) NOT NULL DEFAULT 'COLABORADOR'
);

CREATE TABLE IF NOT EXISTS produtos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    descricao VARCHAR(255),
    codigo_barras VARCHAR(100),
    qtd_estoque INT NOT NULL DEFAULT 0,
    preco_custo DECIMAL(10,2) NOT NULL DEFAULT 0,
    preco_venda DECIMAL(10,2) NOT NULL DEFAULT 0,
    preco_atacado DECIMAL(10,2) DEFAULT 0,
    qtd_atacado INT DEFAULT 10,
    unidade_medida VARCHAR(20) DEFAULT 'UN',
    anvisa VARCHAR(50),
    fabricante VARCHAR(100),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_produtos_nome (nome),
    INDEX idx_produtos_codigo (codigo_barras)
);

CREATE TABLE IF NOT EXISTS cotacoes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cliente VARCHAR(150) NOT NULL,
    vendedor VARCHAR(100),
    data DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'AGUARDANDO',
    feedback TEXT,
    resultado_ia JSON,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clientes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cnpj VARCHAR(20),
    nome VARCHAR(150) NOT NULL,
    ie VARCHAR(30),
    cidade VARCHAR(100),
    uf VARCHAR(2),
    email VARCHAR(150),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
