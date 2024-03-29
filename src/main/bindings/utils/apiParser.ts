import * as amf from '@api-modeling/amf-client-js';

export class ApiParser {
    private specUrl: string;


    public static  RAML1 = "RAML 1.0";
    public static OAS3 = "OAS 3.0";
    public static OAS2 = "OAS 2.0";
    public static AMF_GRAPH = "AMF Graph"
    public static ASYNC2 = "ASYNC 2.0"
    public static JSON_SCHEMA = "JSON Schema";

    public static YAML = "application/yaml";
    public static JSON = "application/json";
    public static JSONLD = "application/ld+json";
    private static formatMap : any = {

        "RAML 1.0": {'application/yaml' : amf.Raml10Parser},
        "OAS 2.0": {'application/json': amf.Oas20Parser, 'application/yaml': amf.Oas20YamlParser},
        "OAS 3.0": {'application/json': amf.Oas30Parser, 'application/yaml': amf.Oas30YamlParser},
        "OAS 3.0.0": {'application/json': amf.Oas30Parser, 'application/yaml': amf.Oas30YamlParser},
        // @ts-ignore
        "ASYNC 2.0": {'application/json': amf.Async20JsonParser, 'application/yaml': amf.Async20Parser},
        // @ts-ignore
        "Async 2.0": {'application/json': amf.Asyn20JsonParser, 'application/yaml': amf.Async20Parser},
        // @ts-ignore
        "AMF Graph": {'application/json' : amf.AmfGraphParser, 'application/ld+json': amf.AmfGraphParser}
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
        if (format != ApiParser.JSON_SCHEMA && format != ApiParser.RAML1 && format != ApiParser.OAS2 && format != ApiParser.OAS3 && format != ApiParser.AMF_GRAPH && format != ApiParser.ASYNC2 && format != "Async 2.0") {
            throw new Error(`Format must be either '${ApiParser.RAML1}', '${ApiParser.OAS2}', '${ApiParser.OAS3}', '${ApiParser.JSON_SCHEMA}' 'Async 2.0' or ${ApiParser.AMF_GRAPH}`);
        }

        if (loader){
            this.loader = loader
        }
        this.parsedUnit = this.parse();
    }

    protected async init() {
        if (!this.initialized) {
            amf.plugins.document.WebApi.register();
            amf.plugins.document.Vocabularies.register();
            amf.plugins.features.AMFValidation.register();
            await amf.Core.init();
            this.initialized = true;
        }
    }

    async resolve(baseUnit : any, aparser: any){ 
        const mr = new amf.ModelResolver()
        const endies = mr.getEndpoints(baseUnit)
        
        const rezzies = mr.getResourceTypes(baseUnit)
        const traits = mr.getTraits(baseUnit)
        
        const report = await aparser.reportValidation(this.syntax)
        if (report.conforms){
            endies.forEach((e : any) => mr.resolveEndpoint(e,baseUnit))
        }

    }
    async parse(): Promise<amf.model.document.BaseUnit> {

        await this.init();
        const mr = new amf.ModelResolver()
        if (this.loader){
            const fetched = await this.loader.fetch(this.specUrl);
            const text = fetched.stream.toString();
            let env = new amf.client.environment.Environment();
            env = env.addClientLoader(this.loader);
            const parser = this.findParser(this.format);
            try {
                const aparser = await new parser(env)
                const baseUnit = await aparser.parseStringAsync(this.specUrl, text);
                this.parsed = true
                const rezzies = mr.getResourceTypes(baseUnit)
                const traits = mr.getTraits(baseUnit)
                try {
                    const report = await aparser.reportValidation(this.syntax)
                    
                    if (report.conforms && this.format === ApiParser.RAML1 && (rezzies.length + traits.length > 0)){
                        const baserUnit = new amf.Raml10Resolver().resolve(baseUnit, amf.ResolutionPipeline.EDITING_PIPELINE)
                        this.parsed = true
                        return baserUnit
                    } else {
                        return baseUnit;
                    }
                } catch (error) {
                    return baseUnit;
                }
            } catch (error) {
                throw error
            }
        } else {
            const aparser = amf.Core
                .parser(this.format, this.syntax)
            const baseUnit = await aparser.parseFileAsync(this.specUrl)
            this.parsed = true;
            try {
                const rezzies = mr.getResourceTypes(baseUnit)
                const traits = mr.getTraits(baseUnit)
                const report = await aparser.reportValidation(this.format, this.syntax)
                if (report.conforms && this.format === ApiParser.RAML1 && (rezzies.length + traits.length > 0)){
                    const baserUnit = new amf.Raml10Resolver().resolve(baseUnit, amf.ResolutionPipeline.DEFAULT_PIPELINE)
                    this.parsed = true
                    return baserUnit
                } else {
                    return baseUnit
                }
            } catch (error) {
                return baseUnit
            }
        }
    }

    private findParser(format: string): any {
        const parserChoices = ApiParser.formatMap[format];
        if (!parserChoices){
            throw new Error("Could not find parser choices for "+this.format);
        }
        const parser = parserChoices[this.syntax];
        if (!parser){
            throw new Error("Could not find parser choices for "+this.format+" with "+this.syntax);
        }

        return parser;
    }
}