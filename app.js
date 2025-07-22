class BookProcessorUI {
    constructor() {
        this.isProcessing = false;
        this.totalLines = 0;
        this.processedLines = 0;
        this.successfulLines = 0;
        this.failedLines = 0;
        this.startTime = null;
        
        this.initializeElements();
        this.attachEventListeners();
        this.updateUI();
    }

    initializeElements() {
        this.elements = {
            textFile: document.getElementById('textFile'),
            batchSize: document.getElementById('batchSize'),
            startBtn: document.getElementById('startProcessing'),
            stopBtn: document.getElementById('stopProcessing'),
            downloadBtn: document.getElementById('downloadSQL'),
            status: document.getElementById('processingStatus'),
            progress: document.getElementById('processingProgress'),
            successRate: document.getElementById('successRate'),
            progressFill: document.getElementById('progressFill'),
            logOutput: document.getElementById('logOutput'),
            clearLogsBtn: document.getElementById('clearLogs'),
            totalLinesDisplay: document.getElementById('totalLines'),
            successfulLinesDisplay: document.getElementById('successfulLines'),
            failedLinesDisplay: document.getElementById('failedLines'),
            processingTimeDisplay: document.getElementById('processingTime')
        };
    }

    attachEventListeners() {
        this.elements.startBtn.addEventListener('click', () => this.startProcessing());
        this.elements.stopBtn.addEventListener('click', () => this.stopProcessing());
        this.elements.downloadBtn.addEventListener('click', () => this.downloadSQL());
        this.elements.clearLogsBtn.addEventListener('click', () => this.clearLogs());
        
        // Set default file path
        this.elements.textFile.value = "C:\\Dev\\Application\\book-prepare\\third_book_all_chapters.txt";
    }

    addLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.textContent = `[${timestamp}] ${message}`;
        
        this.elements.logOutput.appendChild(logEntry);
        this.elements.logOutput.scrollTop = this.elements.logOutput.scrollHeight;
    }

    clearLogs() {
        this.elements.logOutput.innerHTML = '';
    }

    updateProgress() {
        const progressPercent = this.totalLines > 0 ? (this.processedLines / this.totalLines) * 100 : 0;
        const successRate = this.processedLines > 0 ? ((this.successfulLines / this.processedLines) * 100).toFixed(1) : 0;
        
        this.elements.progress.textContent = `${this.processedLines}/${this.totalLines}`;
        this.elements.successRate.textContent = `${successRate}%`;
        this.elements.progressFill.style.width = `${progressPercent}%`;
        
        this.elements.totalLinesDisplay.textContent = this.totalLines;
        this.elements.successfulLinesDisplay.textContent = this.successfulLines;
        this.elements.failedLinesDisplay.textContent = this.failedLines;
        
        if (this.startTime) {
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            this.elements.processingTimeDisplay.textContent = `${elapsed}s`;
        }
    }

    updateUI() {
        this.elements.startBtn.disabled = this.isProcessing;
        this.elements.stopBtn.disabled = !this.isProcessing;
        this.elements.textFile.disabled = this.isProcessing;
        this.elements.batchSize.disabled = this.isProcessing;
        
        if (this.isProcessing) {
            this.elements.status.textContent = 'Processing...';
            this.elements.status.style.color = '#f6ad55';
        } else {
            this.elements.status.textContent = this.processedLines > 0 ? 'Completed' : 'Ready';
            this.elements.status.style.color = this.processedLines > 0 ? '#48bb78' : '#667eea';
        }
        
        this.elements.downloadBtn.disabled = this.processedLines === 0;
        
        this.updateProgress();
    }

    async startProcessing() {
        const filePath = this.elements.textFile.value.trim();
        const batchSize = parseInt(this.elements.batchSize.value);

        if (!filePath) {
            this.addLog('Please enter a text file path', 'error');
            return;
        }

        if (batchSize < 1 || batchSize > 100) {
            this.addLog('Batch size must be between 1 and 100', 'error');
            return;
        }

        this.isProcessing = true;
        this.startTime = Date.now();
        this.resetStats();
        this.updateUI();

        this.addLog('Starting processing...', 'info');
        this.addLog(`File: ${filePath}`, 'info');
        this.addLog(`Batch size: ${batchSize}`, 'info');

        try {
            // Simulate processing since we can't actually run Node.js from browser
            await this.simulateProcessing(filePath, batchSize);
        } catch (error) {
            this.addLog(`Error: ${error.message}`, 'error');
        }

        this.isProcessing = false;
        this.updateUI();
    }

    async simulateProcessing(filePath, batchSize) {
        // This is a simulation - in a real implementation, you'd call the Node.js backend
        this.totalLines = Math.floor(Math.random() * 100) + 20; // Random number of lines
        this.updateUI();

        for (let i = 0; i < this.totalLines; i += batchSize) {
            if (!this.isProcessing) break; // Check for stop

            const currentBatch = Math.min(batchSize, this.totalLines - i);
            this.addLog(`Processing batch ${Math.floor(i/batchSize) + 1} (${currentBatch} lines)`, 'info');

            // Simulate processing time
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

            // Simulate results
            const batchSuccesses = Math.floor(currentBatch * (0.7 + Math.random() * 0.3)); // 70-100% success rate
            const batchFailures = currentBatch - batchSuccesses;

            this.successfulLines += batchSuccesses;
            this.failedLines += batchFailures;
            this.processedLines += currentBatch;

            if (batchSuccesses > 0) {
                this.addLog(`✓ Successfully processed ${batchSuccesses} lines`, 'success');
            }
            if (batchFailures > 0) {
                this.addLog(`✗ Failed to process ${batchFailures} lines`, 'error');
            }

            this.updateUI();
        }

        if (this.isProcessing) {
            this.addLog('Processing completed!', 'success');
            this.addLog(`Total: ${this.totalLines}, Success: ${this.successfulLines}, Failed: ${this.failedLines}`, 'info');
        } else {
            this.addLog('Processing stopped by user', 'info');
        }
    }

    stopProcessing() {
        this.isProcessing = false;
        this.addLog('Stopping processing...', 'info');
    }

    resetStats() {
        this.totalLines = 0;
        this.processedLines = 0;
        this.successfulLines = 0;
        this.failedLines = 0;
        this.startTime = null;
    }

    downloadSQL() {
        // Simulate SQL download
        const sqlContent = `-- Book Sentences SQL Export
-- Generated: ${new Date().toISOString()}
-- Total processed: ${this.processedLines} lines
-- Successful: ${this.successfulLines}
-- Failed: ${this.failedLines}

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS book_sentences (
    id INTEGER PRIMARY KEY,
    sentence_number INTEGER,
    chapter_id INTEGER,
    original_text TEXT,
    original_parsed_text TEXT,
    translation_parsed_text TEXT,
    processing_errors TEXT
);

CREATE INDEX IF NOT EXISTS idx_book_sentences_chapter_sentence ON book_sentences(chapter_id, sentence_number);

-- Sample data (simulated)
${Array.from({length: this.successfulLines}, (_, i) => 
    `INSERT INTO book_sentences (chapter_id, sentence_number, original_text, original_parsed_text, translation_parsed_text, processing_errors) VALUES (1, ${i+1}, 'Sample text ${i+1}', 'Sample/1/ German/2/ text/3/', 'Sample English text', NULL);`
).join('\n')}
`;

        const blob = new Blob([sqlContent], { type: 'text/sql' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'book_sentences_inserts.sql';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.addLog('SQL file downloaded successfully', 'success');
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new BookProcessorUI();
});