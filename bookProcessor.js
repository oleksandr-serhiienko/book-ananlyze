import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { DOMParser } from 'xmldom';

class EPUBReader {
    constructor(epubPath) {
        this.epubPath = epubPath;
        this.zip = null;
        this.opfPath = null;
        this.chapters = [];
        this.chapterCounter = 1;
    }

    async readEPUB() {
        try {
            // Load the EPUB file (which is a ZIP archive)
            this.zip = new AdmZip(this.epubPath);
            
            // Find and parse the OPF file (contains book metadata and structure)
            await this.findOPFFile();
            await this.parseOPF();
            
            // Extract text from all chapters
            let fullText = '';
            for (const chapter of this.chapters) {
                const chapterText = await this.extractChapterText(chapter);
                if (chapterText.trim()) {
                    fullText += `[CHAPTER MARKER] ${this.chapterCounter}\n\n`;
                    fullText += chapterText + '\n\n';
                    this.chapterCounter++;
                }
            }
            
            return fullText;
        } catch (error) {
            console.error('Error reading EPUB:', error);
            throw error;
        }
    }

    async findOPFFile() {
        // First, check container.xml to find the OPF file location
        const containerXML = this.zip.readAsText('META-INF/container.xml');
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXML, 'text/xml');
        
        const rootfileElements = containerDoc.getElementsByTagName('rootfile');
        if (rootfileElements.length > 0) {
            this.opfPath = rootfileElements[0].getAttribute('full-path');
        } else {
            // Fallback: look for common OPF file locations
            const entries = this.zip.getEntries();
            for (const entry of entries) {
                if (entry.entryName.endsWith('.opf')) {
                    this.opfPath = entry.entryName;
                    break;
                }
            }
        }
        
        if (!this.opfPath) {
            throw new Error('Could not find OPF file in EPUB');
        }
    }

    async parseOPF() {
        const opfContent = this.zip.readAsText(this.opfPath);
        const parser = new DOMParser();
        const opfDoc = parser.parseFromString(opfContent, 'text/xml');
        
        // Get the base directory for relative paths
        const baseDir = path.dirname(this.opfPath);
        
        // Find all spine items (reading order)
        const spineItems = opfDoc.getElementsByTagName('itemref');
        const manifestItems = opfDoc.getElementsByTagName('item');
        
        // Create a map of manifest items
        const manifestMap = {};
        for (let i = 0; i < manifestItems.length; i++) {
            const item = manifestItems[i];
            const id = item.getAttribute('id');
            const href = item.getAttribute('href');
            const mediaType = item.getAttribute('media-type');
            
            manifestMap[id] = {
                href: href,
                mediaType: mediaType,
                fullPath: baseDir ? `${baseDir}/${href}` : href
            };
        }
        
        // Get chapters in reading order
        for (let i = 0; i < spineItems.length; i++) {
            const itemref = spineItems[i];
            const idref = itemref.getAttribute('idref');
            
            if (manifestMap[idref] && manifestMap[idref].mediaType === 'application/xhtml+xml') {
                this.chapters.push(manifestMap[idref]);
            }
        }
    }

    async extractChapterText(chapter) {
        try {
            const chapterContent = this.zip.readAsText(chapter.fullPath);
            const parser = new DOMParser();
            const doc = parser.parseFromString(chapterContent, 'text/xml');
            
            // Extract text using a more systematic approach to avoid duplicates
            const bodyElement = doc.getElementsByTagName('body')[0];
            if (!bodyElement) {
                return '';
            }
            
            // Get all text content from the body, preserving structure
            const text = this.extractTextFromNode(bodyElement);
            
            // Clean up the text but preserve paragraph structure
            return this.cleanText(text);
        } catch (error) {
            console.error(`Error extracting text from chapter ${chapter.href}:`, error);
            return '';
        }
    }

    extractTextFromNode(node, preserveBreaks = true) {
        if (!node) return '';
        
        // If it's a text node, return its content
        if (node.nodeType === 3) { // Text node
            return node.nodeValue || '';
        }
        
        // Skip script and style elements
        if (node.nodeName && (node.nodeName.toLowerCase() === 'script' || node.nodeName.toLowerCase() === 'style')) {
            return '';
        }
        
        let text = '';
        const tagName = node.nodeName ? node.nodeName.toLowerCase() : '';
        
        // Add content from child nodes
        if (node.childNodes) {
            for (let i = 0; i < node.childNodes.length; i++) {
                text += this.extractTextFromNode(node.childNodes[i], preserveBreaks);
            }
        }
        
        // Add appropriate line breaks after block elements
        if (preserveBreaks && this.isBlockElement(tagName)) {
            // Only add a line break if the text doesn't already end with one
            if (text.trim() && !text.endsWith('\n')) {
                text += '\n';
            }
        }
        
        return text;
    }

    isBlockElement(tagName) {
        const blockElements = [
            'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'blockquote', 'li', 'ul', 'ol', 'section', 'article',
            'header', 'footer', 'nav', 'aside', 'main', 'br'
        ];
        return blockElements.includes(tagName);
    }

    getTextContent(node) {
        if (!node) return '';
        
        if (node.nodeType === 3) { // Text node
            return node.nodeValue || '';
        }
        
        let text = '';
        if (node.childNodes) {
            for (let i = 0; i < node.childNodes.length; i++) {
                text += this.getTextContent(node.childNodes[i]);
            }
        }
        
        return text;
    }

    cleanText(text) {
        return text
            .replace(/[ \t]+/g, ' ') // Replace multiple spaces/tabs with single space
            .replace(/\n[ \t]+/g, '\n') // Remove spaces after newlines
            .replace(/[ \t]+\n/g, '\n') // Remove spaces before newlines
            .trim();
    }

    // Static method to save text to file
    static saveToFile(text, outputPath) {
        fs.writeFileSync(outputPath, text, 'utf8');
        console.log(`Text saved to: ${outputPath}`);
    }
}

// Usage example
async function main() {
    // Replace with your EPUB file path
    const epubPath = 'your-book.epub';
    const outputPath = 'extracted-text.txt';
    
    try {
        const reader = new EPUBReader(epubPath);
        console.log('Reading EPUB file...');
        
        const extractedText = await reader.readEPUB();
        
        console.log(`Extracted ${reader.chapterCounter - 1} chapters`);
        console.log('First 500 characters of extracted text:');
        console.log(extractedText.substring(0, 500) + '...');
        
        // Save to file
        EPUBReader.saveToFile(extractedText, outputPath);
        
        return extractedText;
    } catch (error) {
        console.error('Failed to read EPUB:', error);
    }
}

// Export for use as module
export { EPUBReader };
export default EPUBReader;

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}