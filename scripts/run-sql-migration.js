const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function main() {
    const migrationArg = process.argv[2];

    if (!migrationArg) {
        console.error('Usage: node scripts/run-sql-migration.js <migration-file-path>');
        process.exit(1);
    }

    const migrationPath = path.resolve(process.cwd(), migrationArg);

    if (!fs.existsSync(migrationPath)) {
        console.error(`Migration file not found: ${migrationPath}`);
        process.exit(1);
    }

    const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
    if (!DB_HOST || !DB_USER || !DB_NAME) {
        console.error('Missing DB env vars. Required: DB_HOST, DB_USER, DB_NAME.');
        process.exit(1);
    }

    let connection;
    try {
        const sql = fs.readFileSync(migrationPath, 'utf8');

        connection = await mysql.createConnection({
            host: DB_HOST,
            user: DB_USER,
            password: DB_PASSWORD,
            database: DB_NAME,
            multipleStatements: true
        });

        await connection.query(sql);
        console.log(`Migration applied successfully: ${migrationArg}`);
    } catch (error) {
        console.error('Failed to apply migration:', error.message);
        process.exitCode = 1;
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

main();
