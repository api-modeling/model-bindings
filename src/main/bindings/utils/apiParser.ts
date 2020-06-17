import * as amf from '@api-modeling/amf-client-js';

export class ApiParser {
    private specUrl: string;

    public static  RAML1 = "RAML 1.0";
    public static OAS3 = "OAS 3.0";
    public static OAS2 = "OAS 2.0";
    public static AMF_GRAPH = "AMF Graph"

    public static JSON_SCHEMA = "JSON Schema";
    public static YAML = "application/yaml";
    public static JSON = "application/json";
    public static JSONLD = "application/ld+json";

    private parsedUnit: Promise<amf.model.document.BaseUnit>;
    private initialized = false;
    private parsed = false;
    private syntax: string;
    private format: string;

    constructor(specUrl: string, format: string, syntax: string) {
        this.specUrl = specUrl;
        this.format = format;
        this.syntax = syntax;

        if (syntax != ApiParser.YAML && syntax != ApiParser.JSON && syntax != ApiParser.JSONLD) {
            throw new Error(`Syntax must be either ${ApiParser.YAML}, ${ApiParser.JSON}, or ${ApiParser.JSONLD}`)
        }
        if (format != ApiParser.JSON_SCHEMA && format != ApiParser.RAML1 && format != ApiParser.OAS2 && format != ApiParser.OAS3 && format != ApiParser.AMF_GRAPH) {
            throw new Error(`Format must be either '${ApiParser.RAML1}', '${ApiParser.OAS2}', '${ApiParser.OAS3}', '${ApiParser.JSON_SCHEMA}' or ${ApiParser.AMF_GRAPH}`);
        }

        this.parsedUnit = this.parse();
    }


    protected async init() {
        if (!this.initialized) {
            amf.plugins.document.WebApi.register();
            await amf.Core.init();
            this.initialized = true;
        }
    }

    async parse(): Promise<amf.model.document.BaseUnit> {
        await this.init();
        const baseUnit = await amf.Core
            .parser(this.format, this.syntax)
            .parseFileAsync(this.specUrl);
        this.parsed = true;
        if (baseUnit instanceof amf.model.document.Module || baseUnit instanceof amf.model.document.Fragment) {
            return baseUnit
        } else {
            throw new Error(`Unsupported type of parsed BaseUnit ${baseUnit}`)
        }
    }
}