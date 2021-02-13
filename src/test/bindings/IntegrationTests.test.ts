import { describe } from 'mocha'
import { assert } from 'chai';
import {APIContractBindingsPlugin} from "../../main/bindings/APIContractBindingsPlugin";
import * as fs from 'fs';
import {ApiParser} from "../../main/bindings/utils/apiParser";

interface TestDescriptor {
    mainFile: string,
    format: string
    syntax: string
}
const tests: {[path:string]: TestDescriptor} = {
    "src/test/resources/integration/arc-analytics": {
        mainFile: "api.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML
    },
    "src/test/resources/integration/arc-modules": {
        mainFile: "arc-api.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML
    },
    "src/test/resources/integration/catalyst": {
        mainFile: "retail_locations_system_api.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML
    },
    "src/test/resources/integration/covid19": {
        mainFile: "covid-data-tracking-api.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML
    },
    "src/test/resources/integration/customers": {
        mainFile: "shared-customers-dapi.json",
        format: ApiParser.OAS2,
        syntax: ApiParser.JSON
    },
    "src/test/resources/integration/drive": {
        mainFile: "api.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML
    },
    "src/test/resources/integration/paypal_orders": {
        mainFile: "orders_v2_api-spec.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML
    },
    "src/test/resources/integration/paypal_payments": {
        mainFile: "payments_v2_api-spec.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML
    },
    "src/test/resources/integration/petstore": {
        mainFile: "petstore.json",
        format: ApiParser.OAS2,
        syntax: ApiParser.JSON
    },
    "src/test/resources/integration/raml_example": {
        mainFile: "api.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML
    }
}

Object.keys(tests).forEach((path) => {
    const test = tests[path];
    const fullPath = path + "/" + test.mainFile;

    describe(`Integration test ${path}`, function() {
        this.timeout(5000);

        it ("Should import correctly the API", async() => {
            const apiPlugin = new APIContractBindingsPlugin();
            const config = [{name: "format", value: test.format}, {name: "syntax", value: test.syntax}];

            const textData = fs.readFileSync(fullPath).toString();

            const parsed = await apiPlugin.import(config,[{ url: "file://" + fullPath, text: textData}]);

            let proms = parsed.map(async (i) => {
                const text = await i.toYaml()
                return { text: text, path: path + "/_model/" + i.location + ".yaml" }
            });
            let finals = await Promise.all(proms);

            finals.forEach((result) => {
                fs.writeFileSync(result.path, result.text);
            });

            assert(true);
        });
    });
});