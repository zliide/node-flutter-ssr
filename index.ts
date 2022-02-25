import { installCanvasRecorder, scriptPlayingRecordedCanvases } from 'canvas-recorder'
import { FetchOptions, JSDOM, ResourceLoader, VirtualConsole } from 'jsdom'
import { BlobStore, installBlobs } from './blobs.js'
import { installFonts, scriptLoadingFonts } from './fonts.js'
import { trackDocumentLoad, PageTaskTracker, trackImageLoading, trackNetworkRequests, trackTimers, wait } from './loading.js'
import { app, middleware, mapFetch, wrapFetch } from './middleware.js'
import { monkeyPatch } from './monkey.js'
import { memoize as _memoize } from 'canvas-recorder'

export type TextMeasure = (font: string, text: string) => { height: number, width: number, descent: number }

export function memoize(maxTexts: number, textMeasure: TextMeasure): TextMeasure {
    return _memoize(maxTexts, textMeasure)
}

const font = middleware({ init: installFonts })
const canvasReorder = (textMeasure: TextMeasure) => middleware({ init: (window: any) => installCanvasRecorder(window, textMeasure) })
const monkeyPatches = (textMeasure: TextMeasure) => middleware({ init: (window: any) => monkeyPatch(window, textMeasure) })
const blobs = (baseUrl: string) => middleware({
    state: () => new BlobStore(baseUrl),
    resourceHandler: (url, options, store, inner) => mapFetch(url, options, () => store.get(url), async blob => Buffer.from(await blob.arrayBuffer()), inner),
    init: installBlobs,
})
const loading = (logger: Logger) => middleware({
    state: () => new PageTaskTracker(),
    resourceHandler: (url, options, tracker, inner) => wrapFetch(p => wait(tracker, p), inner(url, options)),
    init: (window, tracker) => {
        window.__loadingTracker = tracker
        trackDocumentLoad(window, tracker)
        trackNetworkRequests(logger, window, tracker)
        trackTimers(window, tracker, timeout => timeout === 16 ? 1 : timeout < 2500 ? timeout : Number.POSITIVE_INFINITY)
        trackImageLoading(window, tracker)
    },
})

async function windowSettled(window: any, signal: { aborted: boolean } | undefined) {
    await window.__loadingTracker.settled(signal)
}

type AbortSignal = { aborted: boolean }

export class Renderer {
    #domCache: Map<string, { dom: JSDOM, lock: Promise<string> }> | undefined
    #logger = new LogProxy()
    #baseUrl
    #blockList
    #resourceFetcher
    #textMeasure

    constructor(resourceFetcher: (name: string) => Promise<Buffer>, baseUrl: string, blockList: string[], textMeasure: TextMeasure) {
        this.#baseUrl = baseUrl
        this.#blockList = blockList
        this.#resourceFetcher = resourceFetcher
        this.#textMeasure = textMeasure
        this.#domCache = new Map<string, { dom: JSDOM, lock: Promise<string> }>()
    }

    async #getDom(userAgent: string, initialUrl: string) {
        if (!this.#domCache) {
            throw new Error('Renderer closed')
        }
        const cached = this.#domCache.get(userAgent)
        if (cached) {
            return cached
        }
        const isMobile = userAgent.includes('Android') || userAgent.includes('iPhone') || userAgent.includes('Mobile')
        const lock = Promise.resolve('')
        const dom = new JSDOM(await this.#resourceFetcher('index.html'), app()
            .use(font)
            .use(blobs(this.#baseUrl))
            .use(canvasReorder(this.#textMeasure))
            .use(monkeyPatches(this.#textMeasure))
            .use(loading(this.#logger))
            .config(
                {
                    virtualConsole: createConsole(this.#logger),
                    resources: new FlutterAppResourceLoader(this.#logger, this.#baseUrl, userAgent, this.#resourceFetcher, this.#blockList),
                    userAgent,
                    url: this.#baseUrl + '#' + initialUrl,
                    contentType: 'text/html',
                    runScripts: 'dangerously',
                    beforeParse: window => {
                        setWindowSize(window, isMobile ? { width: 411, height: 731 } : { width: 1920, height: 1600 })
                        window.localStorage['flutter.ServerSideRendering'] = true
                    },
                }))

        return { dom, lock }
    }

    #updateLock(userAgent: string, lock: Promise<string>) {
        if (!this.#domCache) {
            return
        }
        const dom = this.#domCache.get(userAgent)
        if (dom) {
            dom.lock = lock
        }
    }

    async render(log: Logger, userAgent: string, url: string, signal?: AbortSignal) {
        const { lock, dom } = await this.#getDom(userAgent, url)
        const renderPromise = (async () => {
            try {
                await lock
            } catch (e) { /* Also thrown when awaiting renderPromise below */ }
            this.#logger.destination = log
            try {
                const location = this.#baseUrl + '#' + url
                if (dom.window.location.href !== location) {
                    dom.window.location.href = location
                }

                await windowSettled(dom.window, signal)

                Array.from(dom.window.document.getElementsByTagName('script'))
                    .filter(scriptTag =>
                        scriptTag.getAttribute('type') === 'application/javascript'
                        || scriptTag.getAttribute('type') === 'text/javascript'
                        || scriptTag.text.includes('loadMainDartJs'))
                    .forEach(scriptTag => scriptTag.remove())
                Array.from(dom.window.document.getElementsByTagName('link'))
                    .filter(relTag =>
                        relTag.getAttribute('rel') === 'preload'
                        || relTag.getAttribute('as') === 'script')
                    .forEach(relTag => relTag.remove())

                return dom.serialize()
                    .replace('</head>', `<script type="application/javascript">\r\n${scriptLoadingFonts(dom.window)}</script>\r\n</head>`)
                    .replace('</body>', `<script type="application/javascript">\r\nPromise.all(fontLoaders).then(function(){\r\n${scriptPlayingRecordedCanvases(dom.window)}\r\n})</script>\r\n</body>`)
            } finally {
                this.#logger.destination = undefined
            }
        })()
        this.#updateLock(userAgent, renderPromise)
        return await renderPromise
    }

    async close() {
        if (!this.#domCache) {
            return
        }
        const doms = [...this.#domCache.values()]
        this.#domCache = undefined
        await Promise.all(doms.map(d => d.lock))
        doms.forEach(d => d.dom.window.close())
    }
}

function setWindowSize(window: any, size: { width: number, height: number }) {
    window.innerWidth = size.width
    window.innerHeight = size.height
}

interface Logger {
    trace(message: string, error?: unknown): void
    debug(message: string, error?: unknown): void
    info(message: string, error?: unknown): void
    warn(message: string, error?: unknown): void
    error(message: string, error?: unknown): void
    fatal(message: string, error?: unknown): void
}

class LogProxy {
    destination: Logger | undefined

    trace(message: string, error?: unknown) { this.destination?.trace(message, error) }
    debug(message: string, error?: unknown) { this.destination?.debug(message, error) }
    info(message: string, error?: unknown) { this.destination?.info(message, error) }
    warn(message: string, error?: unknown) { this.destination?.warn(message, error) }
    error(message: string, error?: unknown) { this.destination?.error(message, error) }
    fatal(message: string, error?: unknown) { this.destination?.fatal(message, error) }
}

function createConsole(logger: Logger) {
    const virtualConsole = new VirtualConsole()
    virtualConsole.on('jsdomError', (e: any) => {
        logger.error('Javascript error during server-side rendering', e)
    })
    virtualConsole.on('error', message => {
        logger.error('Error from javascript during server-side rendering: ' + message)
    })
    virtualConsole.on('warn', message => {
        logger.warn('Error from javascript during server-side rendering: ' + message)
    })
    virtualConsole.on('info', message => {
        logger.debug('Error from javascript during server-side rendering: ' + message)
    })
    virtualConsole.on('trace', message => {
        logger.trace('Error from javascript during server-side rendering: ' + message)
    })
    virtualConsole.on('log', message => {
        logger.trace('Log from javascript during server-side rendering: ' + message)
    })
    virtualConsole.on('dir', message => {
        logger.trace('Dir from javascript during server-side rendering: ' + message)
    })
    return virtualConsole
}

class FlutterAppResourceLoader extends ResourceLoader {
    #logger
    #baseUrl
    #fetcher
    #blockList

    constructor(log: Logger, baseUrl: string, userAgent: string, fetcher: (name: string) => Promise<Buffer>, blockList: string[]) {
        super({ userAgent })
        this.#logger = log
        this.#baseUrl = baseUrl
        this.#fetcher = fetcher
        this.#blockList = blockList
    }

    fetch(url: string, options: FetchOptions) {
        this.#logger.trace('Fetching ' + url)
        if (url.startsWith(this.#baseUrl)) {
            return this.#fetcher(url.substring(this.#baseUrl.length))
        }
        if (url.startsWith('data:')) {
            return Promise.resolve(Buffer.from(url.substring(url.indexOf(';base64,') + 8), 'base64'))
        }
        if (url.endsWith('.png')) {
            return Promise.resolve(dummyPng)
        }
        if (url.endsWith('.jpg') || url.endsWith('.jpeg')) {
            return Promise.resolve(dummyJpeg)
        }
        if (url.endsWith('.gif')) {
            return Promise.resolve(dummyGif)
        }

        if (this.#blockList.includes(url)) {
            return Promise.resolve(Buffer.from('')) as any
        }
        this.#logger.error('Unexpected server-side render resource: ' + url)
        return super.fetch(url, options) as any
    }
}

const dummyGif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x00, 0x3b])
const dummyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04,
    0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x64, 0x60, 0x00, 0x00, 0x00, 0x06, 0x00, 0x02, 0x30, 0x81, 0xd0, 0x2f,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
const dummyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xc2, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x01, 0x3f, 0x10])
