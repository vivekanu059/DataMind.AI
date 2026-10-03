import 'dotenv/config';
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import { StructuredTool } from "@langchain/core/tools";
import { BaseMessage } from "@langchain/core/messages";

export class QuotaExhaustedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "QuotaExhaustedError";
    }
}

interface ProviderSpec {
    name: string;
    createInstance: () => BaseChatModel;
    isConfigured: () => boolean;
}

class ModelRouter {
    private failedProviders: Map<string, number> = new Map(); 
    private cooldownMs = 10 * 60 * 1000; // 10-minute penalty box for rate-limited (429) models

    private providers: ProviderSpec[] = [
        {
            name: "gemini-model",
            isConfigured: () => Boolean(process.env.GOOGLE_API_KEY),
            createInstance: () =>
                new ChatGoogleGenerativeAI({
                    apiKey: process.env.GOOGLE_API_KEY,
                    model: "gemini-3.1-pro-preview",
                    temperature: 0.1,
                    maxOutputTokens: 8192,
                    maxRetries: 0,
                }),
        },
        {
            name: "groq-llama",
            isConfigured: () => Boolean(process.env.GROQ_API_KEY),
            createInstance: () =>
                new ChatGroq({
                    apiKey: process.env.GROQ_API_KEY,
                    model: "openai/gpt-oss-120b",
                    temperature: 0.1,
                    maxTokens: 4096,
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
                    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
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
                    model: "gpt-oss:20b",
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
        console.warn(`[Model Router] Quota exhausted or rate-limited on [${name}]. Quarantining for 10 minutes.`);
        this.failedProviders.set(name, Date.now() + this.cooldownMs);
    }

    async routeExecution(messages: BaseMessage[], tools?: StructuredTool[]) {
        const errors: string[] = [];

        for (const provider of this.providers) {
            if (!provider.isConfigured()) {
                console.log(`[Model Router] Skipping [${provider.name}]: API key not present in environment variables.`);
                continue;
            }
            if (!this.isAvailable(provider.name)) {
                console.log(`[Model Router] Skipping [${provider.name}]: Provider is in 10-minute cooldown.`);
                continue;
            }

            console.log(`[Model Router] Executing request using: ${provider.name}`);

            try {
                let model = provider.createInstance();
                if (tools && tools.length > 0) {
                    if (typeof model.bindTools !== "function") {
                        throw new Error(`${provider.name} does not support tool binding.`);
                    }
                    model = model.bindTools(tools) as unknown as BaseChatModel;
                }

                return await model.invoke(messages);
            } catch (err: any) {
                const errMsg = err?.message || String(err);
                errors.push(`${provider.name}: ${errMsg}`);

                // Only quarantine if the provider hit an actual HTTP 429 or quota limit
                const isRateLimit = err?.status === 429 || 
                                   errMsg.toLowerCase().includes("quota") || 
                                   errMsg.toLowerCase().includes("rate limit") || 
                                   errMsg.includes("429");

                if (isRateLimit) {
                    this.markFailed(provider.name);
                } else {
                    console.error(`[Model Router] Error executing on ${provider.name}:`, errMsg);
                }
            }
        }

        throw new QuotaExhaustedError(
            `All configured AI model providers failed or are unavailable.\nTraces:\n${errors.join("\n")}`
        );
    }
}

export const modelRouter = new ModelRouter();