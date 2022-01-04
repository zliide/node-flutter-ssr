import { FetchOptions, JSDOM, ResourceLoader, VirtualConsole } from 'jsdom'
import { installCanvasRecorder, scriptPlayingRecordedCanvases } from 'canvas-recorder'
import { BlobStore, installBlobs } from './blobs.js'
import { installFonts, scriptLoadingFonts } from './fonts.js'
import { Semaphore, settled, trackNetworkRequests, trackTimers } from './loading.js'

export type TextMeasure = (font: string, text: string) => { height: number, width: number, descent: number }

type AbortSignal = { aborted: boolean }

export class Renderer {
    #domCache: Map<string, { dom: JSDOM, lock: Promise<string>, semaphore: Semaphore }> | undefined
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
        this.#domCache = new Map<string, { dom: JSDOM, lock: Promise<string>, semaphore: Semaphore }>()
    }

    async #getDom(userAgent: string, initialUrl: string) {
        if (!this.#domCache) {
            throw new Error('Renderer closed')
        }
        const cached = this.#domCache.get(userAgent)
        if (cached) {
            return cached
        }
        const blobs = new BlobStore(this.#baseUrl)
        const loader = new BlobResourceLoader(userAgent, blobs,
            new FlutterAppResourceLoader(this.#logger, this.#baseUrl, userAgent, this.#resourceFetcher, this.#blockList))
        const isMobile = userAgent.includes('Android') || userAgent.includes('iPhone') || userAgent.includes('Mobile')
        const semaphore = new Semaphore()
        const lock = Promise.resolve('')
        const dom = new JSDOM(await this.#resourceFetcher('index.html'), {
            virtualConsole: createConsole(this.#logger),
            resources: new CountingResourceLoader(userAgent, loader, semaphore),
            userAgent,
            url: this.#baseUrl + '#' + initialUrl,
            contentType: 'text/html',
            runScripts: 'dangerously',
            beforeParse: window => {
                monkeyPatch(window, blobs, this.#textMeasure)
                trackNetworkRequests(this.#logger, window, semaphore)
                trackTimers(window, semaphore)
                setWindowSize(window, isMobile ? { width: 411, height: 731 } : { width: 1920, height: 1600 })
                window.localStorage['flutter.ServerSideRendering'] = true
            },
        })
        return { dom, lock, semaphore }
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
        const { lock, dom, semaphore } = await this.#getDom(userAgent, url)
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

                await settled(dom.window, semaphore, signal)

                Array.from(dom.window.document.getElementsByTagName('script'))
                    .filter(scriptTag =>
                        scriptTag.getAttribute('type') === 'application/javascript'
                        || scriptTag.getAttribute('type') === 'text/javascript'
                        || scriptTag.text.includes('loadMainDartJs'))
                    .forEach(scriptTag => scriptTag.remove())

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

const dummyGif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x00, 0x3b])
const dummyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04,
    0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x64, 0x60, 0x00, 0x00, 0x00, 0x06, 0x00, 0x02, 0x30, 0x81, 0xd0, 0x2f,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
const dummyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xc2, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x01, 0x3f, 0x10])

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

class BlobResourceLoader extends ResourceLoader {
    #inner
    #blobs

    constructor(userAgent: string, blobs: BlobStore, inner: ResourceLoader) {
        super({ userAgent })
        this.#blobs = blobs
        this.#inner = inner
    }

    fetch(url: string, options: FetchOptions) {
        return this.#blobs.get(url).then(blob => {
            if (blob) {
                return blob
            }
            return this.#inner.fetch(url, options)
        }) as any
    }
}

class CountingResourceLoader extends ResourceLoader {
    #inner
    #semaphore

    constructor(userAgent: string, inner: ResourceLoader, semaphore: Semaphore) {
        super({ userAgent })
        this.#inner = inner
        this.#semaphore = semaphore
    }

    fetch(url: string, options: FetchOptions) {
        return this.#semaphore.wait(this.#inner.fetch(url, options)) as any
    }
}

class PannerStub {
}
class AudioContextStub {
    createPanner() { return new PannerStub() }
    createStereoPanner() { return new PannerStub() }
}
class MediaElementAudioSourceNodeStub {
}
class GeolocationStub {
}

function monkeyPatch(window: any, blobs: BlobStore, textMeasure: TextMeasure) {
    Object.defineProperty(window.navigator, 'vendor', {
        value: 'Google Inc.',
    })

    installFonts(window)
    installCanvasRecorder(window, textMeasure)
    installBlobs(window, blobs)

    const innerElementFactory = window.document.createElement.bind(window.document)
    window.document.createElement = (localName: string) => {
        const element = innerElementFactory(localName)
        if (localName.toLowerCase() === 'p') {
            element.getBoundingClientRect = () => {
                const size = textMeasure(element.style.font, element.textContent)
                return {
                    x: 0,
                    y: 0,
                    bottom: size.height - size.descent,
                    height: size.height,
                    left: 0,
                    right: 0,
                    top: 0,
                    width: 0,
                }
            }
        }
        return element
    }

    window.AudioContext = AudioContextStub
    window.MediaElementAudioSourceNode = MediaElementAudioSourceNodeStub
    window.navigator.geolocation = GeolocationStub
    window.Element.prototype.attachShadow = function (this) {
        const element = window.document.createElement('flt-element-host-node')
        this.append(element)
        return element
    }
    window.matchMedia = (media: any) => ({
        media,
        matches: false,
        onchange: null,
        addListener: () => { /**/ },
    })
    Object.defineProperty(window.navigator, 'languages', {
        value: null,
    })
}

function setWindowSize(window: any, size: { width: number, height: number }) {
    window.innerWidth = size.width
    window.innerHeight = size.height
}
