const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const markdownIt = require("markdown-it");
const markdownItAnchor = require("markdown-it-anchor");

module.exports = function (eleventyConfig) {

  // ── PLUGINS ──
  eleventyConfig.addPlugin(syntaxHighlight);

  // ── MARKDOWN CONFIG ──
  const md = markdownIt({
    html: true,
    linkify: true,
    typographer: true,
  }).use(markdownItAnchor, {
    permalink: markdownItAnchor.permalink.headerLink(),
    slugify: s => s.toLowerCase().replace(/[^\w]+/g, '-')
  });
  eleventyConfig.setLibrary("md", md);

  // ── PASSTHROUGH ──
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });
  eleventyConfig.addPassthroughCopy({ "src/site.webmanifest": "site.webmanifest" });

  // ── COLLECTIONS ──
  eleventyConfig.addCollection("posts", function (collectionApi) {
    return collectionApi
      .getFilteredByGlob("src/blog/**/*.md")
      .sort((a, b) => b.date - a.date);
  });

  // ── FILTERS ──
  eleventyConfig.addFilter("dateDisplay", (date) => {
    return new Date(date).toLocaleDateString("en-IN", {
      year: "numeric", month: "long", day: "numeric",
      timeZone: "Asia/Kolkata"
    });
  });

  eleventyConfig.addFilter("dateISO", (date) => {
    return new Date(date).toISOString().split("T")[0];
  });

  eleventyConfig.addFilter("readingTime", (content) => {
    const words = content.replace(/<[^>]+>/g, "").split(/\s+/).length;
    return Math.ceil(words / 200);
  });

  eleventyConfig.addFilter("excerpt", (content) => {
    const text = content.replace(/<[^>]+>/g, "");
    return text.slice(0, 160).trim() + "…";
  });

  // ── SHORTCODES ──
  eleventyConfig.addShortcode("year", () => `${new Date().getFullYear()}`);

  eleventyConfig.addPairedShortcode("callout", (content, type = "info") => {
    const icons = { info: "💡", warn: "⚠️", ok: "✓", tip: "→" };
    return `<div class="callout callout--${type}"><span class="callout__icon">${icons[type] || "💡"}</span><div class="callout__body">${content}</div></div>`;
  });

  eleventyConfig.addPairedShortcode("tldr", (content) => {
    return `<div class="tldr"><div class="tldr__label">TL;DR</div><div class="tldr__body">${content}</div></div>`;
  });

  // ── DIR CONFIG ──
  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      layouts: "_includes/layouts",
      data: "_data",
    },
    templateFormats: ["md", "njk", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
};
