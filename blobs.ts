import probe from 'probe-image-size'
import { Readable } from 'stream'

export class BlobStore {
    #baseUrl
    #blobs
    #counter = 0

    constructor(baseUrl: string) {
        this.#baseUrl = baseUrl
        this.#blobs = new Map<string, Blob>()
    }

    addBlob(obj: Blob | MediaSource) {
        if (!isBlob(obj)) {
            throw new Error('Media blobs not implemented.')
        }
        const url = `blob:${this.#baseUrl}${++this.#counter}`
        this.#blobs.set(url, obj)
        return url
    }

    removeBlob(url: string) {
        return this.#blobs.delete(url)
    }

    get(url: string) {
        return this.#blobs.get(url)
    }
}

function isBlob(obj: Blob | MediaSource): obj is Blob {
    return typeof (obj as any).size === 'number'
}

function assignMetadataToImage(image: any, meta: probe.ProbeResult) {
    Object.defineProperties(image, {
        naturalWidth: {
            configurable: true,
            value: meta.width,
        },
        naturalHeight: {
            configurable: true,
            value: meta.height,
        },
    })
}

class ArrayBufferBlob {
    #buffer

    constructor(buffers: ArrayBuffer[]) {
        this.#buffer = buffers
    }

    get size() {
        return this.#buffer[0].byteLength
    }

    arrayBuffer() {
        return Promise.resolve(this.#buffer[0])
    }
}

export function installBlobs(window: any, blobs: BlobStore) {
    window.Blob = ArrayBufferBlob as any
    const url = URL
    window.URL = url
    window.URL.createObjectURL = (obj: Blob | MediaSource) => blobs.addBlob(obj)
    window.URL.revokeObjectURL = (u: string) => blobs.removeBlob(u)

    window.Image.prototype.decode = async function (this) {
        const u: string = this.src
        const blob = blobs.get(u)
        if (blob) {
            const buffer = Buffer.from(await blob.arrayBuffer())
            this.src = `data:image/gif;base64,${buffer.toString('base64')}`
            assignMetadataToImage(this, await probe(Readable.from(buffer)))
            return
        }
        assignMetadataToImage(this, await probe(this.src, { headers: { 'user-agent': window.navigator.userAgent } } as any))
    }

    const innerElementFactory = window.document.createElement.bind(window.document)
    window.document.createElement = (localName: string) => {
        const inner = innerElementFactory(localName)
        switch (localName.toLowerCase()) {
            case 'img': {
                let onLoad = () => { /**/ }
                let onError = () => { /**/ }
                const innerSrcGetter = inner.__lookupGetter__('src').bind(inner)
                const innerSrcSetter = inner.__lookupSetter__('src').bind(inner)
                const innerOnLoad = inner.__lookupSetter__('onload').bind(inner)
                const innerOnError = inner.__lookupSetter__('onerror').bind(inner)
                Object.defineProperties(inner, {
                    src: {
                        configurable: true,
                        get() {
                            return innerSrcGetter()
                        },
                        set(value: string) {
                            innerSrcSetter(value)
                            if (value.startsWith('https://')) {
                                probe(value, { headers: { 'user-agent': window.navigator.userAgent } } as any)
                                    .then(meta => {
                                        assignMetadataToImage(this, meta)
                                        onLoad()
                                    })
                                    .catch(onError)
                            } else {
                                onLoad()
                            }
                        },
                    },
                    onload: {
                        configurable: true,
                        set(handler: () => void) {
                            onLoad = handler
                            innerOnLoad(handler)
                        },
                    },
                    onerror: {
                        configurable: true,
                        set(handler: () => void) {
                            onError = handler
                            innerOnError(handler)
                        },
                    },
                })
                break
            }
        }
        return inner
    }
}
