const fs = require('fs');

class TextProcessor {
    extractChaptersAndLines(filePath) {
        const processedLines = [];
        let currentChapterId = 0;
        let currentLineInChapter = 0;
        
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const lines = fileContent.split(/\r?\n/);
            
            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                const lineStrip = lines[lineNum].trim();

                if (lineStrip.includes('[CHAPTER MARKER]')) {
                    const chapterNumberMatch = lineStrip.match(/(\d+)/);
                    if (chapterNumberMatch) {
                        currentChapterId = parseInt(chapterNumberMatch[1]);
                    } else {
                        currentChapterId += 1;
                    }
                    
                    currentLineInChapter = 0;
                    console.log(`--- Detected Chapter ${currentChapterId} (skipping line: '${lineStrip}') ---`);
                    continue;
                }

                if (!lineStrip) {
                    continue;
                }

                currentLineInChapter += 1;
                if (currentChapterId === 0) {
                    if (processedLines.length === 0) {
                        console.log("No '[CHAPTER MARKER]' found before first text, defaulting to Chapter 1.");
                    }
                    currentChapterId = 1;
                }

                processedLines.push({
                    chapter_id: currentChapterId,
                    line_number: currentLineInChapter,
                    original_text: lineStrip
                });
            }
            
            if (processedLines.length === 0) {
                console.log("Warning: No lines were extracted. Check text file content and chapter markers.");
            } else {
                console.log(`Extracted ${processedLines.length} lines across detected chapters.`);
            }

        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`FATAL: Text file not found at ${filePath}.`);
                return [];
            } else {
                console.log(`FATAL: Error reading or processing text file ${filePath}: ${error}`);
                return [];
            }
        }
            
        return processedLines;
    }

    cleanAnnotatedText(annotatedText) {
        if (!annotatedText) return "";
        return annotatedText.replace(/\/\d+\//g, '').trim();
    }

    parseTranslationResponse(responseContent) {
        const errors = [];
        const parts = responseContent.split('|');
        
        if (parts.length >= 4) {
            let germanAnnotated = parts[1].trim();
            if (germanAnnotated.endsWith(',')) {
                germanAnnotated = germanAnnotated.slice(0, -1).trim();
            }
            const englishAnnotated = parts[3].trim();
            return [germanAnnotated, englishAnnotated, errors];
        } else {
            errors.push(`Unexpected line response format. Expected at least 4 parts when splitting by '|', got ${parts.length}.`);
            errors.push(`Full response part: '${responseContent.substring(0, 200)}...'`);
            return [null, null, errors];
        }
    }
}

module.exports = TextProcessor;