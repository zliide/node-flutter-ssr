export class Semaphore {
    #count = 0
    #resolve: ((stuffDone: boolean) => void) | undefined
    #promise: Promise<boolean> | undefined

    done() { return this.#promise ?? Promise.resolve(false) }

    increment() {
        if (++this.#count === 1) {
            this.#promise = new Promise<boolean>(resolve => this.#resolve = resolve)
        }
    }
    decrement() {
        if (--this.#count === 0) {
            this.#resolve!(true)
            this.#promise = undefined
            this.#resolve = undefined
        }
    }
    async wait<T>(promise: Promise<T> | null) {
        if (!promise) {
            return
        }
        this.increment()
        try {
            return await promise
        } finally {
            this.decrement()
        }
    }
}

type AbortSignal = { aborted: boolean }

export async function settled(window: any, semaphore: Semaphore, signal: AbortSignal | undefined) {
    do {
        if (signal?.aborted) {
            throw new Error('Rendering aborted while waiting for timers and network to settle.')
        }
        await new Promise<void>(resolve => window.queueMicrotask(resolve))
    } while (await semaphore.done())
}


interface Logger {
    trace(message: string, error?: unknown): void
    error(message: string, error?: unknown): void
}

export function trackNetworkRequests(log: Logger, window: any, semaphore: Semaphore) {
    const oldXhrOpen = window.XMLHttpRequest.prototype.open
    window.XMLHttpRequest.prototype.open = function (this, method: any, requestUrl: any) {
        semaphore.increment()
        log.trace('Request BEGIN: ' + requestUrl)
        this.addEventListener('loadend', () => {
            semaphore.decrement()
            log.trace('Request END:   ' + requestUrl)
        })
        this.addEventListener('abort', function (this: any, _event: any) {
            semaphore.decrement()
            log.error('Request END:   ' + requestUrl + ' (aborted)')
        })
        this.addEventListener('error', function (this: any, _event: any) {
            semaphore.decrement()
            log.error('Request END:   ' + requestUrl + ' (error)')
        })
        this.addEventListener('timeout', function (this: any, _event: any) {
            semaphore.decrement()
            log.error('Request END:   ' + requestUrl + ' (timeout)')
        })
        return oldXhrOpen.bind(this)(method, requestUrl)
    }
}

export function trackTimers(window: any, semaphore: Semaphore) {
    const activeTimers = new Set<number>()
    const oldSetTimeout = window.setTimeout
    window.setTimeout = function (this, handler: () => void, timeout: number) {
        semaphore.increment()
        const handle = oldSetTimeout.bind(this)(() => {
            semaphore.decrement()
            activeTimers.delete(handle)
            handler()
        }, timeout)
        activeTimers.add(handle)
        return handle
    }
    const oldClearTimeout = window.clearTimeout
    window.clearTimeout = function (this, handle: number) {
        if (handle && activeTimers.has(handle)) {
            semaphore.decrement()
            activeTimers.delete(handle)
        }
        oldClearTimeout.bind(this)(handle)
    }
}
