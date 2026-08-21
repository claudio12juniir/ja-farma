-- Schema Postgres (Supabase). O banco/schema já existe no projeto Supabase,
-- então basta rodar isto no SQL Editor (ou via psql) uma vez.

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    "user" VARCHAR(50) NOT NULL UNIQUE,
    pass_hash VARCHAR(100) NOT NULL,
    perfil VARCHAR(20) NOT NULL DEFAULT 'COLABORADOR'
);

CREATE TABLE IF NOT EXISTS produtos (
    id SERIAL PRIMARY KEY,
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
    -- Classificação fiscal do produto (NF-e) — dado cadastral informado pela
    -- empresa/contador de quem usa o sistema, nunca calculado por aqui.
    ncm VARCHAR(10),
    cfop VARCHAR(10),
    csosn VARCHAR(10),
    origem_icms VARCHAR(2),
    cst_pis VARCHAR(5),
    cst_cofins VARCHAR(5),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_produtos_nome ON produtos (nome);
CREATE INDEX IF NOT EXISTS idx_produtos_codigo ON produtos (codigo_barras);

CREATE TABLE IF NOT EXISTS cotacoes (
    id SERIAL PRIMARY KEY,
    cliente VARCHAR(150) NOT NULL,
    vendedor VARCHAR(100),
    data DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'AGUARDANDO',
    feedback TEXT,
    resultado_ia JSONB,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY,
    cnpj VARCHAR(20),
    nome VARCHAR(150) NOT NULL,
    ie VARCHAR(30),
    cidade VARCHAR(100),
    uf VARCHAR(2),
    email VARCHAR(150),
    -- Endereço completo, exigido pela NFe.io pra emitir nota pro cliente.
    bairro VARCHAR(100),
    logradouro VARCHAR(150),
    numero VARCHAR(20),
    cep VARCHAR(9),
    codigo_ibge_cidade VARCHAR(7),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dados cadastrais da empresa emissora das notas fiscais (hoje só a J.A. — linha
-- única, id=1). Tudo aqui é informado pelo próprio usuário/contador; o sistema não
-- calcula nem valida regime tributário ou dados fiscais de ninguém.
CREATE TABLE IF NOT EXISTS empresa_emissora (
    id INT PRIMARY KEY DEFAULT 1,
    cnpj VARCHAR(20),
    razao_social VARCHAR(150),
    nome_fantasia VARCHAR(150),
    ie VARCHAR(30),
    tax_regime VARCHAR(40),
    bairro VARCHAR(100),
    logradouro VARCHAR(150),
    numero VARCHAR(20),
    cep VARCHAR(9),
    cidade VARCHAR(100),
    uf VARCHAR(2),
    codigo_ibge_cidade VARCHAR(7),
    nfeio_company_id VARCHAR(50),
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT empresa_emissora_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS notas_fiscais (
    id SERIAL PRIMARY KEY,
    cliente_id INT REFERENCES clientes(id),
    cotacao_id INT REFERENCES cotacoes(id),
    nfeio_invoice_id VARCHAR(50),
    status VARCHAR(30) NOT NULL DEFAULT 'Processing',
    serie INT,
    numero BIGINT,
    chave_acesso VARCHAR(60),
    pdf_url VARCHAR(255),
    xml_url VARCHAR(255),
    itens JSONB NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
