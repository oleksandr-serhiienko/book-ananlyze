class BookProcessorUI {
    constructor() {
        this.isProcessing = false;
        this.totalLines = 0;
        this.totalChapters = 0;
        this.processedLines = 0;
        this.successfulLines = 0;
        this.failedLines = 0;
        this.startTime = null;
        
        this.initializeElements();
        this.attachEventListeners();
        this.loadSupportedLanguages();
        this.updateUI();
    }

    initializeElements() {
        this.elements = {
            textFile: document.getElementById('textFile'),
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
            processingTimeDisplay: document.getElementById('processingTime'),
            sourceLanguage: document.getElementById('sourceLanguage'),
            targetLanguage: document.getElementById('targetLanguage')
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

    async loadSupportedLanguages() {
        try {
            const response = await fetch('http://localhost:3001/api/languages');
            if (!response.ok) {
                throw new Error('Failed to load supported languages');
            }
            
            const data = await response.json();
            this.populateLanguageOptions(data.supportedLanguages, data.defaultSource, data.defaultTarget);
            
        } catch (error) {
            console.error('Error loading supported languages:', error);
            // Fall back to default options if API fails
            this.addLog('Using default language options (API unavailable)', 'warn');
        }
    }

    populateLanguageOptions(supportedLanguages, defaultSource, defaultTarget) {
        // Clear existing options
        this.elements.sourceLanguage.innerHTML = '';
        this.elements.targetLanguage.innerHTML = '';
        
        // Populate both select elements
        Object.values(supportedLanguages).forEach(language => {
            const sourceOption = new Option(language, language);
            const targetOption = new Option(language, language);
            
            this.elements.sourceLanguage.add(sourceOption);
            this.elements.targetLanguage.add(targetOption);
        });
        
        // Set default selections
        this.elements.sourceLanguage.value = defaultSource;
        this.elements.targetLanguage.value = defaultTarget;
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

        if (!filePath) {
            this.addLog('Please enter a text file path', 'error');
            return;
        }

        this.isProcessing = true;
        this.startTime = Date.now();
        this.resetStats();
        this.updateUI();

        try {
            await this.startSentenceProcessing();
        } catch (error) {
            this.addLog(`Error: ${error.message}`, 'error');
            this.isProcessing = false;
            this.updateUI();
        }
    }

    async startSentenceProcessing() {
        const filePath = this.elements.textFile.value.trim();

        // Get AI configuration from form (now using shared fields)
        const aiConfig = {
            projectId: document.getElementById('projectId').value.trim(),
            location: document.getElementById('location').value.trim(),
            modelEndpoint: document.getElementById('modelEndpoint').value.trim()
        };

        // Get translation configuration
        const translationConfig = {
            sourceLanguage: this.elements.sourceLanguage.value,
            targetLanguage: this.elements.targetLanguage.value
        };

        this.addLog('Starting sentence-by-sentence processing...', 'info');
        this.addLog(`File: ${filePath}`, 'info');
        this.addLog(`AI Config: Project ${aiConfig.projectId}, Location ${aiConfig.location}`, 'info');
        this.addLog(`Translation: ${translationConfig.sourceLanguage} → ${translationConfig.targetLanguage}`, 'info');

        try {
            const response = await fetch('http://localhost:3001/api/process/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filePath,
                    aiConfig,
                    translationConfig
                })
            });

            if (!response.ok) {
                const error = await response.json();
                let errorMessage = error.error || 'Failed to start processing';
                if (error.details) errorMessage += `\nDetails: ${error.details}`;
                if (error.path) errorMessage += `\nFile: ${error.path}`;
                if (error.code) errorMessage += `\nError Code: ${error.code}`;
                throw new Error(errorMessage);
            }

            const result = await response.json();
            this.addLog(result.message, 'success');
            this.totalLines = result.totalLines || 0;
            this.totalChapters = result.totalChapters || 0;
            
            if (result.totalChapters) {
                this.addLog(`Detected ${result.totalChapters} chapters, processing sentence by sentence`, 'info');
            }
            
            this.updateUI();

            // Start polling for status updates
            this.pollStatus();

        } catch (error) {
            // Display detailed error information
            const errorLines = error.message.split('\n');
            errorLines.forEach((line, index) => {
                if (index === 0) {
                    this.addLog(`Error starting processing: ${line}`, 'error');
                } else if (line.trim()) {
                    this.addLog(`  ${line}`, 'error');
                }
            });
            throw error;
        }
    }


    async pollStatus() {
        const pollInterval = 2000; // 2 seconds
        let lastLogCount = 0;
        
        while (this.isProcessing) {
            try {
                const response = await fetch('http://localhost:3001/api/status');
                if (!response.ok) {
                    throw new Error('Failed to fetch status');
                }
                
                const status = await response.json();
                
                // Update processing state
                this.isProcessing = status.isRunning;
                this.totalLines = status.totalLines || this.totalLines;
                this.totalChapters = status.totalChapters || this.totalChapters;
                this.processedLines = status.processedLines || this.processedLines;
                this.successfulLines = status.successfulLines || this.successfulLines;
                this.failedLines = status.failedLines || this.failedLines;
                this.batchJobName = status.jobName;
                
                // Add new logs with better formatting for multi-line entries
                if (status.logs && status.logs.length > lastLogCount) {
                    for (let i = lastLogCount; i < status.logs.length; i++) {
                        const logMessage = status.logs[i];
                        let logType = 'info';
                        
                        if (logMessage.includes('✓') || logMessage.includes('success') || logMessage.toLowerCase().includes('completed')) {
                            logType = 'success';
                        } else if (logMessage.includes('✗') || logMessage.includes('Error') || logMessage.includes('Failed') || logMessage.includes('stderr')) {
                            logType = 'error';
                        }
                        
                        // Handle multi-line log entries (like stack traces)
                        if (logMessage.includes('\n')) {
                            const lines = logMessage.split('\n');
                            lines.forEach((line, lineIndex) => {
                                if (lineIndex === 0) {
                                    this.addLogEntry(line, logType);
                                } else if (line.trim()) {
                                    this.addLogEntry(`  ${line}`, logType);
                                }
                            });
                        } else {
                            this.addLogEntry(logMessage, logType);
                        }
                    }
                    lastLogCount = status.logs.length;
                }
                
                this.updateUI();
                
                // Check if processing completed
                if (!status.isRunning) {
                    this.isProcessing = false;
                    this.updateUI();
                    break;
                }
                
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                
            } catch (error) {
                this.addLog(`Error polling status: ${error.message}`, 'error');
                this.isProcessing = false;
                this.updateUI();
                break;
            }
        }
    }
    
    addLogEntry(message, type = 'info') {
        // Add log entry without timestamp (backend already includes timestamp)
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.textContent = message;
        
        this.elements.logOutput.appendChild(logEntry);
        this.elements.logOutput.scrollTop = this.elements.logOutput.scrollHeight;
    }

    async stopProcessing() {
        this.isProcessing = false;
        this.addLog('Stopping processing...', 'info');
        
        try {
            const response = await fetch('http://localhost:3001/api/stop', {
                method: 'POST'
            });
            
            if (response.ok) {
                const result = await response.json();
                this.addLog(result.message, 'info');
            }
        } catch (error) {
            this.addLog(`Error stopping processing: ${error.message}`, 'error');
        }
        
        this.updateUI();
    }

    resetStats() {
        this.totalLines = 0;
        this.totalChapters = 0;
        this.processedLines = 0;
        this.successfulLines = 0;
        this.failedLines = 0;
        this.startTime = null;
        this.batchJobName = null;
    }


    async downloadSQL() {
        try {
            const response = await fetch('http://localhost:3001/api/download/sql');
            
            if (!response.ok) {
                throw new Error('Failed to download SQL file');
            }
            
            const sqlContent = await response.text();
            
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
            
        } catch (error) {
            this.addLog(`Error downloading SQL: ${error.message}`, 'error');
        }
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new BookProcessorUI();
});