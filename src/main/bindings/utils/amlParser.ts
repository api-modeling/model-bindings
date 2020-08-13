import * as amf from '@api-modeling/amf-client-js';

export class AmlParser {
    private specUrl: string;


    private initialized = false;
    private text: string;

    constructor(specUrl: string, text: string) {
        this.specUrl = specUrl;
        this.text = text
    }


    protected async init() {
        if (!this.initialized) {
            amf.plugins.document.Vocabularies.register();
            await amf.Core.init();
            this.initialized = true;
        }
    }

    async parse(): Promise<amf.model.document.BaseUnit> {
        await this.init();
        const baseUnit = await amf.Core
            .parser("AML 1.0", "application/yaml")
            .parseStringAsync(this.specUrl, this.text)
        return baseUnit
    }
}