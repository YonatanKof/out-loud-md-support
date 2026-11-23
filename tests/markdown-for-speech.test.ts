import { describe, it, expect } from "vitest";
import {
  looksLikeMarkdown,
  markdownToSpeechText,
  prepareSpeechText,
} from "../electron/markdown-for-speech.js";

describe("looksLikeMarkdown", () => {
  it("returns false for plain sentences", () => {
    expect(looksLikeMarkdown("Hello world. This is fine.")).toBe(false);
  });

  it("returns true for common markdown markers", () => {
    expect(looksLikeMarkdown("# Title\n\n**bold**")).toBe(true);
    expect(looksLikeMarkdown("- item one")).toBe(true);
    expect(looksLikeMarkdown("[link](https://example.com)")).toBe(true);
  });
});

describe("prepareSpeechText / markdownToSpeechText", () => {
  it("leaves plain text unchanged", () => {
    const plain = "Say hello, world!";
    expect(prepareSpeechText(plain)).toBe(plain);
    expect(markdownToSpeechText(plain).isMarkdown).toBe(false);
  });

  it("strips heading hashes and bold markers", () => {
    const md = "# Heading\n\n**Bold** and _italic_ with a [link](https://example.com)";
    const out = prepareSpeechText(md);
    expect(out).not.toMatch(/^#/m);
    expect(out).not.toContain("**");
    expect(out).not.toContain("_italic_");
    expect(out).toContain("Heading");
    expect(out).toContain("Bold");
    expect(out).toContain("italic");
    expect(out).toContain("link");
    expect(out).not.toContain("example.com");
  });

  it("speaks link labels only", () => {
    const out = prepareSpeechText("See [Out Loud](https://out-loud.io) today.");
    expect(out).toContain("Out Loud");
    expect(out).not.toContain("https");
  });

  it("omits fenced code but keeps inline code", () => {
    const md = "Before\n\n```js\nconst x = 1;\n```\n\nAfter `inline` end.";
    const out = prepareSpeechText(md);
    expect(out).toContain("Before");
    expect(out).toContain("After");
    expect(out).toContain("inline");
    expect(out).not.toContain("const");
    expect(out).not.toContain("```");
  });

  it("inserts pause markers for structure", () => {
    const out = prepareSpeechText("# Title\n\n- one\n- two");
    expect(out).toMatch(/\[0\.\d+s\]/);
  });

  it("handles bullet list without speaking markers", () => {
    const out = prepareSpeechText("- alpha\n- beta");
    expect(out).not.toMatch(/^-/m);
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
  });
});
