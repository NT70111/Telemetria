const { DatabaseSync } = require('node:sqlite');

const WINDOW_SIZE = 3600;

class TrendStore {
    constructor(databasePath) {
        this.database = new DatabaseSync(databasePath);
        this.lastValues = new Map();
        this.trends = new Map();
        this.database.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;

            CREATE TABLE IF NOT EXISTS trend_archive (
                archive_id INTEGER PRIMARY KEY AUTOINCREMENT,
                trend_id TEXT NOT NULL,
                source TEXT NOT NULL,
                object_id INTEGER NOT NULL,
                object_name TEXT NOT NULL,
                value_json TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                archived_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS valid (
                object_id INTEGER PRIMARY KEY,
                object_name TEXT NOT NULL,
                type TEXT NOT NULL,
                value_json TEXT NOT NULL,
                recorded_at TEXT NOT NULL
            );
        `);

        this.upsertValidValue = this.database.prepare(`
            INSERT INTO valid (object_id, object_name, type, value_json, recorded_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(object_id) DO UPDATE SET
                object_name = excluded.object_name,
                type = excluded.type,
                value_json = excluded.value_json,
                recorded_at = excluded.recorded_at
        `);
        this.insertArchive = this.database.prepare(`
            INSERT INTO trend_archive (
                trend_id, source, object_id, object_name, value_json,
                recorded_at, archived_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
    }

    getTableName(trend) {
        if (
            !trend ||
            typeof trend.source !== 'string' ||
            !/^[A-Za-z0-9_]+$/.test(trend.source) ||
            !Number.isSafeInteger(trend.objectId) ||
            trend.trendId !== `${trend.source}:${trend.objectId}`
        ) {
            throw new TypeError('Invalid trend identity');
        }

        return `trend_${trend.source}_${trend.objectId}`;
    }

    registerTrend(trend) {
        const tableName = this.getTableName(trend);
        if (this.trends.has(trend.trendId)) {
            return tableName;
        }

        const table = `"${tableName}"`;
        this.database.exec(`
            CREATE TABLE IF NOT EXISTS ${table} (
                record_id INTEGER PRIMARY KEY AUTOINCREMENT,
                object_id INTEGER NOT NULL,
                object_name TEXT NOT NULL,
                value_json TEXT NOT NULL,
                recorded_at TEXT NOT NULL
            );
        `);

        const statements = {
            insert: this.database.prepare(`
                INSERT OR IGNORE INTO ${table} (
                    record_id, object_id, object_name, value_json, recorded_at
                ) VALUES (?, ?, ?, ?, ?)
            `),
            count: this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`),
            overflow: this.database.prepare(`
                SELECT record_id, object_id, object_name, value_json, recorded_at
                FROM ${table}
                ORDER BY record_id
                LIMIT ?
            `),
            delete: this.database.prepare(`
                DELETE FROM ${table}
                WHERE record_id = ?
            `),
            latest: this.database.prepare(`
                SELECT value_json
                FROM ${table}
                ORDER BY record_id DESC
                LIMIT 1
            `)
        };
        this.trends.set(trend.trendId, { trend, ...statements });

        const registeredTrend = this.trends.get(trend.trendId);
        this.database.exec('BEGIN IMMEDIATE');
        try {
            this.archiveOverflow(registeredTrend);
            this.database.exec('COMMIT');
        } catch (error) {
            try {
                this.database.exec('ROLLBACK');
            } catch (rollbackError) {
                throw new AggregateError(
                    [error, rollbackError],
                    `Failed to register trend ${trend.trendId} and roll back`
                );
            }
            this.trends.delete(trend.trendId);
            throw error;
        }

        const latest = statements.latest.get();
        if (latest) {
            this.lastValues.set(trend.trendId, JSON.parse(latest.value_json));
        }

        return tableName;
    }

    upsertValidBatch(objects) {
        if (objects.length === 0) {
            return;
        }

        this.database.exec('BEGIN IMMEDIATE');
        try {
            for (const object of objects) {
                this.upsertValidValue.run(
                    object.id,
                    object.name,
                    object.type,
                    JSON.stringify(object.value),
                    new Date().toISOString()
                );
            }
            this.database.exec('COMMIT');
        } catch (error) {
            try {
                this.database.exec('ROLLBACK');
            } catch (rollbackError) {
                throw new AggregateError(
                    [error, rollbackError],
                    'Failed to store valid values and roll back the transaction'
                );
            }
            throw error;
        }
    }

    archiveOverflow(trendStatements) {
        const currentCount = trendStatements.count.get().count;
        if (currentCount <= WINDOW_SIZE) {
            return;
        }

        const overflow = trendStatements.overflow.all(currentCount - WINDOW_SIZE);
        const archivedAt = new Date().toISOString();

        for (const record of overflow) {
            this.insertArchive.run(
                trendStatements.trend.trendId,
                trendStatements.trend.source,
                record.object_id,
                record.object_name,
                record.value_json,
                record.recorded_at,
                archivedAt
            );
            trendStatements.delete.run(record.record_id);
        }
    }

    append(trend, value) {
        const trendStatements = this.trends.get(trend.trendId);
        if (!trendStatements) {
            throw new Error(`Trend ${trend.trendId} has not been registered`);
        }

        this.database.exec('BEGIN IMMEDIATE');
        try {
            trendStatements.insert.run(
                null,
                trend.objectId,
                trend.objectName,
                JSON.stringify(value),
                new Date().toISOString()
            );
            this.archiveOverflow(trendStatements);
            this.database.exec('COMMIT');
        } catch (error) {
            try {
                this.database.exec('ROLLBACK');
            } catch (rollbackError) {
                throw new AggregateError(
                    [error, rollbackError],
                    `Failed to store trend ${trend.trendId} and roll back`
                );
            }
            throw error;
        }
    }

    appendIfChanged(trend, value) {
        if (!this.trends.has(trend.trendId)) {
            throw new Error(`Trend ${trend.trendId} has not been registered`);
        }
        if (
            this.lastValues.has(trend.trendId) &&
            Object.is(this.lastValues.get(trend.trendId), value)
        ) {
            return false;
        }

        this.append(trend, value);
        this.lastValues.set(trend.trendId, value);
        return true;
    }

    close() {
        this.database.close();
    }
}

module.exports = { TrendStore, WINDOW_SIZE };
