import { describe } from 'mocha'
import { assert } from 'chai';
import {CIMBindingsPlugin} from "../../main/bindings/CIMBindingsPlugin";
import * as fs from 'fs';
import * as graph from "../../main/bindings/utils/N3Graph";
import { Module, DataModel, BindingsModel, ModularityDialect, DataModelDialect, ModelBindingsDialect } from "@api-modeling/api-modeling-metadata"
import {VOCAB} from "../../main/bindings/cim/constants";
import {NamedNode, Quad_Subject} from "n3";

describe('CIMBindingsPlugin', function() {
    this.timeout(500000);
    const cimPlugin = new CIMBindingsPlugin();
    const textUrl = "src/test/resources/model.jsonld";
    const textData = fs.readFileSync(textUrl).toString();

    it('should parse CIM distribution and generate subject areas', async function () {
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

    it ('should export CIM distribution from a data model with the proper model bindings', async function () {
        const parsed = await cimPlugin.import([],[{ url: "file://"+ textUrl, text: textData}] );
        const config = [{name: "outputFile", value: "exported.jsonld"}, {name: "cimVersion", value: "0.2"}];
        const generated = await cimPlugin.export(config, parsed)

        const store = graph.store();
        await graph.loadGraph(textData, store);

        const storeParsed = graph.store();
        await graph.loadGraph(generated[0].text, storeParsed);

        fs.writeFileSync(textUrl.replace(".jsonld", ".json"), generated[0].text);

        let subjectAreas = store.getSubjects(VOCAB.RDF_TYPE, VOCAB.CIM_SUBJECT_AREA, null);
        let  entityGroups = store.getSubjects(VOCAB.RDF_TYPE, VOCAB.CIM_ENTITY_GROUP, null);
        let  shapes = store.getSubjects(VOCAB.RDF_TYPE, VOCAB.SH_SHAPE, null);

        assert.isNotEmpty(subjectAreas);
        assert.isNotEmpty(entityGroups);
        assert.isNotEmpty(shapes);

        subjectAreas.forEach((sa: Quad_Subject) => {
            const found = storeParsed.getQuads(sa.id, VOCAB.RDF_TYPE, VOCAB.CIM_SUBJECT_AREA, null)
            assert.equal(found.length, 1)
        });

        entityGroups.forEach((sa: Quad_Subject) => {
            const found = storeParsed.getQuads(sa.id, VOCAB.RDF_TYPE, VOCAB.CIM_ENTITY_GROUP, null)
            assert.equal(found.length, 1)
        });

        shapes.forEach((sa: Quad_Subject) => {
            const found = storeParsed.getQuads(sa.id, VOCAB.RDF_TYPE, VOCAB.SH_SHAPE, null)
            assert.equal(found.length, 1)
        });
    })
});