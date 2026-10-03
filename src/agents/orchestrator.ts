import 'dotenv/config';
import { modelRouter } from "../gateway/modelRouter";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { AnalystState } from "../types";
import { executeQuery } from "../db/duckdbEngine";

if (!process.env.GOOGLE_API_KEY) {
    throw new Error("CRITICAL: GOOGLE_API_KEY is missing from environment variables.");
}

const getStringContent = (content: any): string => {
    if (Array.isArray(content)) {
        return content.map(block => block.text || '').join('');
    }
    return String(content || '');
};

const parseAIJson = (content: any) => {
    try {
        const text = getStringContent(content);
        const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (error) {
        console.error("AI JSON Parsing Failed:", error);
        return {}; 
    }
};

const cleanSQL = (content: any) => {
    const text = getStringContent(content);
    return text.replace(/```sql/gi, '').replace(/```/g, '').trim();
};

// Stage 1 to 7 remain exactly the same
export const dataProfilerAgent = async (filePath: string, rawSchema: string) => {
    const prompt = `You are an expert Data Engineer. Audit this dataset:\nFile: read_csv_auto('${filePath}')\nSchema: ${rawSchema}\nProvide a JSON summary with: 'totalColumns', 'columnTypes', 'potentialIssues'`;
    const response: any = await modelRouter.routeExecution([new HumanMessage(prompt)]);
    return parseAIJson(response.content);
};

export const dataCleanerAgent = async (filePath: string, profilingInfo: any) => {
    const prompt = `Based on dataset issues: ${JSON.stringify(profilingInfo)}, write a DuckDB SQL VIEW to clean nulls. Dataset source: read_csv_auto('${filePath}'). Return ONLY a single valid DuckDB SELECT query.`;
    const response: any = await modelRouter.routeExecution([new HumanMessage(prompt)]);
    return cleanSQL(response.content);
};

export const businessContextAgent = async (state: AnalystState): Promise<Partial<AnalystState>> => {
    const prompt = `You are a Lead Data Analyst. Question: ${state.businessQuestion}\nSchema: ${state.datasetSchema}\nIdentify key metrics and period comparisons required. Return JSON with 'identifiedMetrics' and 'comparisonPeriods'.`;
    const response: any = await modelRouter.routeExecution([new HumanMessage(prompt)]);
    const parsed = parseAIJson(response.content);
    return { identifiedMetrics: parsed.identifiedMetrics, comparisonPeriods: parsed.comparisonPeriods };
};

export const sqlGenerationAgent = async (state: AnalystState): Promise<Partial<AnalystState>> => {
    const prompt = `Write a DuckDB SQL query to extract: ${state.identifiedMetrics.join(", ")}. Dataset source: read_csv_auto('${state.filePath}'). Schema: ${state.datasetSchema}\nReturn ONLY valid SQL.`;
    const response: any = await modelRouter.routeExecution([new HumanMessage(prompt)]);
    return { generatedSQL: cleanSQL(response.content) };
};

export const executionAgent = async (state: AnalystState): Promise<Partial<AnalystState>> => {
    try {
        const results = await executeQuery(state.generatedSQL);
        return { queryResults: results, sqlError: null };
    } catch (error: any) {
        return { sqlError: error.message };
    }
};

export const diagnosticAgent = async (state: AnalystState): Promise<Partial<AnalystState>> => {
    const prompt = `Analyze raw dataset output: ${JSON.stringify(state.queryResults).substring(0, 2500)}\nIdentify statistical anomalies, outliers, and potential drivers. Return JSON with 'anomaliesDetected', 'segmentedData', and 'possibleCauses'.`;
    const response: any = await modelRouter.routeExecution([new HumanMessage(prompt)]);
    return parseAIJson(response.content);
};

export const synthesisAgent = async (state: AnalystState): Promise<Partial<AnalystState>> => {
    const prompt = `Synthesize an executive analyst report for: "${state.businessQuestion}"\nMetrics: ${state.identifiedMetrics.join(", ")}\nAnomalies: ${JSON.stringify(state.anomaliesDetected)}\nReturn JSON strictly matching this structure: { "executiveSummary": "string", "recommendations": ["string"], "chartConfigs": [ { "type": "BarChart", "title": "string", "description": "string", "xAxisKey": "string", "data": [{"key": "value"}], "series": [{"dataKey": "string", "name": "string", "fill": "#color"}] } ] }`;
    const response: any = await modelRouter.routeExecution([new HumanMessage(prompt)]);
    const parsed = parseAIJson(response.content);
    return { executiveSummary: parsed.executiveSummary || parsed.summary || '', recommendations: parsed.recommendations || [], chartConfigs: parsed.chartConfigs || [] };
};

// SQL Tool Factory for the Chatbot
const buildAnalyticsTools = (filePath: string) => [
    new DynamicStructuredTool({
        name: "execute_duckdb_sql",
        description: "Execute a DuckDB SQL query against the dataset.",
        schema: z.object({ query: z.string().describe("A valid DuckDB SQL query") }),
        func: async ({ query }) => {
            // Self-correcting safety replace in case the LLM hallucinates a table name
            let datasetQuery = query;
            if (!datasetQuery.toLowerCase().includes('read_csv_auto')) {
                datasetQuery = datasetQuery.replace(/from \w+/i, `FROM read_csv_auto('${filePath}')`);
            }
            try {
                const result = await executeQuery(datasetQuery);
                return JSON.stringify(result);
            } catch (e: any) {
                return `SQL Error: ${e.message}. Fix your syntax and try again.`;
            }
        }
    })
];

// Stage 8: Real-Time Interactive Follow-Up Support
export const interactiveFollowupAgent = async (
    userQuery: string, 
    filePath: string, 
    schema: string, 
    chatHistory: Array<{ role: string; message: string }>
) => {
    let sampleData = "";
    try {
        sampleData = JSON.stringify(await executeQuery(`SELECT * FROM read_csv_auto('${filePath}') LIMIT 3`));
    } catch (e) {
        sampleData = "Unavailable";
    }

    const analyticsTools = buildAnalyticsTools(filePath);

    // 🧠 Enhanced System Prompt: Explicitly teaching the AI how to analyze
    const systemPrompt = new SystemMessage(`
        You are an elite Senior Data Analyst AI assistant.
        Target Dataset: read_csv_auto('${filePath}')
        Exact Schema: ${schema}
        Data Sample (First 3 rows): ${sampleData}

        CRITICAL WORKFLOW RULES:
        1. YOU MUST NEVER GUESS DATA. Call the 'execute_duckdb_sql' tool to find the exact answer.
        2. FOR ANALYTICAL QUESTIONS (e.g., "top items", "underperforming"): You MUST write SQL that aggregates the data. 
           - Use COUNT(), SUM(), AVG(), and GROUP BY.
           - Use ORDER BY and LIMIT 10 to find top/bottom performers.
           - NEVER just SELECT * for analytical questions.
        3. If the tool returns a warning that results were truncated, your SQL was too broad. Rewrite it using strict aggregations and a LIMIT.
        4. Once the tool returns the specific aggregated data, stop calling tools and provide your final human-readable answer in Markdown.
    `);

    let messages: any[] = [
        systemPrompt,
        ...chatHistory.slice(-4).map(msg => msg.role === 'user' ? new HumanMessage(msg.message) : new AIMessage(msg.message)),
        new HumanMessage(userQuery)
    ];

    // 🚀 Increased from 4 to 10 to give the AI enough turns to correct bad SQL
    let maxLoops = 10; 
    let lastQueryData = null; 

    const MAX_TOOL_PAYLOAD = 20000; 

    try {
        while (maxLoops > 0) {
            console.log(`\n[Chat Agent Loop] Loops remaining: ${maxLoops}`);

            const sanitizedMessages = messages.map(m => {
                if (m._getType() === "ai") {
                    if (Array.isArray(m.content)) m.content = m.content.map((c: any) => c.text || '').join('');
                    if (!m.content) m.content = ""; 
                }
                return m;
            });

            const response: any = await modelRouter.routeExecution(sanitizedMessages, analyticsTools);
            messages.push(response);

            if (response.tool_calls && response.tool_calls.length > 0) {
                for (const [toolCallIndex, toolCall] of response.tool_calls.entries()) {
                    const tool = analyticsTools.find(t => t.name === toolCall.name);
                    
                    if (tool) {
                        console.log(`[Chat Action] Triggering Tool: ${toolCall.name}`);
                        const rawToolResult = await tool.func(toolCall.args as any);
                        
                        if (toolCall.name === 'execute_duckdb_sql') {
                            try { lastQueryData = JSON.parse(rawToolResult as string); } catch(e) {}
                        }

                        let toolResultString = typeof rawToolResult === "string" ? rawToolResult : JSON.stringify(rawToolResult);
                        
                        if (toolResultString.length > MAX_TOOL_PAYLOAD) {
                            console.warn(`[Payload Guard] Truncating response. Original size: ${toolResultString.length} chars.`);
                            toolResultString = toolResultString.substring(0, MAX_TOOL_PAYLOAD) + `\n\n... [SYSTEM WARNING: Results truncated because the output exceeded API limits. You MUST rewrite your SQL using aggregations (COUNT, SUM), stronger WHERE filters, or a LIMIT clause.]`;
                        }

                        messages.push(new ToolMessage({
                            tool_call_id: toolCall.id ?? `${toolCall.name}-${toolCallIndex}`,
                            name: toolCall.name,
                            content: toolResultString
                        }));
                    }
                }
            } else {
                let finalAnswerText = response.content;
                if (Array.isArray(finalAnswerText)) {
                    finalAnswerText = finalAnswerText.map((b: any) => b.text || '').join('');
                }

                return {
                    answer: finalAnswerText || "I processed the data but couldn't format the response cleanly.",
                    data: lastQueryData,
                    chart: null
                };
            }
            maxLoops--;
        }

        return {
            answer: "I checked the database but the query results were too large or complex to extract in one go. Could you ask for a more specific metric or limit?",
            data: lastQueryData,
            chart: null
        };
        
    } catch (error) {
        console.error("Chat Agent Network/Fetch Error:", error);
        return {
            answer: "All AI providers are currently exhausted or unavailable. Please try again in a few moments.",
            data: null,
            chart: null
        };
    }
};