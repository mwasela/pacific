-- Migration: Add Transaction pagination/filter indexes
-- Date: 2026-04-21
-- Target DB: MySQL
--
-- This script is idempotent: it checks information_schema before creating each index.
-- It assumes the Sequelize default table name: Transactions.

SET @schema_name = DATABASE();

-- 1) createdAt + id (default keyset pagination)
SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1
            FROM information_schema.statistics
            WHERE table_schema = @schema_name
              AND table_name = 'Transactions'
              AND index_name = 'idx_transactions_createdat_id'
        ),
        'SELECT ''idx_transactions_createdat_id already exists'' AS message',
        'CREATE INDEX idx_transactions_createdat_id ON Transactions (createdAt, id)'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Transaction_timestamp + id (alternate keyset pagination)
SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1
            FROM information_schema.statistics
            WHERE table_schema = @schema_name
              AND table_name = 'Transactions'
              AND index_name = 'idx_transactions_trx_timestamp_id'
        ),
        'SELECT ''idx_transactions_trx_timestamp_id already exists'' AS message',
        'CREATE INDEX idx_transactions_trx_timestamp_id ON Transactions (Transaction_timestamp, id)'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) status + createdAt + id (status filter + pagination)
SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1
            FROM information_schema.statistics
            WHERE table_schema = @schema_name
              AND table_name = 'Transactions'
              AND index_name = 'idx_transactions_status_createdat_id'
        ),
        'SELECT ''idx_transactions_status_createdat_id already exists'' AS message',
        'CREATE INDEX idx_transactions_status_createdat_id ON Transactions (status, createdAt, id)'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4) visit_id (join optimization)
SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1
            FROM information_schema.statistics
            WHERE table_schema = @schema_name
              AND table_name = 'Transactions'
              AND index_name = 'idx_transactions_visit_id'
        ),
        'SELECT ''idx_transactions_visit_id already exists'' AS message',
        'CREATE INDEX idx_transactions_visit_id ON Transactions (visit_id)'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Optional rollback statements (manual):
-- DROP INDEX idx_transactions_createdat_id ON Transactions;
-- DROP INDEX idx_transactions_trx_timestamp_id ON Transactions;
-- DROP INDEX idx_transactions_status_createdat_id ON Transactions;
-- DROP INDEX idx_transactions_visit_id ON Transactions;
