import fs from 'fs';
import path from 'path';
import { getLanguageCode } from './constants.js';

class BatchSentenceProcessor {
    constructor() {
        this.isProcessing = false;
        
        // Create timestamped file paths
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.outputFile = `logs/batchSent/batch_output_${timestamp}.jsonl`;
        this.processedCount = 0;
        this.successCount = 0;
    }

    readUserSettings() {
        try {
            const settingsContent = fs.readFileSync('userSettings.json', 'utf8');
            const settings = JSON.parse(settingsContent);
            return settings.batchProcessing || settings.sentenceProcessing || settings.wordProcessing || {};
        } catch (error) {
            console.warn('Could not read user settings, using defaults');
            return { sourceLanguage: 'German', targetLanguage: 'English' };
        }
    }

    saveLanguageSettings(sourceLanguage, targetLanguage) {
        try {
            let settings;
            try {
                const settingsContent = fs.readFileSync('userSettings.json', 'utf8');
                settings = JSON.parse(settingsContent);
            } catch (error) {
                // If file doesn't exist or is invalid, create new structure
                settings = {
                    sentenceProcessing: {},
                    wordProcessing: {},
                    epubProcessing: {},
                    batchProcessing: {}
                };
            }

            // Ensure batchProcessing section exists
            if (!settings.batchProcessing) {
                settings.batchProcessing = {};
            }

            // Update batch processing language settings
            settings.batchProcessing.sourceLanguage = sourceLanguage;
            settings.batchProcessing.targetLanguage = targetLanguage;

            // Save updated settings
            fs.writeFileSync('userSettings.json', JSON.stringify(settings, null, 2), 'utf8');
            console.log(`Saved batch language settings: ${sourceLanguage} -> ${targetLanguage}`);
        } catch (error) {
            console.warn('Could not save language settings:', error.message);
        }
    }

    async initialize() {
        // Ensure directories exist
        fs.mkdirSync('logs/batchSent', { recursive: true });
        
        // Initialize output file
        fs.writeFileSync(this.outputFile, '', 'utf8');
    }

    stop() {
        this.isProcessing = false;
    }

    async processBatchFile(filePath, sourceLanguage = null, targetLanguage = null) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        await this.initialize();
        
        // Use provided languages or fall back to user settings
        let finalSourceLanguage = sourceLanguage;
        let finalTargetLanguage = targetLanguage;
        
        if (!finalSourceLanguage || !finalTargetLanguage) {
            const userSettings = this.readUserSettings();
            finalSourceLanguage = finalSourceLanguage || userSettings.sourceLanguage || 'German';
            finalTargetLanguage = finalTargetLanguage || userSettings.targetLanguage || 'English';
        }

        // Save the language settings for future use
        this.saveLanguageSettings(finalSourceLanguage, finalTargetLanguage);
        const sourceCode = getLanguageCode(finalSourceLanguage);
        const targetCode = getLanguageCode(finalTargetLanguage);
        const languagePair = `${sourceCode}-${targetCode}`;
        
        console.log(`Starting batch conversion for: ${filePath}`);
        console.log(`Using language pair: ${languagePair} (${finalSourceLanguage} -> ${finalTargetLanguage})`);
        
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
        
        console.log(`Found ${lines.length} lines to convert`);
        
        this.isProcessing = true;
        this.processedCount = 0;
        this.successCount = 0;

        for (let i = 0; i < lines.length && this.isProcessing; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            
            // Create JSONL entry matching test.jsonl format
            const jsonlEntry = {
                request: {
                    contents: [{
                        role: "user",
                        parts: [{
                            text: `${languagePair} |${line}|`
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.2
                    }
                }
            };
            
            fs.appendFileSync(this.outputFile, JSON.stringify(jsonlEntry) + '\n', 'utf8');
            this.successCount++;
            this.processedCount++;
        }

        const finalStats = {
            total_lines: lines.length,
            processed: this.processedCount,
            successful: this.successCount,
            failed: 0,
            success_rate: '100.00%',
            output_file: this.outputFile
        };

        console.log('\nBatch Conversion Complete:');
        console.log(`Total lines: ${finalStats.total_lines}`);
        console.log(`Processed: ${finalStats.processed}`);
        console.log(`Output file: ${finalStats.output_file}`);

        return finalStats;
    }


    getStats() {
        return {
            processed: this.processedCount,
            successful: this.successCount,
            failed: this.errorCount,
            isProcessing: this.isProcessing
        };
    }
}

export default BatchSentenceProcessor;