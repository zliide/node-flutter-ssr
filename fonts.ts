class FontFace {
    readonly family
    readonly asset
    readonly descriptors
    #status: 'error' | 'loaded' | 'loading' | 'unloaded' = 'loading'
    get status() {
        return this.#status
    }

    constructor(family: string, source: any, descriptors: string) {
        if (typeof source !== 'string') {
            throw new Error('Not implemented.')
        }
        this.family = family
        this.asset = source
        this.descriptors = descriptors
    }

    load() {
        this.#status = 'loaded'
        return Promise.resolve(this)
    }
}

export function installFonts(window: any) {
    window.FontFace = FontFace
    window.document.fonts = new Set()
}

export function scriptLoadingFonts(window: any) {
    return 'const fontLoaders = [];\r\n' + [...window.document.fonts]
        .filter(face => !face.family.startsWith('\'')) // Ignore Safari work-around
        .map((face, ix) => `const _f${ix} = new FontFace('${face.family}','${face.asset}',${JSON.stringify(face.descriptors)});\r\nfontLoaders.push(_f${ix}.load().then(function() { document.fonts.add(_f${ix}); }).catch(function (e) { console.error('Error loading font ${face.family}'); console.error(e); }));`)
        .join('\r\n')
}
