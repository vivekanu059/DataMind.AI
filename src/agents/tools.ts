import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { executeQuery } from "../db/duckdbEngine";

export const buildAnalyticsTools = (fileLocation: string) => {
    const executeSqlTool = new DynamicStructuredTool({
        name: "execute_duckdb_sql",
        description: "Execute a DuckDB SQL query against the target dataset.",
        schema: z.object({ query: z.string().describe("A valid DuckDB SQL query") }),
        func: async ({ query }) => {
            let safeQuery = query.replace(/read_csv_auto\s*\([^)]*\)/gi, `read_csv_auto('${fileLocation}')`);
            
            try {
                const result = await executeQuery(safeQuery);
                
                // 🛑 Hard stop to prevent token explosion and API crashes
                if (Array.isArray(result) && result.length > 25) {
                    const truncated = result.slice(0, 25);
                    return JSON.stringify(truncated) + `\n\n[CRITICAL WARNING: Result was massive (${result.length} rows). Truncated to 25 rows to prevent token exhaustion. You MUST rewrite your SQL to use COUNT(), SUM(), AVG(), GROUP BY, or strict WHERE conditions.]`;
                }

                // Backup safeguard: If the data is stringified and still massively wide
                const stringResult = JSON.stringify(result);
                if (stringResult.length > 15000) {
                     return stringResult.substring(0, 15000) + `... [STRING TRUNCATED due to memory limits. Select fewer columns.]`;
                }

                return stringResult;
            } catch (e: any) {
                return `SQL Error: ${e.message}. Fix your syntax and try again.`;
            }
        }
    });

    const getDatasetSchemaTool = new DynamicStructuredTool({
        name: "get_dataset_schema",
        description: "Retrieve the column names and data types of the dataset.",
        schema: z.object({}), 
        func: async () => {
            try {
                const query = `DESCRIBE SELECT * FROM read_csv_auto('${fileLocation}')`;
                const results = await executeQuery(query);
                return JSON.stringify(results);
            } catch (error: any) {
                return `Error reading schema: ${error.message}`;
            }
        },
    });

    return [getDatasetSchemaTool, executeSqlTool];
};