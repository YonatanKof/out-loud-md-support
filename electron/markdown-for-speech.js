/**
 * Convert Markdown-ish pasted text into speakable plain text for Kokoro TTS.
 *
 * Pipeline: espeak-ng phonemization → ONNX (no SSML / per-word prosody). Structure
 * and light emphasis cues use the app's pause markers ([Ns]) that sanitizeText()
 * already interprets.
 *
 * Code blocks: omitted with a short pause (syntax is noise when listening).
 * Inline `code`: spoken as literal content. Links: label only.
 */
export function looksLikeMarkdown(text) {
    if (!text || !text.trim())
        return false;
    const patterns = [
        /^\s{0,3}#{1,6}\s+\S/m,
        /^\s{0,3}>\s+\S/m,
        /^\s{0,3}(?:[-*+]|\d+[.)])\s+\S/m,
        /```/,
        /!\[[^\]]*\]\([^)]+\)/,
        /\[[^\]]+\]\([^)]+\)/,
        /\*\*[^*\n]+\*\*/,
        /__[^_\n]+__/,
        /(?:^|[^\w`])_[^_\n]+_(?:[^\w`]|$)/m,
        /`[^`\n]+`/,
        /^\s{0,3}(?:-{3,}|_{3,}|\*{3,})/m,
    ];
    return patterns.some((re) => re.test(text));
}
class SpeechBuilder {
    source;
    out = [];
    map = [];
    constructor(source) {
        this.source = source;
    }
    insert(literal) {
        for (const ch of literal) {
            this.out.push(ch);
            this.map.push(-1);
        }
    }
    copyFromSource(srcStart, srcEnd) {
        for (let i = srcStart; i < srcEnd; i++) {
            this.out.push(this.source[i]);
            this.map.push(i);
        }
    }
    finish(isMarkdown) {
        let raw = this.out.join("");
        const rawMap = this.map;
        raw = raw.replace(/\n{3,}/g, "\n\n");
        const trimLeft = raw.match(/^\s*/)?.[0].length ?? 0;
        const trimRight = raw.match(/\s*$/)?.[0].length ?? 0;
        const start = trimLeft;
        const end = raw.length - trimRight;
        const text = raw.slice(start, end);
        const map = rawMap.slice(start, end);
        return { text, isMarkdown, sourceIndexByOutput: Int32Array.from(map) };
    }
}
function passthrough(text) {
    const sourceIndexByOutput = new Int32Array(text.length);
    for (let i = 0; i < text.length; i++)
        sourceIndexByOutput[i] = i;
    return { text, isMarkdown: false, sourceIndexByOutput };
}
function* iterSpeakableLines(source) {
    let i = 0;
    while (i < source.length) {
        if (source.startsWith("```", i)) {
            const close = source.indexOf("```", i + 3);
            if (close === -1)
                break;
            i = close + 3;
            while (i < source.length && source[i] === "\n")
                i++;
            continue;
        }
        const lineEnd = source.indexOf("\n", i);
        const end = lineEnd === -1 ? source.length : lineEnd;
        yield { text: source.slice(i, end), start: i, end };
        if (lineEnd === -1)
            break;
        i = lineEnd + 1;
    }
}
function processInline(source, b, start, end) {
    let i = start;
    while (i < end) {
        const rest = source.slice(i, end);
        const code = rest.match(/^`([^`\n]+)`/);
        if (code) {
            const innerStart = i + 1;
            b.copyFromSource(innerStart, innerStart + code[1].length);
            i += code[0].length;
            continue;
        }
        const img = rest.match(/^!\[([^\]]*)\]\([^)]*\)/);
        if (img) {
            const alt = img[1].trim();
            if (alt)
                b.copyFromSource(i + 2, i + 2 + alt.length);
            i += img[0].length;
            continue;
        }
        const link = rest.match(/^\[([^\]]+)\]\([^)]*\)/);
        if (link) {
            b.copyFromSource(i + 1, i + 1 + link[1].length);
            i += link[0].length;
            continue;
        }
        const tri = rest.match(/^(\*{3}|_{3})([\s\S]+?)\1/);
        if (tri) {
            b.insert("[0.18s]");
            processInline(source, b, i + 3, i + 3 + tri[2].length);
            b.insert("[0.08s]");
            i += tri[0].length;
            continue;
        }
        const bold = rest.match(/^(\*\*|__)([\s\S]+?)\1/);
        if (bold) {
            b.insert("[0.15s]");
            processInline(source, b, i + 2, i + 2 + bold[2].length);
            b.insert("[0.08s]");
            i += bold[0].length;
            continue;
        }
        const italicStar = rest.match(/^\*([^*\n]+)\*/);
        if (italicStar) {
            b.insert("[0.1s]");
            processInline(source, b, i + 1, i + 1 + italicStar[1].length);
            i += italicStar[0].length;
            continue;
        }
        const italicUnder = rest.match(/^_([^_\n]+)_/);
        if (italicUnder && (i === start || !/\w/.test(source[i - 1]))) {
            b.insert("[0.1s]");
            processInline(source, b, i + 1, i + 1 + italicUnder[1].length);
            i += italicUnder[0].length;
            continue;
        }
        const autolink = rest.match(/^<((?:https?|mailto):[^>]+)>/);
        if (autolink) {
            i += autolink[0].length;
            continue;
        }
        if (/^<\/?[a-z][^>]*>/i.test(rest)) {
            const tagEnd = rest.indexOf(">");
            if (tagEnd !== -1) {
                i += tagEnd + 1;
                continue;
            }
        }
        b.copyFromSource(i, i + 1);
        i++;
    }
}
function lineContentBounds(line) {
    const text = line.text;
    let start = line.start;
    let end = line.end;
    const heading = text.match(/^(\s{0,3})(#{1,6})\s+(.*)$/s);
    if (heading) {
        start += heading[1].length + heading[2].length + 1;
        end = line.start + text.length;
        return { start, end };
    }
    const bq = text.match(/^(\s{0,3})>\s?(.*)$/s);
    if (bq) {
        start += bq[1].length + (text.includes("> ") ? 2 : 1);
        return { start, end: line.end };
    }
    const ul = text.match(/^(\s{0,3})[-*+]\s+(.*)$/s);
    if (ul) {
        start += ul[1].length + 2;
        return { start, end: line.end };
    }
    const olPrefix = text.match(/^(\s{0,3})\d+[.)]\s+/);
    if (olPrefix) {
        start = line.start + olPrefix[0].length;
        return { start, end: line.end };
    }
    return { start: line.start, end: line.end };
}
export function markdownToSpeechText(source) {
    if (!looksLikeMarkdown(source))
        return passthrough(source);
    const b = new SpeechBuilder(source);
    const lines = [...iterSpeakableLines(source)];
    let prevList = false;
    let prevHeading = false;
    let prevWasContent = false;
    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        // Fenced code → pause between what's before and after (blocks already skipped in iter)
        if (li > 0 && lines[li - 1].end < line.start - 1) {
            b.insert("[0.35s]");
        }
        if (line.text.trim() === "") {
            if (prevWasContent)
                b.insert("\n");
            prevList = false;
            prevHeading = false;
            prevWasContent = false;
            continue;
        }
        if (/^\s{0,3}(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line.text)) {
            b.insert("[0.6s]");
            prevList = false;
            prevHeading = false;
            prevWasContent = false;
            continue;
        }
        const heading = line.text.match(/^(\s{0,3})(#{1,6})\s+/);
        if (heading) {
            if (prevWasContent && !prevHeading)
                b.insert("[0.55s]");
            const bounds = lineContentBounds(line);
            processInline(source, b, bounds.start, bounds.end);
            b.insert("[0.25s]");
            prevHeading = true;
            prevList = false;
            prevWasContent = true;
            if (li < lines.length - 1)
                b.insert("\n");
            continue;
        }
        prevHeading = false;
        const isUl = /^\s{0,3}[-*+]\s+/.test(line.text);
        const isOl = /^\s{0,3}\d+[.)]\s+/.test(line.text);
        if (isUl || isOl) {
            if (prevList)
                b.insert("[0.22s]");
            else if (prevWasContent)
                b.insert("[0.2s]");
            const bounds = lineContentBounds(line);
            processInline(source, b, bounds.start, bounds.end);
            prevList = true;
            prevWasContent = true;
            if (li < lines.length - 1)
                b.insert("\n");
            continue;
        }
        prevList = false;
        const bounds = lineContentBounds(line);
        processInline(source, b, bounds.start, bounds.end);
        prevWasContent = true;
        if (li < lines.length - 1)
            b.insert("\n");
    }
    return b.finish(true);
}
export function prepareSpeechText(raw) {
    if (!looksLikeMarkdown(raw))
        return raw;
    return markdownToSpeechText(raw).text;
}
export function sourceRangeForSpeechRange(result, outStart, outEnd) {
    if (!result.isMarkdown)
        return { start: outStart, end: outEnd };
    const map = result.sourceIndexByOutput;
    let start = -1;
    let end = -1;
    for (let i = outStart; i < outEnd && i < map.length; i++) {
        const src = map[i];
        if (src < 0)
            continue;
        if (start === -1)
            start = src;
        end = src + 1;
    }
    if (start === -1)
        return null;
    return { start, end };
}
//# sourceMappingURL=markdown-for-speech.js.map