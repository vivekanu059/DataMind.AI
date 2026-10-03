// src/db/duckdbEngine.ts
import duckdb from 'duckdb';

const db = new duckdb.Database(':memory:');
const connection = db.connect();

// Global serialization patch for BigInt
(BigInt.prototype as any).toJSON = function () {
    return Number(this);
};

export const executeQuery = (sql: string): Promise<any[]> => {
    return new Promise((resolve, reject) => {
        connection.all(sql, (err, res) => {
            if (err) {
                reject(err);
            } else {
                // Convert any native BigInt fields returned by DuckDB into standard Numbers
                const sanitizedResults = JSON.parse(
                    JSON.stringify(res, (_, value) =>
                        typeof value === 'bigint' ? Number(value) : value
                    )
                );
                resolve(sanitizedResults);
            }
        });
    });
};

export const getSchema = async (filePath: string): Promise<string> => {
    const query = `DESCRIBE SELECT * FROM read_csv_auto('${filePath}')`;
    const schema = await executeQuery(query);
    return JSON.stringify(schema);
};