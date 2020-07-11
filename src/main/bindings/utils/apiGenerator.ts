import * as amf from '@api-modeling/amf-client-js';
import base = Mocha.reporters.base;
import {ApiParser} from "./apiParser";

export class ApiGenerator {


    private initialized = false;
    private syntax: string;
    private format: string;
    private baseUnit: amf.model.document.BaseUnit;

    constructor(baseUnit: amf.model.document.BaseUnit, format: string, syntax: string) {
        this.baseUnit = baseUnit
        this.format   = format;
        this.syntax   = syntax;

        if (syntax != ApiParser.YAML && syntax != ApiParser.JSON && syntax != ApiParser.JSONLD) {
            throw new Error(`Syntax must be either ${ApiParser.YAML}, ${ApiParser.JSON}, or ${ApiParser.JSONLD}`)
        }
        if (format != ApiParser.JSON_SCHEMA && format != ApiParser.RAML1 && format != ApiParser.OAS2 && format != ApiParser.OAS3 && format != ApiParser.AMF_GRAPH) {
            throw new Error(`Format must be either '${ApiParser.RAML1}', '${ApiParser.OAS2}', '${ApiParser.OAS3}', '${ApiParser.JSON_SCHEMA}' or ${ApiParser.AMF_GRAPH}`);
        }

    }

    protected async init() {
        if (!this.initialized) {
            amf.plugins.document.WebApi.register();
            await amf.Core.init();
            this.initialized = true;
        }
    }

    async generate(): Promise<string> {
        await this.init();
        const generated = await amf.Core
            .generator(this.format, this.syntax)
            .generateString(this.baseUnit);

        return generated
    }
}