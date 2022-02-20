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

type TextMeasure = (font: string, text: string) => { height: number, width: number, descent: number }

export function monkeyPatch(window: any, textMeasure: TextMeasure) {
    Object.defineProperty(window.navigator, 'vendor', {
        value: 'Google Inc.',
    })

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
