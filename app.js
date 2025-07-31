class BookProcessorUI {
    constructor() {
        this.isProcessing = false;
        this.totalLines = 0;
        this.totalChapters = 0;
        this.processedLines = 0;
        this.successfulLines = 0;
        this.failedLines = 0;
        this.startTime = null;
        
        // Word processing state
        this.isWordProcessing = false;
        this.totalWords = 0;
        this.newWords = 0;
        this.processedWords = 0;
        this.successfulWords = 0;
        this.failedWords = 0;
        this.wordStartTime = null;
        this.currentMode = 'sentence'; // 'sentence' or 'word'
        
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
            targetLanguage: document.getElementById('targetLanguage'),
            
            // Tab elements
            sentenceTab: document.getElementById('sentenceTab'),
            wordTab: document.getElementById('wordTab'),
            
            // Mode-specific elements
            sentenceModeInfo: document.getElementById('sentenceModeInfo'),
            wordModeInfo: document.getElementById('wordModeInfo'),
            sentenceResults: document.getElementById('sentenceResults'),
            wordResults: document.getElementById('wordResults'),
            
            // Word processing elements
            totalWordsDisplay: document.getElementById('totalWords'),
            newWordsDisplay: document.getElementById('newWords'),
            successfulWordsDisplay: document.getElementById('successfulWords'),
            failedWordsDisplay: document.getElementById('failedWords'),
            wordProcessingTimeDisplay: document.getElementById('wordProcessingTime')
        };
    }

    attachEventListeners() {
        this.elements.startBtn.addEventListener('click', () => this.startProcessing());
        this.elements.stopBtn.addEventListener('click', () => this.stopProcessing());
        this.elements.downloadBtn.addEventListener('click', () => this.downloadSQL());
        this.elements.clearLogsBtn.addEventListener('click', () => this.clearLogs());
        
        // Tab switching
        this.elements.sentenceTab.addEventListener('click', () => this.switchMode('sentence'));
        this.elements.wordTab.addEventListener('click', () => this.switchMode('word'));
        
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

    switchMode(mode) {
        this.currentMode = mode;
        
        // Update tab appearance
        this.elements.sentenceTab.classList.toggle('active', mode === 'sentence');
        this.elements.wordTab.classList.toggle('active', mode === 'word');
        
        // Show/hide mode-specific info
        this.elements.sentenceModeInfo.style.display = mode === 'sentence' ? 'block' : 'none';
        this.elements.wordModeInfo.style.display = mode === 'word' ? 'block' : 'none';
        
        // Show/hide results
        this.elements.sentenceResults.style.display = mode === 'sentence' ? 'grid' : 'none';
        this.elements.wordResults.style.display = mode === 'word' ? 'grid' : 'none';
        
        // Reset processing states when switching modes
        if (mode === 'sentence') {
            this.isWordProcessing = false;
        } else {
            this.isProcessing = false;
        }
        
        this.updateUI();
    }

    updateProgress() {
        if (this.currentMode === 'sentence') {
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
        } else {
            // Word processing progress
            const progressPercent = this.newWords > 0 ? (this.processedWords / this.newWords) * 100 : 0;
            const successRate = this.processedWords > 0 ? ((this.successfulWords / this.processedWords) * 100).toFixed(1) : 0;
            
            this.elements.progress.textContent = `${this.processedWords}/${this.newWords}`;
            this.elements.successRate.textContent = `${successRate}%`;
            this.elements.progressFill.style.width = `${progressPercent}%`;
            
            this.elements.totalWordsDisplay.textContent = this.totalWords;
            this.elements.newWordsDisplay.textContent = this.newWords;
            this.elements.successfulWordsDisplay.textContent = this.successfulWords;
            this.elements.failedWordsDisplay.textContent = this.failedWords;
            
            if (this.wordStartTime) {
                const elapsed = Math.floor((Date.now() - this.wordStartTime) / 1000);
                this.elements.wordProcessingTimeDisplay.textContent = `${elapsed}s`;
            }
        }
    }

    updateUI() {
        const isAnyProcessing = this.isProcessing || this.isWordProcessing;
        const currentProcessing = this.currentMode === 'sentence' ? this.isProcessing : this.isWordProcessing;
        const hasResults = this.currentMode === 'sentence' ? this.processedLines > 0 : this.processedWords > 0;
        
        this.elements.startBtn.disabled = isAnyProcessing;
        this.elements.stopBtn.disabled = !currentProcessing;
        this.elements.textFile.disabled = isAnyProcessing;
        
        if (currentProcessing) {
            this.elements.status.textContent = this.currentMode === 'sentence' ? 'Processing Sentences...' : 'Processing Words...';
            this.elements.status.style.color = '#f6ad55';
        } else {
            this.elements.status.textContent = hasResults ? 'Completed' : 'Ready';
            this.elements.status.style.color = hasResults ? '#48bb78' : '#667eea';
        }
        
        this.elements.downloadBtn.disabled = !hasResults;
        
        this.updateProgress();
    }

    async startProcessing() {
        const filePath = this.elements.textFile.value.trim();

        if (!filePath) {
            this.addLog('Please enter a text file path', 'error');
            return;
        }

        if (this.currentMode === 'sentence') {
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
        } else {
            this.isWordProcessing = true;
            this.wordStartTime = Date.now();
            this.resetWordStats();
            this.updateUI();

            try {
                await this.startWordProcessing();
            } catch (error) {
                this.addLog(`Error: ${error.message}`, 'error');
                this.isWordProcessing = false;
                this.updateUI();
            }
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
        if (this.currentMode === 'sentence') {
            this.isProcessing = false;
            this.addLog('Stopping sentence processing...', 'info');
            
            try {
                const response = await fetch('http://localhost:3001/api/stop', {
                    method: 'POST'
                });
                
                if (response.ok) {
                    const result = await response.json();
                    this.addLog(result.message, 'info');
                }
            } catch (error) {
                this.addLog(`Error stopping sentence processing: ${error.message}`, 'error');
            }
        } else {
            this.isWordProcessing = false;
            this.addLog('Stopping word processing...', 'info');
            
            try {
                const response = await fetch('http://localhost:3001/api/words/stop', {
                    method: 'POST'
                });
                
                if (response.ok) {
                    const result = await response.json();
                    this.addLog(result.message, 'info');
                }
            } catch (error) {
                this.addLog(`Error stopping word processing: ${error.message}`, 'error');
            }
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

    resetWordStats() {
        this.totalWords = 0;
        this.newWords = 0;
        this.processedWords = 0;
        this.successfulWords = 0;
        this.failedWords = 0;
        this.wordStartTime = null;
    }

    async startWordProcessing() {
        const filePath = this.elements.textFile.value.trim();

        this.addLog('Starting word processing...', 'info');
        this.addLog(`File: ${filePath}`, 'info');

        try {
            const response = await fetch('http://localhost:3001/api/words/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filePath
                })
            });

            if (!response.ok) {
                const error = await response.json();
                let errorMessage = error.error || 'Failed to start word processing';
                if (error.details) errorMessage += `\nDetails: ${error.details}`;
                if (error.path) errorMessage += `\nFile: ${error.path}`;
                if (error.code) errorMessage += `\nError Code: ${error.code}`;
                throw new Error(errorMessage);
            }

            const result = await response.json();
            this.addLog(result.message, 'success');
            
            this.updateUI();

            // Start polling for word processing status
            this.pollWordStatus();

        } catch (error) {
            // Display detailed error information
            const errorLines = error.message.split('\n');
            errorLines.forEach((line, index) => {
                if (index === 0) {
                    this.addLog(`Error starting word processing: ${line}`, 'error');
                } else if (line.trim()) {
                    this.addLog(`  ${line}`, 'error');
                }
            });
            throw error;
        }
    }

    async pollWordStatus() {
        const pollInterval = 2000; // 2 seconds
        let lastLogCount = 0;
        
        while (this.isWordProcessing) {
            try {
                const response = await fetch('http://localhost:3001/api/words/status');
                if (!response.ok) {
                    throw new Error('Failed to fetch word processing status');
                }
                
                const status = await response.json();
                
                // Update word processing state
                this.isWordProcessing = status.isRunning;
                this.totalWords = status.totalWords || this.totalWords;
                this.newWords = status.newWords || this.newWords;
                this.processedWords = status.processedWords || this.processedWords;
                this.successfulWords = status.successfulWords || this.successfulWords;
                this.failedWords = status.failedWords || this.failedWords;
                
                // Add new logs
                if (status.logs && status.logs.length > lastLogCount) {
                    for (let i = lastLogCount; i < status.logs.length; i++) {
                        const logMessage = status.logs[i];
                        let logType = 'info';
                        
                        if (logMessage.includes('✓') || logMessage.includes('success') || logMessage.toLowerCase().includes('completed')) {
                            logType = 'success';
                        } else if (logMessage.includes('✗') || logMessage.includes('Error') || logMessage.includes('Failed')) {
                            logType = 'error';
                        }
                        
                        this.addLogEntry(logMessage, logType);
                    }
                    lastLogCount = status.logs.length;
                }
                
                this.updateUI();
                
                // Check if processing completed
                if (!status.isRunning) {
                    this.isWordProcessing = false;
                    this.updateUI();
                    break;
                }
                
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                
            } catch (error) {
                this.addLog(`Error polling word processing status: ${error.message}`, 'error');
                this.isWordProcessing = false;
                this.updateUI();
                break;
            }
        }
    }


    async downloadSQL() {
        try {
            const endpoint = this.currentMode === 'sentence' ? 'http://localhost:3001/api/download/sql' : 'http://localhost:3001/api/words/download/sql';
            const filename = this.currentMode === 'sentence' ? 'book_sentences_inserts.sql' : 'word_translations_inserts.sql';
            
            const response = await fetch(endpoint);
            
            if (!response.ok) {
                throw new Error('Failed to download SQL file');
            }
            
            const sqlContent = await response.text();
            
            const blob = new Blob([sqlContent], { type: 'text/sql' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.addLog(`${this.currentMode === 'sentence' ? 'Sentence' : 'Word'} SQL file downloaded successfully`, 'success');
            
        } catch (error) {
            this.addLog(`Error downloading SQL: ${error.message}`, 'error');
        }
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new BookProcessorUI();
});