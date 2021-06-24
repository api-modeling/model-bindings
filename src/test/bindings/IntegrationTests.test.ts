import { describe } from 'mocha'
import { assert } from 'chai';
import {APIContractBindingsPlugin} from "../../main/bindings/APIContractBindingsPlugin";
import * as fs from 'fs';
import {ApiParser} from "../../main/bindings/utils/apiParser";
import exp from "constants";
import {ConfigurationParameter} from "../../main";

interface TestDescriptor {
    mainFile: string
    format: string
    syntax: string
    export: boolean
}
const tests: {[path:string]: TestDescriptor} = {
    "src/test/resources/integration/arc-analytics": {
        mainFile: "api.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML,
        export: true
    },
    "src/test/resources/integration/arc-modules": {
        mainFile: "arc-api.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML,
        export: true
    },
    "src/test/resources/integration/catalyst": {
        mainFile: "retail_locations_system_api.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML,
        export: true
    },
    "src/test/resources/integration/covid19": {
        mainFile: "covid-data-tracking-api.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML,
        export: true
    },
    "src/test/resources/integration/customers": {
        mainFile: "shared-customers-dapi.json",
        format: ApiParser.OAS2,
        syntax: ApiParser.JSON,
        export: true
    },
    "src/test/resources/integration/drive": {
        mainFile: "api.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML,
        export: true
    },
    "src/test/resources/integration/paypal_orders": {
        mainFile: "orders_v2_api-spec.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML,
        export: true
    },
    "src/test/resources/integration/paypal_payments": {
        mainFile: "payments_v2_api-spec.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML,
        export: true
    },

    "src/test/resources/integration/petstore": {
        mainFile: "petstore.json",
        format: ApiParser.OAS2,
        syntax: ApiParser.JSON,
        export: true
    },
    "src/test/resources/integration/raml_example": {
        mainFile: "api.raml",
        format: ApiParser.RAML1,
        syntax: ApiParser.YAML,
        export: true
    }
}

const deleteFolderRecursive = function(path: string) {
    var files = [];
    if( fs.existsSync(path) ) {
        files = fs.readdirSync(path);
        files.forEach(function(file,index){
            var curPath = path + "/" + file;
            if(fs.lstatSync(curPath).isDirectory()) { // recurse
                deleteFolderRecursive(curPath);
            } else { // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
};

Object.keys(tests).forEach((path) => {
    const test = tests[path];
    const fullPath = path + "/" + test.mainFile;

    describe(`Integration test ${path}`, function() {
        this.timeout(50000);

        it ("Should import/export correctly the API", async() => {
            const apiPlugin = new APIContractBindingsPlugin();
            const config = [{name: "format", value: test.format}, {name: "syntax", value: test.syntax}];

            const textData = fs.readFileSync(fullPath).toString();

            const parsed = await apiPlugin.import(config,[{ url: "file://" + fullPath, text: textData}]);

            deleteFolderRecursive(path + "/_model/");
            fs.mkdirSync(path + "/_model/")
            let proms = parsed.map(async (i) => {
                const text = await i.toYaml()
                return { text: text, path: path + "/_model/" + i.location + ".yaml" }
            });
            let finals = await Promise.all(proms);

            finals.forEach((result) => {
                fs.writeFileSync(result.path, result.text);
            });


            if (test.export) {
                const export_configs: {[format: string]: ConfigurationParameter[]} = {
                    "raml": [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}],
                    "oas":  [{name: "format", value: ApiParser.OAS3 + ".0"}, {name: "syntax", value: ApiParser.JSON}],
                }

                const promises = Object.keys(export_configs).map(async (format) => {
                    const exportConfig: ConfigurationParameter[] = export_configs[format];
                    const components = fullPath.split("/")
                    components.pop();

                    const exported = await apiPlugin.export(exportConfig, parsed)

                    const exportPath = components.join("/") + `/_export_${format}`
                    if (fs.existsSync(exportPath)) {
                        deleteFolderRecursive(exportPath);
                    }
                    if (!fs.existsSync(exportPath)) {
                        fs.mkdirSync(exportPath)
                    }
                    exported.forEach((out) => {
                        fs.writeFileSync(exportPath + "/" + (out.url.startsWith('file:/') ? out.url.substring(6) : out.url), out.text);
                    });
                });
                await Promise.all(promises)
            }

            assert(true);
        });
    });
});