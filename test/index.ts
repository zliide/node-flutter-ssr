import assert from 'assert'
import { readFile, writeFile } from 'fs/promises'
import { createServer } from 'http'
import { Renderer } from '../index.js'
import { measureText } from './text.js'
import { memoize } from 'canvas-recorder'

describe('renderer', () => {
    describe('can render a skeleton app', () => {
        const path = './test/app/build/web/'
        let server: { close: () => void } | undefined
        before(function (this) {
            server = fileServer(path, 51746)
        })
        after(function (this) {
            server?.close()
        })

        const renderer = new Renderer(
            name => readFile(path + name),
            'http://[::1]:51746/', [], memoize(2000, measureText))
        for (const testCase of [
            {
                uri: '', terms: [
                    'Sample Items',
                    'SampleItem 1',
                    'SampleItem 2',
                    'SampleItem 3',
                ],
            },
            {
                uri: '/sample_item', terms: [
                    'Item Detail',
                    'More Information Here',
                ],
            },
            {
                uri: '/settings', terms: [
                    'Settings',
                    'System Theme',
                ],
            },
        ]) {
            it('route ' + testCase.uri, async () => {
                const log = new Log()
                const markup = await renderer.render(log, 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', testCase.uri)
                try {
                    assert.ok(log.errorFree, `Errors was logged rendering ${testCase.uri}`)
                    for (const term of testCase.terms) {
                        assert.ok(markup.includes(term), `${testCase.uri} does not contain "${term}"`)
                    }
                } catch (e) {
                    await writeFile('test/error-result.html', markup)
                    throw e
                }
            }).slow(2000).timeout(10000)
        }
    })
})

class Log {
    #errorFree = true

    get errorFree() {
        return this.#errorFree
    }

    trace() { /**/ }
    debug() { /**/ }
    info() { /**/ }
    warn(message: string, error?: unknown) {
        this.#print(message, error)
    }
    error(message: string, error?: unknown) {
        this.#errorFree = false
        this.#print(message, error)
    }
    fatal(message: string, error?: unknown) {
        this.#errorFree = false
        this.#print(message, error)
    }

    #print(message: string, error?: unknown) {
        console.error(message)
        if (error) {
            console.error(error)
        }
    }
}

function fileServer(path: string, port: number) {
    const server = createServer(async (request, response) => {
        try {
            const content = await readFile(path + request.url)
            response.writeHead(200)
            response.end(content, 'utf-8')
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                response.writeHead(404)
                response.end()
            }
            else {
                response.writeHead(500)
                response.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n')
                response.end()
            }
        }
    }).listen(port)
    return {
        close: () => server.close(),
    }
}
