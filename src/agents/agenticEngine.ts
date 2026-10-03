import { modelRouter } from "../gateway/modelRouter";
import { buildAnalyticsTools } from "./tools";
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";

export const runAutonomousAnalyst = async (
    objective: string, 
    fileLocation: string, 
    chatHistory: Array<{ role: string; content: string }> = []
) => {
    const analyticsTools = buildAnalyticsTools(fileLocation);

    const systemPrompt = new SystemMessage(`
        You are an autonomous Senior Data Analyst. You have direct access to DuckDB analytics tools connected to the user's CSV dataset.
        
        YOUR WORKFLOW:
        1. Examine the dataset schema using 'get_dataset_schema' or query sample rows to understand exact column names, date formats, and casing.
        2. Execute DuckDB SQL queries using 'execute_duckdb_sql' to investigate every aspect required by the user's objective.
           - Query the data using: FROM read_csv_auto('${fileLocation}')
           - Run separate, targeted SQL queries for each metric, distribution, or chart needed.
           - Never invent data. All numbers, rankings, anomalies, and insights MUST come directly from query results.
        3. Once you have retrieved the necessary data from the dataset, provide your comprehensive, final response matching the exact requested format.
    `);

    let messages: any[] = [
        systemPrompt,
        ...chatHistory.map(msg => msg.role === 'user' ? new HumanMessage(msg.content) : new AIMessage(msg.content)),
        new HumanMessage(objective)
    ];

    // Increased to 20 to allow multi-chart and multi-query investigation without hitting limits
    let maxLoops = 20; 

    while (maxLoops > 0) {
        console.log(`\n[Agent Loop] Loops remaining: ${maxLoops}`);

        // Sanitize historical AI messages to prevent 400 errors across providers
        const sanitizedMessages = messages.map(m => {
            if (m._getType() === "ai") {
                if (Array.isArray(m.content)) {
                    m.content = m.content.map((c: any) => c.text || '').join('');
                }
                if (m.content === null || m.content === undefined) {
                    m.content = ""; 
                }
            }
            return m;
        });

        // Nudge the model to wrap up when running low on loops
        if (maxLoops === 2) {
            sanitizedMessages.push(new HumanMessage(
                "You have executed your investigation queries. Now compile all your findings into the final requested output format."
            ));
        }

        let response: any = await modelRouter.routeExecution(sanitizedMessages, analyticsTools);
        messages.push(response);

        if (response.tool_calls && response.tool_calls.length > 0) {
            for (const [toolCallIndex, toolCall] of response.tool_calls.entries()) {
                const tool = analyticsTools.find(t => t.name === toolCall.name);
                
                if (tool) {
                    console.log(`[Agent Action] Triggering Tool: ${toolCall.name}`);
                    try {
                        const rawToolResult = await tool.func(toolCall.args as any);
                        const toolResult = typeof rawToolResult === "string" ? rawToolResult : JSON.stringify(rawToolResult);
                        
                        messages.push(new ToolMessage({
                            tool_call_id: toolCall.id ?? `\({toolCall.name}-\){toolCallIndex}`,
                            name: toolCall.name,
                            content: toolResult
                        }));
                    } catch (error: any) {
                        messages.push(new ToolMessage({
                            tool_call_id: toolCall.id ?? `\({toolCall.name}-\){toolCallIndex}`,
                            name: toolCall.name,
                            content: `Error executing tool: ${error.message}`
                        }));
                    }
                }
            }
        } else {
            return {
                finalAnswer: response.content,
                agentTrace: messages.map(m => ({ role: m._getType(), content: m.content }))
            };
        }
        maxLoops--;
    }

    // Graceful fallback: If loops run out, compile the final answer using real query results already collected
    console.log("\n[Agent Loop] Max loops reached. Synthesizing final answer from collected dataset queries...");
    const finalSanitized = messages.map(m => {
        if (m._getType() === "ai") {
            if (Array.isArray(m.content)) {
                m.content = m.content.map((c: any) => c.text || '').join('');
            }
            if (m.content === null || m.content === undefined) {
                m.content = ""; 
            }
        }
        return m;
    });

    finalSanitized.push(new HumanMessage(
        "Based on all the queries executed above on the dataset, provide the final response strictly matching the requested format. Do not call any more tools."
    ));

    const finalFallback: any = await modelRouter.routeExecution(finalSanitized);
    return {
        finalAnswer: finalFallback.content,
        agentTrace: messages.map(m => ({ role: m._getType(), content: m.content }))
    };
};