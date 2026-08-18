require('dotenv').config();
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

console.log("📡 Conectando ao MySQL local...");

const connection = mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sistema_ja_farma'
});

connection.connect(async err => {
    if (err) {
        console.error("❌ ERRO AO CONECTAR:", err.message);
        console.error("Dica: rode o schema.sql primeiro e confira as variáveis DB_* no .env.");
        process.exit(1);
    }
    console.log("✅ Conectado! Verificando usuário admin...");

    connection.query("SELECT id FROM usuarios WHERE user = 'admin'", async (err, rows) => {
        if (err) { console.error("Erro ao consultar usuários:", err.message); process.exit(1); }

        if (rows.length > 0) {
            console.log("ℹ️ Usuário 'admin' já existe. Nada a fazer.");
            console.log("   Use a tela 'Equipe' (login ADMIN) para redefinir a senha se necessário.");
            process.exit(0);
        }

        const senhaGerada = crypto.randomBytes(6).toString('hex');
        const hash = await bcrypt.hash(senhaGerada, 10);

        connection.query(
            "INSERT INTO usuarios (nome, user, pass_hash, perfil) VALUES (?, ?, ?, ?)",
            ['Administrador', 'admin', hash, 'ADMIN'],
            (err) => {
                if (err) { console.error("Erro ao criar admin:", err.message); process.exit(1); }

                console.log("\n------------------------------------------------");
                console.log("🎉 Usuário admin criado com sucesso!");
                console.log("------------------------------------------------");
                console.log("Usuário: admin");
                console.log(`Senha:   ${senhaGerada}`);
                console.log("------------------------------------------------");
                console.log("Guarde essa senha agora — ela não será mostrada de novo.");
                console.log("Troque-a pela tela 'Equipe' após o primeiro login.");
                process.exit(0);
            }
        );
    });
});
