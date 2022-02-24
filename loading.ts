interface Tracker {
    increment(): void
    decrement(): void
}

export async function wait<T>(tracker: Tracker, promise: Promise<T>) {
    tracker.increment()
    try {
        return await promise
    } finally {
        tracker.decrement()
    }
}

export class PageTaskTracker implements Tracker {
    semaphore = new Semaphore()
    #stuffHappened = false

    async settled(signal?: { aborted: boolean } | undefined) {
        let ioHappened
        let ioHandled
        do {
            if (signal?.aborted) {
                throw new Error('Rendering aborted while waiting for timers and network to settle.')
            }
            ioHappened = await this.semaphore.checkForMoreWork()
            ioHandled = await this.#microTasks()
        } while (ioHappened || ioHandled)
    }

    async #microTasks() {
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        const stuffHappened = this.#stuffHappened
        this.#stuffHappened = false
        return stuffHappened
    }

    increment() {
        this.#stuffHappened = true
        this.semaphore.increment()
    }
    decrement() {
        this.semaphore.decrement()
    }
}

class Semaphore implements Tracker {
    #count = 0
    #resolve: ((stuffDone: boolean) => void) | undefined
    #promise: Promise<boolean> | undefined

    checkForMoreWork() {
        if (this.#promise) {
            return this.#promise
        }
        return Promise.resolve(false)
    }

    increment() {
        if (++this.#count === 1) {
            this.#promise = new Promise<boolean>(resolve => {
                this.#resolve = resolve
            })
        }
    }
    decrement() {
        if (--this.#count === 0) {
            this.#resolve!(true)
            this.#promise = undefined
            this.#resolve = undefined
        }
    }
}

interface Logger {
    trace(message: string, error?: unknown): void
    error(message: string, error?: unknown): void
}

export function trackNetworkRequests(log: Logger, window: any, tracker: Tracker) {
    const oldXhrOpen = window.XMLHttpRequest.prototype.open
    window.XMLHttpRequest.prototype.open = function (this, method: any, requestUrl: any) {
        tracker.increment()
        log.trace('Request BEGIN: ' + requestUrl)
        this.addEventListener('loadend', () => {
            tracker.decrement()
            log.trace('Request END:   ' + requestUrl)
        })
        this.addEventListener('abort', function (this: any, _event: any) {
            tracker.decrement()
            log.error('Request END:   ' + requestUrl + ' (aborted)')
        })
        this.addEventListener('error', function (this: any, _event: any) {
            tracker.decrement()
            log.error('Request END:   ' + requestUrl + ' (error)')
        })
        this.addEventListener('timeout', function (this: any, _event: any) {
            tracker.decrement()
            log.error('Request END:   ' + requestUrl + ' (timeout)')
        })
        return oldXhrOpen.bind(this)(method, requestUrl)
    }
}

export function trackDocumentLoad(window: any, tracker: Tracker) {
    tracker.increment()
    window.document.addEventListener('load', () => {
        tracker.decrement()
    })
}

export function trackTimers(window: any, tracker: Tracker, realTime?: (timeout: number) => number) {
    const activeTimers = new Set<number>()
    const oldSetTimeout = window.setTimeout
    let neverHandle = 0
    window.setTimeout = function (this, handler: () => void, timeout: number) {
        const realTimeout = realTime ? realTime(timeout) : timeout
        if (realTimeout === Number.POSITIVE_INFINITY) {
            return --neverHandle
        }
        tracker.increment()
        const handle = oldSetTimeout.bind(this)(() => {
            activeTimers.delete(handle)
            handler()
            tracker.decrement()
        }, realTimeout)
        activeTimers.add(handle)
        return handle
    }
    const oldClearTimeout = window.clearTimeout
    window.clearTimeout = function (this, handle: number) {
        if (activeTimers.has(handle)) {
            tracker.decrement()
            activeTimers.delete(handle)
        }
        oldClearTimeout.bind(this)(handle)
    }

    window.setInterval = function (this) {
        return --neverHandle
    }
}

export function trackImageLoading(window: any, tracker: Tracker) {
    const innerElementFactory = window.document.createElement.bind(window.document)
    window.document.createElement = (localName: string) => {
        const inner = innerElementFactory(localName)
        switch (localName.toLowerCase()) {
            case 'img': {
                let onLoad = () => { /**/ }
                let onError = () => { /**/ }
                const innerSrcGetter = inner.__lookupGetter__('src').bind(inner)
                const innerSrcSetter = inner.__lookupSetter__('src').bind(inner)
                inner.onload = () => {
                    onLoad()
                    tracker.decrement()
                }
                inner.onerror = () => {
                    onError()
                    tracker.decrement()
                }
                Object.defineProperties(inner, {
                    src: {
                        configurable: true,
                        get() {
                            return innerSrcGetter()
                        },
                        set(value: string) {
                            tracker.increment()
                            innerSrcSetter(value)
                        },
                    },
                    onload: {
                        configurable: true,
                        set(handler: () => void) {
                            onLoad = handler
                        },
                    },
                    onerror: {
                        configurable: true,
                        set(handler: () => void) {
                            onError = handler
                        },
                    },
                })
                break
            }
        }
        return inner
    }
}
