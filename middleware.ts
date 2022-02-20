import { AbortablePromise, ConstructorOptions, DOMWindow, FetchOptions, ResourceLoader } from 'jsdom'

type Middleware = (config: ConstructorOptions) => ConstructorOptions

type ResourceHandler = (url: string, options: FetchOptions, inner: (url: string, options: FetchOptions) => Promise<Buffer> | null) => Promise<Buffer> | null

type StatelessImplementation = {
    resourceHandler?: ResourceHandler
    init?: (window: DOMWindow) => void
}
type StatefulImplementation<TState> = {
    state: () => TState
    resourceHandler?: (url: string, options: FetchOptions, state: TState, inner: (url: string, options: FetchOptions) => Promise<Buffer> | null) => Promise<Buffer> | null
    init?: (window: DOMWindow, state: TState) => void
}

function isStateful<TState>(implementation: StatelessImplementation | StatefulImplementation<TState>): implementation is StatefulImplementation<TState> {
    return !!(implementation as any).state
}

export function middleware<TState>(implementation: StatelessImplementation | StatefulImplementation<TState>): Middleware {
    if (isStateful(implementation)) {
        return config => {
            const state = implementation.state()
            return {
                ...config,
                ...implementation.resourceHandler && {
                    resources: new ResourceLoaderDecorator(config.userAgent, (u, o, i) => implementation.resourceHandler!(u, o, state, i), config.resources),
                },
                ...implementation.init && {
                    beforeParse: window => {
                        config.beforeParse?.(window)
                        implementation.init?.(window, state)
                    },
                },
            }
        }
    } else {
        return config => {
            return {
                ...config,
                ...implementation.resourceHandler && {
                    resources: new ResourceLoaderDecorator(config.userAgent, implementation.resourceHandler, config.resources),
                },
                ...implementation.init && {
                    beforeParse: window => {
                        config.beforeParse?.(window)
                        implementation.init!(window)
                    },
                },
            }
        }
    }
}

export function wrapFetch<T>(wrapper: (innerResult: Promise<T>) => Promise<T>, innerFetch: Promise<T> | null) {
    if (!innerFetch) {
        return null
    }
    return wrapper(innerFetch)
}

export function mapFetch<T>(
    url: string, options: FetchOptions, getter: () => T | undefined, map: (result: T) => Promise<Buffer>, inner: (url: string, options: FetchOptions) => Promise<Buffer> | null) {
    const result = getter()
    if (result) {
        return map(result)
    }
    return inner(url, options)
}

class ResourceLoaderDecorator extends ResourceLoader {
    #inner
    #handler

    constructor(userAgent: string | undefined, handler: ResourceHandler, inner?: ResourceLoader | 'usable') {
        super({ userAgent })
        this.#handler = handler
        this.#inner = inner
    }

    fetch(url: string, options: FetchOptions) {
        return asAbortable(
            this.#handler(url, options, (u, o) => this.#inner && this.#inner !== 'usable' ? this.#inner.fetch(u, o) : super.fetch(u, o)))
    }
}

function asAbortable<T>(p: Promise<T> | null): AbortablePromise<T> | null {
    if (!p) {
        return p
    }
    const ap: any = p
    ap.abort = () => { console.log('Abort ignored') }
    return ap
}

class UseStep {
    #previous?
    #middleware?

    constructor(previous?: UseStep, mw?: Middleware) {
        this.#previous = previous
        this.#middleware = mw
    }

    // tslint:disable-next-line: no-shadowed-variable
    use(middleware: Middleware): UseStep {
        return new UseStep(this, middleware)
    }

    config(config: ConstructorOptions): ConstructorOptions {
        if (this.#previous) {
            config = this.#previous.config(config)
        }
        if (this.#middleware) {
            config = this.#middleware(config)
        }
        return config
    }
}

export function app(): UseStep {
    return new UseStep()
}
