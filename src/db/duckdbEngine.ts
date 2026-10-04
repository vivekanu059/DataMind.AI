// src/db/duckdbEngine.ts
import duckdb from 'duckdb';

const db = new duckdb.Database(':memory:');
const connection = db.connect();

// 🛡️ Load the HTTP extension so DuckDB can read remote Cloud/S3 URLs directly
connection.exec(`
    INSTALL httpfs;
    LOAD httpfs;
`, (err) => {
    if (err) {
        console.error("Failed to load DuckDB httpfs extension:", err);
    } else {
        console.log("DuckDB httpfs extension loaded successfully.");
    }
});

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
    // Because of httpfs, filePath can now safely be a public https:// URL
    const query = `DESCRIBE SELECT * FROM read_csv_auto('${filePath}')`;
    const schema = await executeQuery(query);
    return JSON.stringify(schema);
};