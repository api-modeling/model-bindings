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

    private static formatMap : any = {
/*
        'JsonPayloadParser',
        'Oas20Parser',
        'Oas20YamlParser',
        'Oas30Parser',
        'Oas30YamlParser',
        'Raml10Parser',
        'RamlParser',
        'VocabulariesParser',
        'YamlPayloadParser',
        'AmfGraphParser',
*/
        "RAML 1.0": {'application/yaml' : 'Raml10Parser'},
        "OAS 2.0": {'application/json': 'Oas20Parser', 'application/yaml': 'Oas20YamlParser'},
        "OAS 3.0": {'application/json': 'Oas30Parser', 'application/yaml': 'Oas30YamlParser'},
        "OAS 3.0.0": {'application/json': 'Oas30Parser', 'application/yaml': 'Oas30YamlParser'},
        "AMF Graph": {'application/json' : "AmfGraphParser", 'application/ld+json': "AmfGraphParser"}
    }

    private parsedUnit: Promise<amf.model.document.BaseUnit>;
    private initialized = false;
    private parsed = false;
    private syntax: string;
    private format: string;
    private loader?: amf.resource.ResourceLoader

    constructor(specUrl: string, format: string, syntax: string, loader?: amf.resource.ResourceLoader) {
        this.specUrl = specUrl;
        this.format = format;
        this.syntax = syntax;
        if (syntax != ApiParser.YAML && syntax != ApiParser.JSON && syntax != ApiParser.JSONLD) {
            throw new Error(`Syntax must be either ${ApiParser.YAML}, ${ApiParser.JSON}, or ${ApiParser.JSONLD}`)
        }
        if (format != ApiParser.JSON_SCHEMA && format != ApiParser.RAML1 && format != ApiParser.OAS2 && format != ApiParser.OAS3 && format != ApiParser.AMF_GRAPH) {
            throw new Error(`Format must be either '${ApiParser.RAML1}', '${ApiParser.OAS2}', '${ApiParser.OAS3}', '${ApiParser.JSON_SCHEMA}' or ${ApiParser.AMF_GRAPH}`);
        }

        if (loader){
            this.loader = loader
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
        if (this.loader){
            const fetched = await this.loader.fetch(this.specUrl)
            const text = fetched.stream.toString()
            let env = new amf.client.environment.Environment() //amf.client.DefaultEnvironment.apply();
            env = env.addClientLoader(this.loader)

            /* Removing for temp fix as this call doesn't work
            const baseUnit = await amf.Core
                .parser(this.format, this.syntax, env)
                .parseStringAsync(this.specUrl,text)
            */
            // Kluge fix for above
            try {
                const parserChoices = ApiParser.formatMap[this.format];
                if (!parserChoices){
                    throw new Error("Could not find parser choices for "+this.format)
                }
                const parserName = parserChoices[this.syntax]
                if (!parserName){
                    throw new Error("Could not find parser choices for "+this.format+" with "+this.syntax)
                }
                const baseUnit = await new (<any>amf)[parserName/*'Raml10Parser'*/](env).parseStringAsync(this.specUrl, text)

                this.parsed = true;
                return baseUnit
            } catch (error) {
                console.log("parse error: "+error)
                throw error
            }
            //const baseUnit = await new (<any>amf)['Aml10Parser'](env).parseStringAsync(this.specUrl, text)

        } else {
            const baseUnit = await amf.Core
            .parser(this.format, this.syntax)
            .parseFileAsync(this.specUrl)
            this.parsed = true;
            return baseUnit
        }
    }
}