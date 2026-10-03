import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import { StructuredTool } from "@langchain/core/tools";
import { BaseMessage } from "@langchain/core/messages";

interface ProviderSpec {
    name: string;
    createInstance: () => BaseChatModel;
    isConfigured: () => boolean;
}

class ModelRouter {
    private failedProviders: Map<string, number> = new Map(); // provider -> cooldown expiration
    private cooldownMs = 10 * 60 * 1000; // 10 minutes quarantine upon 429/quota exhaustion

    private providers: ProviderSpec[] = [
        {
            name: "gemini-flash",
            isConfigured: () => Boolean(process.env.GOOGLE_API_KEY),
            createInstance: () =>
                new ChatGoogleGenerativeAI({
                    model: "gemini-2.5-flash",
                    temperature: 0.1,
                    maxRetries: 0,
                }),
        },
        {
            name: "groq-llama",
            isConfigured: () => Boolean(process.env.GROQ_API_KEY),
            createInstance: () =>
                new ChatGroq({
                    apiKey: process.env.GROQ_API_KEY,
                    model: "llama-3.3-70b-versatile",
                    temperature: 0.1,
                    maxRetries: 0,
                }),
        },
        {
            name: "openrouter-backup",
            isConfigured: () => Boolean(process.env.OPENROUTER_API_KEY),
            createInstance: () =>
                new ChatOpenAI({
                    apiKey: process.env.OPENROUTER_API_KEY,
                    configuration: {
                        baseURL: "https://openrouter.ai/api/v1",
                    },
                    model: "meta-llama/llama-3.3-70b-instruct",
                    temperature: 0.1,
                    maxRetries: 0,
                }),
        },
        {
            name: "ollama-local",
            isConfigured: () => Boolean(process.env.ENABLE_LOCAL_OLLAMA === "true"),
            createInstance: () =>
                new ChatOllama({
                    baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
                    model: "qwen2.5:7b",
                    temperature: 0.1,
                }),
        },
    ];

    private isAvailable(name: string): boolean {
        const cooldownUntil = this.failedProviders.get(name);
        if (!cooldownUntil) return true;
        if (Date.now() > cooldownUntil) {
            this.failedProviders.delete(name);
            return true;
        }
        return false;
    }

    private markFailed(name: string) {
        console.warn(`[Model Router] Quota exhausted or failure on [${name}]. Quarantining for 10 minutes.`);
        this.failedProviders.set(name, Date.now() + this.cooldownMs);
    }

    /**
     * Executes an inference call, automatically routing between providers upon quota or network failure.
     */
    async routeExecution(
        messages: BaseMessage[],
        tools?: StructuredTool[]
    ) {
        const errors: string[] = [];

        for (const provider of this.providers) {
            if (!provider.isConfigured()) continue;
            if (!this.isAvailable(provider.name)) continue;

            console.log(`[Model Router] Routing request to: ${provider.name}`);

            try {
                let model = provider.createInstance();
                if (tools && tools.length > 0) {
                    if (typeof model.bindTools !== "function") {
                        throw new Error(`${provider.name} does not support tools`);
                    }
                    model = model.bindTools(tools) as unknown as BaseChatModel;
                }

                const response = await model.invoke(messages);
                return response;
            } catch (err: any) {
                const errMsg = err?.message || String(err);
                errors.push(`${provider.name}: ${errMsg}`);

                // Trip circuit breaker if quota limit or 429
                if (err.status === 429 || errMsg.includes("quota") || errMsg.includes("429")) {
                    this.markFailed(provider.name);
                } else {
                    console.error(`[Model Router] Error on ${provider.name}:`, errMsg);
                }
            }
        }

        throw new Error(
            `[Model Router] All model providers exhausted or unavailable.\nTraces:\n${errors.join("\n")}`
        );
    }
}

export const modelRouter = new ModelRouter();