const { VertexAI } = require('@google-cloud/vertexai');
const fs = require('fs');

class ModelClient {
    constructor(config) {
        this.config = config;
        this.vertexAI = new VertexAI({
            project: config.PROJECT_ID,
            location: config.LOCATION
        });
        this.model = this.vertexAI.getGenerativeModel({
            model: config.MODEL_NAME,
        });
    }

    async getBatchTranslation(batchLines) {
        const batchText = batchLines.map(line => line.original_text).join('\n');
        const prompt = `de-en |${batchText}|`;
        
        try {
            const request = {
                contents: [{
                    role: 'user',
                    parts: [{ text: prompt }]
                }],
                generationConfig: this.config.MODEL_CONFIG,
                safetySettings: this.config.SAFETY_SETTINGS
            };

            const result = await this.model.generateContent(request);
            return result.response.candidates[0].content.parts[0].text;
            
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

module.exports = ModelClient;