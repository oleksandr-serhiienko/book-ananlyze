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
        
        // EPUB processing state
        this.isEpubProcessing = false;
        this.chapterCount = 0;
        this.textLength = 0;
        this.epubStartTime = null;
        
        this.currentMode = 'sentence'; // 'sentence', 'word', or 'epub'
        
        this.initializeElements();
        this.attachEventListeners();
        this.loadSupportedLanguages();
        this.updateUI();
        
        // Initialize quick button selection and load saved settings
        setTimeout(() => {
            this.updateQuickButtonSelection();
            this.loadSavedSettings();
        }, 100);
    }

    initializeElements() {
        this.elements = {
            textFile: document.getElementById('textFile'),
            textFileInput: document.getElementById('textFileInput'),
            browseTextBtn: document.getElementById('browseTextBtn'),
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
            epubTab: document.getElementById('epubTab'),
            
            // Mode-specific elements
            sentenceModeInfo: document.getElementById('sentenceModeInfo'),
            wordModeInfo: document.getElementById('wordModeInfo'),
            epubModeInfo: document.getElementById('epubModeInfo'),
            databaseConfigGroup: document.getElementById('databaseConfigGroup'),
            epubConfigGroup: document.getElementById('epubConfigGroup'),
            databasePath: document.getElementById('databasePath'),
            databaseFileInput: document.getElementById('databaseFileInput'),
            browseDatabaseBtn: document.getElementById('browseDatabaseBtn'),
            epubFile: document.getElementById('epubFile'),
            epubFileInput: document.getElementById('epubFileInput'),
            browseEpubBtn: document.getElementById('browseEpubBtn'),
            sentenceResults: document.getElementById('sentenceResults'),
            wordResults: document.getElementById('wordResults'),
            epubResults: document.getElementById('epubResults'),
            
            // Word processing elements
            totalWordsDisplay: document.getElementById('totalWords'),
            newWordsDisplay: document.getElementById('newWords'),
            successfulWordsDisplay: document.getElementById('successfulWords'),
            failedWordsDisplay: document.getElementById('failedWords'),
            wordProcessingTimeDisplay: document.getElementById('wordProcessingTime'),
            
            // EPUB processing elements
            chapterCountDisplay: document.getElementById('chapterCount'),
            textLengthDisplay: document.getElementById('textLength'),
            epubStatusDisplay: document.getElementById('epubStatus'),
            epubFileSizeDisplay: document.getElementById('epubFileSize')
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
        this.elements.epubTab.addEventListener('click', () => this.switchMode('epub'));
        
        // File selection
        this.elements.browseTextBtn.addEventListener('click', () => this.browseTextFile());
        this.elements.textFileInput.addEventListener('change', (e) => this.handleTextFileSelect(e));
        this.elements.browseDatabaseBtn.addEventListener('click', () => this.browseDatabaseFile());
        this.elements.databaseFileInput.addEventListener('change', (e) => this.handleDatabaseFileSelect(e));
        this.elements.browseEpubBtn.addEventListener('click', () => this.browseEpubFile());
        this.elements.epubFileInput.addEventListener('change', (e) => this.handleEpubFileSelect(e));
        
        // Quick database selection buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('db-quick-btn')) {
                this.selectQuickDatabase(e.target);
            }
        });
        
        // Set default file path
        this.elements.textFile.value = "C:\\Dev\\Application\\book-prepare\\third_book_all_chapters.txt";
    }

    async loadSupportedLanguages() {
        try {
            const response = await fetch('http://localhost:3005/api/languages');
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
        this.elements.epubTab.classList.toggle('active', mode === 'epub');
        
        // Show/hide mode-specific info
        this.elements.sentenceModeInfo.style.display = mode === 'sentence' ? 'block' : 'none';
        this.elements.wordModeInfo.style.display = mode === 'word' ? 'block' : 'none';
        this.elements.epubModeInfo.style.display = mode === 'epub' ? 'block' : 'none';
        this.elements.databaseConfigGroup.style.display = mode === 'word' ? 'block' : 'none';
        this.elements.epubConfigGroup.style.display = mode === 'epub' ? 'block' : 'none';
        
        // Hide Text File Path field for EPUB mode since it has its own file input
        const textFileGroup = document.getElementById('textFileGroup');
        if (textFileGroup) textFileGroup.style.display = mode === 'epub' ? 'none' : 'block';
        
        // Hide AI and Translation config for EPUB mode (it's just a converter)
        const aiConfigGroup = document.getElementById('aiConfigGroup');
        const translationConfigGroup = document.getElementById('translationConfigGroup');
        if (aiConfigGroup) aiConfigGroup.style.display = mode === 'epub' ? 'none' : 'block';
        if (translationConfigGroup) translationConfigGroup.style.display = mode === 'epub' ? 'none' : 'block';
        
        // Show/hide results
        this.elements.sentenceResults.style.display = mode === 'sentence' ? 'grid' : 'none';
        this.elements.wordResults.style.display = mode === 'word' ? 'grid' : 'none';
        this.elements.epubResults.style.display = mode === 'epub' ? 'grid' : 'none';
        
        // Reset processing states when switching modes
        if (mode === 'sentence') {
            this.isWordProcessing = false;
            this.isEpubProcessing = false;
        } else if (mode === 'word') {
            this.isProcessing = false;
            this.isEpubProcessing = false;
        } else if (mode === 'epub') {
            this.isProcessing = false;
            this.isWordProcessing = false;
        }
        
        // Load saved settings for the new mode
        this.loadSavedSettings();
        
        this.updateUI();
    }

    async loadSavedSettings() {
        try {
            const currentTab = getCurrentTab();
            const response = await fetch(`http://localhost:3005/api/last-settings/${currentTab}`);
            
            if (!response.ok) {
                console.log('No saved settings found or server error');
                return;
            }
            
            const settings = await response.json();
            
            // Load AI configuration settings
            if (settings.projectId) {
                document.getElementById('projectId').value = settings.projectId;
            }
            if (settings.location) {
                document.getElementById('location').value = settings.location;
            }
            if (settings.modelEndpoint) {
                document.getElementById('modelEndpoint').value = settings.modelEndpoint;
            }
            
            // Load translation settings
            if (settings.sourceLanguage) {
                this.elements.sourceLanguage.value = settings.sourceLanguage;
            }
            if (settings.targetLanguage) {
                this.elements.targetLanguage.value = settings.targetLanguage;
            }
            
            // Load file paths based on current mode
            if (this.currentMode === 'word') {
                if (settings.textFilePath) {
                    this.elements.textFile.value = settings.textFilePath;
                }
                if (settings.databasePath) {
                    this.elements.databasePath.value = settings.databasePath;
                    this.updateQuickButtonSelection();
                }
            } else if (this.currentMode === 'sentence') {
                if (settings.textFilePath) {
                    this.elements.textFile.value = settings.textFilePath;
                }
            } else if (this.currentMode === 'epub') {
                if (settings.epubFilePath) {
                    this.elements.epubFile.value = settings.epubFilePath;
                }
            }
            
            // Load rollback models
            if (settings.rollbackModels && Array.isArray(settings.rollbackModels)) {
                // Clear existing rollback models
                for (let i = 1; i <= 3; i++) {
                    document.getElementById(`rollbackModel${i}`).value = '';
                }
                
                // Load saved rollback models
                settings.rollbackModels.forEach((model, index) => {
                    if (index < 3 && model) {
                        document.getElementById(`rollbackModel${index + 1}`).value = model;
                    }
                });
            }
            
            console.log(`Settings loaded for ${currentTab}`);
            
        } catch (error) {
            console.error('Error loading saved settings:', error);
        }
    }

    browseTextFile() {
        this.elements.textFileInput.click();
    }

    handleTextFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            // Use the file path (for desktop apps) or file name (for web)
            const filePath = file.path || file.name;
            this.elements.textFile.value = filePath;
            this.addLog(`Text file selected: ${filePath}`, 'info');
        }
    }

    browseDatabaseFile() {
        this.elements.databaseFileInput.click();
    }

    handleDatabaseFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            // Use the file path (for desktop apps) or file name (for web)
            const filePath = file.path || file.name;
            this.elements.databasePath.value = filePath;
            this.updateQuickButtonSelection();
            this.addLog(`Database file selected: ${filePath}`, 'info');
        }
    }

    browseEpubFile() {
        this.elements.epubFileInput.click();
    }

    handleEpubFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            // Use the file path (for desktop apps) or file name (for web)
            const filePath = file.path || file.name;
            this.elements.epubFile.value = filePath;
            this.addLog(`EPUB file selected: ${filePath}`, 'info');
            
            // Update file size display
            if (file.size) {
                const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
                this.elements.epubFileSizeDisplay.textContent = `${sizeInMB} MB`;
            }
        }
    }

    selectQuickDatabase(button) {
        const dbPath = button.dataset.db;
        this.elements.databasePath.value = dbPath;
        this.updateQuickButtonSelection();
        
        if (dbPath === '') {
            this.addLog('Set to process all words (no database check)', 'info');
        } else {
            this.addLog(`Database set to: ${dbPath}`, 'info');
        }
    }

    updateQuickButtonSelection() {
        const currentPath = this.elements.databasePath.value;
        const quickButtons = document.querySelectorAll('.db-quick-btn');
        
        quickButtons.forEach(btn => {
            btn.classList.remove('selected');
            if (btn.dataset.db === currentPath) {
                btn.classList.add('selected');
            }
        });
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
        } else if (this.currentMode === 'word') {
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
        } else if (this.currentMode === 'epub') {
            // EPUB processing progress - simpler, no percentage
            this.elements.progress.textContent = this.isEpubProcessing ? 'Processing...' : 'Ready';
            this.elements.successRate.textContent = this.isEpubProcessing ? 'Processing' : 'N/A';
            this.elements.progressFill.style.width = this.isEpubProcessing ? '100%' : '0%';
            
            this.elements.chapterCountDisplay.textContent = this.chapterCount;
            this.elements.textLengthDisplay.textContent = this.textLength > 0 ? `${(this.textLength / 1000).toFixed(0)}k chars` : '0';
            this.elements.epubStatusDisplay.textContent = this.isEpubProcessing ? 'Processing' : (this.chapterCount > 0 ? 'Completed' : 'Ready');
        }
    }

    updateUI() {
        const isAnyProcessing = this.isProcessing || this.isWordProcessing || this.isEpubProcessing;
        let currentProcessing, hasResults;
        
        if (this.currentMode === 'sentence') {
            currentProcessing = this.isProcessing;
            hasResults = this.processedLines > 0;
        } else if (this.currentMode === 'word') {
            currentProcessing = this.isWordProcessing;
            hasResults = this.processedWords > 0;
        } else if (this.currentMode === 'epub') {
            currentProcessing = this.isEpubProcessing;
            hasResults = this.chapterCount > 0;
        }
        
        this.elements.startBtn.disabled = isAnyProcessing;
        this.elements.stopBtn.disabled = !currentProcessing;
        this.elements.textFile.disabled = isAnyProcessing;
        
        if (currentProcessing) {
            let statusText = 'Processing...';
            if (this.currentMode === 'sentence') statusText = 'Processing Sentences...';
            else if (this.currentMode === 'word') statusText = 'Processing Words...';
            else if (this.currentMode === 'epub') statusText = 'Converting EPUB...';
            
            this.elements.status.textContent = statusText;
            this.elements.status.style.color = '#f6ad55';
        } else {
            this.elements.status.textContent = hasResults ? 'Completed' : 'Ready';
            this.elements.status.style.color = hasResults ? '#48bb78' : '#667eea';
        }
        
        this.elements.downloadBtn.disabled = !hasResults;
        
        this.updateProgress();
    }

    async startProcessing() {
        if (this.currentMode === 'epub') {
            return this.startEpubProcessing();
        }
        
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

        // Include rollback models in config
        includeRollbackModelsInConfig(aiConfig);

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
            const response = await fetch('http://localhost:3005/api/process/start', {
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
                const response = await fetch('http://localhost:3005/api/status');
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
                const response = await fetch('http://localhost:3005/api/stop', {
                    method: 'POST'
                });
                
                if (response.ok) {
                    const result = await response.json();
                    this.addLog(result.message, 'info');
                }
            } catch (error) {
                this.addLog(`Error stopping sentence processing: ${error.message}`, 'error');
            }
        } else if (this.currentMode === 'word') {
            this.isWordProcessing = false;
            this.addLog('Stopping word processing...', 'info');
            
            try {
                const response = await fetch('http://localhost:3005/api/words/stop', {
                    method: 'POST'
                });
                
                if (response.ok) {
                    const result = await response.json();
                    this.addLog(result.message, 'info');
                }
            } catch (error) {
                this.addLog(`Error stopping word processing: ${error.message}`, 'error');
            }
        } else if (this.currentMode === 'epub') {
            this.isEpubProcessing = false;
            this.addLog('Stopping EPUB processing...', 'info');
            // EPUB processing doesn't have a separate stop endpoint since it's usually quick
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
        const databasePath = this.elements.databasePath.value.trim();

        // Get AI configuration from form (same as sentence processing)
        const aiConfig = {
            projectId: document.getElementById('projectId').value.trim(),
            location: document.getElementById('location').value.trim(),
            modelEndpoint: document.getElementById('modelEndpoint').value.trim()
        };

        // Include rollback models in config
        includeRollbackModelsInConfig(aiConfig);

        // Get translation configuration from form (same as sentence processing)
        const translationConfig = {
            sourceLanguage: document.getElementById('sourceLanguage').value,
            targetLanguage: document.getElementById('targetLanguage').value
        };

        this.addLog('Starting word processing...', 'info');
        this.addLog(`File: ${filePath}`, 'info');
        this.addLog(`Database: ${databasePath}`, 'info');
        this.addLog(`AI Config: Project ${aiConfig.projectId}, Location ${aiConfig.location}`, 'info');
        this.addLog(`Translation: ${translationConfig.sourceLanguage} → ${translationConfig.targetLanguage}`, 'info');

        try {
            const response = await fetch('http://localhost:3005/api/words/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filePath,
                    databasePath,
                    aiConfig,  // Pass AI config to word processing
                    translationConfig  // Pass translation config to word processing
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
                const response = await fetch('http://localhost:3005/api/words/status');
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
            let endpoint, filename;
            
            if (this.currentMode === 'sentence') {
                endpoint = 'http://localhost:3005/api/download/sql';
                filename = 'book_sentences_inserts.sql';
            } else if (this.currentMode === 'word') {
                endpoint = 'http://localhost:3005/api/words/download/sql';
                filename = 'word_translations_inserts.sql';
            } else if (this.currentMode === 'epub') {
                endpoint = 'http://localhost:3005/api/epub/download/text';
                filename = 'extracted_epub_text.txt';
            }
            
            const response = await fetch(endpoint);
            
            if (!response.ok) {
                throw new Error('Failed to download file');
            }
            
            const content = await response.text();
            const contentType = this.currentMode === 'epub' ? 'text/plain' : 'text/sql';
            
            const blob = new Blob([content], { type: contentType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            let fileType;
            if (this.currentMode === 'sentence') fileType = 'Sentence SQL';
            else if (this.currentMode === 'word') fileType = 'Word SQL';
            else if (this.currentMode === 'epub') fileType = 'Extracted text';
            
            this.addLog(`${fileType} file downloaded successfully`, 'success');
            
        } catch (error) {
            this.addLog(`Error downloading file: ${error.message}`, 'error');
        }
    }

    async startEpubProcessing() {
        const filePath = this.elements.epubFile.value.trim();

        if (!filePath) {
            this.addLog('Please select an EPUB file', 'error');
            return;
        }

        this.isEpubProcessing = true;
        this.epubStartTime = Date.now();
        this.resetEpubStats();
        this.updateUI();

        this.addLog('Starting EPUB to text conversion...', 'info');
        this.addLog(`File: ${filePath}`, 'info');

        try {
            await this.processEpubFile();
        } catch (error) {
            this.addLog(`Conversion failed: ${error.message}`, 'error');
            this.isEpubProcessing = false;
            this.updateUI();
        }
    }

    async processEpubFile() {
        const filePath = this.elements.epubFile.value.trim();

        try {
            const response = await fetch('http://localhost:3005/api/epub/extract', {
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
                let errorMessage = error.error || 'Failed to convert EPUB';
                if (error.details) errorMessage += ` - ${error.details}`;
                throw new Error(errorMessage);
            }

            const result = await response.json();
            this.addLog('Conversion started...', 'success');
            
            // Start polling for status updates (simplified)
            this.pollEpubStatus();

        } catch (error) {
            this.addLog(`Conversion error: ${error.message}`, 'error');
            throw error;
        }
    }

    async pollEpubStatus() {
        const pollInterval = 1000; // 1 second for faster feedback
        let lastLogCount = 0;
        
        while (this.isEpubProcessing) {
            try {
                const response = await fetch('http://localhost:3005/api/epub/status');
                if (!response.ok) {
                    throw new Error('Failed to check conversion status');
                }
                
                const status = await response.json();
                
                // Update EPUB processing state
                this.isEpubProcessing = status.isRunning;
                this.chapterCount = status.chapterCount || 0;
                
                // Add new logs (simplified)
                if (status.logs && status.logs.length > lastLogCount) {
                    for (let i = lastLogCount; i < status.logs.length; i++) {
                        const logMessage = status.logs[i];
                        let logType = 'info';
                        
                        if (logMessage.toLowerCase().includes('success') || logMessage.toLowerCase().includes('completed') || logMessage.includes('✓')) {
                            logType = 'success';
                        } else if (logMessage.toLowerCase().includes('error') || logMessage.toLowerCase().includes('failed') || logMessage.includes('✗')) {
                            logType = 'error';
                        }
                        
                        this.addLogEntry(logMessage, logType);
                    }
                    lastLogCount = status.logs.length;
                }
                
                // Update text length from status
                if (status.hasText && status.chapterCount > 0) {
                    this.textLength = status.chapterCount * 3000; // Rough estimate: 3k chars per chapter
                }
                
                this.updateUI();
                
                // Check if conversion completed
                if (!status.isRunning) {
                    this.isEpubProcessing = false;
                    if (this.chapterCount > 0) {
                        this.addLog(`✅ Conversion completed! Extracted ${this.chapterCount} chapters`, 'success');
                        this.addLog('Click "Download Results" to get your text file', 'success');
                    }
                    this.updateUI();
                    break;
                }
                
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                
            } catch (error) {
                this.addLog(`Status check error: ${error.message}`, 'error');
                this.isEpubProcessing = false;
                this.updateUI();
                break;
            }
        }
    }

    resetEpubStats() {
        this.chapterCount = 0;
        this.textLength = 0;
        this.epubStartTime = null;
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const ui = new BookProcessorUI();
    // Store reference for global functions
    document.querySelector('body').__bookProcessorUI = ui;
});

// Rollback Models Functionality
function toggleRollbackModels() {
    const container = document.getElementById('rollbackModelsContainer');
    const icon = document.querySelector('.toggle-icon');
    
    if (container.style.display === 'none') {
        container.style.display = 'block';
        icon.classList.add('expanded');
        icon.textContent = '▼';
    } else {
        container.style.display = 'none';
        icon.classList.remove('expanded');
        icon.textContent = '▶';
    }
}

function clearRollbackModel(modelNumber) {
    document.getElementById(`rollbackModel${modelNumber}`).value = '';
}

function clearAllRollbackModels() {
    for (let i = 1; i <= 3; i++) {
        clearRollbackModel(i);
    }
}

async function loadSavedRollbackModels() {
    try {
        // Use the main UI class method to load all settings
        const ui = document.querySelector('body').__bookProcessorUI;
        if (ui) {
            await ui.loadSavedSettings();
            showMessage('Settings loaded successfully!', 'success');
        } else {
            // Fallback to direct loading if UI instance not available
            const currentTab = getCurrentTab();
            const response = await fetch(`http://localhost:3005/api/last-settings/${currentTab}`);
            const settings = await response.json();
            
            if (settings.rollbackModels && Array.isArray(settings.rollbackModels)) {
                clearAllRollbackModels();
                settings.rollbackModels.forEach((model, index) => {
                    if (index < 3 && model) {
                        document.getElementById(`rollbackModel${index + 1}`).value = model;
                    }
                });
                showMessage('Rollback models loaded successfully!', 'success');
            } else {
                showMessage('No saved rollback models found.', 'info');
            }
        }
    } catch (error) {
        console.error('Error loading rollback models:', error);
        showMessage('Failed to load rollback models.', 'error');
    }
}

function getCurrentTab() {
    // Check which tab is active
    const activeTab = document.querySelector('.tab-button.active');
    if (activeTab) {
        const tabId = activeTab.id;
        if (tabId === 'sentenceTab') return 'sentenceProcessing';
        if (tabId === 'wordTab') return 'wordProcessing';
        if (tabId === 'epubTab') return 'epubProcessing';
    }
    
    // Default fallback
    return 'sentenceProcessing';
}

function getRollbackModelsFromForm() {
    const rollbackModels = [];
    
    for (let i = 1; i <= 3; i++) {
        const value = document.getElementById(`rollbackModel${i}`).value.trim();
        if (value) {
            rollbackModels.push(value);
        }
    }
    
    return rollbackModels;
}

function showMessage(message, type) {
    // Create a simple notification
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 4px;
        color: white;
        font-weight: 500;
        z-index: 1000;
        max-width: 300px;
        word-wrap: break-word;
    `;
    
    // Set background color based on type
    if (type === 'success') notification.style.backgroundColor = '#48bb78';
    else if (type === 'error') notification.style.backgroundColor = '#f56565';
    else notification.style.backgroundColor = '#4299e1';
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

// Function to include rollback models in existing AI config
function includeRollbackModelsInConfig(aiConfig) {
    const rollbackModels = getRollbackModelsFromForm();
    if (rollbackModels.length > 0) {
        aiConfig.rollbackModels = rollbackModels;
    }
    return aiConfig;
}