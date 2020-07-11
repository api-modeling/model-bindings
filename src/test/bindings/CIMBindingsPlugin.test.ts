import { describe } from 'mocha'
import { assert } from 'chai';
import {CIMBindingsPlugin} from "../../main/bindings/CIMBindingsPlugin";
import * as fs from 'fs';
import { Module, DataModel, BindingsModel, ModularityDialect, DataModelDialect, ModelBindingsDialect } from "@api-modeling/api-modeling-metadata"

describe('CIMBindingsPlugin', function() {
    this.timeout(5000);
    it('should parse CIM distribution and generate subject areas', async function () {
        const cimPlugin = new CIMBindingsPlugin();
        const textUrl = "src/test/resources/model.jsonld";
        const textData = fs.readFileSync(textUrl).toString();
        const parsed = await cimPlugin.import([],[{ url: "file://"+ textUrl, text: textData}] );
        assert.equal(parsed.length, 14); // all the models: modules, entities, bindings

        const modules = parsed.filter((parsed) => parsed instanceof ModularityDialect)
        const dataModels = parsed.filter((parsed) => parsed instanceof DataModelDialect)
        const bindingsModels = parsed.filter((parsed) => parsed instanceof ModelBindingsDialect)

        const allModules = modules.map((module) => (<Module>module.encodesWrapper!).nested!.length ).reduce((acc, i) => { return acc + i }, 0)
        const allEntities = dataModels.map((module) => (<DataModel>module.encodesWrapper!).entities!.length ).reduce((acc, i) => { return acc + i }, 0)
        const allBindings = bindingsModels.map((module) => (<BindingsModel>module.encodesWrapper!).bindings!.length ).reduce((acc, i) => { return acc + i }, 0)

        assert.equal(allModules, 6)
        assert.equal(dataModels.length, 12)
        assert.equal(allEntities, 127)
        assert.equal(allBindings, dataModels.length + allModules)

    });

});