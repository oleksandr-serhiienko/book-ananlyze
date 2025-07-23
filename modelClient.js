import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

class ModelClient {
    constructor(config) {
        this.config = config;
        this.ai = new GoogleGenAI({
            vertexai: true,
            project: config.PROJECT_ID,
            location: config.LOCATION
        });
        this.model = config.MODEL_ENDPOINT;
        this.generationConfig = config.GENERATION_CONFIG;
    }

    async getBatchTranslation(batchLines) {
        const numberedLines = batchLines.map((line, index) => 
            `${index + 1}. ${line.original_text}`
        ).join('\n');
        
        const prompt = `Translate the following German text to English. Return one JSON object per line in this exact format: {"original": "German text", "translated": "English text"}

German text to translate:
${numberedLines}

Return ${batchLines.length} JSON objects, one per line, in the same order:`;
        
        try {
            const chat = this.ai.chats.create({
                model: this.model,
                config: this.generationConfig
            });

            const message = { text: prompt };
            const response = await chat.sendMessage({ message: [message] });
            
            // Handle streaming response
            let fullResponse = '';
            if (response.text) {
                fullResponse = response.text;
            } else {
                // Handle stream if needed
                for await (const chunk of response) {
                    if (chunk.text) {
                        fullResponse += chunk.text;
                    }
                }
            }
            
            return fullResponse;
            
        } catch (error) {
            throw error;
        }
    }

    logSuccessfulResponse(batchLines, rawResponse, logFile) {
        const logEntry = {
            batch_size: batchLines.length,
            timestamp: new Date().toISOString(),
            raw_response: rawResponse
        };
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n', 'utf8');
    }

    logError(chapterId, lineNum, originalLine, reason, rawOutputData = "", parseErrorsList = null, logFile) {
        let errorMessage = `Chapter: ${chapterId}, LineNum: ${lineNum}\nOriginalLine: ${originalLine.substring(0, 100)}...\nReason: ${reason}\n`;
        if (parseErrorsList) {
            errorMessage += `Parse Errors: ${parseErrorsList.join('; ')}\n`;
        }
        if (rawOutputData) {
            errorMessage += `Raw Model Output:\n${rawOutputData}\n`;
        }
        errorMessage += "-".repeat(30) + "\n";
        fs.appendFileSync(logFile, errorMessage, 'utf8');
    }

    async delay(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }
}

export default ModelClient;