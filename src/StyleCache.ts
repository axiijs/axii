// Style caching system to reduce style sheet creation and updates
export class StyleCache {
    private static instance: StyleCache;
    private styleCache = new Map<string, {
        sheet: CSSStyleSheet;
        rules: Set<string>;
        lastUpdate: number;
    }>();

    private constructor() {}

    static getInstance(): StyleCache {
        if (!StyleCache.instance) {
            StyleCache.instance = new StyleCache();
        }
        return StyleCache.instance;
    }

    getStyleSheet(id: string): CSSStyleSheet | undefined {
        return this.styleCache.get(id)?.sheet;
    }

    hasRule(id: string, rule: string): boolean {
        return this.styleCache.get(id)?.rules.has(rule) || false;
    }

    addRule(id: string, rule: string, sheet: CSSStyleSheet) {
        let cache = this.styleCache.get(id);
        if (!cache) {
            cache = {
                sheet,
                rules: new Set(),
                lastUpdate: Date.now()
            };
            this.styleCache.set(id, cache);
        }
        cache.rules.add(rule);
        cache.lastUpdate = Date.now();
    }

    // Clean up unused style sheets (called periodically)
    cleanup(maxAgeMs: number = 300000) { // 5 minutes default
        const now = Date.now();
        for (const [id, cache] of this.styleCache.entries()) {
            if (now - cache.lastUpdate > maxAgeMs) {
                const sheet = cache.sheet;
                const adoptedSheets = Array.from(document.adoptedStyleSheets);
                const index = adoptedSheets.indexOf(sheet);
                if (index !== -1) {
                    adoptedSheets.splice(index, 1);
                    document.adoptedStyleSheets = adoptedSheets;
                }
                this.styleCache.delete(id);
            }
        }
    }
}
