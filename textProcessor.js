import fs from 'fs';

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
        
        try {
            // Try to parse as JSON first
            const parsed = JSON.parse(responseContent.trim());
            
            if (parsed.original && parsed.translated) {
                return [parsed.original, parsed.translated, errors];
            } else {
                errors.push(`JSON response missing required fields 'original' or 'translated'`);
                errors.push(`Found fields: ${Object.keys(parsed).join(', ')}`);
                return [null, null, errors];
            }
            
        } catch (jsonError) {
            // Fallback to old pipe-delimited format
            const parts = responseContent.split('|');
            
            if (parts.length >= 4) {
                let germanAnnotated = parts[1].trim();
                if (germanAnnotated.endsWith(',')) {
                    germanAnnotated = germanAnnotated.slice(0, -1).trim();
                }
                const englishAnnotated = parts[3].trim();
                return [germanAnnotated, englishAnnotated, errors];
            } else {
                errors.push(`Failed to parse as JSON: ${jsonError.message}`);
                errors.push(`Failed to parse as pipe-delimited: Expected at least 4 parts when splitting by '|', got ${parts.length}.`);
                errors.push(`Full response: '${responseContent.substring(0, 200)}...'`);
                return [null, null, errors];
            }
        }
    }
}

export default TextProcessor;