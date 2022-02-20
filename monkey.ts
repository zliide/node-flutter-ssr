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

    const innerElementNSFactory = window.document.createElementNS.bind(window.document)
    window.document.createElementNS = (namespace: string, localName: string) => {
        const element = innerElementNSFactory(namespace, localName)
        if (namespace === 'http://www.w3.org/2000/svg') {
            const extension = svgExtensions[localName]
            if (extension) {
                const [className, _, properties] = extension
                element.__proto__ = window[className].prototype
                Object.defineProperties(element, {
                    ...properties,
                    [Symbol.toStringTag]: { value: className, configurable: true },
                })
            }
        }
        return element
    }
    for (const [className, statics] of Object.values(svgExtensions)) {
        const type: any = function Class() { /**/ }
        type.prototype.__proto__ = window.SVGElement.prototype
        for (const [sp, sv] of Object.entries(statics)) {
            type[sp] = sv
            type.prototype[sp] = sv
        }
        window[className] = type
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

class SVGValue {
    // SVG_LENGTHTYPE_CM = 6
    // SVG_LENGTHTYPE_EMS = 3
    // SVG_LENGTHTYPE_EXS = 4
    // SVG_LENGTHTYPE_IN = 8
    // SVG_LENGTHTYPE_MM = 7
    // SVG_LENGTHTYPE_NUMBER = 1
    // SVG_LENGTHTYPE_PC = 10
    // SVG_LENGTHTYPE_PERCENTAGE = 2
    // SVG_LENGTHTYPE_PT = 9
    // SVG_LENGTHTYPE_PX = 5
    // SVG_LENGTHTYPE_UNKNOWN = 0

    readonly unitType = 2
    value = 0.1
    valueAsString = '10%'
    valueInSpecifiedUnits = 10

    convertToSpecifiedUnits(_unitType: number) { /**/ }
    newValueSpecifiedUnits(_unitType: number, _valueInSpecifiedUnits: number) { /**/ }
}

class SVGAnimatedValue {
    baseVal = new SVGValue()
    animVal = new SVGValue()
}

class SVGList {
    readonly items: SVGValue[] = []

    appendItem(value: SVGValue) {
        this.items.push(value)
    }
}

class SVGAnimatedList {
    baseVal = new SVGList()
    animVal = new SVGList()
}

const svgFilterPrimitiveStandardAttributes = {
    x: { enumerable: true, value: new SVGAnimatedValue() },
    y: { enumerable: true, value: new SVGAnimatedValue() },
    width: { enumerable: true, value: new SVGAnimatedValue() },
    height: { enumerable: true, value: new SVGAnimatedValue() },
    result: { enumerable: true, value: new SVGAnimatedValue() },
}
const svgURIReferenceAttributes = {
    href: { enumerable: true, value: new SVGAnimatedValue() },
}


const svgExtensions: { [localName: string]: [string, object, PropertyDescriptorMap] } = {
    path: ['SVGPathElement', {}, {}],
    filter: ['SVGFilterElement', {}, {
        ...svgURIReferenceAttributes,
        x: { enumerable: true, value: new SVGAnimatedValue() },
        y: { enumerable: true, value: new SVGAnimatedValue() },
        width: { enumerable: true, value: new SVGAnimatedValue() },
        height: { enumerable: true, value: new SVGAnimatedValue() },
        filterUnits: { enumerable: true, value: new SVGAnimatedValue() },
        primitiveUnits: { enumerable: true, value: new SVGAnimatedValue() },
    }],
    feColorMatrix: ['SVGFEColorMatrixElement',
        {
            SVG_FECOLORMATRIX_TYPE_UNKNOWN: 0,
            SVG_FECOLORMATRIX_TYPE_MATRIX: 1,
            SVG_FECOLORMATRIX_TYPE_SATURATE: 2,
            SVG_FECOLORMATRIX_TYPE_HUEROTATE: 3,
            SVG_FECOLORMATRIX_TYPE_LUMINANCETOALPHA: 4,
        }, {
            ...svgFilterPrimitiveStandardAttributes,
            in1: { enumerable: true, value: new SVGAnimatedValue() },
            type: { enumerable: true, value: new SVGAnimatedValue() },
            values: { enumerable: true, value: new SVGAnimatedList() },
        }],
    feFlood: ['SVGFEFloodElement', {}, {
        ...svgFilterPrimitiveStandardAttributes,
    }],
    feBlend: ['SVGFEBlendElement',
        {
            SVG_FEBLEND_MODE_UNKNOWN: 0,
            SVG_FEBLEND_MODE_NORMAL: 1,
            SVG_FEBLEND_MODE_MULTIPLY: 2,
            SVG_FEBLEND_MODE_SCREEN: 3,
            SVG_FEBLEND_MODE_DARKEN: 4,
            SVG_FEBLEND_MODE_LIGHTEN: 5,
            SVG_FEBLEND_MODE_OVERLAY: 6,
            SVG_FEBLEND_MODE_COLOR_DODGE: 7,
            SVG_FEBLEND_MODE_COLOR_BURN: 8,
            SVG_FEBLEND_MODE_HARD_LIGHT: 9,
            SVG_FEBLEND_MODE_SOFT_LIGHT: 10,
            SVG_FEBLEND_MODE_DIFFERENCE: 11,
            SVG_FEBLEND_MODE_EXCLUSION: 12,
            SVG_FEBLEND_MODE_HUE: 13,
            SVG_FEBLEND_MODE_SATURATION: 14,
            SVG_FEBLEND_MODE_COLOR: 15,
            SVG_FEBLEND_MODE_LUMINOSITY: 16,
        }, {
            ...svgFilterPrimitiveStandardAttributes,
            in1: { enumerable: true, value: new SVGAnimatedValue() },
            in2: { enumerable: true, value: new SVGAnimatedValue() },
            mode: { enumerable: true, value: new SVGAnimatedValue() },
        }],
    feComposite: ['SVGFECompositeElement',
        {
            SVG_FECOMPOSITE_OPERATOR_UNKNOWN: 0,
            SVG_FECOMPOSITE_OPERATOR_OVER: 1,
            SVG_FECOMPOSITE_OPERATOR_IN: 2,
            SVG_FECOMPOSITE_OPERATOR_OUT: 3,
            SVG_FECOMPOSITE_OPERATOR_ATOP: 4,
            SVG_FECOMPOSITE_OPERATOR_XOR: 5,
            SVG_FECOMPOSITE_OPERATOR_ARITHMETIC: 6,
        }, {
            ...svgFilterPrimitiveStandardAttributes,
            in1: { enumerable: true, value: new SVGAnimatedValue() },
            in2: { enumerable: true, value: new SVGAnimatedValue() },
            k1: { enumerable: true, value: new SVGAnimatedValue() },
            k2: { enumerable: true, value: new SVGAnimatedValue() },
            k3: { enumerable: true, value: new SVGAnimatedValue() },
            k4: { enumerable: true, value: new SVGAnimatedValue() },
            operator: { enumerable: true, value: new SVGAnimatedValue() },
        }],
    feImage: ['SVGFEImageElement', {}, {
        ...svgFilterPrimitiveStandardAttributes,
        ...svgURIReferenceAttributes,
        preserveAspectRatio: { enumerable: true, value: new SVGAnimatedValue() },
    }],
}
