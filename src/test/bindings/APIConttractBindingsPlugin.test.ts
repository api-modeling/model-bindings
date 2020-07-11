import { describe } from 'mocha'
import { assert } from 'chai';
import {APIContractBindingsPlugin} from "../../main/bindings/APIContractBindingsPlugin";
import * as fs from 'fs';
import { Module, DataModel, BindingsModel, ModularityDialect, DataModelDialect, ModelBindingsDialect } from "@api-modeling/api-modeling-metadata"
import {ApiParser} from "../../main/bindings/utils/apiParser";
import exp from "constants";

describe('APIBindingsPlugin', function() {
    this.timeout(5000);
    it('should parse RAML specs and generate matching modules', async function () {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "src/test/resources/library.raml";
        const textData = fs.readFileSync(textUrl).toString();
        const parsed = await apiPlugin.import(
            [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}],
            [{ url: "file://"+ textUrl, text: textData}]
        );
        assert.equal(parsed.length, 4); // all the models: modules, entities, bindings

        const modules = parsed.filter((parsed) => parsed instanceof ModularityDialect)
        const dataModels = parsed.filter((parsed) => parsed instanceof DataModelDialect)
        const bindingsModels = parsed.filter((parsed) => parsed instanceof ModelBindingsDialect)

        const allModules = modules.map((module) => (<Module>module.encodesWrapper!).dataModels!.length ).reduce((acc, i) => { return acc + i }, 0)
        const allEntities = dataModels.map((module) => (<DataModel>module.encodesWrapper!).entities!.length ).reduce((acc, i) => { return acc + i }, 0)
        const allBindings = bindingsModels.map((module) => (<BindingsModel>module.encodesWrapper!).bindings!.length ).reduce((acc, i) => { return acc + i }, 0)

        assert.equal(allModules, 2)
        assert.equal(dataModels.length, 2)
        assert.equal(allEntities, 8)
        assert.equal(allBindings, dataModels.length)
    });

    it ('should export API models to RAML specs', async function() {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "src/test/resources/library2.raml";
        const textData = fs.readFileSync(textUrl).toString();
        const config = [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}];
        const parsed = await apiPlugin.import(config,[{ url: "file://"+ textUrl, text: textData}]);

        const generated = await apiPlugin.export(config, parsed);

        const parsedLibrary2 = "#%RAML 1.0 Library\n" +
            "types:\n" +
            "  Person:\n" +
            "    description: a human being\n" +
            "    type: library3_raml.Animal\n" +
            "    properties:\n" +
            "      name:\n" +
            "        type: string\n" +
            "      gender:\n" +
            "        type: string\n" +
            "      age:\n" +
            "        type: integer\n" +
            "  Family:\n" +
            "    description: a human molecule\n" +
            "    properties:\n" +
            "      parents:\n" +
            "        items: Person\n" +
            "      children:\n" +
            "        items: Person\n" +
            "  AliveThings:\n" +
            "    type: library3_raml.Animal | library3_raml.Vegetable\n" +
            "uses:\n" +
            "  library3_raml: data_model_7a5862da7f051870bf9f1e65903c49f4.raml\n";

        const parsedLibrary3 = "#%RAML 1.0 Library\n" +
            "types:\n" +
            "  Animal:\n" +
            "    description: not a plant, not a fungus\n" +
            "    properties:\n" +
            "      size:\n" +
            "        type: number\n" +
            "        format: float\n" +
            "      birthDate:\n" +
            "        type: datetime\n" +
            "  Vegetable:\n" +
            "    description: Green organic matter\n" +
            "    properties:\n" +
            "      height:\n" +
            "        type: number\n" +
            "        format: float\n";

        const expected: {[url: string]: string } = {
            "data_model_2b5cfe8bf55d68d44943b00af096f7b4.raml": parsedLibrary2,
            "data_model_7a5862da7f051870bf9f1e65903c49f4.raml": parsedLibrary3
        }
        generated.forEach((g) => {
            const expectedText = expected[g.url];
            assert.isNotNull(expectedText)
            assert.equal(g.text, expectedText)
        });
    });
});