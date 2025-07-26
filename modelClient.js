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
        this.sourceLanguage = config.DEFAULT_SOURCE_LANGUAGE || 'German';
        this.targetLanguage = config.DEFAULT_TARGET_LANGUAGE || 'English';
    }

    setLanguagePair(sourceLanguage, targetLanguage) {
        this.sourceLanguage = sourceLanguage;
        this.targetLanguage = targetLanguage;
    }

    async getSingleTranslation(lineData) {
        const prompt = `Translate the following ${this.sourceLanguage} text to ${this.targetLanguage}. Return one JSON object in this exact format: {"original": "${this.sourceLanguage} text", "translated": "${this.targetLanguage} text"}

${this.sourceLanguage} text to translate:
${lineData.original_text}

Return one JSON object:`;
        
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

    logSuccessfulResponse(lineDataArray, rawResponse, logFile) {
        const logEntry = {
            line_count: lineDataArray.length,
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