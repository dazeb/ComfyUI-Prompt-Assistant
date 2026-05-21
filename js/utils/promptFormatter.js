/**
 * Prompt Formatting Tool
 * Provides formatting methods related to prompts
 */

import { logger } from './logger.js';

class PromptFormatter {
    // Define special separators
    static SEPARATORS = {
        START: '【T:', // Tag start marker
        END: ':T】',   // Tag end marker
        NEWLINE: '\n'  // Newline used to separate multiple tags
    };

    // Define punctuation mapping table
    static PUNCTUATION_MAP = {
        // Basic punctuation
        '，': ',',
        '。': '.',
        '、': ',',
        '；': ';',
        '：': ':',
        '？': '?',
        '！': '!',

        // Quotation marks
        '\u201C': '"', // Chinese left double quotation mark
        '\u201D': '"', // Chinese right double quotation mark
        '\u2018': "'", // Chinese left single quotation mark
        '\u2019': "'", // Chinese right single quotation mark

        // Brackets
        '（': '(',
        '）': ')',
        '【': '[',
        '】': ']',
        '「': '{',
        '」': '}',
        '『': '{',
        '』': '}',
        '〔': '[',
        '〕': ']',
        '［': '[',
        '］': ']',
        '｛': '{',
        '｝': '}',
        '《': '<',
        '》': '>',
        '〈': '<',
        '〉': '>',

        // Other symbols
        '～': '~',
        '｜': '|',
        '·': '.',
        '…': '...',
        '━': '-',
        '—': '-',
        '──': '--',
        '－': '-',
        '＿': '_',
        '＋': '+',
        '×': '*',
        '÷': '/',
        '＝': '=',
        '＠': '@',
        '＃': '#',
        '＄': '$',
        '％': '%',
        '＾': '^',
        '＆': '&',
        '＊': '*',
    };

    // Define the set of punctuation to detect
    static PUNCTUATION_SET = new Set([',', '.', '，', '。']);

    /**
     * Find the nearest punctuation in the text
     */
    static findNearestPunctuation(text, searchForward = true) {
        if (!text) return false;

        // Remove leading and trailing spaces
        const cleanText = searchForward ? text.trimStart() : text.trimEnd();
        if (!cleanText) return false;

        // Search for the first non-space character
        const char = searchForward ? cleanText[0] : cleanText[cleanText.length - 1];
        return this.PUNCTUATION_SET.has(char);
    }

    /**
     * Format tag, generate four formats
     */
    static formatTag(tagValue) {
        try {
            // Generate four formats
            const format1 = ` ${tagValue}`;           // Space + tag
            const format2 = ` ${tagValue},`;          // Space + tag + comma
            const format3 = `, ${tagValue}`;          // Comma + space + tag
            const format4 = `, ${tagValue},`;         // Comma + space + tag + comma

            logger.debug(`Tag formatting | Result: success | Original value: ${tagValue} | Format 1: "${format1}" | Format 2: "${format2}" | Format 3: "${format3}" | Format 4: "${format4}"`);

            return {
                format1,
                format2,
                format3,
                format4,
                insertedFormat: null // The actual inserted format, initially null
            };
        } catch (error) {
            logger.error(`Tag formatting | Result: exception | Error: ${error.message}`);
            return {
                format1: ` ${tagValue}`,
                format2: ` ${tagValue},`,
                format3: `, ${tagValue}`,
                format4: `, ${tagValue},`,
                insertedFormat: null
            };
        }
    }

    /**
     * Determine which format should be used
     */
    static determineFormatType(beforeText, afterText) {
        try {
            // Check if the input is empty
            if (!beforeText && !afterText) {
                // logger.debug('Format determination | Result: empty input | Using format: 2');
                return 2; // Empty input uses format 2 (space + tag + comma)
            }

            // Check if the preceding text only contains spaces
            const hasTextBefore = beforeText.trim().length > 0;

            // Find punctuation before and after, skipping spaces
            const hasCommaBefore = this.findNearestPunctuation(beforeText, false);
            const hasCommaAfter = this.findNearestPunctuation(afterText, true);

            // If there is no actual text ahead (only spaces), use format 2
            if (!hasTextBefore) {
                // logger.debug('Format determination | Result: no text ahead | Using format: 2');
                return 2; // Use format 2 (space + tag + comma)
            }

            // Determine which format to use based on punctuation before and after
            let formatType;
            if (hasCommaBefore && hasCommaAfter) {
                formatType = 1; // Punctuation both before and after, use format 1 (space + tag)
            } else if (hasCommaBefore && !hasCommaAfter) {
                formatType = 2; // Punctuation before, none after, use format 2 (space + tag + comma)
            } else if (!hasCommaBefore && hasCommaAfter) {
                formatType = 3; // No punctuation before, punctuation after, use format 3 (comma + space + tag)
            } else {
                formatType = 4; // No punctuation on either side, use format 4 (comma + space + tag + comma)
            }

            // logger.debug(`Format determination | Before punctuation: ${hasCommaBefore} | After punctuation: ${hasCommaAfter} | Text before: ${hasTextBefore} | Using format: ${formatType}`);
            return formatType;

        } catch (error) {
            logger.error(`Format determination | Result: exception | Error: ${error.message}`);
            return 2; // Default to format 2 on error
        }
    }

    /**
     * Format prompt for API call
     */
    static formatPromptForAPI(prompt) {
        // Temporarily return original text, no formatting
        return {
            formattedText: prompt,
            extractedParts: [],
            originalText: prompt
        };
    }

    /**
     * Get plain text for API call
     */
    static getAPIText(formatInfo) {
        // Directly return original text
        return formatInfo?.formattedText || '';
    }

    /**
     * Restore API result to original format
     */
    static restorePromptFormat(apiResult, formatInfo) {
        // Directly return API result
        return apiResult;
    }

    /**
     * Format translated text
     * Process according to user-set formatting options
     * Note: This method is responsible for formatting all translation results (including Baidu translation and LLM translation),
     * The backend no longer performs any format preprocessing or postprocessing.
     */
    static formatTranslatedText(text) {
        try {
            if (!text) return '';

            // Record original text for logging
            const originalText = text;

            // Get formatting options (from global FEATURES object)
            const options = {
                punctuation: window.FEATURES?.translateFormatPunctuation ?? true,
                space: window.FEATURES?.translateFormatSpace ?? true,
                dots: window.FEATURES?.translateFormatDots ?? false,
                newline: window.FEATURES?.translateFormatNewline ?? false
            };

            let formattedText = text;

            // Choose different processing based on whether to preserve newlines
            if (options.newline) {
                // Preserve newlines: process line by line
                const lines = text.split('\n');
                const formattedLines = lines.map(line => {
                    return this._formatLine(line, options);
                });
                formattedText = formattedLines.join('\n');
            } else {
                // Do not preserve newlines: process as whole (newlines will be replaced by space logic)
                formattedText = this._formatLine(text, options);
            }

            // Log
            if (originalText !== formattedText) {
                const enabledOptions = [];
                if (options.punctuation) enabledOptions.push('Punctuation conversion');
                if (options.space) enabledOptions.push('Space handling');
                if (options.dots) enabledOptions.push('Dot handling');
                if (options.newline) enabledOptions.push('Preserve newlines');

                const logFormatted = formattedText.length > 100 ?
                    formattedText.substring(0, 100) + '...' : formattedText;
                logger.debug(`Text formatting | Options: [${enabledOptions.join(', ')}] | Result: "${logFormatted}"`);
            }

            return formattedText;

        } catch (error) {
            logger.error(`Text formatting | Result: exception | Error: ${error.message}`);
            return text; // Return original text on error
        }
    }

    /**
     * Format a single line of text
     * Execute corresponding formatting operations based on options
     */
    static _formatLine(line, options) {
        let formattedLine = line;

        // 1. Punctuation conversion
        if (options.punctuation) {
            for (const [cnPunct, enPunct] of Object.entries(this.PUNCTUATION_MAP)) {
                formattedLine = formattedLine.split(cnPunct).join(enPunct);
            }
        }

        // 2. Handle consecutive dots
        if (options.dots) {
            formattedLine = formattedLine.replace(/\.{3,}/g, '...');
        }

        // 3. Handle extra spaces
        if (options.space) {
            formattedLine = formattedLine
                .replace(/\s+/g, ' ')           // Convert multiple spaces to single space
                .replace(/\s*,\s*/g, ', ')      // Unify spaces after commas
                .trim();                        // Remove leading and trailing spaces
        }

        return formattedLine;
    }

    /**
     * Determine the language type of the text
     */
    static detectLanguage(text) {
        try {
            if (!text) {
                return {
                    from: 'en',
                    to: 'zh'
                };
            }

            // Check if contains Chinese characters
            const hasChineseChars = /[\u4e00-\u9fff]/.test(text);
            // Check if contains English characters
            const hasEnglishChars = /[a-zA-Z]/.test(text);

            let from, to, type;

            if (hasChineseChars && !hasEnglishChars) {
                // Pure Chinese
                from = 'zh';
                to = 'en';
                type = 'Pure Chinese';
            } else if (!hasChineseChars && hasEnglishChars) {
                // Pure English
                from = 'en';
                to = 'zh';
                type = 'Pure English';
            } else {
                // Mixed language: compare number of Chinese characters vs English words to determine direction
                const cnChars = text.match(/[\u4e00-\u9fff]/g) || [];
                const enWords = text.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g) || [];
                const cnUnits = cnChars.length;
                const enUnits = enWords.length;

                // Get mixed language translation rule
                const rule = window.FEATURES?.mixedLangTranslateRule || 'auto_minor';

                switch (rule) {
                    case 'to_zh':
                        // Always translate to Chinese
                        from = 'en';
                        to = 'zh';
                        type = 'Mixed language → Chinese';
                        break;
                    case 'to_en':
                        // Always translate to English
                        from = 'zh';
                        to = 'en';
                        type = 'Mixed language → English';
                        break;
                    case 'auto_major':
                        // Translate the majority language
                        if (cnUnits > enUnits) {
                            from = 'zh';
                            to = 'en';
                            type = 'Mixed language - translate Chinese';
                        } else if (enUnits > cnUnits) {
                            from = 'en';
                            to = 'zh';
                            type = 'Mixed language - translate English';
                        } else {
                            from = 'zh';
                            to = 'en';
                            type = 'Mixed language';
                        }
                        break;
                    case 'auto_minor':
                    default:
                        // Translate the minority language (original logic)
                        if (cnUnits > enUnits) {
                            from = 'en';
                            to = 'zh';
                            type = 'Mixed language - translate English';
                        } else if (enUnits > cnUnits) {
                            from = 'zh';
                            to = 'en';
                            type = 'Mixed language - translate Chinese';
                        } else {
                            from = 'zh';
                            to = 'en';
                            type = 'Mixed language';
                        }
                        break;
                }
            }

            // Log
            logger.debug(`Language detection | Result: ${type} | Translation direction: ${from} → ${to}`);

            return { from, to };

        } catch (error) {
            logger.error(`Language detection | Result: exception | Error: ${error.message}`);
            return {
                from: 'en',
                to: 'zh'
            };
        }
    }

    /**
     * Check if the text is a mix of Chinese and English
     */
    static isMixedChineseEnglish(text) {
        if (!text) return false;
        const hasChinese = /[\u4e00-\u9fff]/.test(text);
        const hasEnglish = /[A-Za-z]/.test(text);
        return hasChinese && hasEnglish;
    }
}

export { PromptFormatter };
