const fs = require('fs');
const config = require('./config');
const TextProcessor = require('./textProcessor');
const SQLGenerator = require('./sqlGenerator');
const ModelClient = require('./modelClient');

class SentenceProcessor {
    constructor() {
        this.textProcessor = new TextProcessor();
        this.sqlGenerator = new SQLGenerator();
        this.modelClient = new ModelClient(config);
        this.isProcessing = false;
    }

    async initialize() {
        this.sqlGenerator.initializeSchema();
        
        // Initialize log files
        fs.writeFileSync(config.ERROR_LOG_FILE_SENTENCES, `Line Processing Error Log - Run: ${new Date().toString()}\n${"=".repeat(40)}\n`, 'utf8');
        fs.writeFileSync(config.SUCCESSFUL_RAW_MODEL_RESPONSE_LOG_SENTENCES, `# Raw Model Responses (Lines) - Run: ${new Date().toString()}\n`, 'utf8');
    }

    stop() {
        this.isProcessing = false;
    }

    async processBatchLines(batchLines) {
        const results = [];
        
        for (let attempt = 1; attempt <= config.MAX_RETRIES_SENTENCE; attempt++) {
            console.log(`  Processing batch of ${batchLines.length} lines (attempt ${attempt}/${config.MAX_RETRIES_SENTENCE})`);
            
            try {
                const rawModelResponse = await this.modelClient.getBatchTranslation(batchLines);
                
                if (!rawModelResponse || !rawModelResponse.trim()) {
                    console.log(`    No content from batch model on attempt ${attempt}.`);
                    if (attempt < config.MAX_RETRIES_SENTENCE) {
                        await this.modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE);
                        continue;
                    } else {
                        for (const lineData of batchLines) {
                            this.modelClient.logError(lineData.chapter_id, lineData.line_number, lineData.original_text, "No content from model after max retries.", rawModelResponse, null, config.ERROR_LOG_FILE_SENTENCES);
                            this.sqlGenerator.addFailedLineSQL(lineData.chapter_id, lineData.line_number, lineData.original_text, "No content from model after max retries.", rawModelResponse);
                            results.push(false);
                        }
                        return results;
                    }
                }

                this.modelClient.logSuccessfulResponse(batchLines, rawModelResponse, config.SUCCESSFUL_RAW_MODEL_RESPONSE_LOG_SENTENCES);

                const responseLines = rawModelResponse.split('\n').filter(line => line.trim());
                
                for (let i = 0; i < batchLines.length; i++) {
                    const lineData = batchLines[i];
                    const responseLine = responseLines[i] || null;
                    
                    if (!responseLine) {
                        this.modelClient.logError(lineData.chapter_id, lineData.line_number, lineData.original_text, "No response for this line in batch", rawModelResponse, null, config.ERROR_LOG_FILE_SENTENCES);
                        this.sqlGenerator.addFailedLineSQL(lineData.chapter_id, lineData.line_number, lineData.original_text, "No response for this line in batch", rawModelResponse);
                        results.push(false);
                        continue;
                    }

                    const [germanAnnotated, englishAnnotated, parseErrors] = this.textProcessor.parseTranslationResponse(responseLine);
                    
                    if (germanAnnotated !== null && englishAnnotated !== null) {
                        this.sqlGenerator.addSuccessfulLineSQL(lineData.chapter_id, lineData.line_number, lineData.original_text, germanAnnotated, englishAnnotated, parseErrors);
                        console.log(`    Successfully processed C${lineData.chapter_id}_S${lineData.line_number}.`);
                        results.push(true);
                    } else {
                        this.modelClient.logError(lineData.chapter_id, lineData.line_number, lineData.original_text, "Failed to parse line response", responseLine, parseErrors, config.ERROR_LOG_FILE_SENTENCES);
                        this.sqlGenerator.addFailedLineSQL(lineData.chapter_id, lineData.line_number, lineData.original_text, parseErrors.join('; '), responseLine);
                        results.push(false);
                    }
                }
                
                return results;
                
            } catch (error) {
                console.log(`    Unexpected error processing batch on attempt ${attempt}: ${error.message}`);
                if (attempt < config.MAX_RETRIES_SENTENCE) {
                    await this.modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE);
                } else {
                    for (const lineData of batchLines) {
                        this.modelClient.logError(lineData.chapter_id, lineData.line_number, lineData.original_text, `Unexpected error after max retries: ${error.message}`, "", [], config.ERROR_LOG_FILE_SENTENCES);
                        this.sqlGenerator.addFailedLineSQL(lineData.chapter_id, lineData.line_number, lineData.original_text, `Unexpected error after max retries: ${error.message}`, "");
                        results.push(false);
                    }
                    return results;
                }
            }
        }
        
        return results;
    }

    saveProgress() {
        this.sqlGenerator.saveToFile(config.SQL_OUTPUT_FILE_SENTENCES);
    }

    async processFile(filePath = null, batchSize = null) {
        const textPath = filePath || config.TEXT_FILE_PATH;
        const processingBatchSize = batchSize || config.BATCH_SIZE;
        
        this.isProcessing = true;
        await this.initialize();

        const allLineData = this.textProcessor.extractChaptersAndLines(textPath);

        if (allLineData.length === 0) {
            console.log("No lines extracted. Exiting.");
            this.isProcessing = false;
            return { success: false, error: "No lines extracted" };
        }

        console.log(`\nAttempting translation for ${allLineData.length} lines and generating SQL inserts for 'book_sentences':`);
        
        try {
            console.log("Vertex AI Client initialized.");
            
            let successfulLines = 0;
            let failedLinesCount = 0;

            for (let i = 0; i < allLineData.length && this.isProcessing; i += processingBatchSize) {
                const batch = allLineData.slice(i, i + processingBatchSize);
                console.log(`\n--- Processing Batch ${Math.floor(i / processingBatchSize) + 1} (lines ${i + 1}-${Math.min(i + processingBatchSize, allLineData.length)}) ---`);
                
                const batchResults = await this.processBatchLines(batch);
                
                for (const result of batchResults) {
                    if (result) {
                        successfulLines++;
                    } else {
                        failedLinesCount++;
                    }
                }
                
                if ((Math.floor(i / processingBatchSize) + 1) % 5 === 0) {
                    this.saveProgress();
                    console.log(`Saved progress after ${Math.floor(i / processingBatchSize) + 1} batches`);
                }
                
                if (i + processingBatchSize < allLineData.length && this.isProcessing) {
                    console.log(`Pausing for ${config.RETRY_DELAY_SECONDS_SENTENCE / 2}ms...`);
                    await this.modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE / 2);
                }
            }

            console.log(`\n--- Line Processing Summary ---`);
            console.log(`Successfully processed and generated SQL for ${successfulLines} lines.`);
            if (failedLinesCount > 0) {
                console.log(`Failed to fully process ${failedLinesCount} lines. Check ${config.ERROR_LOG_FILE_SENTENCES} and the DB table.`);
            }
            
            this.saveProgress();
            console.log(`\nSQL for 'book_sentences' saved to ${config.SQL_OUTPUT_FILE_SENTENCES}`);
            console.log(`Line error log: ${config.ERROR_LOG_FILE_SENTENCES}`);
            console.log(`Successful raw line responses log: ${config.SUCCESSFUL_RAW_MODEL_RESPONSE_LOG_SENTENCES}`);
            console.log("Line script finished.");
            
            this.isProcessing = false;
            return {
                success: true,
                totalLines: allLineData.length,
                successfulLines,
                failedLines: failedLinesCount
            };
            
        } catch (error) {
            console.log(`\nCRITICAL SCRIPT ERROR (line processing): ${error.message}`);
            this.modelClient.logError(0, 0, "CRITICAL SCRIPT ERROR", error.message, "", [], config.ERROR_LOG_FILE_SENTENCES);
            this.saveProgress();
            this.isProcessing = false;
            return { success: false, error: error.message };
        }
    }
}

async function main() {
    const processor = new SentenceProcessor();
    const result = await processor.processFile();
    console.log('Processing result:', result);
}

// Export for use as module
module.exports = SentenceProcessor;

// Run the main function if called directly
if (require.main === module) {
    main().catch(console.error);
}